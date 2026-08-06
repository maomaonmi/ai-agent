已完成多智能体讨论模式的三项升级。
自定义智能体参与讨论
进入“多智能体协同”模式后，可以勾选最多 5 个自定义智能体：
被选 Agent 会加入 Supervisor 的主讲候选池。
第二位发言者优先从选中的自定义 Agent 中选择。
不会让同一个 Agent 自问自答。
被暂停的 Agent 不会出现在讨论成员列表。
在智能体工厂中新增、暂停或删除后，讨论成员列表会即时同步。
可控输出长度
新增三档长度控制，并实际限制模型 max_tokens：
模式	单次发言	最终总结	使用场景
精简	约 180 Tokens	约 280 Tokens	最省成本，短句交流
适中	约 320 Tokens	约 480 Tokens	有一定例子和补充
展开	约 600 Tokens	约 900 Tokens	允许更完整的讨论

默认使用“精简”，直接降低讨论模式的 Token 消耗。
更自然、有趣的讨论风格
原来的“专业报告、审查意见、反驳”语气已经调整为朋友式圆桌聊天：
主持人邀请成员先聊看法
第二位成员自然接话、追问或举反例
第一位成员回应并修正观点
主持人给出简短聊天小结
减少行业黑话、论文腔和复杂标题
允许适度幽默，但仍要求事实准确
不输出隐藏思维链
主要修改：
[main.py](D:/AI-Agent学习计划/AI-Agent study/main.py)
[AgentDiscussionSettings.tsx](D:/AI-Agent学习计划/AI-Agent study/frontend/ai-agent/src/components/AgentDiscussionSettings.tsx)
[ChatInterface.tsx](D:/AI-Agent学习计划/AI-Agent study/frontend/ai-agent/src/components/ChatInterface.tsx)
[api.ts](D:/AI-Agent学习计划/AI-Agent study/frontend/ai-agent/src/lib/api.ts)
[test_multi_agent_discussion.py](D:/AI-Agent学习计划/AI-Agent study/tests/test_multi_agent_discussion.py)
验证结果：
后端 21 项测试通过
Python 编译通过
ESLint 通过
Next.js 生产构建通过
Chrome 实际交互验证通过
精简、适中、展开三档切换正常
自定义成员区域正常显示
重启后端和前端后即可使用新设置。

已经增加“讨论轮数”设置。
现在效果：
支持选择 1–5 轮，默认 2 轮。
每轮包括“其他智能体接话 + 主讲智能体回应”。
后续轮次会承接上一轮内容继续讨论。
多个自定义智能体会按轮次轮流参与。
每条讨论记录显示“第 N 轮”。
达到设定轮数后，主持人才生成最终答案。
前端显示预计模型调用次数，方便控制 Token 消耗。
后端会校验轮数范围，避免非法请求。
涉及文件：
[main.py](D:/AI-Agent学习计划/AI-Agent study/main.py)
[AgentDiscussionSettings.tsx](D:/AI-Agent学习计划/AI-Agent study/frontend/ai-agent/src/components/AgentDiscussionSettings.tsx)
[ChatInterface.tsx](D:/AI-Agent学习计划/AI-Agent study/frontend/ai-agent/src/components/ChatInterface.tsx)
[api.ts](D:/AI-Agent学习计划/AI-Agent study/frontend/ai-agent/src/lib/api.ts)
[test_multi_agent_discussion.py](D:/AI-Agent学习计划/AI-Agent study/tests/test_multi_agent_discussion.py)
验证结果：24 项后端测试全部通过，前端 ESLint、TypeScript 检查和生产构建均通过。重启后端和前端即可看到新设置。