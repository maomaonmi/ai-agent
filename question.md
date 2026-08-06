prompt = [SystemMessage(content="""
            你是一个结构化思考助手。回答数学或逻辑问题时，格式必须严格遵循以下范例：
            【范例 - 问：(1) x + y = 10 (2) x - y = 2，求 x】
            **问题拆解**
            - 已知条件：方程①、方程②
            - 求解目标：x 的值
            - 方法：两式相加消除 y

            **执行步骤**
            1. 方程① + 方程②：2x = 12
            2. 两边除以 2：x = 6

            **验证**：代入原式 6 + 4 = 10 ✅，6 - 4 = 2 ✅
            **最终答案**：x = 6
            你必须先在 <think>...</think> 标签内写出"问题拆解 → 执行步骤 → 验证"的完整推理过程，然后再用 Markdown 结构化输出"最终答案"。
            不要在最终回答里重复描述"我的思考过程是..."这类废话，直接给出格式化的分析即可。
            ---""")]

# 【核心逻辑】结构化提示词
# 这种提示词的价值在于它定义了一个“模具”，AI 必须填入内容
STRUCTURED_PROMPT = """你是一个专业的全球行业分析师。
你的任务是根据用户提供的行业/公司，进行深度情报分析。

### 必须遵守的输出格式规范：
1. **思考过程**：请在 <think> 标签内进行逻辑拆解。
2. **正式报告**：请在 <report> 标签内书写。必须包含：
   - ## 行业概览（一段话简介）
   - **核心指标对比**（必须使用下方的标准 Markdown 表格格式，禁止省略任何一行）：

     ```
     | 指标名称 | 当前数值 | 趋势判断 |
     |---------|---------|---------|
     | 示例：年营收 | 示例：¥120亿 | 示例：↑ 同比增长 25% |
     | （实际填写） | （实际填写） | （实际填写） |
     ```

   - > [!IMPORTANT] 核心风险提示（分点列出 3-5 条）
3. **元数据摘要**：请在 <metadata> 标签内**只输出一个合法的 JSON 对象**，禁止写任何解释文字、禁止换行、禁止使用 Markdown 代码块包裹，直接写 `{"key": "value"}` 格式。包含：
   - "industry_name": 行业名称
   - "risk_level": 1-10 的数字
   - "tags": 关键词列表
"""

当你写 f"Schema: { 'key': 'value' }" 时，Python 解释器会尝试去寻找名为 'key': 'value' 的变量，结果导致发给 AI 的 Prompt 变成了一堆乱码或空值。这就是为什么 AI 之前一直在“盲猜”字段名。
为了彻底解决此问题，我们将 JSON Schema 的定义从 f-string 中剥离，存入独立的字符串变量 SCHEMA_TEMPLATE。在构建提示词时，通过变量引用的方式注入，完美避开大括号转义问题。同时，升级了 Analyst 节点的指令逻辑：只要发生错误，不仅反馈错误内容，还重新下发一遍标准 Schema 模板，确保 AI 的“考卷”上始终有正确答案。

问题清楚了——analyst 和 auditor 之间陷入了死循环：
analyst 生成的回复因为"搞一下那个东西"太模糊，引用和充分性都难以达标
auditor 每次都返回 correction_feedback，导致 langgraph 不断重试
没有设置上限，循环永不停止，只能 Ctrl+C 强制终止
解法：加一个循环计数，超过阈值就强制结束。
核心改动是加了 retry_count 字段：
retrieve 节点初始化 retry_count = 0
analyst 节点每次重试 retry_count + 1
should_continue 中 retry_count >= 3 时强制返回 __end__
这样即使 auditor 一直返回 feedback，最多也只会循环 3 次，不会卡死。

问题在于 query_rewriter_node 虽然生成了关键词，但根本没用上——retrieval_node 还是拿硬编码的固定文档，完全没有按关键词去检索。
要真正理解"搞一下那个东西"这个模糊表述，需要让 retrieval 节点根据 rewriter 的输出来动态决定搜什么。
根本原因是 rewriter 生成关键词在 retrieve 之后，而 retrieve 又用硬编码文档，所以关键词根本没参与检索。调换顺序：先 rewriter 再 retrieve，让 retrieve 真正用关键词筛选文档。
现在流程变成：START → rewrite → retrieve → analyst → validator，关键词真正参与检索了：
rewrite 生成关键词并附加到消息列表
retrieve 从消息中读取关键词，用 LLM 判断哪些资料与之相关
资料库从 3 条扩充到 8 条，覆盖更多场景
图顺序现在正确了：START → rewrite → retrieve → analyst → validator → analyst（循环）。
现在 rewriter 先理解"搞一下那个东西"，生成关键词 维修时间, 费用查询, 余额不足，然后 retrieve 根据这些关键词去资料库匹配相关内容，再传给 analyst 撰写报告。

