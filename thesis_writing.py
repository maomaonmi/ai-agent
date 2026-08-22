"""论文写作大纲领域契约与流式解析。

模型按 NDJSON 输出，每一行都是可独立校验和转发的结构化事件。这样既能
在生成过程中逐节点渲染，也不会要求前端解析尚未闭合的巨大 JSON。
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, Field


ThesisTargetWords = Literal[3000, 5000, 8000, 10000, 15000, 20000, 30000]

# Why: 写作链路 provider 化——默认 qwen 保证存量请求零回归；minimax 走
# OpenAI 兼容适配（大纲/正文）与服务端 web_search（参考资料）。
ThesisProvider = Literal["qwen", "minimax"]


class ThesisOutlineRequest(BaseModel):
    instruction: str = Field(min_length=2, max_length=20_000)
    thesis_type: str = Field(default="通用类型", min_length=1, max_length=40)
    education_level: str = Field(default="学段不限", min_length=1, max_length=40)
    target_words: ThesisTargetWords | None = None
    session_id: str | None = Field(default=None, min_length=8, max_length=64)
    previous_outline: dict | None = None
    provider: ThesisProvider = "qwen"


class ThesisReferenceChapter(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=300)
    summary: str = Field(default="", max_length=2_000)


class ThesisReferenceRequest(BaseModel):
    instruction: str = Field(min_length=2, max_length=20_000)
    chapters: list[ThesisReferenceChapter] = Field(min_length=1, max_length=12)
    provider: ThesisProvider = "qwen"


class ThesisBodyReference(BaseModel):
    id: str = Field(min_length=1, max_length=120)
    title: str = Field(min_length=1, max_length=500)
    url: str = Field(min_length=8, max_length=2_000)
    snippet: str = Field(default="", max_length=8_000)


class ThesisBodySection(BaseModel):
    id: str = Field(min_length=1, max_length=120)
    title: str = Field(min_length=1, max_length=500)
    writing_brief: str = Field(default="", max_length=4_000)
    target_words: int = Field(default=0, ge=0, le=20_000)


class ThesisBodyChapter(BaseModel):
    id: str = Field(min_length=1, max_length=120)
    title: str = Field(min_length=1, max_length=500)
    summary: str = Field(default="", max_length=4_000)
    target_words: int = Field(default=0, ge=0, le=30_000)
    sections: list[ThesisBodySection] = Field(default_factory=list, max_length=20)
    references: list[ThesisBodyReference] = Field(default_factory=list, max_length=12)


class ThesisBodyRequest(BaseModel):
    title: str = Field(min_length=2, max_length=1_000)
    chapters: list[ThesisBodyChapter] = Field(min_length=1, max_length=12)
    completed_chapter_ids: list[str] = Field(default_factory=list, max_length=12)
    provider: ThesisProvider = "qwen"


def build_thesis_chapter_prompt(request: ThesisBodyRequest, chapter: ThesisBodyChapter) -> str:
    sections = "\n".join(
        f"- {section.title}（约 {section.target_words or '按内容需要'} 字）：{section.writing_brief or '围绕标题展开'}"
        for section in chapter.sections
    ) or "- 按本章标题和摘要组织二级结构"
    references = "\n".join(
        f"- [ref:{reference.id}] {reference.title}\n  URL: {reference.url}\n  摘要: {reference.snippet or '无摘要'}"
        for reference in chapter.references
    ) or "- 本章暂无已核验联网来源；不要虚构引用。"
    return f"""你是严谨的中文学术论文作者。请只生成当前大章节正文，不要生成其他章节。
论文标题：{request.title}
当前章节：{chapter.title}
章节任务：{chapter.summary or '围绕章节标题完成论证'}
目标篇幅：约 {chapter.target_words or 1200} 字

子章节结构：
{sections}

可用参考资料：
{references}

写作要求：
- 严格按子章节顺序输出，保留子章节标题；不重复输出大章节标题。
- 论证连贯、避免空话，使用正式学术中文。
- 只有在资料确实支持对应事实时，才在句末使用 [ref:资料ID]；不得编造资料ID、作者、数据或引用。
- 没有足够资料支持的判断，应明确使用审慎措辞，不得伪装成已证实事实。
- 直接输出正文，不要 Markdown 代码块，不要解释生成过程。"""


def build_citation_verification_prompt(chapter: ThesisBodyChapter, content: str, used_reference_ids: set[str]) -> str:
    evidence = "\n".join(
        f"- {reference.id}: {reference.title}\n  证据: {reference.snippet or '无可用证据片段'}"
        for reference in chapter.references if reference.id in used_reference_ids
    )
    return f"""你是论文引用核验员。请判断正文中每个引用是否被对应证据支持。
当前章节：{chapter.title}
正文：
{content}

引用证据：
{evidence}

