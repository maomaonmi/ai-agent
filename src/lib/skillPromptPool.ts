/**
 * Skill 创建提示词池（计划书 §3.1 D4）
 * Why: "Create with agent" 按钮点击后从池中随机抽一条预填输入框（不自动发送），
 *   引导用户与 AI 交互式完成 Skill 定义。
 */

const PROMPTS: readonly string[] = [
  `我想创建一个新 Skill。请通过提问帮我明确以下四点，最后输出标准格式：
1. 这个 Skill 解决什么场景？
2. 触发条件是什么（用户说什么话时自动挂载）？
3. 标准步骤有哪些（按序编号）？
4. 校验规则有哪些（产物必须满足什么约束）？

最终请输出：
- name: /skill-name
- description: 一句话简述
- instructions: 逐行步骤

我会把它加入我的 Skill 库。`,

  `帮我写一个 Skill。请先问我三个问题：
① 目标用户是谁、在什么情境下会用这个 Skill？
② 期望的输出形态是什么（代码 / 文档 / HTML / 配置）？
③ 有哪些必须遵守的规范或约束？

然后根据我的回答，生成 name / description / instructions 三段式内容。`,

  `我需要一个新 Skill 来规范化某类重复任务。请采访我：
1. 这类任务的典型输入是什么？
2. 理想的执行流程应该分几步？
3. 每一步的关键决策点在哪里？
4. 最终交付物长什么样、怎么验证是否合格？

采访完后输出 Skill 三字段，我会直接录入。`,

  `请帮我设计一个 Skill。我们先聊：
- 这个 Skill 要替代我当前怎么做事情？
- 有哪些常见错误或遗漏你想帮我避免？
- 触发词大概是什么？

聊清楚后给我 name / description / instructions 三段。`,

  `我想沉淀一个 Skill。请逐个问我：
① 你想把这个 Skill 命名为什么？
② 什么场景下应该自动触发它？
③ 执行时有几个固定步骤、几个可选步骤？
④ 如何判断执行结果是正确的？

回答完毕后请整理成标准 Skill 格式。`,

  `我准备创建一个新 Skill，但还没想清楚细节。请引导我：
1. 先描述你想解决的问题，我来帮你提炼触发条件
2. 然后一起拆解标准步骤
3. 最后定义校验规则

一步步来，每步等我回答后再进入下一步。完成后输出 name / description / instructions。`,
] as const;

export function randomSkillPrompt(): string {
  const idx = Math.floor(Math.random() * PROMPTS.length);
  return PROMPTS[idx]!;
}
