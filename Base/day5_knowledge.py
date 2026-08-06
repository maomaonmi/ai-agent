from enum import unique
import json
import openai
from sentence_transformers import SentenceTransformer
import numpy as np

client = openai.OpenAI(
    api_key = "sk-6d31f71ec3514f6785e28fa00ea03199",
    base_url = "https://api.deepseek.com"
)

# 1. 加载一个超小型的语义模型（第一次运行会自动下载，约几十MB）
model = SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')

# 2. 准备我们的知识库（虚构的维修手册）
knowledge_base = [
    "黑科技手机X屏幕碎裂维修费用为500元，需要耗时2个小时。"
    "如果黑科技手机X无法开机，请长按电源键和音量键加10秒强制重启 。"
    "黑科技手机X的电池质保期为2年，非人为损坏可免费更换。"
    "手机进水后请勿开机，应立即放入干燥米缸中并联系售后。",
    "黑科技手机X支持超快闪充，必须使用原装60W充电头。"
]

# 3. 预先计算：把知识库里每一句话都变成“坐标”
knowledge_embeddings = model.encode(knowledge_base)

def search_knowledge_base_pro(query):
    print(f"🔍 [第一步：查询扩展] 正在请AI帮我们美化搜索词...")

    # 1. 询问 AI：为了搜到这个问题的答案，我该搜哪些词？
    expansion_prompt = f"针对用户的问题：'{query}', 请给出三个最相关的搜索关键词，用逗号分隔，不要有其他废话。"
    response = client.chat.completions.create(
        model = "deepseek-chat",
        messages = [{"role": "user", "content": expansion_prompt}]
    )
    keywords = response.choices[0].messages.content.split("，")
    keywords.append(query) # 把原始问题也加进去
    
    # 2. 拿着所有关键词去“海选”
    all_result = []
    for k in keywords:
        # 这里复用昨天的向量搜索逻辑
        res = vector_search(k.strip())
        all_result.append(res)

    #去除掉重复的结果
    unique_result = list(set(all_result))

    print(f"🎯 [第二步：重排序] 正在从 {len(unique_result)} 条海选结果中精选最精准的答案...")

    # 3. 裁判官逻辑 (Rerank)
    rerank_prompt = f"""
        用户的问题是：'{query}'
        以下是搜到的几条参考资料：
        {unique_result}

        请从中选出最能回答用户问题的一条资料，请直接输出资料原文，不要有任何评价。
        """

    final_res = client.chat.completion.create(
        model="deepseek-chat",
        message = [{"role": "user","content": rerank_prompt}]
    )

    return final_res.choices[0].message.content

# 测试一下
#print(search_knowledge_base("屏幕坏了多少钱"))