严格返回一个 JSON 对象，不要 Markdown：
{{"citations":[{{"reference_id":"资料ID","status":"verified|partial|unsupported","reason":"简短原因"}}]}}
判定规则：verified=证据直接支持相邻事实；partial=只支持部分或措辞过强；unsupported=证据缺失、无关或矛盾。不得因为 URL 存在就判定 verified。"""


def normalize_search_results(chapter_id: str, results: list[dict], limit: int = 6) -> list[dict]:
    """把千问搜索结果归一化为稳定前端契约；URL 去重且绝不伪造来源。"""
    normalized: list[dict] = []
    seen_urls: set[str] = set()
    for index, item in enumerate(results):
        url = str(item.get("url") or item.get("link") or "").strip()
        title = str(item.get("title") or item.get("name") or "").strip()
        parsed_url = urlparse(url)
        if parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc or not title or url in seen_urls:
            continue
        seen_urls.add(url)
        normalized.append({
            "id": f"{chapter_id}-ref-{index + 1}",
            "chapter_id": chapter_id,
            "title": title,
            "url": url,
            "domain": parsed_url.netloc.removeprefix("www."),
            "snippet": str(item.get("snippet") or item.get("description") or item.get("text") or item.get("content") or "").strip(),
            "status": "found",
        })
        if len(normalized) >= max(1, min(limit, 6)):
            break
    return normalized


def choose_chapter_for_source(
    chapters: list[dict],
    source: dict,
    current_query: str = "",
    counts: dict[str, int] | None = None,
) -> str:
    """按标题/摘要关键词匹配 Deep Research 来源；无明显匹配时分配给当前来源最少的章节。"""
    if not chapters:
        raise ValueError("chapters 不能为空")
    counts = counts or {}
    source_text = " ".join(str(source.get(key) or "") for key in ("title", "description", "snippet")) + " " + current_query

    def tokens(text: str) -> set[str]:
        latin = re.findall(r"[a-zA-Z0-9]{2,}", text.lower())
        chinese = [text[index:index + 2] for index in range(max(0, len(text) - 1)) if "\u4e00" <= text[index] <= "\u9fff" and "\u4e00" <= text[index + 1] <= "\u9fff"]
        return set(latin + chinese)

    source_tokens = tokens(source_text)
    scored = []
    for chapter in chapters:
        chapter_id = str(chapter.get("id") or "")
        chapter_tokens = tokens(f"{chapter.get('title', '')} {chapter.get('summary', '')}")
        scored.append((len(source_tokens & chapter_tokens), -counts.get(chapter_id, 0), chapter_id))
    best_score, _, best_id = max(scored)
    if best_score > 0:
        return best_id
    return min((str(chapter.get("id") or "") for chapter in chapters), key=lambda chapter_id: counts.get(chapter_id, 0))


def _chapter_guidance(target_words: int | None) -> str:
    if target_words is None or target_words <= 3000:
        return "规划 4 至 5 个大章节，以二级标题为主。"
    if target_words <= 8000:
        return "规划 5 至 7 个大章节，必要时使用三级标题。"
    if target_words <= 15000:
        return "规划 6 至 9 个大章节，使用二至三级标题。"
    return "规划 8 至 12 个大章节，使用三级标题并给出清晰的章节字数预算。"


def build_thesis_outline_prompt(request: ThesisOutlineRequest) -> str:
    target = f"约 {request.target_words} 字" if request.target_words else "字数不限"
    regenerate_note = (
        "这是一次候选大纲重生成。保持研究主题，但必须给出明显不同且合理的新结构。"
        if request.previous_outline
        else "这是第一次生成大纲。"
    )
    return f"""你是一名严谨的中文学术论文结构编辑。请根据真实用户主题生成可执行的论文大纲。

论文主题与要求：{request.instruction.strip()}
论文类型：{request.thesis_type}
学段：{request.education_level}
期望字数：{target}
结构规模：{_chapter_guidance(request.target_words)}
{regenerate_note}

输出必须严格采用 NDJSON：每行一个 JSON 对象，不要 Markdown 代码块，不要解释文字。
按以下顺序输出：
1. 一行标题：{{"type":"title","title":"论文标题"}}
2. 摘要与 Abstract：{{"type":"preface","id":"abstract","title":"摘要","writing_brief":"摘要要点"}}
3. 每个大章节一行：{{"type":"chapter","id":"c1","order":1,"title":"1. 引言","summary":"本章作用","target_words":800}}
4. 紧随章节输出其子章节：{{"type":"section","chapter_id":"c1","id":"s1","order":1,"title":"1.1 研究背景","writing_brief":"本节应写的事实、论点和方法","target_words":300}}
5. 最后一行：{{"type":"done"}}

要求：
- 章节必须紧扣用户题目，禁止使用空泛通用模板。
- 标题层级清晰，章节之间不存在明显重复。
- 每个大章节包含 2 至 4 个子章节。
- target_words 总体接近期望字数；字数不限时仍给出合理预算。
- writing_brief 必须能直接指导后续正文写作和章节检索。
"""


def parse_outline_ndjson_lines(chunks: Iterable[str]) -> tuple[list[dict], str]:
    """解析任意边界切分的 NDJSON chunk，忽略无效行并保留末尾残片。"""
    buffer = ""
    events: list[dict] = []
    for chunk in chunks:
        buffer += chunk
        lines = buffer.split("\n")
        buffer = lines.pop()
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict) and isinstance(value.get("type"), str):
                events.append(value)
    return events, buffer
