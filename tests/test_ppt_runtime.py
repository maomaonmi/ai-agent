from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from ppt_runtime import LibreOfficeNotAvailable, LibreOfficeRuntime


def test_runtime_prefers_explicit_libreoffice_path(tmp_path: Path) -> None:
    executable = tmp_path / "soffice.exe"
    executable.write_bytes(b"placeholder")

    runtime = LibreOfficeRuntime(executable=str(executable))

    assert runtime.resolve_executable() == executable.resolve()


def test_runtime_raises_stable_error_when_libreoffice_is_missing(tmp_path: Path) -> None:
    runtime = LibreOfficeRuntime(executable=str(tmp_path / "missing-soffice.exe"))

    with pytest.raises(LibreOfficeNotAvailable) as exc_info:
        runtime.require_executable()

    assert exc_info.value.code == "LIBREOFFICE_NOT_AVAILABLE"


def test_runtime_discovers_user_scoped_ai_ppt_install(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    executable = (
        tmp_path
        / "Programs"
        / "LibreOffice-26.2.5-AIPPT"
        / "program"
        / "soffice.com"
    )
    executable.parent.mkdir(parents=True)
    executable.write_bytes(b"placeholder")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))

    runtime = LibreOfficeRuntime(candidates=())

    assert runtime.resolve_executable() == executable.resolve()


def test_convert_command_uses_isolated_user_profile(tmp_path: Path) -> None:
    executable = tmp_path / "soffice.exe"
    executable.write_bytes(b"placeholder")
    source = tmp_path / "source.pptx"
    source.write_bytes(b"PK\x03\x04")
    output_dir = tmp_path / "output"
    profile_dir = tmp_path / "profile"
    runtime = LibreOfficeRuntime(executable=str(executable))

    command = runtime.build_convert_command(
        source=source,
        output_dir=output_dir,
        profile_dir=profile_dir,
        target_format="pdf",
    )

    assert command[0] == str(executable.resolve())
    assert "--headless" in command
    assert "--convert-to" in command
    assert "pdf" in command
    assert str(source.resolve()) in command
    assert str(output_dir.resolve()) in command
    assert any(item.startswith("-env:UserInstallation=file:///") for item in command)


def test_probe_returns_version_without_exposing_process_details(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    executable = tmp_path / "soffice.exe"
    executable.write_bytes(b"placeholder")
    runtime = LibreOfficeRuntime(executable=str(executable))

    def fake_run(*_args: object, **_kwargs: object) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess([], 0, stdout="LibreOffice 26.2.4.2\n", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)

    status = runtime.probe()

    assert status.available is True
    assert status.version == "LibreOffice 26.2.4.2"
    assert status.executable == str(executable.resolve())
