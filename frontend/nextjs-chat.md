/**
 * Next.js 前端 - LangGraph Agent 聊天界面
 * 
 * 文件结构:
 * - package.json      → 依赖配置
 * - tailwind.config.js → Tailwind 配置
 * - src/app/page.tsx  → 主页面
 * - src/components/ChatInterface.tsx → 聊天组件
 * - src/lib/api.ts    → API 调用
 */

# ==========================================
# 1. package.json
# ==========================================

{
  "name": "langgraph-chat-frontend",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "14.1.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "autoprefixer": "^10.4.17",
    "postcss": "^8.4.35",
    "tailwindcss": "^3.4.1",
    "typescript": "^5"
  }
}


# ==========================================
# 2. tailwind.config.js
# ==========================================

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}


# ==========================================
# 3. postcss.config.js
# ==========================================

module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}


# ==========================================
# 4. src/app/globals.css
# ==========================================

@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --background: #ffffff;
  --foreground: #171717;
}

body {
  color: var(--foreground);
  background: var(--background);
}


# ==========================================
# 5. src/lib/api.ts (API 调用和 SSE 处理)
# ==========================================

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface NodeEvent {
  node_name: string;
  status: 'processing' | 'completed';
  output?: Record<string, unknown>;
}

export interface ReasoningEvent {
  reasoning: string;
  index: number;
}

export interface DoneEvent {
  answer: string;
  reasoning_steps: number;
  mode: string;
}

export interface ErrorEvent {
  message: string;
}

type SSEEventHandler = {
  onNode?: (event: NodeEvent) => void;
  onReasoning?: (event: ReasoningEvent) => void;
  onDone?: (event: DoneEvent) => void;
  onError?: (event: ErrorEvent) => void;
};

export async function sendChatMessage(
  message: string,
  mode: 'standard' | 'deep',
  handlers: SSEEventHandler
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, mode }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('event:')) {
        const eventType = line.slice(6).trim();
        continue;
      }
      if (line.startsWith('data:')) {
        const data = line.slice(5).trim();
        if (!data) continue;

        try {
          const parsed = JSON.parse(data);

          // 根据 data 中的 event_type 字段判断事件类型
          if (parsed.node_name) {
            handlers.onNode?.({
              node_name: parsed.node_name,
              status: parsed.status,
              output: parsed.output,
            });
          } else if (parsed.reasoning !== undefined) {
            handlers.onReasoning?.({
              reasoning: parsed.reasoning,
              index: parsed.index,
            });
          } else if (parsed.answer !== undefined) {
            handlers.onDone?.({
              answer: parsed.answer,
              reasoning_steps: parsed.reasoning_steps,
              mode: parsed.mode,
            });
          } else if (parsed.message && !parsed.node_name) {
            handlers.onError?.({
              message: parsed.message,
            });
          }
        } catch (e) {
          console.error('Failed to parse SSE data:', e);
        }
      }
    }
  }
}

export async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}


# ==========================================
# 6. src/components/ChatInterface.tsx
# ==========================================

'use client';

import { useState, useRef, useEffect } from 'react';
import { sendChatMessage, ChatMessage } from '@/lib/api';

const NODE_LABELS: Record<string, string> = {
  start: '开始处理',
  router: '意图分析',
  rewrite: '查询重写',
  retrieve: '资料检索',
  analyst: '智能分析',
  validator: '证据审计',
};

const MODE_LABELS = {
  standard: '标准模式',
  deep: '深度思考模式 (R1)',
};

export default function ChatInterface() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'standard' | 'deep'>('standard');
  const [isLoading, setIsLoading] = useState(false);
  const [currentNode, setCurrentNode] = useState<string | null>(null);
  const [reasoningSteps, setReasoningSteps] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, reasoningSteps]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    setIsLoading(true);
    setError(null);
    setCurrentNode(null);
    setReasoningSteps([]);

    // 添加用户消息
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);

    try {
      await sendChatMessage(
        userMessage,
        mode,
        {
          onNode: (event) => {
            if (event.status === 'completed') {
              setCurrentNode(event.node_name);
              setTimeout(() => setCurrentNode(null), 1000);
            }
          },
          onReasoning: (event) => {
            setReasoningSteps((prev) => [...prev, event.reasoning]);
          },
          onDone: (event) => {
            setMessages((prev) => [
              ...prev,
              { role: 'assistant', content: event.answer },
            ]);
          },
          onError: (event) => {
            setError(event.message);
          },
        }
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto p-6">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            手机管家专家诊断系统
          </h1>
          <p className="text-gray-500 mt-1">
            基于 LangGraph 多节点推理 + DeepSeek R1 深度思考
          </p>
        </div>

        {/* Mode Selector */}
        <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="mode"
                checked={mode === 'standard'}
                onChange={() => setMode('standard')}
                className="w-4 h-4 text-blue-600"
              />
              <span className="text-gray-700">标准模式 (快速)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="mode"
                checked={mode === 'deep'}
                onChange={() => setMode('deep')}
                className="w-4 h-4 text-blue-600"
              />
              <span className="text-gray-700">深度思考模式 (R1)</span>
            </label>
          </div>
        </div>

        {/* Status Bar */}
        {currentNode && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
            <div className="flex items-center gap-2">
              <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full" />
              <span className="text-blue-700">
                正在处理: {NODE_LABELS[currentNode] || currentNode}
              </span>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
            <span className="text-red-700">错误: {error}</span>
          </div>
        )}

        {/* Chat Messages */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6 min-h-[400px]">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">对话历史</h2>
          
          {messages.length === 0 && !isLoading && (
            <div className="text-gray-400 text-center py-12">
              暂无对话记录，请输入您的问题
            </div>
          )}

          <div className="space-y-4">
            {messages.map((msg, index) => (
              <div
                key={index}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-3 ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-900'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Reasoning Display (Deep Mode) */}
          {reasoningSteps.length > 0 && (
            <div className="mt-6 border-t pt-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">
                深度思考过程 ({reasoningSteps.length} 次)
              </h3>
              <div className="space-y-3">
                {reasoningSteps.map((reasoning, index) => (
                  <details key={index} className="bg-purple-50 rounded-lg">
                    <summary className="px-4 py-2 cursor-pointer font-medium text-purple-700">
                      第 {index + 1} 次尝试
                    </summary>
                    <div className="px-4 py-3 text-gray-700 whitespace-pre-wrap text-sm">
                      {reasoning}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="bg-white rounded-lg shadow-sm p-4">
          <form onSubmit={handleSubmit} className="flex gap-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="例如：我只有100元，该怎么修屏幕？"
              disabled={isLoading}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed font-medium"
            >
              {isLoading ? '处理中...' : '发送'}
            </button>
          </form>
        </div>

        {/* API Status */}
        <div className="mt-4 text-center text-sm text-gray-500">
          当前模式: {MODE_LABELS[mode]}
        </div>
      </div>
    </div>
  );
}


# ==========================================
# 7. src/app/page.tsx
# ==========================================

import ChatInterface from '@/components/ChatInterface';

export default function Home() {
  return <ChatInterface />;
}


# ==========================================
# 8. src/app/layout.tsx
# ==========================================

import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '手机管家专家诊断系统',
  description: '基于 LangGraph 的智能客服 Agent',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}


# ==========================================
# 9. .env.local
# ==========================================

NEXT_PUBLIC_API_URL=http://localhost:8000
