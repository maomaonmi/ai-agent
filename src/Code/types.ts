// 和后端 app.py 里 stream_llm_response() 推送的 JSON 结构一一对应
export interface CodeUpdateMessage {
  type: 'code_update'
  code: string
  done: boolean
}

// iframe 内注入的监听脚本，通过 postMessage 上报错误时的消息格式
export interface SandboxErrorMessage {
  type: 'sandbox-error'
  message: string
  stack?: string
  lineno?: number
}

export type GenerationStatus =
  | { state: 'idle' }
  | { state: 'generating'; charCount: number }
  | { state: 'done' }
  | { state: 'repairing'; attempt: number }
  | { state: 'error'; message: string }
