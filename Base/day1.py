import openai
import json # 导入json模块，用于解析JSON字符串,并将其转换为Python对象
client = openai.OpenAI(
    api_key="sk-6d31f71ec3514f6785e28fa00ea03199",
    base_url="https://api.deepseek.com"
)

response = client.chat.completions.create(
    model = "deepseek-chat",
    messages = [
        {"role": "system",
         "content": "你现在是一个高冷的HR助手。请从用户的描述中提取简历信息，并只以JSON格式输出，不要包含任何解释或开场白。"},
        {"role": "user",
         "content": "我叫张大炮，手机号13812345678。我会打篮球，也喜欢旅游。还会写点python。之前在‘黑马烧烤店‘当过3年店长，懂点管理。希望能找个AI开发的工作，月薪给我15000就行。"}
    ],
   stream=False
)

content = response.choices[0].message.content

try:
    data = json.loads(content)
    print("解析成功!")
    salary = data.get("expected_salary",0)
    if int(salary) <=10000:
        print(f"HR回复: {data['name']} 同学，你的薪资要求很合理，明天来面试吧。")
    else:
        print(f"HR回复: 太贵了，滚！")

except Exception as e:
    print(f"解析失败，AI给的内容格式不对。错误原因: {e}")

print("AI给的原始数据是：",content)

