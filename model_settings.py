"""Persistent, validated model-provider settings for the application."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from threading import RLock
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator


def ensure_direct_connection(base_url: str) -> None:
    """把 base_url 的域名并入 NO_PROXY，使 httpx 客户端直连该端点。

    Why: httpx/openai 客户端默认读取 HTTP_PROXY/HTTPS_PROXY 环境变量；在代理环境下
    国内端点（dashscope/bigmodel/deepseek）被错误代理会抛 ConnectError。客户端均为
    按请求新建，此处幂等更新环境变量后即刻生效，用户无需手工配置。

    Deprecated for request handling: this mutates the whole Python process and can
    break unrelated requests when the machine's system proxy is required. Runtime
    code should leave proxy selection to the client's normal environment handling.
    """
    host = urlparse((base_url or "").strip()).hostname
    if not host:
        return
    existing = os.environ.get("NO_PROXY") or os.environ.get("no_proxy") or ""
    entries = [item.strip() for item in existing.split(",") if item.strip()]
    if host not in entries:
        entries.append(host)
        os.environ["NO_PROXY"] = ",".join(entries)


@dataclass(frozen=True)
class ProviderCapabilities:
    """供应商/模型能力矩阵——所有能力判断的唯一入口。

    Why: 历史上能力判断靠 `"glm" in model.lower()` 字符串嗅探散布在 App.py/main.py
    各处，每接入一个供应商就要改 N 处。此处收口后，新供应商只需在本映射加规则。
    """

    supports_json_format: bool        # response_format=json_object 是否可靠
    thinking_control: str             # "glm" | "qwen_budget" | "deepseek" | "minimax" | "none"
    supports_vision: bool             # 当前模型是否可直接消费多模态附件
    supports_active_cache: bool = False  # 是否支持 Anthropic 主动缓存（cache_control）
    # Why: MiniMax web_search_20250305 是 Anthropic Messages 协议级 server tool，
    # 文档未限定模型但实际后端可能拒。agent_loop/chat 据此决定是否注入 web_search tool。
    supports_server_web_search: bool = True


def capabilities_for_model(model_id: str) -> ProviderCapabilities:
    """按 model_id 在 MODEL_CATALOG 中反查能力；未命中走保守默认。

    Why: 收口字符串嗅探（历史 `"glm" in name` / `"qwen" in name`），让运行时能力判断
    与前端展示共用 MODEL_CATALOG 同一数据源。新供应商只需在 MODEL_CATALOG 加条目即可，
    无需改本函数。兜底分支保持历史行为，避免未知模型回退炸裂。
    """
    name = (model_id or "").lower()
    for provider_variants in MODEL_CATALOG.values():
        for variant in provider_variants:
            if variant["model_id"].lower() == name:
                return ProviderCapabilities(
                    supports_json_format=variant.get("supports_json_format", True),
                    thinking_control=variant.get("thinking_control", "none"),
                    supports_vision=variant.get("supports_vision", False),
                    supports_active_cache=variant.get("supports_active_cache", False),
                    supports_server_web_search=variant.get("supports_server_web_search", True),
                )
    # 兜底：未知模型走保守默认（与历史行为一致）
    return ProviderCapabilities(True, "none", False)


# 模型目录：前端 ModelQuickSwitcher / SettingsDialog 的单一数据源（GET /api/settings/model-catalog）。
# Why: capabilities_for_model() 也走本表反查，运行时能力判断与前端展示共用同一数据源，
# 杜绝历史上"catalog 改了但 capabilities_for_model 还在字符串嗅探"的双数据源问题。
MODEL_CATALOG: dict[str, list[dict]] = {
    "qwen": [
        {"value": "qwen:qwen3.8-max", "label": "千问 Qwen3.8 Max · 旗舰", "model_id": "qwen3.8-max",
         "supports_vision": False, "supports_json_format": True,
         "thinking_control": "qwen_budget", "input_context": 256_000, "output_context": 32_000},
        {"value": "qwen:qwen3.7-plus", "label": "千问 Qwen3.7 Plus · 均衡", "model_id": "qwen3.7-plus",
         "supports_vision": False, "supports_json_format": True,
         "thinking_control": "qwen_budget", "input_context": 256_000, "output_context": 16_000},
        {"value": "qwen:qwen3.7-flash", "label": "千问 Qwen3.7 Flash · 性价比", "model_id": "qwen3.7-flash",
         "supports_vision": False, "supports_json_format": True,
         "thinking_control": "qwen_budget", "input_context": 256_000, "output_context": 16_000},
        {"value": "qwen:qwen-vl-max", "label": "千问 Qwen-VL Max · 视觉", "model_id": "qwen-vl-max",
         "supports_vision": True, "supports_json_format": True,
         "thinking_control": "none", "input_context": 128_000, "output_context": 8_000},
        # Why: qwen-deep-research 是千问专用深度研究模型，使用 DashScope 原生 API（非 OpenAI 兼容），
        #   支持两步式调用（反问确认 + 深入研究）和四阶段流式响应。
        {"value": "qwen:qwen-deep-research", "label": "千问 Deep Research · 深度研究", "model_id": "qwen-deep-research",
         "supports_vision": False, "supports_json_format": False,
         "thinking_control": "none", "input_context": 131_072, "output_context": 8_192,
         "is_deep_research": True},
    ],
    "glm": [
        {"value": "glm:glm-5", "label": "GLM-5", "model_id": "glm-5",
         "supports_vision": False, "supports_json_format": False,
         "thinking_control": "glm", "input_context": 128_000, "output_context": 16_000},
        {"value": "glm:glm-5.1", "label": "GLM-5.1", "model_id": "glm-5.1",
         "supports_vision": False, "supports_json_format": False,
         "thinking_control": "glm", "input_context": 128_000, "output_context": 16_000},
        {"value": "glm:glm-5.2", "label": "GLM-5.2", "model_id": "glm-5.2",
         "supports_vision": False, "supports_json_format": False,
         "thinking_control": "glm", "input_context": 128_000, "output_context": 16_000},
        {"value": "glm:glm-5-turbo", "label": "GLM-5 Turbo", "model_id": "glm-5-turbo",
         "supports_vision": False, "supports_json_format": False,
         "thinking_control": "glm", "input_context": 128_000, "output_context": 16_000},
        {"value": "glm:glm-5v-turbo", "label": "GLM-5V Turbo · 视觉", "model_id": "glm-5v-turbo",
         "supports_vision": True, "supports_json_format": False,
         "thinking_control": "glm", "input_context": 128_000, "output_context": 16_000},
    ],
    "deepseek": [
        # Why: deepseek-chat 将于 2026/07/24 弃用，升级到 v4-flash/pro。
        # 上下文 1M / 输出 384K，支持思考模式（thinking.type + 顶层 reasoning_effort）。
        {"value": "deepseek:deepseek-v4-flash", "label": "DeepSeek V4 Flash · 性价比", "model_id": "deepseek-v4-flash",
         "supports_vision": False, "supports_json_format": True,
         "thinking_control": "deepseek", "input_context": 1_000_000, "output_context": 384_000},
        {"value": "deepseek:deepseek-v4-pro", "label": "DeepSeek V4 Pro · 旗舰", "model_id": "deepseek-v4-pro",
         "supports_vision": False, "supports_json_format": True,
         "thinking_control": "deepseek", "input_context": 1_000_000, "output_context": 384_000},
    ],
    # Why: MiniMax 主链路走 Anthropic Messages 协议（拿到 M3 thinking 块 / Interleaved
    # Thinking / 服务端 web_search 的唯一路径），OpenAI 兼容端点仅供 LangGraph/Code 复用。
    # supports_active_cache: 主动缓存（cache_control）仅 M2.7/M2.5 系列支持，M3 携带会报错。
    "minimax": [
        {"value": "minimax:MiniMax-M3", "label": "MiniMax M3 · 旗舰", "model_id": "MiniMax-M3",
         "supports_vision": True, "supports_json_format": True,
         "thinking_control": "minimax", "input_context": 1_000_000, "output_context": 32_000,
         "supports_active_cache": False, "supports_server_web_search": True},
        {"value": "minimax:MiniMax-M2.7", "label": "MiniMax M2.7 · 均衡", "model_id": "MiniMax-M2.7",
         "supports_vision": False, "supports_json_format": True,
         "thinking_control": "minimax", "input_context": 204_800, "output_context": 32_000,
         "supports_active_cache": True, "supports_server_web_search": True},
        {"value": "minimax:MiniMax-M2.7-highspeed", "label": "MiniMax M2.7 极速", "model_id": "MiniMax-M2.7-highspeed",
         "supports_vision": False, "supports_json_format": True,
         "thinking_control": "minimax", "input_context": 204_800, "output_context": 32_000,
         "supports_active_cache": True, "supports_server_web_search": True},
        {"value": "minimax:MiniMax-M2.5", "label": "MiniMax M2.5 · 性价比", "model_id": "MiniMax-M2.5",
         "supports_vision": False, "supports_json_format": True,
         "thinking_control": "minimax", "input_context": 204_800, "output_context": 32_000,
         "supports_active_cache": True, "supports_server_web_search": True},
        {"value": "minimax:MiniMax-M2.5-highspeed", "label": "MiniMax M2.5 极速", "model_id": "MiniMax-M2.5-highspeed",
         "supports_vision": False, "supports_json_format": True,
         "thinking_control": "minimax", "input_context": 204_800, "output_context": 32_000,
         "supports_active_cache": True, "supports_server_web_search": True},
    ],
}


class ModelSettings(BaseModel):
    provider: Literal["deepseek", "glm", "qwen", "minimax", "custom"] = "deepseek"
    # Why: minimax 主链路走 Anthropic Messages 协议；其余供应商维持 OpenAI 兼容。
    api_format: Literal["openai_chat_completions", "anthropic_messages"] = "openai_chat_completions"
    base_url: str = "https://api.deepseek.com"
    model_id: str = "deepseek-v4-flash"
    api_key: str = ""
    # Why: MiniMax 专项生成（图像/视频）走独立端点，部分套餐（如 Max）需要单独的套餐 Key，
    # 与普通文本 API Key 不同。留空时回退到 api_key。
    minimax_video_api_key: str = ""
    display_name: str = "DeepSeek V4 Flash"
    model_family: str = "default"
    input_context: int = Field(default=1_000_000, ge=1, le=10_000_000)
    output_context: int = Field(default=384_000, ge=1, le=1_000_000)
    tool_call_rounds: int = Field(default=200, ge=1, le=1_000)
    full_url: bool = False
    multimodal: bool = False
    text_model_id: str = "glm-5-turbo"
    vision_model_id: str = "glm-5v-turbo"
    thinking_enabled: bool = True
    reasoning_effort: str = Field(default="high", max_length=16)
    # Why: 千问思考协议是 enable_thinking + thinking_budget（token 预算），
    # 与 GLM 的 reasoning_effort 档位互不复用，防止参数串协议导致 400。
    thinking_budget: int | None = Field(default=None, ge=256, le=65_536)
    temperature: float = Field(default=1.0, ge=0, le=2)
    max_tokens: int = Field(default=16_000, ge=1, le=65_536)

    @field_validator("reasoning_effort")
    @classmethod
    def validate_reasoning_effort(cls, value: str, info) -> str:
        value = (value or "high").strip().lower()
        provider = info.data.get("provider")
        # Why: DeepSeek 协议字面支持 low/high/xhigh/max（无 medium/minimal），
        # 按 provider 分支校验避免无效档位串入 API。
        if provider == "deepseek":
            allowed = {"low", "high", "xhigh", "max"}
            if value not in allowed:
                raise ValueError(f"DeepSeek reasoning_effort 必须是 {', '.join(sorted(allowed))} 之一")
        else:
            allowed = {"max", "xhigh", "high", "medium", "low", "minimal", "none"}
            if value not in allowed:
                raise ValueError(f"reasoning_effort 必须是 {', '.join(sorted(allowed))} 之一")
        return value

    @field_validator("base_url", "model_id")
    @classmethod
    def required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("该字段不能为空")
        return value.rstrip("/")

    @field_validator("display_name")
    @classmethod
    def display_name_limit(cls, value: str) -> str:
        value = value.strip()
        if len(value) > 32:
            raise ValueError("展示名称不能超过 32 个字符")
        return value

    @field_validator("model_id")
    @classmethod
    def validate_provider_model_id(cls, value: str, info) -> str:
        provider = info.data.get("provider")
        if provider == "glm" and (value != value.lower() or " " in value):
            raise ValueError("GLM 模型 ID 必须使用官方小写标识，例如 glm-5v-turbo")
        return value


class ModelSettingsStore:
    def __init__(self, path: Path | None = None):
        self.path = path or Path(os.getenv(
            "MODEL_SETTINGS_PATH",
            Path(__file__).resolve().parent / "data" / "model_settings.json",
        ))
        self._lock = RLock()

    def _read_document(self) -> dict:
        if not self.path.exists():
            default = ModelSettings(api_key=os.getenv("DEEPSEEK_API_KEY", ""))
            return {"active_provider": "deepseek", "profiles": {"deepseek": default.model_dump()}}
        raw = json.loads(self.path.read_text(encoding="utf-8"))
        if "profiles" not in raw:  # migrate the original single-profile format
            if raw.get("provider") == "glm" and raw.get("model_id") != str(raw.get("model_id", "")).lower().replace(" ", "-"):
                raw["model_id"] = "glm-5v-turbo"
            settings = ModelSettings.model_validate(raw)
            return {"active_provider": settings.provider, "profiles": {settings.provider: settings.model_dump()}}
        # Why: deepseek-chat 将于 2026/07/24 弃用，此处一次性迁移到 v4-flash。
        # 同时同步上下文长度（旧 64K/8K → 新 1M/384K），避免用户手动改配置。
        # 迁移幂等：已是 v4 系列则跳过。
        deepseek_profile = raw.get("profiles", {}).get("deepseek", {})
        if deepseek_profile.get("model_id") == "deepseek-chat":
            deepseek_profile["model_id"] = "deepseek-v4-flash"
            deepseek_profile["display_name"] = "DeepSeek V4 Flash"
            deepseek_profile["input_context"] = 1_000_000
            deepseek_profile["output_context"] = 384_000
        return raw

    def load(self, provider: str | None = None) -> ModelSettings:
        with self._lock:
            document = self._read_document()
            selected = provider or document.get("active_provider", "deepseek")
            profile = document.get("profiles", {}).get(selected)
            if profile:
                return ModelSettings.model_validate(profile)
            if selected == "glm":
                return ModelSettings(provider="glm", base_url="https://open.bigmodel.cn/api/paas/v4", model_id="glm-5v-turbo", display_name="GLM-5V Turbo", multimodal=True)
            if selected == "qwen":
                return ModelSettings(provider="qwen", base_url="https://dashscope.aliyuncs.com/compatible-mode/v1", model_id="qwen3.7-plus", display_name="千问 Qwen3.7 Plus", thinking_budget=8_000)
            if selected == "minimax":
                # Why: Anthropic 兼容端点是主链路（M3 thinking 块 / Interleaved Thinking / server web_search）。
                return ModelSettings(
                    provider="minimax",
                    api_format="anthropic_messages",
                    base_url="https://api.minimax.io/anthropic",
                    model_id="MiniMax-M3",
                    display_name="MiniMax M3",
                    input_context=1_000_000,
                    output_context=32_000,
                )
            return ModelSettings(provider=selected)

    def save(self, settings: ModelSettings) -> ModelSettings:
        with self._lock:
            document = self._read_document()
            profiles = document.setdefault("profiles", {})
            existing = profiles.get(settings.provider, {})
            if not settings.api_key and existing.get("api_key"):
                settings.api_key = existing["api_key"]
            profiles[settings.provider] = settings.model_dump()
            document["active_provider"] = settings.provider
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temp = self.path.with_suffix(".tmp")
            temp.write_text(
                json.dumps(document, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            temp.replace(self.path)
            return settings

    def public(self, provider: str | None = None) -> dict:
        settings = self.load(provider)
        data = settings.model_dump(exclude={"api_key", "minimax_video_api_key"})
        data["has_api_key"] = bool(settings.api_key)
        data["has_minimax_video_key"] = bool(settings.minimax_video_api_key)
        return data


# ==========================================
# ServiceSettings：全局联网服务 Key（Tavily / SiliconFlow Reranker）
# 与 LLM Provider 模型配置解耦，不随 deepseek/glm/qwen 分 profile。
# 敏感 Key 同样 public() 时脱敏，禁止 GET 接口明文回传前端。
# ==========================================
SearchProvider = Literal["tavily", "firecrawl"]
DeepResearchEngine = Literal["firecrawl", "native"]


class ServiceSettings(BaseModel):
    # --- 应用级 HTTP/HTTPS 代理 ---
    # OpenAI-compatible、DashScope、智谱及搜索请求共用该代理。
    proxy_enabled: bool = False
    proxy_url: str = ""

    # --- 搜索服务选择 ---
    # DeepSeek 无原生联网，走独立搜索服务。Tavily 需绑支付（额度有限），
    # Firecrawl 免费档 500 credits/月且无需绑卡，作为默认兜底。
    search_provider: SearchProvider = "firecrawl"
    tavily_api_key: str = ""
    firecrawl_api_key: str = ""
    rerank_api_key: str = ""

    # --- Firecrawl 高级参数（DeepSeek 联网 / 深度调研共用）---
    # Highlights：对每条搜索结果返回"查询词命中的上下文片段 + score"，供前端面板显示。
    # 约等于"0 cost"，但会多返回字段、略增响应体大小，默认开启。
    firecrawl_enable_highlights: bool = True
    # Scrape Top N：对搜索结果前 N 条（2~5，默认 3）调 /v1/scrape 拿全文 Markdown。
    # 每条 1 credit，显著提升 Reranker/LLM 理解度，但过多会吃额度 + 拉长耗时。
    firecrawl_scrape_top_n: int = 3
    # Markdown Max Chars：单页 Markdown 截断长度，避免把整站（几十KB）塞进上下文。
    # 1200~4000 之间，默认 2000。
    firecrawl_markdown_max_chars: int = 2000
    # 深度调研引擎：Firecrawl /v1/research 是官方异步 Job，端到端产出报告；
    # "native" 保留原自研 day32+day33 链路（子查询→抓取→切片→Reranker→Day33 推理）。
    deep_research_engine: DeepResearchEngine = "firecrawl"

    @field_validator("proxy_url")
    @classmethod
    def normalize_proxy_url(cls, value: str) -> str:
        value = (value or "").strip()
        if not value:
            return ""
        # 允许用户直接填写 127.0.0.1:7897，减少代理配置门槛。
        if "://" not in value:
            value = f"http://{value}"
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.path not in {"", "/"}:
            raise ValueError("代理地址必须是 HTTP/HTTPS URL，例如 http://127.0.0.1:7897")
        return value.rstrip("/")

    @field_validator("tavily_api_key", "firecrawl_api_key", "rerank_api_key")
    @classmethod
    def strip_key(cls, value: str) -> str:
        return (value or "").strip()

    @field_validator("search_provider")
    @classmethod
    def normalize_provider(cls, value: str) -> str:
        value = (value or "").strip().lower()
        return value if value in {"tavily", "firecrawl"} else "firecrawl"

    @field_validator("deep_research_engine")
    @classmethod
    def normalize_research_engine(cls, value: str) -> str:
        value = (value or "").strip().lower()
        return value if value in {"firecrawl", "native"} else "firecrawl"

    @field_validator("firecrawl_scrape_top_n")
    @classmethod
    def clamp_scrape_top_n(cls, value: int) -> int:
        try:
            v = int(value)
        except (TypeError, ValueError):
            v = 3
        return max(0, min(5, v))

    @field_validator("firecrawl_markdown_max_chars")
    @classmethod
    def clamp_markdown_chars(cls, value: int) -> int:
        try:
            v = int(value)
        except (TypeError, ValueError):
            v = 2000
        return max(800, min(4000, v))


class ServiceSettingsStore:
    """极简单文件存储，无 profile 分层。"""

    def __init__(self, path: Path | None = None):
        self.path = path or Path(os.getenv(
            "SERVICE_SETTINGS_PATH",
            Path(__file__).resolve().parent / "data" / "service_settings.json",
        ))
        self._lock = RLock()

    def load(self) -> ServiceSettings:
        with self._lock:
            if not self.path.exists():
                return ServiceSettings()
            try:
                raw = json.loads(self.path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                return ServiceSettings()
            return ServiceSettings.model_validate(raw)

    def save(self, settings: ServiceSettings) -> ServiceSettings:
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temp = self.path.with_suffix(".tmp")
            temp.write_text(settings.model_dump_json(indent=2), encoding="utf-8")
            temp.replace(self.path)
            return self.load()

    def public(self) -> dict:
        s = self.load()
        # Why: 脱敏，GET 接口不推明文 key 到前端，仅回传状态布尔 + 非敏感配置。
        return {
            # —— 搜索提供商与 Key 状态 ——
            "search_provider": s.search_provider,
            "has_tavily_key": bool(s.tavily_api_key),
            "has_firecrawl_key": bool(s.firecrawl_api_key),
            "has_rerank_key": bool(s.rerank_api_key),
            "tavily_api_key": "",
            "firecrawl_api_key": "",
            "rerank_api_key": "",
            # —— Firecrawl 高级参数（非敏感，允许 GET 回显，便于前端回填下拉/数值）——
            "firecrawl_enable_highlights": s.firecrawl_enable_highlights,
            "firecrawl_scrape_top_n": s.firecrawl_scrape_top_n,
            "firecrawl_markdown_max_chars": s.firecrawl_markdown_max_chars,
            "deep_research_engine": s.deep_research_engine,
            # 代理地址可能携带用户名/密码，GET 只返回状态和主机，不回传原值。
            "proxy_enabled": s.proxy_enabled,
            "has_proxy": bool(s.proxy_url),
            "proxy_host": urlparse(s.proxy_url).hostname if s.proxy_url else "",
        }


_PROVIDER_HOSTS = {"dashscope.aliyuncs.com", "open.bigmodel.cn", "api.deepseek.com"}
_PROXY_ENV_KEYS = ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy")
_ORIGINAL_PROXY_ENV = {key: os.environ.get(key) for key in _PROXY_ENV_KEYS}


def _without_provider_hosts(raw: str) -> str:
    entries = [item.strip() for item in (raw or "").split(",") if item.strip()]
    kept = [item for item in entries if item.lower().lstrip(".") not in _PROVIDER_HOSTS]
    return ",".join(kept)


def apply_network_proxy(settings: ServiceSettings) -> None:
    """Apply the user-selected proxy without leaking it through the public API.

    httpx/openai read these variables when each client is created. The helper is
    intentionally called only at startup and after an explicit settings save;
    request code must not mutate NO_PROXY per request.
    """
    proxy = settings.proxy_url.strip() if settings.proxy_enabled else ""
    if proxy:
        for key in _PROXY_ENV_KEYS:
            os.environ[key] = proxy
        # A previous runtime (or an old version) may have forced provider hosts
        # into NO_PROXY. Remove only those entries so the configured proxy wins.
        for key in ("NO_PROXY", "no_proxy"):
            if key in os.environ:
                cleaned = _without_provider_hosts(os.environ.get(key, ""))
                if cleaned:
                    os.environ[key] = cleaned
                else:
                    os.environ.pop(key, None)
        return

    # Restore the process environment that existed before app-level proxy config.
    for key, value in _ORIGINAL_PROXY_ENV.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
