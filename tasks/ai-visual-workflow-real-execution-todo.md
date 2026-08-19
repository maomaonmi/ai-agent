# AI 可视化工作流真实执行 Todo

## Contract

- [x] `media.asset` 加入后端/前端端口类型与兼容校验。
- [x] `image_generate` 支持多张 `references`；`reference_to_video` 支持 image/video 混合参考。
- [ ] node definitions 提供可渲染的模型、输入和工具参数 schema。

## Runtime

- [x] repository node runs / artifacts / events。
- [x] `VisualWorkflowExecutor` 与真实视频 provider、图片 provider 适配。
- [x] 视觉转提示词节点接入 Qwen3.7 Flash / GLM-5V Turbo OpenAI-compatible 接口。
- [x] 智谱 `vidu2-reference` 使用 `image_url` 多参考图契约。
- [x] execute API、run status、node status、SSE、取消。
- [x] fake provider 测试和真实配置缺失错误测试。

## Frontend

- [x] Weavy 风格图标栏与搜索/分类目录。
- [x] 输入与模型 Inspector 表单。
- [x] 图片输入节点支持本地多图上传与节点内缩略图预览。
- [x] 提示词节点支持节点内直接编辑，图片/视频生成节点支持节点内模型选择。
- [x] 支持 Delete/Backspace 和 Inspector 删除按钮，删除时自动清理关联连线。
- [x] 执行进度、失败/取消。
- [ ] 失败节点重试。
- [x] 节点成功后的图片/视频媒体预览。

## Verification

- [x] 后端 visual workflow/video tests。
- [x] 前端 `tsc` 与目标 ESLint。
- [ ] `/visual-workflow` 路由与 execute API 运行检查。
