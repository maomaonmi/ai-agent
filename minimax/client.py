"""httpx 直调 MiniMax Anthropic Messages REST 客户端。

Why 不用 anthropic SDK：零新依赖（规避 MCP SDK 版本兼容前科），本包完全自包含；
Anthropic SSE 事件类型固定，解析工作量可控。

协议要点（官方文档）：
- POST {base_url}/v1/messages，Bearer 认证（同时带 x-api-key + anthropic-version 双保险）；
- 响应 content 为块列表：thinking / text / tool_use / server_tool_use / web_search_tool_result；
- 流式事件：message_start → content_block_start/delta/stop → message_delta → message_stop；
- Interleaved Thinking 纪律：assistant 消息（含 thinking/tool_use 块）必须完整回传历史。
"""

from __future__ import annotations

import json
import logging
from typing import Any, Iterator

import httpx

from .constants import (
    ANTHROPIC_BASE_URL,
    ANTHROPIC_VERSION,
    DEFAULT_TIMEOUT,
    alternate_server_tools_base_url,
)

logger = logging.getLogger("minimax.client")


class MiniMaxAPIError(Exception):
    """MiniMax API 调用错误（status_code + 中文可读信息）。"""

    def __init__(self, message: str, status_code: int | None = None, detail: str = ""):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.detail = detail


def _map_http_error(status_code: int, body: str) -> MiniMaxAPIError:
    """HTTP 状态码 → 中文可读错误（上层直接透给前端）。"""
    snippet = (body or "").strip()[:300]
    if status_code in (401, 403):
        return MiniMaxAPIError("MiniMax API Key 无效或无权限，请检查设置中的 Key", status_code, snippet)
    if status_code == 404:
        return MiniMaxAPIError("MiniMax 接口或模型不存在，请检查 base_url 与模型 ID", status_code, snippet)
    if status_code == 429:
        return MiniMaxAPIError("MiniMax 请求被限流或额度不足，请稍后重试", status_code, snippet)
    if status_code == 400:
        return MiniMaxAPIError(f"MiniMax 请求参数错误：{snippet or 'bad request'}", status_code, snippet)
    if status_code >= 500:
        return MiniMaxAPIError(f"MiniMax 服务端异常（HTTP {status_code}），请稍后重试", status_code, snippet)
    return MiniMaxAPIError(f"MiniMax 请求失败（HTTP {status_code}）：{snippet}", status_code, snippet)


