# Spec: Code 模式三角色运维闭环

## Objective

让 Code 模式不再以“没有 error/warn”为完成标准，而是以用户需求对应的可观察行为通过测试为完成标准。系统包含主 Agent、运维修复 Agent、测试 Agent；测试在生成或修改后强制执行，失败时由运维修复 Agent 基于项目、控制台、DOM 和测试证据生成最小补丁，再重新测试。

## Tech Stack

- 后端：Python 3、FastAPI、OpenAI-compatible Chat Completions
- 前端：Next.js 15、React 18、TypeScript
- 浏览器验收：Python Playwright + pytest 风格断言
- 沙盒：受限 iframe、VFS、内置 Mock REST API

## Commands

- 后端测试：`python -m unittest discover -s tests -p "test_code_sandbox.py"`
- Python 编译：`python -m py_compile App.py`
- 前端检查：`npm run lint`
- 前端构建：`npm run build`
- 安装浏览器：`python -m playwright install chromium`

## Project Structure

- `App.py`：三角色提示词、API 合同、测试计划编译与执行
- `frontend/ai-agent/src/lib/api.ts`：验收/诊断事件合同
- `frontend/ai-agent/src/hooks/useCodeAutoRepair.ts`：主 Agent 状态机
- `frontend/ai-agent/src/components/CodeWorkspace.tsx`：测试与修复报告展示
- `tests/test_code_sandbox.py`：合同、安全边界与回归测试

## Testing Strategy

- 模型只输出结构化验收计划，不直接输出可执行 Python。
- 后端验证动作和断言白名单，再编译成固定 Python Playwright 脚本。
- 脚本在临时目录、超时和隔离浏览器上下文中运行。
- 测试至少覆盖用户请求对应的一个可观察结果，不能只断言控制台日志。
- 测试失败必须返回断言、控制台、页面文本和截图路径等证据。

## Boundaries

- Always：测试必经；模型输出先校验；补丁必须精确；保留人工终止。
- Ask first：扩大到宿主机文件、外部网络或新增持久化服务。
- Never：直接执行模型任意 Python/命令；读取密钥；修改项目外文件；把内部思维链展示给用户。

## Success Criteria

- 生成和修改完成后自动运行测试 Agent。
- 功能断言失败时自动调用运维修复 Agent，而不是等待 error/warn。
- 修复后自动重新测试，直到通过、用户终止或出现真实阻塞。
- UI 展示验收条件、测试脚本、失败证据、修复摘要和最终状态。
- 主 Agent、运维 Agent、测试 Agent 均有明确 token 上限。

## Non-goals

- 不允许模型任意执行 Python。
- 不开放宿主机全盘读写。
- 不把“控制台无错误”当作唯一验收标准。
