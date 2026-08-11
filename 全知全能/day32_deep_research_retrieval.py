import os
import re
import requests
from typing import List, Dict, Any, Optional
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage

# ==========================================
# 1. 基础配置 (Keys 走环境变量/运行时配置，严禁硬编码默认值)
#
# 约定 env 名与上层 main.py 统一：
#   FIRECRAWL_API_KEY  - Firecrawl 搜索（替代原 Tavily）
#   RERANK_API_KEY     - SiliconFlow (或兼容) Reranker
#   DEEPSEEK_API_KEY   - DeepSeek (用于 day32 本地 LLM 推理)
# 为什么要默认空串：避免旧开发者环境残留的"示例 Key"被意外真的送到外网打 credit。
#
# Why 新增 configure_retrieval_keys：main.py 的 Key 从 service_settings.json 读取，
#   day32 模块级 os.getenv 拿不到。主程序调用前必须先注入，否则搜索全部跳过。
# ==========================================
FIRECRAWL_API_KEY = os.getenv("FIRECRAWL_API_KEY", "")
FIRECRAWL_BASE_URL = os.getenv("FIRECRAWL_BASE_URL", "https://api.firecrawl.dev").rstrip("/")
RERANK_API_KEY = os.getenv("RERANK_API_KEY", "") or os.getenv("SILICONFLOW_KEY", "")
DEEPSEEK_KEY = os.getenv("DEEPSEEK_API_KEY", "")


def configure_retrieval_keys(
    firecrawl_key: Optional[str] = None,
    rerank_key: Optional[str] = None,
    deepseek_key: Optional[str] = None,
    firecrawl_base_url: Optional[str] = None,
) -> None:
    """主程序运行时注入 Key（覆盖模块级 os.getenv 默认值）。

    Why：main.py 的 FIRECRAWL_API_KEY / RERANK_API_KEY 来自 service_settings.json，
      不在环境变量里；day32 模块加载时 os.getenv 拿到空串，导致搜索全部跳过。
      主程序必须在调用 day32 任何函数前先调用本函数注入 Key。
    """
    global FIRECRAWL_API_KEY, RERANK_API_KEY, DEEPSEEK_KEY, FIRECRAWL_BASE_URL, llm
    if firecrawl_key is not None:
        FIRECRAWL_API_KEY = firecrawl_key
    if rerank_key is not None:
        RERANK_API_KEY = rerank_key
    if deepseek_key is not None:
        DEEPSEEK_KEY = deepseek_key
    if firecrawl_base_url is not None:
        FIRECRAWL_BASE_URL = firecrawl_base_url.rstrip("/")
    # Key 变化后重建 LLM 单例
    llm = _lazy_llm()


def _lazy_llm() -> ChatOpenAI | None:
    """延迟初始化 LLM：无 Key 时返回 None；Fan-out 子查询生成器 call-time 再抛可理解错误。"""
    if not DEEPSEEK_KEY:
        return None
    try:
        return ChatOpenAI(model="deepseek-chat", api_key=DEEPSEEK_KEY, base_url="https://api.deepseek.com")
    except Exception:
        return None


llm: ChatOpenAI | None = _lazy_llm()

# ==========================================
# 2. 步骤一：Query Fan-out (多路搜索词广播)
# ==========================================
def generate_sub_queries(original_query: str, history: Optional[List[Dict[str, str]]] = None) -> List[str]:
    """将用户的复杂研究问题，裂变为 3-4 个不同维度的子搜索词。

    Key 未配置时：不硬崩，返回原始查询 + 几个通用维度改写（同义词/最新动态/对比），
    保证整条 day32+day33 链路在零配置环境下也能跑到出报告。

    Why 加 history：用户问"还有类似的物理学或数学方面的吗"这种指代型问题，
      没有上下文 LLM 根本不知道"类似的"指什么，会原样把问题当搜索词。
      传入最近若干轮历史后，LLM 能解析指代并改写成完整搜索词。
    """
    print(f"\n[Step 1] 📡 正在将研究课题进行多路意图裂变...")
    sub_queries: list[str] = []
    if llm is not None:
        # Why：把会话历史拼进 prompt，让 LLM 理解"类似的""上面提到的"等指代词。
        #   只取最近 6 轮，避免上下文过长；role 标注让 LLM 区分用户/助手视角。
        history_block = ""
        if history:
            recent = history[-6:]
            lines = []
            for turn in recent:
                role = turn.get("role", "user")
                content = str(turn.get("content", "")).strip()
                if content:
                    lines.append(f"[{role}] {content[:500]}")
            if lines:
                history_block = "\n【会话历史（用于解析指代）】:\n" + "\n".join(lines) + "\n"

        prompt = f"""你是一个 Deep Research 研究规划员。
请针对研究课题：'{original_query}'，生成 3 个互不重叠、涵盖不同侧重点（如：现状/技术细节/商业表现/风险等）的精准搜索词。
{history_block}
重要规则：
1. 如果当前问题包含"类似的""上面提到的""还有没有"等指代词，必须结合会话历史解析出具体指代对象，生成完整可搜索的词。
2. 直接输出搜索词，每行一个，不要包含数字序号或多余文字。"""
        try:
            res = llm.invoke([SystemMessage(content=prompt)])
            sub_queries = [line.strip() for line in res.content.split("\n") if line.strip()]
        except Exception as e:
            print(f"  ⚠️  LLM 子查询生成失败，回退规则改写: {type(e).__name__}")
    # 兜底：始终保留原始查询 + 两条规则维度改写
    fallback_supplements = [
        f"{original_query} 最新进展",
        f"{original_query} 优缺点 对比",
    ]
    if original_query not in sub_queries:
        sub_queries.append(original_query)
    for fb in fallback_supplements:
        if fb not in sub_queries:
            sub_queries.append(fb)
    print(f"  └─ 广播生成 {len(sub_queries)} 个并行搜索通道: {sub_queries}")
    return sub_queries