优化了两个方向：
回答风格控制
要求“只答所问”，不再主动扩展时间成本、预算判断、建议下一步
对资料未提及内容统一说“未提及”，禁止推测
评分口径对齐
在审计提示词里说明：只要额外细节仍被资料支持，不必然扣分
在 run_judge_standalone 里也加了相同口径，避免 “9.5 分被评判员压回 8 分”

改了三处核心提示词：
1. analyst（回答质量）
明确要求：不遗漏资料中已有的相关信息，哪怕用户没主动问
多部分问题逐一作答，不遗漏
2. 审计节点（通过条件收紧）
强调：不接受因"信息不够完整"或"未补充额外细节"而产生的冲突判定
只判断声明是否被证据支持，不评判信息充分性
3. 评判 prompt（打分标准重构）
明确"多说了资料中没有的内容"才扣分
明确"资料中有的相关信息但没回答"也扣分
区分了扣分 vs 不扣分的边界
这样应该能解决之前第一题"只答了 500 元却被扣 2 分"的矛盾，以及第二题诚实说"未提及"却被扣分的问题。

修好了两处：
prompt 约束：明确写出 score 必须是 1 到 10 之间的整数
代码兜底：max(1, min(10, int(raw["score"]))) 把任何异常分数强制 clamp 到 1~10 范围
再跑一次就不会出现 95、100 了，平均分会在 8~10 之间。

改了两处：
prompt 细化：把"复杂逻辑判断、对比"这种模糊描述拆成了 7 种具体触发条件，LLM 判断起来更容易命中 deep
关键词兜底：即使 LLM 判断错了，只要问题里出现 还是、先、能不能、够不够、性价比 等关键词，直接强制走 deep


你这个判断是对的：你虽然增加了 RAG，但是 AI 没有真正调用到它。原因不是一个，而是几个地方叠在一起导致的。
我已经帮你改好了，核心问题如下。

第一，tech_specialist_tool 之前没有加 @tool，所以它不是 LangChain 工具。你虽然把它放进了 tools 列表，但模型不一定能按工具协议正确识别它。

第二，你的 tool_excutor 写死了永远调用 get_user_balance：
result = get_user_balance.invoke(args)
这就导致即使模型真的想调用 tech_specialist_tool，最后也还是会执行余额工具。
我已经改成按工具名动态分发：
def tool_excutor(state: State):
    """执行工具的节点 (手动版，为了让你看清原理)"""
    print("--- 🛠️  正在执行工具调用... ---")
    last_message = state["messages"][-1]
    tool_outputs = []
    for tool_call in last_message.tool_calls:
        tool_name = tool_call["name"]
        args = tool_call["args"]
        selected_tool = tool_map[tool_name]
        result = selected_tool.invoke(args)
        tool_outputs.append(
            ToolMessage(
                tool_call_id = tool_call["id"],
                content = str(result)
            )
        )
    return {"messages": tool_outputs}
配套加了这个工具映射：
# 把工具放进列表
tools = [get_user_balance, tech_specialist_tool]
tool_map = {tool.name: tool for tool in tools}

第三，你的输入是：
"我是张大炮，帮我查查余额，够不够修手机的"
这是一个复合任务：
查余额
查修手机多少钱
比较够不够
但是你的经理原规则是：
如果用户要查询余额 → BALANCE_AGENT
如果用户涉及维修 → TECH_AGENT
这会导致它只选一个方向。终端里它选了 BALANCE_AGENT，所以后续没有进入技术节点。
我现在把规则改成：如果同时包含余额和维修费用判断，交给 BALANCE_AGENT，但 BALANCE_AGENT 自己必须调用两个工具。
    规则：
    1. 如果用户要查询余额、银行卡、账户金额，回复：BALANCE_AGENT
    2. 如果用户的问题同时包含余额查询和维修费用判断，也回复：BALANCE_AGENT
    3. 如果用户的问题只涉及维修、修理、故障、技术支持，回复：TECH_AGENT
    4. 其他普通问题，回复：FINISH

