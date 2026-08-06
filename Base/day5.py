import json
import openai
from sentence_transformers import SentenceTransformer
import numpy as np

client = openai.OpenAI(
    api_key = "sk-6d31f71ec3514f6785e28fa00ea03199",
    base_url = "https://api.deepseek.com"
)

memory = [
    {"role": "system","content": "你是一个记性极好的私人助理，记住用户说的话，并给出回答。"},
]

tools = [
    {
        "type": "function",
        "function": {
            "name": "get_user_balance",
            "parameters": {
                "type": "object",
                "properties": {
                    "name":{"type": "string", "description": "用户的姓名"}
                },
                "required": ["name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_phone_price",
            "description": "查询指定型号手机的市场价格",
            "parameters": {
                "type": "object",
                "properties": {
                    "model_name":{"type": "string", "description": "手机型号，如iPhone 15"}
                },
                "required": ["model_name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_knowledge_base",
            "description": "查看维修手册知识库",
            "parameters": {
                "type": "object",
                "properties": {
                    "query":{"type": "string", "description": "手机维修的相关问题"}
                },
                "required": ["query"]
            }
        }
        
    }
]

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

def vector_search(query):
    """使用向量相似度从知识库中找出最相关的一条资料。"""
    query_embedding = model.encode([query])[0]

    similarities = np.dot(knowledge_embeddings, query_embedding) / (
        np.linalg.norm(knowledge_embeddings, axis=1) * np.linalg.norm(query_embedding)
    )

    best_index = int(np.argmax(similarities))
    return knowledge_base[best_index]

def search_knowledge_base_pro(query):
    print(f"🔍 [第一步：查询扩展] 正在请AI帮我们美化搜索词...")

    # 1. 询问 AI：为了搜到这个问题的答案，我该搜哪些词？
    expansion_prompt = f"针对用户的问题：'{query}', 请给出三个最相关的搜索关键词，用逗号分隔，不要有其他废话。"
    response = client.chat.completions.create(
        model = "deepseek-chat",
        messages = [{"role": "user", "content": expansion_prompt}]
    )
    keywords = response.choices[0].message.content.split("，")
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

    final_res = client.chat.completions.create(
        model="deepseek-chat",
        messages = [{"role": "user","content": rerank_prompt}]
    )

    return final_res.choices[0].message.content

# 测试一下
#print(search_knowledge_base("屏幕坏了多少钱"))


def get_user_balance(name):
    print(f"--- 正在执行系统工具：查询 {name} 的余额 ---")
    balances = {"张大炮": 100, "小王": 5000, "老李": 2000}
    return json.dumps({"name": name, "balance": balances.get(name, "未知")})

def get_phone_price(model_name):
    print(f"--- 正在执行系统工具：查询 {model_name} 的市场价格 ---")
    prices = {"iPhone 15": 5999,"小米14": 3999,"华为Meta60": 6999,"红米": 799}
    return json.dumps({"model": model_name, "price": prices.get(model_name, "1500")})

available_functions = {
    "get_user_balance": get_user_balance,
    "get_phone_price": get_phone_price,
    "search_knowledge_base": search_knowledge_base_pro
}

#messages = [{"role": "user","content": "帮我看看张大炮还有多少钱，够不够买个iPhone 15"}]

print("---已进入AI私人管家模式模式（输入'quit'退出）---")

while True:
    user_input = input("你：")

    if user_input.lower() in ['quit','exit','退出']:
        break

    memory.append({
        "role": "user",
        "content": user_input
    })

    while True:
        response = client.chat.completions.create(
            model = "deepseek-v4-flash",
            messages = memory,
            tools = tools,
            tool_choice = "auto"
        )

        message = response.choices[0].message

        if not message.tool_calls:
            memory.append({
                "role": "assistant",
                "content": message.content
            })
            print(f"AI: {message.content}")
            break

        print("AI调用了工具!")
        memory.append(message)

        for tool_call in message.tool_calls:
            func_name = tool_call.function.name
            args = json.loads(tool_call.function.arguments)

            function_to_call = available_functions[func_name]
            result = function_to_call(**args)

            memory.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": result
            })

    print(f"记忆长度：{len(memory)}")

    