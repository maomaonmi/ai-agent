import json
import openai

from day2_agent import get_user_balance

client = openai.OpenAI(
    api_key="sk-6d31f71ec3514f6785e28fa00ea03199",
    base_url="https://api.deepseek.com"
)

def get_user_balance(name):
    print(f"--- 正在执行系统工具：查询 {name} 的余额 ---")
    balances = {"张大炮": 100, "小王": 5000, "老李": 2000}
    return json.dumps({"name": name, "balance": balances.get(name, "未知")})

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
    }
]

messages = [{"role": "user","content": "帮我看看张大炮还有多少钱，够不够买个500块钱的手机"}]

response = client.chat.completions.create(
    model = "deepseek-chat",
    messages = messages,
    tools = tools, # 告诉AI你有哪些工具
)

message = response.choices[0].message
tool_calls = message.tool_calls

if tool_calls:
    print("AI调用了工具!")
    for tool_call in tool_calls:
        #拿到AI想调用的函数名和参数
        func_name = tool_call.function.name
        args = json.loads(tool_call.function.arguments)# 解析JSON字符串为Python对象
        
        # 真正去执行那个 Python 函数
        if func_name == "get_user_balance":
            result = get_user_balance(args['name'])
            # 把函数的执行结果塞回对话历史
            messages.append(message)# 把AI刚才的话存起来
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
            