# TSX 前端运行方式

后端不变，还是用之前的 `app.py`（FastAPI）：

```bash
cd ../  # 回到 day49-code-sandbox 根目录
uvicorn app:app --reload --port 8000
```

前端另开一个终端：

```bash
cd frontend-tsx
npm install
npm run dev
```

浏览器打开 Vite 提示的地址（默认 `http://localhost:5173`）。

`vite.config.ts` 里配置了代理，前端请求 `/api/generate` 会自动转发到
`http://localhost:8000`，不需要额外处理跨域。

---

## 目录结构和职责划分

```
src/
  types.ts                  只放前后端的数据契约（SSE 消息格式）
  hooks/useCodeGeneration.ts  所有 SSE 请求、解析、状态管理逻辑
  components/CodeSandbox.tsx  iframe 渲染，纯展示，不含业务逻辑
  App.tsx                    组合以上几块，负责 UI 布局
```

这个拆分是有意为之：**逻辑写死版**（第49天上一版）优点是简单直接，能一眼看完；
但项目变大后，把 SSE 逻辑抽成 `useCodeGeneration` 这个自定义 Hook，
`App.tsx` 就只剩下"要展示什么"，不用关心"怎么请求数据"——
后面做自修复循环（第50天）时，改动只发生在 Hook 内部，UI 组件完全不用动。
