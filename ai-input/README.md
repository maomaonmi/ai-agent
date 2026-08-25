# AI 多模式输入框

一个用 React + TypeScript 复刻的多模式 AI 输入框 UI，对应截图中的五种模式：

1. **对话**（默认）— 底部固定输入栏，带 8 个模式切换按钮和语音输入
2. **PPT 生成** — 中央输入框带 `PPT创作` 标签 + 模板网格
3. **视频生成** — 中央输入框含参考上传区 + 设置弹窗（清晰度/比例/时长/配音）
4. **图像生成** — 中央输入框带 `AI生图` 标签 + 图片画廊
5. **深入研究** — 中央输入框上方有 6 个示例问题 chip + 三个特性卡片

## 启动

```bash
cd ai-input-box
npm install
npm run dev
```

打开 http://localhost:5173 即可。

## 项目结构

```
src/
├── main.tsx                 # 入口
├── App.tsx                  # 根组件（模式状态管理）
├── App.css                  # 全局布局
├── index.css                # 变量 + reset
├── types.ts                 # 共享类型
└── components/
    ├── Icons.tsx            # 内联 SVG 图标
    ├── InputBar.tsx         # 输入栏（支持对话 / 模式两种布局）
    ├── InputBar.css         # 输入栏样式
    ├── views.css            # 视图通用样式
    └── views/
        ├── PPTView.tsx
        ├── VideoView.tsx
        ├── ImageView.tsx
        └── ResearchView.tsx
```

## 实现要点

- **状态管理**：`App` 持有 `mode` 状态，4 个模式视图（PPT/视频/图像/研究）各自渲染自己的输入栏
- **输入栏复用**：`<InputBar mode="chat" | "ppt" | ... />` 通过 `mode` 决定渲染聊天版底栏（多模式按钮）还是模式版底栏（tag + options + 右侧按钮）
- **退出模式**：每个模式视图的 tag 都有 `×`，点击调用 `onBack` 回到对话模式
- **TypeScript 严格模式**：所有 props 都用 discriminated union 标注
- **零依赖**：仅 React + ReactDOM，没有引入 UI 库
