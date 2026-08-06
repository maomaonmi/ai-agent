import json
import openai

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
    }
]

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

    