import json
import openai

client = openai.OpenAI(
    api_key="sk-6d31f71ec3514f6785e28fa00ea03199",
    base_url="https://api.deepseek.com"
)

def get_user_balance(name):
    print(f"--- 正在执行系统工具：查询 {name} 的余额 ---")
    balances = {"张大炮": 100, "小王": 5000, "老李": 2000}
    return json.dumps({"name": name, "balance": balances.get(name, "未知")})

def get_phone_price(model_name):
    print(f"--- 正在执行系统工具：查询 {model_name} 的市场价格 ---")
    prices = {"iPhone 15": 5999,"小米14": 3999,"华为Meta60": 6999,"红米": 799}
    return json.dumps({"model": model_name, "price": prices.get(model_name, "1500")})

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

available_functions = {
    "get_user_balance": get_user_balance,
    "get_phone_price": get_phone_price,
}

messages = [{"role": "user","content": "帮我看看张大炮还有多少钱，够不够买个iPhone 15"}]

response = client.chat.completions.create(
    model = "deepseek-chat",
    messages = messages,
    tools = tools, # 告诉AI你有哪些工具
)

message = response.choices[0].message
tool_calls = message.tool_calls

if tool_calls:
    print("AI调用了工具!")
    messages.append(message)# 把AI刚才的话存起来
    for tool_call in tool_calls:
        #拿到AI想调用的函数名和参数
        func_name = tool_call.function.name
        args = json.loads(tool_call.function.arguments)# 解析JSON字符串为Python对象

        function_to_call = available_functions[func_name]
        
        # 真正去执行那个 Python 函数
        if function_to_call:
            result = function_to_call(**args)
            # 把函数的执行结果塞回对话历史
            
            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": result
            })
    
    second_response = client.chat.completions.create(
        model = "deepseek-chat",
        messages = messages
    )
    print("AI最终回复：")
    print(second_response.choices[0].message.content)
else:
    print("AI不需要调用工具。")
    print(message.content)
            