import { useState } from 'react'
import { useAutoRepair } from './useAutoRepair'
import { CodeSandbox } from './CodeSandbox'

const DEFAULT_PROMPT =
  '做一个可以点击加一的计数器按钮，带渐变背景和动画效果'

function statusText(
  status: ReturnType<typeof useAutoRepair>['status'],
  retryCount: number
): string {
  switch (status.state) {
    case 'idle':
      return ''
    case 'generating':
      return `生成中...（${status.charCount} 字符）`
    case 'repairing':
      return `⚠️ 检测到报错，自动修复中...（第 ${status.attempt} 次）`
    case 'done':
      return retryCount > 0
        ? `✅ 生成完成（经过 ${retryCount} 次自动修复）`
        : '✅ 生成完成'
    case 'error':
      return `❌ ${status.message}`
  }
}

export default function App() {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const { code, status, retryCount, generate } = useAutoRepair()

  const isBusy = status.state === 'generating' || status.state === 'repairing'

  return (
    <div className="app-layout">
      <aside className="panel">
        <h3 className="panel-title">🧪 Code 沙盒（Day 50 · 自修复版）</h3>

        <textarea
          className="prompt-input"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="描述你想要的网页效果..."
        />

        <button
          className="generate-btn"
          disabled={isBusy}
          onClick={() => generate(prompt)}
        >
          {isBusy ? '处理中...' : '生成并预览'}
        </button>

        <p className="status-text">{statusText(status, retryCount)}</p>
      </aside>

      <main className="sandbox-wrap">
        <div className="sandbox-header">
          实时预览沙盒（报错会自动触发修复，最多重试 3 次）
        </div>
        <div className="sandbox-body">
          <CodeSandbox code={code} />
        </div>
      </main>
    </div>
  )
}
