"""Day 37 custom-agent storage and meta-generation engine."""

from __future__ import annotations

import json
import os
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Callable, List

from pydantic import BaseModel, Field, field_validator


ALLOWED_AGENT_TOOLS = {"read", "edit", "terminal", "web_search"}
_STORE_LOCK = threading.RLock()


class AgentStoreError(RuntimeError):
    """Base error for persistent agent storage."""


class AgentStoreCorruptedError(AgentStoreError):
    """Raised when the persisted JSON cannot be safely decoded."""


class AgentConfig(BaseModel):
    id: str = Field(
        min_length=2,
        max_length=64,
        pattern=r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
        description="Stable lowercase identifier.",
    )
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(min_length=5, max_length=500)
    system_prompt: str = Field(min_length=20, max_length=4000)
    is_callable: bool = True
    when_to_use: str = Field(min_length=10, max_length=500)
    tools: List[str] = Field(default_factory=list, max_length=4)
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)

    @field_validator("tools")
    @classmethod
    def validate_tools(cls, tools: List[str]) -> List[str]:
        normalized: List[str] = []
        for tool in tools:
            if tool not in ALLOWED_AGENT_TOOLS:
                raise ValueError(f"Unsupported agent tool: {tool}")
            if tool not in normalized:
                normalized.append(tool)
        return normalized


class GenerateAgentRequest(BaseModel):
    user_idea: str = Field(min_length=2, max_length=1000)

    @field_validator("user_idea")
    @classmethod
    def strip_user_idea(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Agent idea cannot be blank")
        return stripped


class AgentStore:
    def __init__(self, path: str | Path):
        self.path = Path(path).resolve()

    def _load_unlocked(self) -> dict[str, AgentConfig]:
        if not self.path.exists():
            return {}
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(raw, dict):
                raise ValueError("Agent store root must be an object")
            return {
                str(agent_id): AgentConfig.model_validate(agent_data)
                for agent_id, agent_data in raw.items()
            }
        except Exception as exc:
            raise AgentStoreCorruptedError(
                f"Agent store is corrupted: {self.path.name}"
            ) from exc

    def _write_unlocked(self, agents: dict[str, AgentConfig]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            agent_id: agent.model_dump(mode="json")
            for agent_id, agent in sorted(agents.items())
        }
        temp_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=self.path.parent,
                prefix=f".{self.path.name}.",
                suffix=".tmp",
                delete=False,
            ) as temp_file:
                json.dump(payload, temp_file, ensure_ascii=False, indent=2)
                temp_file.flush()
                os.fsync(temp_file.fileno())
                temp_path = Path(temp_file.name)
            os.replace(temp_path, self.path)
        finally:
            if temp_path is not None and temp_path.exists():
                temp_path.unlink()

    def list(self, *, callable_only: bool = False) -> List[AgentConfig]:
        with _STORE_LOCK:
            agents = self._load_unlocked().values()
            if callable_only:
                agents = (agent for agent in agents if agent.is_callable)
            return sorted(agents, key=lambda agent: (agent.created_at, agent.id))

    def get(self, agent_id: str) -> AgentConfig | None:
        with _STORE_LOCK:
            return self._load_unlocked().get(agent_id)

    def upsert(self, agent: AgentConfig) -> AgentConfig:
        with _STORE_LOCK:
            agents = self._load_unlocked()
            existing = agents.get(agent.id)
            now = time.time()
            stored = agent.model_copy(update={
                "created_at": existing.created_at if existing else agent.created_at,
                "updated_at": now,
            })
            agents[stored.id] = stored
            self._write_unlocked(agents)
            return stored

    def delete(self, agent_id: str) -> bool:
        with _STORE_LOCK:
            agents = self._load_unlocked()
            if agent_id not in agents:
                return False
            del agents[agent_id]
            self._write_unlocked(agents)
            return True


def _extract_json_object(text: str) -> dict[str, Any]:
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end < start:
        raise ValueError("Model response did not contain a JSON object")
    try:
        payload = json.loads(text[start:end + 1])
    except json.JSONDecodeError as exc:
        raise ValueError("Model response contained invalid JSON") from exc
    if not isinstance(payload, dict):
        raise ValueError("Generated agent must be a JSON object")
    return payload


def generate_agent_config(
    user_idea: str,
    llm_invoke: Callable[[str, str], str],
) -> AgentConfig:
    idea = GenerateAgentRequest(user_idea=user_idea).user_idea
    system_prompt = """你是 Agent Factory 的元智能体架构师。
根据用户的一句话想法，生成一个可供项目 Planner 调用的 Agent 配置。
只输出 JSON 对象，不要输出 Markdown 或解释。字段必须完整：
{
  "id": "英文小写连字符标识",
  "name": "带 Emoji 的中文名称",
  "description": "一句话功能简介",
  "system_prompt": "详细角色、任务边界、输出要求和禁止事项",
  "is_callable": true,
  "when_to_use": "Planner 应在什么任务场景调用它",
  "tools": ["read", "web_search"]
}
tools 只能从 read、edit、terminal、web_search 中选择，最多 4 个。
不要在 system_prompt 中放入密钥、命令或要求绕过安全限制的内容。"""
    raw_response = llm_invoke(system_prompt, f"用户想法：{idea}")
    payload = _extract_json_object(raw_response)
    return AgentConfig.model_validate(payload)
