# AI PPT 工作台视觉 QA

source visual truth: `C:/Users/xys/AppData/Local/Temp/codex-clipboard-62ca529d-fc5c-4a8d-9230-4eda1f7bd8ed.png`（对话 + 编辑器参考）与 `C:/Users/xys/AppData/Local/Temp/codex-clipboard-e3e60254-c91f-4c63-aaff-7e0a16a256a8.png`（工作流参考）。

implementation screenshot: `frontend/ai-agent/design-qa-chat-final.png`（应用内浏览器，1280×720，device scale 1）。

state: `/ppt/workspace/new?source=sidebar&session=chat-layout-2`；空白新工作台，发送“做一份关于团队协作的 8 页 PPT”后，工作流运行中。

comparison evidence:

- Full view：左侧为正常 AI 对话、可折叠工作流卡片和输入框；右侧为缩略图、工具栏、16:9 画布和备注区，保持参考图的左右层级。
- Focused regions：左侧链路卡片可展开/收起每个阶段；右侧新增幻灯片、插入图表和文本编辑控件已在真实浏览器交互中验证。
- Typography：沿用项目 system/PingFang fallback，标题与阶段标题使用明确的 semibold 层级，小字使用高对比 slate 色。
- Spacing/layout：对话区、拖拽分隔线、缩略图轨和画布区均使用稳定边界；左栏宽度可在 320–620px 之间拖动。
- Colors/tokens：使用白色工作区、浅灰画布、violet 主行动色和 emerald 自动保存状态，匹配参考图的安静编辑器语言。
- Imagery：使用项目内生成的真实 PNG 视觉资产；素材卡保留“网页图片 / AI 生成图片”来源标记。
- Copy/content：首次进入显示“等待你的指令”，发送后才显示用户/助手消息和运行态，避免进入即自动执行。

comparison history:

1. 旧版问题：侧边栏进入后沿用 `aurora-strategy` 种子，视觉上像打开历史模板。修复：`source=sidebar` 使用唯一 session 参数和 blank seed，标题改为“新建 AI PPT”。
2. 旧版问题：进入页面立即启动工作流。修复：`running` 初始为 false，只有发送输入或点击开始后启动。
3. 旧版问题：左侧只有固定时间线。修复：改为对话消息 + 总链路折叠卡 + 阶段级折叠，并加入可拖拽宽度分隔线。
4. 旧版问题：工作台直接引入 PptxGenJS 导致浏览器 `node:fs`/`node:https` 编译错误。修复：导出移至 `/api/ppt/export` Node 路由；新页面控制台已验证零错误、零警告。

primary interactions tested: 侧边栏 AI PPT → 新空白工作台；输入并发送需求；展开/收起 AI 工作流链路与阶段；插入图表；新建幻灯片；模板市场“使用此模板”进入模板工作台；服务端导出接口返回 200 有效 PPTX。

final result: passed
