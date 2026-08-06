import os
import re
import requests
from typing import List, Dict, Any
from tavily import TavilyClient
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage

# ==========================================
# 1. 基础配置 (配置你的 API Keys)
# ==========================================
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "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")
SILICONFLOW_KEY = os.getenv("SILICONFLOW_KEY", "sk-uxbwkpqtfksnzpzkagxrmlpjxgzmajipleykmxaxiaxqwnkm")
DEEPSEEK_KEY = os.getenv("DEEPSEEK_API_KEY", "sk-6d31f71ec3514f6785e28fa00ea03199")

tavily_client = TavilyClient(api_key=TAVILY_API_KEY)
llm = ChatOpenAI(model="deepseek-chat", api_key=DEEPSEEK_KEY, base_url="https://api.deepseek.com")

# ==========================================
# 2. 步骤一：Query Fan-out (多路搜索词广播)
# ==========================================
def generate_sub_queries(original_query: str) -> List[str]:
    """将用户的复杂研究问题，裂变为 3-4 个不同维度的子搜索词"""
    print(f"\n[Step 1] 📡 正在将研究课题进行多路意图裂变...")
    prompt = f"""你是一个 Deep Research 研究规划员。
请针对研究课题：'{original_query}'，生成 3 个互不重叠、涵盖不同侧重点（如：现状/技术细节/商业表现/风险等）的精准搜索词。
直接输出搜索词，每行一个，不要包含数字序号或多余文字。"""

    res = llm.invoke([SystemMessage(content=prompt)])
    sub_queries = [line.strip() for line in res.content.split("\n") if line.strip()]
    sub_queries.append(original_query) # 始终保留原始查询
    print(f"  └─ 广播生成 {len(sub_queries)} 个并行搜索通道: {sub_queries}")
    return sub_queries

# ==========================================
# 3. 步骤二：海选抓取 (Mass Search Fetching)
# ==========================================
def fetch_mass_web_pages(sub_queries: List[str]) -> List[Dict[str, str]]:
    """并行/并发抓取多路网页"""
    print(f"\n[Step 2] 🌐 全网海量并发抓取中...")
    raw_pages = []
    seen_urls = set()

    for q in sub_queries:
        try:
            # 开启高级搜索，获取全文片段
            res = tavily_client.search(query=q, search_depth="advanced", max_results=5)
            for item in res.get("results", []):
                url = item.get("url")
                if url and url not in seen_urls:
                    seen_urls.add(url)
                    raw_pages.append({
                        "url": url,
                        "title": item.get("title", ""),
                        "content": item.get("content", "")
                    })
        except Exception as e:
            print(f"  ⚠️ 查询 '{q}' 抓取异常: {e}")

    print(f"  └─ 成功抓取到 {len(raw_pages)} 篇不重复的全网网页内容")
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
    """
    使用 BGE-Reranker 对 100+ 切片进行打分，并挑选 Top 10 精华
    """
    print(f"\n[Step 4] 🎯 正在使用 BGE-Reranker 对 {len(chunks)} 个切片进行交叉熵重排打分...")
    
    if not chunks:
        return []

    rerank_url = "https://api.siliconflow.cn/v1/rerank"
    headers = {
        "Authorization": f"Bearer {SILICONFLOW_KEY}",
        "Content-Type": "application/json"
    }

    # API 批量限制：每次处理最多 100 条，分批发送
    batch_size = 80
    all_scored_chunks = []

    for i in range(0, len(chunks), batch_size):
        batch = chunks[i:i + batch_size]
        payload = {
            "model": "BAAI/bge-reranker-v2-m3",
            "query": query,
            "documents": [c["text"] for c in batch],
            "top_n": len(batch) # 拿回批次内所有得分
        }

        try:
            resp = requests.post(rerank_url, json=payload, headers=headers, timeout=30).json()
            results = resp.get("results", [])
            for res_item in results:
                original_chunk = batch[res_item["index"]]
                original_chunk["score"] = res_item["relevance_score"]
                all_scored_chunks.append(original_chunk)
        except Exception as e:
            print(f"  ⚠️ Rerank 批次 {i} 执行失败: {e}")

    # 按得分从高到低全局排序
    all_scored_chunks.sort(key=lambda x: x.get("score", 0), reverse=True)
    
    # 截取 Top 10
    top_golden_chunks = all_scored_chunks[:top_n]
    print(f"  └─ 重排完成！已从 {len(chunks)} 条数据中提炼出得分最高的 【{len(top_golden_chunks)}】 条金子切片")
    
    # 打包成 1-10 编号格式
    final_output = []
    for idx, item in enumerate(top_golden_chunks):
        final_output.append({
            "id": idx + 1,
            "title": item["title"],
            "url": item["url"],
            "score": round(item["score"], 4),
            "text": item["text"]
        })
        
    return final_output

# ==========================================
# 6. Deep Research 检索管道整合
# ==========================================
def run_deep_retrieval_pipeline(query: str) -> List[Dict[str, Any]]:
    print(f"\n" + "="*60)
    print(f"🚀 启动 Deep Research 深度检索管道: '{query}'")
    print("="*60)
    
    # 1. 裂变搜索词
    sub_queries = generate_sub_queries(query)
    
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