class MiniMaxClient:
    """MiniMax Anthropic Messages 协议客户端（非流式 + 流式）。"""

    def __init__(self, api_key: str, base_url: str = ANTHROPIC_BASE_URL, timeout: float = DEFAULT_TIMEOUT):
        if not api_key:
            raise MiniMaxAPIError("请先在设置中配置 MiniMax API Key")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    # ------------------------------------------------------------------ headers
    def _headers(self) -> dict[str, str]:
        # Why: MiniMax 官方 curl 示例对 messages 用 Bearer、对 server-tools 用 x-api-key；
        # 两个头同时携带是安全的（服务端任取其一），避免不同网关行为差异。
        return {
            "Authorization": f"Bearer {self.api_key}",
            "x-api-key": self.api_key,
            "anthropic-version": ANTHROPIC_VERSION,
            "Content-Type": "application/json",
        }

    def _messages_url(self, base_url: str | None = None) -> str:
        return f"{(base_url or self.base_url).rstrip('/')}/v1/messages"

    def _candidate_base_urls(self) -> list[str]:
        """Prefer the documented host, then try the regional host once."""
        candidates = [self.base_url]
        alternate = alternate_server_tools_base_url(self.base_url)
        if alternate and alternate not in candidates:
            candidates.append(alternate)
        return candidates

    # ------------------------------------------------------------------ 非流式
    def create_message(
        self,
        *,
        model: str,
        messages: list[dict],
        max_tokens: int,
        system: str | list[dict] | None = None,
        tools: list[dict] | None = None,
        tool_choice: dict | str | None = None,
        thinking: dict | None = None,
        temperature: float | None = None,
        extra_body: dict | None = None,
    ) -> dict:
        """非流式调用，返回完整 message dict（content 块列表 + usage + stop_reason）。

        Args:
            tool_choice: Anthropic tool_choice 字段。dict 形如
                {"type": "auto"|"any"|"tool", "name": "..."}；str 仅支持 "auto" / "any"。
                "any" 强制模型必须调一次工具——plan 搜索链路用此确保 web_search 被调用。
        """
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
        }
        if system:
            # Why: 同 stream_message —— list 形式 system 在 MiniMax 兼容层可能被丢弃，
            #   归一化为 string 确保 prompt 完整可达。
            payload_system = system
            if isinstance(system, list):
                text_chunks = []
                for block in system:
                    if isinstance(block, dict) and block.get("type") == "text":
                        text_chunks.append(str(block.get("text") or ""))
                payload_system = "\n\n".join(t for t in text_chunks if t)
                logger.info(
                    "[minimax] create_message system list→string 归一化：原 %d 块 → string 长度 %d",
                    len(system), len(payload_system),
                )
            if payload_system:
                payload["system"] = payload_system
        if tools:
            payload["tools"] = tools
            # Why: 仅在有 tools 时透传 tool_choice——裸调模型传 any 会 400。
            if tool_choice is not None:
                payload["tool_choice"] = tool_choice
        if thinking:
            payload["thinking"] = thinking
        if temperature is not None:
            payload["temperature"] = temperature
        if extra_body:
            payload.update(extra_body)
        response = None
        for index, base_url in enumerate(self._candidate_base_urls()):
            try:
                with httpx.Client(timeout=self.timeout) as client:
                    response = client.post(self._messages_url(base_url), headers=self._headers(), json=payload)
                break
            except httpx.ConnectError as exc:
                if index + 1 < len(self._candidate_base_urls()):
                    logger.warning("[minimax] %s TLS 连接失败，回退 regional Anthropic endpoint: %s", base_url, exc)
                    continue
                logger.exception("[minimax] 请求异常")
                raise MiniMaxAPIError(f"MiniMax 连接失败：{exc}") from exc
            except httpx.HTTPError as exc:
                logger.exception("[minimax] 请求异常")
                raise MiniMaxAPIError(f"MiniMax 连接失败：{exc}") from exc
        if response is None:
            raise MiniMaxAPIError("MiniMax 连接失败：没有可用的 Anthropic endpoint")
        if response.status_code != 200:
            raise _map_http_error(response.status_code, response.text)
        data = response.json()
        if data.get("base_resp", {}).get("status_code", 0) not in (0, None):
            # MiniMax 业务层错误（HTTP 200 但 base_resp 非 0）
            raise MiniMaxAPIError(
                f"MiniMax 业务错误：{data['base_resp'].get('status_msg', 'unknown')}",
                detail=json.dumps(data["base_resp"], ensure_ascii=False),
            )
        return data

    # ------------------------------------------------------------------ 流式
    def stream_message(
        self,
        *,
        model: str,
        messages: list[dict],
        max_tokens: int,
        system: str | list[dict] | None = None,
        tools: list[dict] | None = None,
        tool_choice: dict | str | None = None,
        thinking: dict | None = None,
        temperature: float | None = None,
        extra_body: dict | None = None,
    ) -> Iterator[dict]:
        """流式调用，产出结构化事件 dict（type 字段区分）。

        事件类型：
        - {"type": "message_start", "usage": {...}}
        - {"type": "thinking_delta", "text": str}
        - {"type": "text_delta", "text": str}
        - {"type": "tool_use", "block": {"id","name","input"}}           # 块完成后产出
        - {"type": "server_tool_use", "block": {...}}                     # 服务端搜索调用
        - {"type": "web_search_tool_result", "block": {...}}              # 服务端搜索结果
        - {"type": "message_delta", "stop_reason": str, "usage": {...}}   # 含 cache_read_input_tokens
        - {"type": "message_stop", "usage": {...}}                        # 汇总 usage
        - {"type": "text_block", "text": str}                             # 非流式风格完整块兜底

        Args:
            tool_choice: Anthropic tool_choice 字段。dict 形如
                {"type": "auto"|"any"|"tool", "name": "..."}；str 仅支持 "auto" / "any"。
                "any" 强制模型必须调一次工具——研究链路用此避免 M2.7/M2.5 跳过 web_search。
        """
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "stream": True,
        }
        if system:
            # Why: Anthropic Messages 协议官方 system 字段是 string，但本项目
            #   apply_cache_breakpoints 会把它转成 list[{"type":"text","text":...,
            #   "cache_control":{...}}] 以注入主动缓存。MiniMax 兼容层对 list 形式
            #   system 处理不一致：M3（无 cache）走 string 正常；M2.7 在 list 形式下
            #   可能把整个 system 丢弃，导致模型只看到 tool_choice 协议级约束、
            #   看不到字数下限等 prompt 强约束——表现为"6 轮检索后只写 75 字"。
            # 归一化策略：list 形式提取所有 text 拼成 string；cache_control 标记
            # 在 string 形式下不再生效，但 prompt 完整可达，比丢了好。
            payload_system = system
            if isinstance(system, list):
                text_chunks = []
                for block in system:
                    if isinstance(block, dict) and block.get("type") == "text":
                        text_chunks.append(str(block.get("text") or ""))
                payload_system = "\n\n".join(t for t in text_chunks if t)
                logger.info(
                    "[minimax] system list→string 归一化：原 %d 块 → string 长度 %d",
                    len(system), len(payload_system),
                )
            if payload_system:
                payload["system"] = payload_system
        if tools:
            payload["tools"] = tools
            # Why: 仅在有 tools 时透传 tool_choice——裸调模型传 any 会 400。
            if tool_choice is not None:
                payload["tool_choice"] = tool_choice
        if thinking:
            payload["thinking"] = thinking
        if temperature is not None:
            payload["temperature"] = temperature
        if extra_body:
            payload.update(extra_body)

        candidates = self._candidate_base_urls()
        for index, base_url in enumerate(candidates):
            try:
                with httpx.Client(timeout=self.timeout) as http:
                    with http.stream("POST", self._messages_url(base_url), headers=self._headers(), json=payload) as response:
                        if response.status_code != 200:
                            body = (response.read() or b"").decode("utf-8", errors="replace")
                            raise _map_http_error(response.status_code, body)
                        # Why: 手动 UTF-8 解码——Windows 下默认编码可能是 GBK（MCP fetch 编码超时前科）。
                        yield from self._iter_sse_events(response)
                return
            except MiniMaxAPIError:
                raise
            except httpx.ConnectError as exc:
                if index + 1 < len(candidates):
                    logger.warning("[minimax] %s TLS 连接失败，回退 regional Anthropic endpoint: %s", base_url, exc)
                    continue
                logger.exception("[minimax] 流式请求异常")
                raise MiniMaxAPIError(f"MiniMax 流式连接失败：{exc}") from exc
            except httpx.HTTPError as exc:
                logger.exception("[minimax] 流式请求异常")
                raise MiniMaxAPIError(f"MiniMax 流式连接失败：{exc}") from exc

    # ------------------------------------------------------------------ SSE 解析
    @staticmethod
    def _iter_sse_events(response: httpx.Response) -> Iterator[dict]:
        """解析 Anthropic SSE 帧 → 结构化事件。

        状态机：block_types[index] 记录当前块类型；tool_use 的 input_json_delta
        在 block_json_parts[index] 累积，content_block_stop 时拼接产出完整 tool_use 块。

        Why 按行切分：iter_bytes 每次返回的字节块可能包含多个 SSE 帧（"event: ...\ndata: ...\n\n"），
        不能整体当一行处理；必须维护 buffer 按 "\\n" 切出完整行再判断 data: 前缀。
        """
        block_types: dict[int, str] = {}
        block_meta: dict[int, dict] = {}       # tool_use: {id, name}
        block_json_parts: dict[int, list[str]] = {}
        block_payloads: dict[int, dict] = {}
        result_block_emitted: set[int] = set()
        usage: dict = {}

        # 累积 buffer：iter_bytes 单次返回的字节块可能横跨多行 SSE。
        buf = bytearray()
        for raw_chunk in response.iter_bytes():
            if not raw_chunk:
                continue
            buf.extend(raw_chunk)
            # 逐行处理 buffer 中所有完整行（以 \\n 结尾），剩余部分留待下个 chunk。
            while True:
                nl = buf.find(b"\n")
                if nl == -1:
                    break
                line = bytes(buf[:nl]).decode("utf-8", errors="replace").rstrip("\r\n")
                del buf[: nl + 1]
                if not line or not line.startswith("data:"):
                    continue
                data_str = line[len("data:"):].strip()
                if not data_str or data_str == "[DONE]":
                    continue
                try:
                    evt = json.loads(data_str)
                except json.JSONDecodeError:
                    logger.warning("[minimax] SSE 帧解析失败：%s", data_str[:120])
                    continue

                evt_type = evt.get("type", "")

                if evt_type == "message_start":
                    msg_usage = (evt.get("message") or {}).get("usage") or {}
                    usage.update(msg_usage)
                    yield {"type": "message_start", "usage": dict(msg_usage)}

                elif evt_type == "content_block_start":
                    index = int(evt.get("index", 0))
                    block = evt.get("content_block") or {}
                    btype = str(block.get("type", ""))
                    block_types[index] = btype
                    block_payloads[index] = dict(block)
                    if btype == "tool_use":
                        block_meta[index] = {"id": block.get("id", ""), "name": block.get("name", "")}
                        block_json_parts[index] = []
                    elif btype == "server_tool_use":
                        # 服务端工具调用块：content_block_start 即携带完整 input
                        yield {"type": "server_tool_use", "block": dict(block)}
                    elif btype in {
                        "web_search_tool_result",
                        "web_search_result",
                        "server_tool_result",
                    }:
                        # 不同 MiniMax 网关版本对结果块的 type 命名略有差异；
                        # 上层统一消费 web_search_tool_result，避免来源被静默丢弃。
                        yield {
                            "type": "web_search_tool_result",
                            "block": {**dict(block), "type": "web_search_tool_result"},
                        }
                        result_block_emitted.add(index)

                # 少数网关会把搜索结果作为顶层事件发送，而不是
                # content_block_start。也统一成同一份上层事件契约。
                elif evt_type in {
                    "web_search_tool_result",
                    "web_search_result",
                    "server_tool_result",
                }:
                    block = evt.get("content_block") or evt.get("block") or evt
                    yield {
                        "type": "web_search_tool_result",
                        "block": {**dict(block), "type": "web_search_tool_result"},
                    }

                elif evt_type == "content_block_delta":
                    index = int(evt.get("index", 0))
                    delta = evt.get("delta") or {}
                    dtype = delta.get("type", "")
                    # Why: 透传 index 给上层（agent_loop.StreamAssembler 用真实 index 归位，
                    # 避免多 thinking/text 块时按类型强制 0/1 互相覆盖）。
                    if dtype == "thinking_delta":
                        yield {"type": "thinking_delta", "index": index, "text": str(delta.get("thinking", ""))}
                    elif dtype == "text_delta":
                        yield {"type": "text_delta", "index": index, "text": str(delta.get("text", ""))}
                    elif dtype == "input_json_delta":
                        block_json_parts.setdefault(index, []).append(str(delta.get("partial_json", "")))
                    elif dtype == "signature_delta":
                        # thinking 块签名：Interleaved Thinking 回传历史时必须携带（agent_loop 消费）。
                        yield {"type": "signature_delta", "index": index, "text": str(delta.get("signature", ""))}
                    elif dtype in {
                        "web_search_tool_result",
                        "web_search_result",
                        "server_tool_result",
                    }:
                        # Some gateways stream the server result as a delta
                        # rather than a complete content_block_start.  Keep
                        # the raw result payload so the upper layer cannot
                        # silently lose all source URLs.
                        block = delta.get("content_block") or delta.get("block") or delta
                        yield {
                            "type": "web_search_tool_result",
                            "block": {**dict(block), "type": "web_search_tool_result"},
                        }

                elif evt_type == "content_block_stop":
                    index = int(evt.get("index", 0))
                    btype = block_types.pop(index, "")
                    meta = block_meta.pop(index, None)
                    parts = block_json_parts.pop(index, None)
                    payload = block_payloads.pop(index, None) or {}
                    if btype == "tool_use" and meta is not None:
                        raw_json = "".join(parts or []).strip()
                        try:
                            tool_input = json.loads(raw_json) if raw_json else {}
                        except json.JSONDecodeError:
                            logger.warning("[minimax] tool_use 参数 JSON 解析失败：%s", raw_json[:120])
                            tool_input = {"_raw": raw_json}
                        yield {"type": "tool_use", "block": {"id": meta["id"], "name": meta["name"], "input": tool_input}}
                    elif btype in {
                        "web_search_tool_result",
                        "web_search_result",
                        "server_tool_result",
                    } and index not in result_block_emitted and payload:
                        yield {
                            "type": "web_search_tool_result",
                            "block": {**payload, "type": "web_search_tool_result"},
                        }
                    result_block_emitted.discard(index)

                elif evt_type == "message_delta":
                    delta = evt.get("delta") or {}
                    delta_usage = evt.get("usage") or {}
                    usage.update(delta_usage)
                    yield {
                        "type": "message_delta",
                        "stop_reason": delta.get("stop_reason"),
                        "usage": dict(delta_usage),
                    }

                elif evt_type == "message_stop":
                    yield {"type": "message_stop", "usage": dict(usage)}

                elif evt_type == "error":
                    err = evt.get("error") or {}
                    raise MiniMaxAPIError(
                        f"MiniMax 流式错误：{err.get('message', 'unknown')}",
                        detail=json.dumps(err, ensure_ascii=False)[:300],
                    )

                # ping / 其他事件忽略