第四，我给 chatbot 加了更明确的系统提示，强制它遇到“余额 + 维修费用”时调用两个工具：
def chatbot(state: State):
    """余额助手：负责处理余额查询，并在需要时查询维修手册。"""
    print("--- 🧠 AI 正在思考下一步... ---")
    agent_prompt = SystemMessage(content="""
你是一个余额与维修费用分析助手。
你可以使用两个工具：
1. get_user_balance：查询用户银行卡余额。
2. tech_specialist_tool：查询手机维修手册、维修费用、故障处理方案。
规则：
- 如果用户问余额，必须调用 get_user_balance。
- 如果用户问修手机、维修价格、够不够修、故障处理，必须调用 tech_specialist_tool。
- 如果用户的问题同时包含余额和维修费用，你需要两个工具都调用，然后综合判断余额是否足够。
- 不要凭空猜维修价格，维修相关信息必须先查维修手册。
""")

第五，你的 tech_node 之前只是普通调用 LLM，没有强制查 RAG。我也补上了：
def tech_node(state: State):
    """技术员：负责处理纯维修请求。"""
    print("🛠️  [技术员] 正在处理维修请求...")
    tech_prompt = SystemMessage(content="""
你是一个手机维修技术员。
规则：
- 只要用户询问维修、故障、修理、维修价格，就必须调用 tech_specialist_tool 查询维修手册。
- 不要凭空回答维修价格或维修方案。
""")

第六，原来 tech 节点后面直接 END，就算技术员产生了工具调用，也没有机会进入 tools 节点执行。所以我把 tech -> END 改成了条件路由：
# 技术员回复后，也要判断是否需要执行 RAG 工具
workflow.add_conditional_edges(
    "tech",
    agent_router,
    {
        "tools": "tools",
        "finish": END
    }
)
现在整体调用逻辑变成：
用户：我是张大炮，帮我查查余额，够不够修手机的
        ↓
      manager
        ↓
判断为 BALANCE_AGENT
        ↓
      agent
        ↓
同时调用 get_user_balance 和 tech_specialist_tool
        ↓
      tools
        ↓
   agent 汇总
        ↓
      END
你之前终端里的结果之所以没有 RAG，是因为模型自己猜了“修手机几十到几百甚至上千”，但没有查手册。现在系统提示里已经明确要求：
不要凭空猜维修价格，维修相关信息必须先查维修手册。

# ==========================================
# 提示词部分
# ==========================================
"""经理节点：先判断任务应该交给哪个角色处理。"""
   print("👔 [经理] 正在分配任务...")
   manager_prompt = SystemMessage(
   content="""
   你是一个任务分配经理，只负责判断用户请求应该交给谁处理。

   规则：
   1. 如果用户要查询余额、银行卡、账户金额，回复：BALANCE_AGENT
   2. 如果用户的问题同时包含余额查询和维修费用判断，也回复：BALANCE_AGENT
   3. 如果用户的问题只涉及维修、修理、故障、技术支持，回复：TECH_AGENT
   4. 如果是普通聊天（如问姓名、打招呼、说废话），请直接根据历史记录回答用户，不要带任何标签。
   5. 其他普通问题，回复：FINISH

   你只能回复上面三个标签之一，不要解释。
""")

"""余额助手：负责处理余额查询，并在需要时查询维修手册。"""
   print("--- 🧠 AI 正在思考下一步... ---")
   agent_prompt = SystemMessage(content="""
   你是一个余额与维修费用分析助手。

   你可以使用两个工具：
   1. get_user_balance：查询用户银行卡余额。
   2. tech_specialist_tool：查询手机维修手册、维修费用、故障处理方案。

   规则：
   - 如果用户问余额，必须调用 get_user_balance。
   - 如果用户问修手机、维修价格、够不够修、故障处理，必须调用 tech_specialist_tool。
   - 如果用户的问题同时包含余额和维修费用，你需要两个工具都调用，然后综合判断余额是否足够。
   - 不要凭空猜维修价格，维修相关信息必须先查维修手册。
   - 严禁编造数据！所有数字必须使用工具来返回结果。
   """)

