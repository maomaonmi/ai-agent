import { useCallback, useRef, useState } from 'react'
import type { CodeUpdateMessage, GenerationStatus } from './types'

/**
 * 封装"调用后端 /api/generate -> 流式解析 SSE -> 返回最新代码"的全部逻辑。
 *
 * 用法：
 *   const { code, status, generate } = useCodeGeneration()
 *   generate("做一个计数器按钮")
 *   // code 会随着生成过程持续更新，组件里直接绑定到 iframe.srcdoc 即可
 */
export function useCodeGeneration() {
  const [code, setCode] = useState<string>('')
  const [status, setStatus] = useState<GenerationStatus>({ state: 'idle' })
  const abortRef = useRef<AbortController | null>(null)

  const generate = useCallback(async (prompt: string) => {
    if (!prompt.trim()) return

    // 如果上一次生成还没结束，先取消它
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setStatus({ state: 'generating', charCount: 0 })
    setCode('')

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
        signal: controller.signal,
      })

      if (!response.body) throw new Error('响应体为空，检查后端是否正常启动')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // SSE 消息以 \n\n 分隔，最后一段可能不完整，留到下一轮拼接
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''

        for (const part of parts) {
          if (!part.startsWith('data: ')) continue

          const msg: CodeUpdateMessage = JSON.parse(part.slice(6))

          setCode(msg.code)
          setStatus(
            msg.done
              ? { state: 'done' }
              : { state: 'generating', charCount: msg.code.length }
          )
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setStatus({ state: 'error', message: (err as Error).message })
    }
  }, [])

  return { code, status, generate }
}