# ==========================================
# 3. 步骤二：海选抓取 (Mass Search Fetching)
# ==========================================
def _firecrawl_search_and_scrape(query: str, limit: int = 5) -> List[Dict[str, str]]:
    """Firecrawl /v2/search + 可选 scrape，返回 [{url, title, content}]。

    Why 替代 Tavily：Tavily 依赖独立 API Key 且用户未配置，Firecrawl 已调通且复用同一 Key。
    参数对齐官方 Playground 默认（不传 tbs/country/location 预过滤）。
    """
    if not FIRECRAWL_API_KEY:
        print(f"  ⚠️  未配置 FIRECRAWL_API_KEY，Firecrawl 搜索跳过。")
        return []

    headers = {
        "Authorization": f"Bearer {FIRECRAWL_API_KEY}",
        "Content-Type": "application/json",
    }
    payload: dict = {
        "query": query,
        "limit": limit,
        "timeout": 60000,
        "ignoreInvalidURLs": True,
        "scrapeOptions": {"formats": ["markdown"], "onlyMainContent": True},
    }

    try:
        r = requests.post(
            f"{FIRECRAWL_BASE_URL}/v2/search",
            json=payload,
            headers=headers,
            timeout=(5, 60),
        )
        if r.status_code >= 400:
            print(f"  ⚠️ Firecrawl search HTTP {r.status_code}: {r.text[:120]}")
            return []

        data = r.json() or {}
        # 多通道抽取（和 main.py _firecrawl_extract_candidates 同逻辑）
        raw_items: list[dict] = []
        for key in ("data", "organic", "results", "items"):
            arr = data.get(key)
            if isinstance(arr, list) and arr:
                raw_items = [x for x in arr if isinstance(x, dict)]
                break

        pages: list[dict[str, str]] = []
        for item in raw_items:
            url = ""
            for uk in ("url", "href", "link", "source"):
                uv = item.get(uk)
                if isinstance(uv, str) and uv:
                    url = uv
                    break
            if not url:
                continue

            title = ""
            for tk in ("title", "pageTitle", "page_title"):
                tv = item.get(tk)
                if isinstance(tv, str) and tv:
                    title = tv
                    break

            content = ""
            for ck in ("markdown", "markdownContent", "markdown_content", "content", "snippet", "description"):
                cv = item.get(ck)
                if isinstance(cv, str) and cv:
                    content = cv
                    break

            pages.append({"url": url, "title": title or "(无标题)", "content": content})

        return pages
    except Exception as e:
        print(f"  ⚠️ Firecrawl search 异常: {type(e).__name__}: {e}")
        return []