"""技术员：负责处理纯维修请求。"""
   print("🛠️  [技术员] 正在处理维修请求...")
   tech_prompt = SystemMessage(content="""
   你是一个手机维修技术员。
   规则：
   - 只要用户询问维修、故障、修理、维修价格，就必须调用 tech_specialist_tool 查询维修手册。
   - 不要凭空回答维修价格或维修方案。
   - 如果用户没有提供手机型号，你必须询问用户，严禁擅自猜测或代入用户角色说话。
   """)


# ==========================================
# 回归测试：黄金数据集评测
# ==========================================
judge_prompt = f"""
你是一个严苛的AI质量审计员，请根据【参考资料】评估【AI回答】的质量。
评分标准：
1. 事实性 (Factuality)：回答中的每一句事实陈述是否都有资料支撑，且没有说错资料中的内容？
2. 引用 (Citations)：每句事实陈述是否标注了 [n] 来源？
3. 诚实性 (Honesty)：资料没提的内容，AI 是否明确说"未提及"？

重要扣分原则：
- 多说了资料中没有的内容，扣分
- 引用标注错误，扣分
- 资料中有的相关信息但没回答，扣分

不扣分的情形：
- 额外补充了资料支持的细节（即使用户没主动问）
- 回答简洁但完整覆盖了用户所问

【用户问题】：{query}
【参考资料】：{docs_str}
【AI回答】：{agent_answer}

请直接输出JSON格式，score 必须是 1 到 10 之间的整数：
{{
    "score": 整数分数,
    "reason": "扣分或加分理由，重点说明多说了还是少说了",
    "hallucination": "是否存在幻觉(yes/no)"
}}
"""

# ==========================================
# 语义级证据审计节点
# ==========================================
# 语义审计
    audit_prompt = f"""
   你是首席审计官。请核对以下声明是否能由其标注的证据库内容真实支撑。
   注意：只要声明被证据库内容支持，即视为通过。不接受因"信息不够完整"或"未补充额外细节"而产生的"冲突"判定。
   【待核对清单】：
   {chr(10).join(audit_tasks)}
   请判断：如果有任何一个声明与其证据不符，请回复"冲突：具体原因"。
   如果全部完全吻合，请回复 "PASS"。
   """

# ==========================================
# 带引用的分析节点
# ==========================================
def grounded_analyst_node(state: GroundedState):
   print("[Node: Analyst] 正在撰写带引用的报告...")

   context_str = "\n".join([f"资料 [{d['id']}]: {d['text']}" for d in state['retrieved_docs']])
   feedback = f"\n注意：上次回复漏掉了引用或引用错误：{state['correction_feedback']}" if state.ge('correction_feedback') else ""

   system_prompt = f"""
   你是一个严谨的客服专家。请根据以下【参考资料】回答用户问题。
   【参考资料】：
   {context_str}
   【强制要求】：
   1. 每一句包含事实的陈述都必须在末尾标注资料编号，例如：修屏幕需要500元 [1]。
   2. 精确回答用户所问：用户问什么就答什么，不要遗漏资料中已有的相关信息（即使用户没有主动问，若该信息与答案直接相关则必须包含）。
   3. 若资料中缺少用户询问的某些信息，直接回复"资料中未提及该信息"。
   4. 对于多部分问题，逐一作答，不要遗漏任一部分。
   5. 禁止添加资料外的任何推测、建议或下一步行动。
   6. 文末必须列出【参考来源】列表。
   {feedback}
   """

# ==========================================
# 查询重写节点
# ==========================================
def query_rewriter_node(state: GroundedState):
   print("\n[Node: Rewriter] 正在将用户意图转化为多路搜索词...")
   user_msg = state["messages"][0].content

   prompt = f"""
   请针对用户的问题，生成3个用于检索维修手册的短关键词。
   用户问题：{user_msg}
   直接输出关键词，用逗号分隔。
   """

