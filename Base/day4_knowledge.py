import json
from sentence_transformers import SentenceTransformer
import numpy as np

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

def search_knowledge_base(query):
    print(f"--- 正在知识库中检索关于 ’{query}‘ 的内容 ---")

    query_embedding = model.encode([query])

    # 计算距离（余弦相似度），找出最像的那句话
    # 这一步就是向量数据库的核心逻辑
    similarities = np.dot(knowledge_embeddings,query_embedding.T).flatten()
    best_idx = np.argmax(similarities)

    return knowledge_base[best_idx]

# 测试一下
#print(search_knowledge_base("屏幕坏了多少钱"))