def _firecrawl_research_papers(query: str, limit: int = 5) -> List[Dict[str, str]]:
    """Firecrawl Research Index /v2/search/research/papers，返回学术论文来源。

    Why 新增：Research Index 是学术论文专用索引（arxiv 等），通用搜索查不到的论文内容可在这里找到。
    仅当 query 看起来是学术性问题时才有结果，流行文化/新闻类 query 返回空属正常。
    无需 API Key 也能用（有更低限流），但有 Key 时限流更高。
    """
    headers: dict = {}
    if FIRECRAWL_API_KEY:
        headers["Authorization"] = f"Bearer {FIRECRAWL_API_KEY}"

    try:
        r = requests.get(
            f"{FIRECRAWL_BASE_URL}/v2/search/research/papers",
            params={"query": query, "k": limit},
            headers=headers,
            timeout=(5, 30),
        )
        if r.status_code >= 400:
            return []

        data = r.json() or {}
        papers = data.get("data") or data.get("papers") or data.get("results") or []
        if not isinstance(papers, list):
            return []

        pages: list[dict[str, str]] = []
        for p in papers:
            if not isinstance(p, dict):
                continue
            paper_id = str(p.get("paperId") or p.get("id") or "")
            title = str(p.get("title") or "")
            abstract = str(p.get("abstract") or "")
            if not title and not abstract:
                continue
            url = f"https://arxiv.org/abs/{paper_id}" if paper_id else ""
            pages.append({
                "url": url,
                "title": f"[论文] {title}",
                "content": abstract,
            })
        return pages
    except Exception:
        # Research Index 是辅助通道，任何异常都不影响主链路
        return []


def fetch_mass_web_pages(sub_queries: List[str]) -> List[Dict[str, str]]:
    """并行/并发抓取多路网页（Firecrawl /v2/search + Research Index 学术论文）。

    Why 替代 Tavily：用户未配置 TAVILY_API_KEY，Firecrawl 已调通且复用同一 Key。
    双路搜索：Firecrawl /v2/search 通用海选 + Research Index 学术论文补充。
    """
    print(f"\n[Step 2] 🌐 全网海量并发抓取中（Firecrawl 搜索 + Research Index）...")
    raw_pages: list[dict[str, str]] = []
    seen_urls: set[str] = set()

    if not FIRECRAWL_API_KEY:
        print("  ⚠️  未配置 FIRECRAWL_API_KEY，搜索跳过，返回空来源集合。")
        return raw_pages

    for q in sub_queries:
        # 路径 A：Firecrawl /v2/search 通用网页搜索
        search_pages = _firecrawl_search_and_scrape(q, limit=5)
        for p in search_pages:
            url = p.get("url", "")
            if url and url not in seen_urls:
                seen_urls.add(url)
                raw_pages.append(p)

        # 路径 B：Firecrawl Research Index 学术论文搜索（辅助，失败不影响主链路）
        paper_pages = _firecrawl_research_papers(q, limit=5)
        for p in paper_pages:
            url = p.get("url", "")
            if url and url not in seen_urls:
                seen_urls.add(url)
                raw_pages.append(p)

    print(f"  └─ 成功抓取到 {len(raw_pages)} 篇不重复的全网网页内容（含学术论文）")
    return raw_pages

# ==========================================
# 4. 步骤三：细粒度切片 (Chunking Engine)
# ==========================================
def chunk_documents(pages: List[Dict[str, str]], chunk_size: int = 350, overlap: int = 50) -> List[Dict[str, Any]]:
    """将长文本切分成 100-180 个高密度小切片"""
    print(f"\n[Step 3] ✂️  正在对网页内容进行细粒度语义切片...")
    chunks = []
    
    for doc_idx, page in enumerate(pages):
        text = page["content"]
        # 清理多余空格换行
        clean_text = re.sub(r'\s+', ' ', text).strip()
        
        # 滑动窗口切片
        start = 0
        chunk_idx = 0
        while start < len(clean_text):
            end = start + chunk_size
            segment = clean_text[start:end]
            if segment:
                chunks.append({
                    "chunk_id": f"doc_{doc_idx}_chk_{chunk_idx}",
                    "url": page["url"],
                    "title": page["title"],
                    "text": segment
                })
            start += (chunk_size - overlap)
            chunk_idx += 1

    print(f"  └─ 原始文本切割完成！共生成 【{len(chunks)}】 个待精炼切片")
    return chunks

