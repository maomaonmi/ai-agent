# Pre-code Review 修正确认 ask-questions 模板

Step 7.2 调用 ask-questions 时按本模板填充：

```
header: "Pre-code Review 修正确认"
question: "本次 GitNexus 校准发现 N 项偏差（黄色 X / 红色 Y），是否应用以下修正草案？"
options:
  - label: "全部应用"
    description: "按上方列出的草案逐条写入 design.md/tasks.md"
    recommended: <仅黄色时为 true，红色时不推荐默认>
  - label: "仅应用红色项"
    description: "只写入模块归属/影响范围相关的红色项"
  - label: "我来逐条勾选"
    description: "我会指明应用哪些条目"
  - label: "全部不应用"
    description: "仅保留报告，artifact 由我手动处理"
allowFreeformInput: true
```

每条修正草案展示格式：

```
<目标文件>:<段落/行号> | <动作 add/modify/delete> | <证据> | <修改文本>
```
