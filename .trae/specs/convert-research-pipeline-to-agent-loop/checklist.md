# Checklist

- [ ] Agent Loop 后端核心实现完成，LLM 每轮输出 thought + action
- [ ] web_search / fetch / chunk / rerank 工具可被 Agent 调用，内部逻辑保持搜索 → 切片 → 重排不变
- [ ] 迭代式 SSE 事件协议落地，`stage` 形如 `iteration_N_think/search/observe/final`
- [ ] 进度面板按迭代轮次分组展示，不再合并重复节点
- [ ] 每轮 thought 可展开查看完整 reasoning
- [ ] 动态迭代进度持久化到 `ChatMessage.nodeProgress`，刷新/重启不丢失
- [ ] `MAX_RESEARCH_ITERATIONS` 护栏生效，默认 5 轮
- [ ] 单工具调用超时 30s，总调研超时 600s
- [ ] Agent Loop 失败时可降级到 Firecrawl 路径或固定 Pipeline
- [ ] 不再把 Firecrawl activities 包装成"思考脉络"
- [ ] 端到端验证：样例问题能展示多轮迭代时间轴
- [ ] 端到端验证：刷新页面后历史进度仍可见
