<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## 页面视觉约定

- 按参考图片实现页面或功能时，参考图用于还原布局、交互和组件细节；颜色主题必须始终跟随项目全局主题配置（例如全局浅色主题），不得直接照搬参考图的深色/浅色背景。
- 全局主题切换逻辑位于 `src/components/SettingsDialog.tsx`，启动时主题恢复位于 `src/app/layout.tsx`，基础颜色变量位于 `src/app/globals.css`；实现页面前先检查这些文件和 `html.dark` 状态。
