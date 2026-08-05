import type { CodeUpdateMessage } from './types'

/**
 * 通用的"调用后端 SSE 接口 -> 解析消息 -> 逐条回调"逻辑。
 * /api/generate 和 /api/fix 返回的数据格式完全一致，所以可以共用这一个函数，
 * 区别只在于调用时传入的 endpoint 和 body 不同。
 */
export async function streamCode(
  endpoint: string,
  body: Record<string, unknown>,
  onChunk: (msg: CodeUpdateMessage) => void,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.body) {
    throw new Error('响应体为空，检查后端是否正常启动')
  }

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
      onChunk(JSON.parse(part.slice(6)))
    }
  }
}