# ==========================================
# 检索节点 (为每条资料打上 ID)
# ==========================================
def retrieval_node(state: GroundedState):
   print("[Node: Retrieval] 正在根据搜索词拉取资料...")
   all_docs = [
      {"id": 1, "text": "黑科技手机X屏幕维修费500元，需2小时。"},
      {"id": 2, "text": "电池质保2年，非人为损坏免费更换。"},
      {"id": 3, "text": "主板维修需返厂，周期为15个工作日。"},
      {"id": 4, "text": "摄像头故障需更换，费用180元。"},
      {"id": 5, "text": "听筒无声可能是软件问题，重启无效后返厂检测。"},
      {"id": 6, "text": "内存升级128G，费用300元。"},
      {"id": 7, "text": "外壳划痕抛光服务50元。"},
      {"id": 8, "text": "进水维修需拆机清理，费用200元起。"}
   ]

   keywords = []
   for msg in state["messages"]:
        if msg.content.startswith("扩展搜索词"):
            raw = msg.content.replace("扩展搜索词：", "")
            keywords = [k.strip() for k in raw.split("，") if k.strip()]
            break

   if not keywords:
        print("  (未识别到关键词，返回全部资料)")
        numbered_docs = [{"id": i+1, "text": d["text"]} for i, d in enumerate(all_docs)]
        return {"retrieved_docs": numbered_docs, "retry_count": 0}

   print(f"  搜索关键词: {keywords}")
   check_prompt = f"""以下是资料库候选条目（仅含text字段）:
   {chr(10).join([f"[{d['id']}] {d['text']}" for d in all_docs])}

   用户想了解: {state['messages'][0].content}
   扩展关键词: {keywords}
   请列出所有相关条目的id，用逗号分隔。"""



1. 核心代码改动

目标 文件 改动 语法高亮 + 行级 diff（零依赖） syntaxHighlight.ts highlight + diffLines + highlightDiff ，支持 HTML/CSS/JS/JSON/Python，diff 用 O(N*M) LCS-DP，超 9M cell 降级（3000 行 × 3000 行）。 源码视图重写（行号、高亮、增绿删红条、主题联动、编辑开关） CodeWorkspace.tsx L43-L49 、 L151-L165 、 L244-L267 、 L340-L369 、 L1288-L1300 、 L1331-L1501 SourceCodeViewer 子组件：双模式（ highlight / raw ），行号栏 sticky 左对齐，每条 diff 在左侧 4px gutter 涂红/绿 + 背景色 + 行首 + / − 符号。 主题变更立即同步 SettingsDialog.tsx L31-L39 applyAppearance 额外派发 CustomEvent('appearance-settings-changed') ，CodeWorkspace 用 MutationObserver + storage + customEvent 三路监听刷新 isDarkTheme 。

需求覆盖

- ✅ 背景色同步设置 ：代码面板的 bg / 边框 / textarea 背景完全跟随 isDarkTheme （深色 slate-950 ，浅色 slate-50 ）。
- ✅ 语法高亮，不同语言不同色 ：深色主题下 keyword 紫红、string 翠绿、tag 玫红、attr 天蓝、property 青色、function 黄；浅色主题对应 700 深色调。 detectLanguage 按扩展名路由。
- ✅ 修改→面板体现（绿增红删） ：每轮 status.state === 'done' 把 vfs 快照写进 previousFileSnapshotsRef ，下次文件内容变化时 diffLines(prev, curr) 计算增删行；首次生成没有 prev 时不染色。头部还有 +N / -M 计数徽章。
- ✅ 行数显示 ：每行都有 1-based 行号，位数自适应（三位数/四位数文件自动撑宽），行号栏 sticky 横向滚动时仍可见。
2. 关键点解析

- Why 零依赖 ：node_modules 本来就大（未安装 shiki / prism / diff），自托管 ~600 行够用且首次冷启动更快； tokenizeRegex 用贪心最早-最长匹配，避免重复切词。
- Why 行级 diff 而不是字符级 ：代码修改“加了哪些行、删了哪些行”是工程师最关心的维度，字符级 inline diff 在 10k 字符文件上计算开销显著。
- Why 首次生成不染色 ：如果没有 prev 版本就把所有行都涂绿，反而是噪音；用户只关心“相对于上一次改动了什么”。
- 手动编辑回存 → 也更新基线 ： saveManualEdit() 更新 previousFileSnapshotsRef[activeFile] ，避免下一轮模型修改把用户手写的内容也误判成插入。
3. 潜在风险 / 维护建议

- 高亮器是“视觉级简化版”，遇到 Python 装饰器+泛型、HTML 中 <?php ?> 脚本块等边界会降级为 plain；若后续需要行业级保真，替换 syntaxHighlight.ts 内部实现为 shiki（保留现有 export 签名）即可，UI 组件无需改。
- diff 的 LCS-DP 在 3k×3k 触发降级；单文件若超过 3k 行建议接入 myers-diff（O(ND)）。