# ==========================================
# 5. 步骤四：批量重排 (Batch Reranking)
# ==========================================
def batch_rerank_chunks(query: str, chunks: List[Dict[str, Any]], top_n: int = 10) -> List[Dict[str, Any]]:
    """使用 BGE-Reranker 对切片打分，挑选 Top N。

    降级策略：
      - 无 RERANK_API_KEY → 按原顺序取 top_n（不抛错，保证 pipeline 跑通）
      - 单批次 4xx/5xx/SSLError → 该批次跳过；剩余成功批次继续，再按已有 score 排序
    """
    print(f"\n[Step 4] 🎯 正在使用 BGE-Reranker 对 {len(chunks)} 个切片进行交叉熵重排打分...")

    if not chunks:
        return []

    # 无 Key：直接按原顺序构造 top_n 的输出，score 按位置衰减（保持与精排结果同契约，下游无需分支）
    if not RERANK_API_KEY:
        print("  ⚠️  未配置 RERANK_API_KEY，跳过 rerank，使用原始顺序。")
        top_raw = chunks[:top_n]
        out: list[dict[str, Any]] = []
        for idx, item in enumerate(top_raw):
            out.append({
                "id": idx + 1,
                "title": item.get("title", ""),
                "url": item.get("url", ""),
                "score": round(1.0 - idx * 0.08, 4),
                "text": item.get("text", ""),
            })
        print(f"  └─ 未使用重排，返回原始顺序 Top 【{len(out)}】")
        return out

    RERANK_URL = "https://api.siliconflow.cn/v1/rerank"
    headers = {
        "Authorization": f"Bearer {RERANK_API_KEY}",
        "Content-Type": "application/json",
    }

    batch_size = 80
    all_scored_chunks: list[Dict[str, Any]] = []

    for i in range(0, len(chunks), batch_size):
        batch = chunks[i:i + batch_size]
        payload = {
            "model": "BAAI/bge-reranker-v2-m3",
            "query": query,
            "documents": [c["text"] for c in batch],
            "top_n": len(batch),
        }
        try:
            r = requests.post(RERANK_URL, json=payload, headers=headers, timeout=30)
            if r.status_code >= 400:
                detail = ""
                try:
                    j = r.json()
                    detail = (j.get("message") or j.get("error") or "") if isinstance(j, dict) else ""
                except Exception:
                    detail = r.text[:120]
                raise RuntimeError(f"HTTP {r.status_code}: {detail or r.reason}")
            resp = r.json()
            results = resp.get("results", []) or []
            for res_item in results:
                idx_raw = res_item.get("index")
                if not isinstance(idx_raw, int) or not (0 <= idx_raw < len(batch)):
                    continue
                original_chunk = dict(batch[idx_raw])
                score_raw = (
                    res_item.get("relevance_score")
                    if res_item.get("relevance_score") is not None
                    else res_item.get("score")
                )
                original_chunk["score"] = float(score_raw or 0.0)
                all_scored_chunks.append(original_chunk)
        except Exception as e:
            print(f"  ⚠️ Rerank 批次 {i//batch_size + 1} 失败: {type(e).__name__}: {e}")

    # 如果全部批次失败 → fallback 原顺序（与无 Key 行为一致）
    if not all_scored_chunks:
        print("  ⚠️  Rerank 全部失败，使用原始顺序作为兜底")
        all_scored_chunks = [dict(c) for c in chunks[:top_n]]
        for idx, c in enumerate(all_scored_chunks):
            c["score"] = 1.0 - idx * 0.08

    all_scored_chunks.sort(key=lambda x: float(x.get("score", 0)), reverse=True)
    top_golden_chunks = all_scored_chunks[:top_n]

    print(f"  └─ 重排完成！已从 {len(chunks)} 条数据中提炼出得分最高的 【{len(top_golden_chunks)}】 条金子切片")
    final_output: list[dict[str, Any]] = []
    for idx, item in enumerate(top_golden_chunks):
        final_output.append({
            "id": idx + 1,
            "title": item.get("title", ""),
            "url": item.get("url", ""),
            "score": round(float(item.get("score", 0)), 4),
            "text": item.get("text", ""),
        })
    return final_output

# ==========================================
# 6. Deep Research 检索管道整合
# ==========================================
def run_deep_retrieval_pipeline(query: str, history: Optional[List[Dict[str, str]]] = None) -> List[Dict[str, Any]]:
    print(f"\n" + "="*60)
    print(f"🚀 启动 Deep Research 深度检索管道: '{query}'")
    print("="*60)

    # 1. 裂变搜索词（传入 history 让 LLM 解析指代）
    sub_queries = generate_sub_queries(query, history=history)

    # 2. 海量并发抓网页
    pages = fetch_mass_web_pages(sub_queries)

    # 3. 细粒度分块 (产生100-180条切片)
    chunks = chunk_documents(pages, chunk_size=350, overlap=50)

    # 4. BGE-Reranker 100+ 选 10 精萃
    golden_chunks = batch_rerank_chunks(query, chunks, top_n=10)

    return golden_chunks

# ==========================================
# 测试运行
# ==========================================
if __name__ == "__main__":
    test_topic = "最新固态电池商业化落地进展与主要突破厂商"
    results = run_deep_retrieval_pipeline(test_topic)
    
    print("\n" + "="*60)
    print("🏆 【第 32 天战果】提炼出的 Top 10 金子证据切片:")
    print("="*60)
    for r in results:
        print(f"[{r['id']}] 得分: {r['score']} | 来源: {r['title']} ({r['url']})")
        print(f"     内容: {r['text'][:120]}...\n")
