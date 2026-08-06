import json
import openai
import numpy as np
from sentence_transformers import SentenceTransformer

client = openai.OpenAI(
    api_key="sk-6d31f71ec3514f6785e28fa00ea03199",
    base_url="https://api.deepseek.com"
)

embedding_model = SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')

knowledge_base = [
    "黑科技手机X屏幕碎裂维修费用为500元，需耗时2小时。",
    "如果黑科技手机X无法开机，请长按电源键和音量加键10秒强制重启。",
    "黑科技手机X的电池质保期为2年，非人为损坏可免费更换。",
    "黑科技手机X支持超快闪充，必须使用原装60W充电头。"
]
knowledge_embeddings = embedding_model.encode(knowledge_base)

def tech_specialist_tool(query):
    """技术专家：负责检索维修手册"""
    print(f"🛠️ [技术专家] 正在翻阅手册查找：{query}")
    
    query_emb = embedding_model.encode([query])[0] # 将查询语句转换为向量
    norm_k = np.linalg.norm(knowledge_embeddings,axis=1) # 计算知识库中每个条目的向量长度
    norm_q = np.linalg.norm(query_emb)  # 将查询语句转换为向量长度
    similarities = np.dot(knowledge_embeddings,query_emb) / (norm_k * norm_q) # 计算知识库中每个条目与查询语句的相似度
    best_index = np.argmax(similarities)                # 找到相似度最高的条目索引
    return f"维修手册显示: {knowledge_base[best_index]}" # 返回相似度最高的条目

def finance_specialist_tool(name):
    """财务专家：负责查询账户余额"""
    print(f"💰 [财务专家] 正在核对 {name} 的账目...")
    balances = {"张大炮": 100,"小王": 5000,"老李": 2000}
    balance = balances.get(name,"未知")
    return f"财务系统显示：{name}的账户余额为{balance}元"

tools = [
    {
        "type": "function",
        "function": {
            "name": "call_tech_expert",
            "description": "当用户询问关于手机维修、故障、技术参数时，请调用此工具。",
            "parameters":{
                "type": "object",
                "properties":{
                    "query": {
                        "type": "string",
                        "description": "具体的技术问题"
                    }
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "call_finance_expert",
            "description": "当用户询问余额、钱、费用支付能力时，请调用此工具。",
            "parameters":{
                "type":"object",
                "properties":{
                    "name": {
                        "type": "string",
                        "description": "用户的姓名"
                    }
                },
                "required": ["name"]
            }
        }
    }
]

available_functions = {
    "call_tech_expert": tech_specialist_tool,
    "call_finance_expert": finance_specialist_tool,
}

memory = [
    {
        "role": "system",
        "content": "你是一个高效率的物业经理。你手下有一名【技术专家】和一名【财务专家】。请根据用户需求调用对应专家，并汇总他们的意见回复用户。如果需要多名专家，请依次调用。"
    }
]

print("--- 👔 欢迎来到黑科技手机管家服务中心（多智能体版） ---")

while True:
    user_input = input("\n👤用户：")
    if user_input.lower() in ["再见","拜拜","退出","再见"]:break

    memory.append({"role": "user","content": user_input})

    while True:
        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=memory,
            tools=tools
        )
    
        msg = response.choices[0].message

        if not msg.tool_calls:
            print(f"\n🤖 经理: {msg.content}")
            memory.append({"role": "assistant","content": msg.content})
            break

        memory.append(msg)
        for tool_call in msg.tool_calls:
            func_name = tool_call.function.name
            args = json.loads(tool_call.function.arguments)

            result = available_functions[func_name](**args)

            memory.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": result
            })
            print(f"📨 [系统] 经理收到了来自专家的情报。")

        if len(memory) > 15:
            
            memory = [memory[0]] + memory[-10:]

