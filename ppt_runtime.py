"""LibreOffice runtime discovery and safe headless conversion helpers."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


_ALLOWED_TARGET_FORMATS = frozenset({"pdf"})
_WINDOWS_CANDIDATES = (
    Path(r"C:\Program Files\LibreOffice\program\soffice.com"),
    Path(r"C:\Program Files\LibreOffice\program\soffice.exe"),
    Path(r"C:\Program Files (x86)\LibreOffice\program\soffice.com"),
    Path(r"C:\Program Files (x86)\LibreOffice\program\soffice.exe"),
)


class LibreOfficeRuntimeError(RuntimeError):
    """Stable application error raised by the document conversion boundary."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class LibreOfficeNotAvailable(LibreOfficeRuntimeError):
    def __init__(self) -> None:
        super().__init__("LIBREOFFICE_NOT_AVAILABLE", "LibreOffice 尚未安装或路径不可用")


@dataclass(frozen=True)
class LibreOfficeStatus:
    available: bool
    executable: str | None = None
    version: str | None = None
    error_code: str | None = None


class LibreOfficeRuntime:
    """Resolve and invoke ``soffice`` without a shell or shared user profile."""

    def __init__(
        self,
        executable: str | os.PathLike[str] | None = None,
        *,
        candidates: Iterable[Path] = _WINDOWS_CANDIDATES,
    ) -> None:
        self._explicit_executable = Path(executable).expanduser() if executable else None
        self._candidates = tuple(candidates)

    def resolve_executable(self) -> Path | None:
        requested = self._explicit_executable
        if requested is None:
            configured = os.getenv("LIBREOFFICE_PATH", "").strip()
            requested = Path(configured).expanduser() if configured else None
        if requested is not None:
            resolved = requested.resolve()
            return resolved if resolved.is_file() else None

        discovered = shutil.which("soffice") or shutil.which("libreoffice")
        if discovered:
            return Path(discovered).resolve()
        for candidate in self._candidates:
            resolved = candidate.resolve()
            if resolved.is_file():
                return resolved
        local_app_data = os.getenv("LOCALAPPDATA", "").strip()
        if local_app_data:
            programs_dir = Path(local_app_data) / "Programs"
            local_candidates = [
                programs_dir / "LibreOffice-AIPPT" / "program" / "soffice.com",
                *sorted(
                    programs_dir.glob("LibreOffice-*-AIPPT/program/soffice.com"),
                    reverse=True,
                ),
            ]
            for candidate in local_candidates:
                resolved = candidate.resolve()
                if resolved.is_file():
                    return resolved
        return None

    def require_executable(self) -> Path:
        executable = self.resolve_executable()
        if executable is None:
            raise LibreOfficeNotAvailable()
        return executable

    def probe(self) -> LibreOfficeStatus:
        try:
            executable = self.require_executable()
            result = subprocess.run(
                [str(executable), "--version"],
                check=False,
                capture_output=True,
                text=True,
                timeout=10,
                shell=False,
            )
        except (LibreOfficeNotAvailable, OSError, subprocess.SubprocessError):
            return LibreOfficeStatus(available=False, error_code="LIBREOFFICE_NOT_AVAILABLE")

        version = (result.stdout or result.stderr or "").strip().splitlines()
        return LibreOfficeStatus(
            available=result.returncode == 0,
            executable=str(executable),
            version=version[0][:160] if version else None,
            error_code=None if result.returncode == 0 else "LIBREOFFICE_PROBE_FAILED",
        )

    def build_convert_command(
        self,
        *,
        source: Path,
        output_dir: Path,
        profile_dir: Path,
        target_format: str = "pdf",
    ) -> list[str]:
        if target_format not in _ALLOWED_TARGET_FORMATS:
            raise ValueError("不支持的 LibreOffice 输出格式")
        source = source.resolve()
        if not source.is_file():
            raise FileNotFoundError(source)
        output_dir = output_dir.resolve()
        profile_dir = profile_dir.resolve()
        return [
            str(self.require_executable()),
            f"-env:UserInstallation={profile_dir.as_uri()}",
            "--headless",
            "--nologo",
            "--nodefault",
            "--nolockcheck",
            "--convert-to",
            target_format,
            "--outdir",
            str(output_dir),
            str(source),
        ]

    def convert_to_pdf(self, source: Path, output_dir: Path, *, timeout_seconds: int = 120) -> Path:
        source = source.resolve()
        output_dir = output_dir.resolve()
        output_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="ai-ppt-lo-profile-") as raw_profile:
            profile_dir = Path(raw_profile)
            command = self.build_convert_command(
                source=source,
                output_dir=output_dir,
                profile_dir=profile_dir,
                target_format="pdf",
            )
            try:
                result = subprocess.run(
                    command,
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=max(10, min(timeout_seconds, 600)),
                    shell=False,
                )
            except subprocess.TimeoutExpired as exc:
                raise LibreOfficeRuntimeError("LIBREOFFICE_TIMEOUT", "PPT 预览转换超时") from exc
            except OSError as exc:
                raise LibreOfficeRuntimeError("LIBREOFFICE_CONVERSION_FAILED", "无法启动 LibreOffice") from exc

        target = output_dir / f"{source.stem}.pdf"
        if result.returncode != 0 or not target.is_file():
            raise LibreOfficeRuntimeError("LIBREOFFICE_CONVERSION_FAILED", "LibreOffice 无法转换该 PPT 文件")
        return target
