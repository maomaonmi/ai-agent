import { useCallback, useEffect, useRef, useState } from 'react'
import { streamCode } from './streamCode'
import { injectErrorCatcher } from './injectErrorCatcher'
import type { GenerationStatus, SandboxErrorMessage } from './types'

const MAX_RETRIES = 3

/**
 * 这个 Hook 是整个自修复循环的调度中心，对外只暴露：
 *   code       -> 已经注入了监听脚本、可以直接传给 iframe.srcdoc 的最终代码
 *   status     -> 当前状态（生成中 / 修复中 / 完成 / 出错）
 *   retryCount -> 已经自动修复了几次
 *   generate   -> 触发一次新的生成
 *
 * 内部流程完全对应之前那张流程图：
 *   generate() -> /api/generate 流式返回代码
 *              -> 注入监听脚本后写入 iframe
 *              -> iframe 报错 -> postMessage -> 这里的 message 监听器捕获到
 *              -> 没超过重试上限 -> 调 /api/fix -> 拿到修复后的代码 -> 重新注入渲染
 *              -> 超过上限 -> 停止，把状态置为 error，交还给用户
 */
export function useAutoRepair() {
  const [displayCode, setDisplayCode] = useState('') // 注入监听脚本后的版本，给 iframe 用
  const [status, setStatus] = useState<GenerationStatus>({ state: 'idle' })
  const [retryCount, setRetryCount] = useState(0)

  const abortRef = useRef<AbortController | null>(null)
  // 用 ref 保存最新代码：message 事件回调是在很久之后才触发的闭包，
  // 如果不用 ref 而直接用 state，闭包里拿到的会是过期的旧值
  const rawCodeRef = useRef('')
  const retryCountRef = useRef(0)

  /** 真正发起一次 SSE 请求的底层函数，generate 和 fix 都基于它 */
  const runStream = useCallback(
    async (endpoint: string, body: Record<string, unknown>) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      try {
        await streamCode(
          endpoint,
          body,
          (msg) => {
            rawCodeRef.current = msg.code
            setDisplayCode(injectErrorCatcher(msg.code))
            setStatus(
              msg.done
                ? { state: 'done' }
                : { state: 'generating', charCount: msg.code.length }
            )
          },
          controller.signal
        )
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setStatus({ state: 'error', message: (err as Error).message })
      }
    },
    []
  )

  /** 用户点按钮触发：从零生成 */
  const generate = useCallback(
    (prompt: string) => {
      if (!prompt.trim()) return
      retryCountRef.current = 0
      setRetryCount(0)
      runStream('/api/generate', { prompt })
    },
    [runStream]
  )

  /** 内部触发：拿着报错信息去修复，不需要用户手动点 */
  const runFix = useCallback(
    (code: string, error: string) => {
      setStatus({ state: 'repairing', attempt: retryCountRef.current })
      runStream('/api/fix', { code, error })
    },
    [runStream]
  )

  // 监听 iframe 通过 postMessage 上报的错误
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const data = event.data as SandboxErrorMessage
      if (!data || data.type !== 'sandbox-error') return

      if (retryCountRef.current >= MAX_RETRIES) {
        setStatus({
          state: 'error',
          message: `自动修复已达上限（${MAX_RETRIES} 次），请手动检查代码`,
        })
        return
      }

      retryCountRef.current += 1
      setRetryCount(retryCountRef.current)
      runFix(rawCodeRef.current, data.message)
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [runFix])

  return { code: displayCode, status, retryCount, generate }
}
