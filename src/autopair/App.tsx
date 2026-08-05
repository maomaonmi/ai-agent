import { useState } from 'react'
import { useAutoRepair } from './useAutoRepair'
import { CodeSandbox } from '../Code/CodeSandbox'

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
    case 'modifying':
      return '✏️ 正在应用修改指令...'
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
  const { code, status, retryCount, history, generate, modify } = useAutoRepair()
  const [instruction, setInstruction] = useState('')

  const isBusy =
    status.state === 'generating' ||
    status.state === 'repairing' ||
    status.state === 'modifying'

  const hasCode = code.length > 0

  function handleModify() {
    if (!instruction.trim()) return
    modify(instruction)
    setInstruction('') // 提交后清空输入框，下一条指令重新开始输入
  }

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

        {hasCode && (
          <>
            <hr style={{ borderColor: '#333', width: '100%' }} />
            <p className="panel-title" style={{ fontSize: 14, margin: 0 }}>
              💬 迭代修改
            </p>

            {history.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#999' }}>
                {history.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            )}

            <textarea
              className="prompt-input"
              style={{ height: 60 }}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="例如：把按钮颜色改成红色"
            />
            <button className="generate-btn" disabled={isBusy} onClick={handleModify}>
              应用修改
            </button>
          </>
        )}
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