## 1. 核心变更速览
(1) 超时/位置/Agent 对话可见

- terminal_service.py#L142 超时常量已设 PROPOSITION_TIMEOUT_SECONDS = 90 ，前后端统一。
- 提案横幅在 IntegratedTerminal.tsx 中紧贴 Terminal Tab 条正上方；CodeWorkspace 外层又把 Console/Terminal 两个 Tab 置于同一可伸缩面板顶栏 ( CodeWorkspace.tsx )，上下"紧靠着"。
- Agent 对话里同步写"正在等待用户选择"： onPropositionUpdate → ChatInterface 抛 code-agent-run-append-step CustomEvent → useCodeAutoRepair.ts 监听到后把 step 追加到该 run 的 trace.steps （带 dedupe_key 去重）。
(2) 白名单（信任同类命令 + 命中自动批准）

- 每次提案横幅都有 checkbox 本次会话信任此类命令 ： IntegratedTerminal.tsx 。
- 勾选"执行"时，提取命令的前 2 token（空格分隔）作为前缀，写入 addTrustedTerminalPrefix(runId, prefix) ： IntegratedTerminal.tsx 。
- 下一次同 run 提案进来， trustedPrefixesByRun[run_id] 命中则前端自动 approve + 不再弹横幅： IntegratedTerminal.tsx 。
- 后端 propose_command 本身也走了 trusted_prefixes 短路批准（终端服务层已实现，保持一致）。
(3) 后端引擎选型落地

- 沿用已实现的 pywinpty (ConPTY) → Windows 原生伪终端，每条命令跑在真实 PowerShell 7+ 里（ANSI 颜色、PSReadLine 补全、 npm/yarn 交互式提示全部兼容）。
- 进程池按 (workspace_id, run_id) 隔离，避免多 agent 共享环境变量/工作目录冲突： PtyTerminalPool._terminals: dict[tuple[str,str], PtyTerminal] 。
- 新增手动关闭接口： POST /api/terminal/close/{workspace_id}/{run_id} 与兼容路径 POST /api/terminal/close/{run_id} ： main.py 。
## 2. 关键链路
- 生成/修改/修复的 API 调用都新增了可选 meta = { workspace_id, run_id } （ api.ts ），对应 useCodeAutoRepair 在调用前从 currentAgentRunIdRef.current 取出 runId 透传。
- workspace_id 前端每个浏览器 tab 一个（localStorage 持久化），避免用户开两个窗口时 run_id 冲突。
- WebSocket URL 构造： ws://<host>/ws/terminal/<workspace_id>/<run_id> ，已过 encodeURIComponent 编码。
## 3. 校验结果
- npx tsc --noEmit ：0 错误。
- python -c AST parse + import 检查： main.py / terminal_service.py / App.py 全部通过， TERMINAL_POOL 正常， PROPOSITION_TIMEOUT_SECONDS = 90 生效。
- VSCode Diagnostics：空数组。
## 4. 潜在风险与建议
1. 信任前缀粒度 ：当前按"前 2 token"命中（如 npm install ），如果用户命令是 npm run rmall 也会命中 npm run 。建议生产环境下把"信任"改成按 (cmd[:1] + args[:1]) 二元组精确匹配，并在 Toast 里提示"已自动批准 [prefix]"，避免越权。
2. 后端 _terminals 直接遍历 ： close_terminal_legacy 直接访问了 TERMINAL_POOL._terminals （私有字段），后续应补一个 PtyTerminalPool.close_by_run_id(run_id) 公共方法，减少耦合。
3. run_id 与 agent 运行次数绑定 ：目前 beginAgentTrace 每次生成都会 +1 并新建独立终端；长时间 session 终端进程会累积。建议在 agent run 完成且命令退出 5 分钟后自动 close ，或在用户点"Reset"时一起回收。
单元测试思路（给你留的接口级思路）：

- 前端 ：mock WebSocket，依次发 {type:'proposition', command:'npm install lodash'} → 用户勾选"信任" approve → 再发同 prefix 的 proposition → 断言 auto-approve 被调用且横幅未再渲染。
- 后端 ：用 monkeypatch 跳过真实 ConPTY spawn，调用 propose_command 两次（第二次 trusted_prefixes 包含前缀），断言第二次直接返回 approved 而非等待审批。