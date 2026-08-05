/**
 * API 调用和 SSE 处理
 * 支持：标准对话 / 深度思考 / 联网搜索 / 深度调研
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const ACCEPTANCE_REQUEST_TIMEOUT_MS = 50_000;

export interface ModelSettings {
  provider: 'deepseek' | 'glm' | 'custom';
  api_format: 'openai_chat_completions';
  base_url: string;
  model_id: string;
  api_key?: string;
  has_api_key?: boolean;
  display_name: string;
  model_family: string;
  input_context: number;
  output_context: number;
  tool_call_rounds: number;
  full_url: boolean;
  multimodal: boolean;
  text_model_id: string;
  vision_model_id: string;
  thinking_enabled: boolean;
  reasoning_effort: string;
  temperature: number;
  max_tokens: number;
}

export interface ChatAttachment {
  type: 'image_url' | 'video_url' | 'file_url';
  url: string;
  name?: string;
}

export async function getModelSettings(provider?: ModelSettings['provider']): Promise<ModelSettings> {
  const query = provider ? `?provider=${encodeURIComponent(provider)}` : '';
  const response = await fetch(`${API_BASE_URL}/api/settings/model${query}`);
  if (!response.ok) throw new Error('无法读取模型配置');
  return response.json();
}

export async function saveModelSettings(settings: ModelSettings): Promise<ModelSettings> {
  const response = await fetch(`${API_BASE_URL}/api/settings/model`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!response.ok) throw new Error('保存模型配置失败');
  return response.json();
}

// ==========================================
// 类型定义
// ==========================================

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  reasoning_time?: number;
  // Why: Code 模式历史消息需要回显用户上传的图片缩略图，便于复看每次提问的视觉上下文。
  attachments?: ChatAttachment[];
}

export interface NodeEvent {
  node_name: string;
  status: 'processing' | 'completed';
  message?: string;
}

export interface ReasoningEvent {
  reasoning: string;
}

export interface WebDoc {
  id: number;
  title: string;
  content: string;
  url: string;
  score: number;
}

export interface WebDocsEvent {
  docs: WebDoc[];
  count: number;
}

export interface DoneEvent {
  answer: string;
  reasoning_steps: number;
  mode: string;
  web_docs?: WebDoc[];
}

export interface ErrorEvent {
  message: string;
}

export type ChatMode =
  | 'standard'
  | 'deep'
  | 'web'
  | 'research'
  | 'agent'
  | 'plan'
  | 'distributed_plan'
  | 'code';

export interface CodeUpdateEvent {
  type: 'code_update';
  code: string;
  done: boolean;
}

export interface CodeErrorEvent {
  type: 'error';
  message: string;
  done: true;
}

export interface CodeAgentActivityEvent {
  type: 'agent_activity';
  channel: 'status' | 'output' | 'answer';
  phase: 'analyzing' | 'diagnosing' | 'generating' | 'patching' | 'validating';
  content: string;
  done: boolean;
}

// Why: 三字段契约中"总结汇报"专用 SSE 事件。summary 内容来自模型或后端 delta 自动总结。
// 前端必须渲染在消息气泡正文区（白底/正常 Markdown），禁止缩进进"完整模型输出"大黑框。
export interface RuntimeSummaryEvent {
  type: 'runtime_summary';
  intent: 'patch' | 'fullstack_bootstrap' | 'answer' | 'ask_clarification';
  content: string;
  done: boolean;
}

// Why: 预留——终端命令提案事件。先走审批链（已在 terminal_service.filter_command 黑白名单），
// 等前端 UI 渲染"执行/拒绝/编辑后执行"横幅后再消费。
export interface TerminalProposalEvent {
  type: 'terminal_proposal';
  command: string;
  reason?: string;
  expected_output_hint?: string;
  run_id?: string;
}

// Why: 全栈修改模式任务拆解——后端把复杂指令拆成子任务列表推给前端，
// 前端用浮层卡片展示进度（待办/进行中/完成/失败/跳过）。
export interface TaskItem {
  id: number;
  title: string;
  target_files: string[];
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
}

export interface TaskListEvent {
  type: 'task_list';
  tasks: TaskItem[];
  done: boolean;
}

export interface TaskUpdateEvent {
  type: 'task_update';
  task_id: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  done: boolean;
}

export type CodeGenerationEvent = CodeUpdateEvent | CodeErrorEvent | CodeAgentActivityEvent | RuntimeSummaryEvent | TerminalProposalEvent | TaskListEvent | TaskUpdateEvent;

export type PlanTaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface PlanTask {
  id: number;
  title: string;
  description: string;
  status: PlanTaskStatus;
  requires_web: boolean;
  assigned_agent?: string;
  result?: string | null;
  error?: string | null;
}

export interface PlanProgressEvent {
  phase: 'planning' | 'executing' | 'replanning' | 'completed';
  tasks: PlanTask[];
  current_task_id?: number | null;
  iteration: number;
  message?: string;
}

// 多智能体协同事件
export interface AgentTalkEvent {
  from_agent: string;
  to_agent: string;
  action: string;
  content?: string;
  timestamp: number;
}

export interface AgentFinalAnswerEvent {
  answer: string;
  handled_by: string;
}

export interface SystemStatusEvent {
  message: string;
}

export type AgentTool = 'read' | 'edit' | 'terminal' | 'web_search';

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  is_callable: boolean;
  when_to_use: string;
  tools: AgentTool[];
  created_at?: number;
  updated_at?: number;
}

export type AgentDraft = Omit<AgentConfig, 'created_at' | 'updated_at'>;

export interface AgentListResponse {
  agents: AgentConfig[];
  count: number;
}

export type DiscussionLength = 'brief' | 'balanced' | 'detailed';
export type CapabilityMode = 'off' | 'auto' | 'on';

export interface RuntimeSettings {
  responseLength: DiscussionLength;
  webSearch: CapabilityMode;
  deepThinking: CapabilityMode;
  discussionRounds: number;
}

export interface CodeAgentTrace {
  steps: string[];
  output: string;
  phase: string;
  isRunning: boolean;
  fileChanges?: CodeFileChange[];
  // Why: 问答分支下后端返回 Markdown 文本，前端用 MarkdownMessage 渲染而非 <pre>。
  answer?: string;
  // Why: Day59 三字段契约——总结汇报，渲染在“消息气泡正文”区（正常白底 Markdown），
  //   禁止缩进进“完整模型输出”大黑框。summary 为空表示本次 run 没有独立汇报内容。
  summary?: string;
  summaryIntent?: 'patch' | 'fullstack_bootstrap' | 'answer' | 'ask_clarification';
  // Why: 预留——终端命令提案缓存列表，等后续 UI 渲染“执行/拒绝/编辑后执行”横幅。
  terminalProposals?: Array<{ command: string; reason?: string; expected_output_hint?: string }>;
}

export interface CodeFileChange {
  path: string;
  additions: number;
  deletions: number;
}

export interface CodeAgentRun {
  id: string;
  request: string;
  projectKind: 'frontend' | 'fullstack';
  createdAt: string;
  trace: CodeAgentTrace;
}

export interface AcceptanceAssertionResult {
  assertion: {
    kind: 'visible' | 'hidden' | 'text_contains' | 'count_gte' | 'console_contains';
    selector: string;
    expected: string;
    minimum: number;
  };
  passed: boolean;
  actual: string;
}

export interface CodeAcceptanceReport {
  passed: boolean;
  blocked: boolean;
  stage?: 'planning' | 'browser';
  diagnostic?: string;
  plan?: {
    summary: string;
    steps: Array<Record<string, unknown>>;
    assertions: Array<Record<string, unknown>>;
  };
  assertions?: AcceptanceAssertionResult[];
  console?: Array<{ level: string; text: string }>;
  network_failures?: Array<{ url: string; error: string }>;
  page_text?: string;
  runner_stderr?: string;
  // Why: runner_stdout 与 returncode 只在“结果标记未被写入或解析失败”的兜底分支中填充，
  // 方便前端 UI 展示给用户 Playwright 的实际 stderr/stdout，不必每次都翻后端日志。
  runner_stdout?: string;
  returncode?: number;
  model_output?: string;
  artifacts?: CodeFileChange[];
}

export interface ChatOptions {
  customAgents?: unknown[];
  discussionLength?: DiscussionLength;
  discussionAgentIds?: string[];
  discussionRounds?: number;
  sessionId?: string;
  runtimeSettings?: RuntimeSettings;
  attachments?: ChatAttachment[];
}

export interface SessionSummary {
  session_id: string;
  title: string;
  mode: ChatMode;
  created_at: number;
  updated_at: number;
}

export interface SessionSnapshot {
  messages: ChatMessage[];
  reasoningSteps: string[];
  webDocs: WebDoc[];
  researchChunks: ResearchChunk[];
  agentTalks: AgentTalkEvent[];
  planProgress: PlanProgressEvent | null;
  discussionLength: DiscussionLength;
  discussionAgentIds: string[];
  discussionRounds: number;
  webSearch?: CapabilityMode;
  deepThinking?: CapabilityMode;
  generatedCode?: string;
  codeVersions?: Array<{
    versionId: string;
    timestamp: string;
    summary: string;
    vfs: Record<string, string>;
    fileCount: number;
  }>;
  activeCodeVersionId?: string;
  codeProjectKind?: 'frontend' | 'fullstack';
  codeAgentRuns?: CodeAgentRun[];
}

export interface SessionHistoryResponse {
  session: SessionSummary;
  snapshot: Partial<SessionSnapshot>;
}

// 深度调研专用事件
export interface ResearchProcessEvent {
  stage: 'fanout' | 'fetch' | 'chunk' | 'rerank' | 'reason';
  status: 'running' | 'done';
  count?: number;
  message?: string;
  message_detail?: string | string[];
  // 各阶段数据
  queries?: string[];          // fanout: 生成的搜索词
  pages?: Array<{ title: string; url: string }>;  // fetch: 抓取的页面
  chunk_count?: number;        // chunk: 切片数量
  top_chunks?: ResearchChunk[]; // rerank: 精选片段
}

export interface ResearchDoneEvent {
  total_pages: number;
  total_chunks: number;
  top_chunks: unknown[];
  report?: string;
  reasoning?: string;
}

// R1 推理完成事件（流式内容）
export interface ResearchReasonDoneEvent {
  reasoning: string;
  report: string;
  reasoning_time: number;
}

// 深度调研精选片段类型
export interface ResearchChunk {
  id: number;
  title: string;
  url: string;
  score: number;
  text: string;
}

// ==========================================
// 回调类型
// ==========================================

type ChatHandlers = {
  onNode?: (event: NodeEvent) => void;
  onReasoning?: (event: ReasoningEvent) => void;
  onWebDocs?: (event: WebDocsEvent) => void;
  onDone?: (event: DoneEvent) => void;
  onError?: (event: ErrorEvent) => void;
  // 多智能体专用
  onAgentTalk?: (event: AgentTalkEvent) => void;
  onAgentFinalAnswer?: (event: AgentFinalAnswerEvent) => void;
  onSystemStatus?: (event: SystemStatusEvent) => void;
  onPlanProgress?: (event: PlanProgressEvent) => void;
  onToken?: (token: string) => void;
  onReasoningDelta?: (token: string) => void;
};

type ResearchHandlers = {
  onResearchProcess?: (event: ResearchProcessEvent) => void;
  onResearchReasonDone?: (event: ResearchReasonDoneEvent) => void;
  onResearchDone?: (event: ResearchDoneEvent) => void;
  onError?: (event: ErrorEvent) => void;
};

// ==========================================
// 普通聊天（standard / deep / web）
// ==========================================

export async function sendChatMessage(
  message: string,
  mode: ChatMode,
  handlers: ChatHandlers,
  options: ChatOptions = {},
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      mode,
      custom_agents: options.customAgents,
      discussion_length: options.discussionLength,
      discussion_agent_ids: options.discussionAgentIds,
      discussion_rounds: options.discussionRounds,
      session_id: options.sessionId,
      runtime_settings: options.runtimeSettings
        ? {
            response_length: options.runtimeSettings.responseLength,
            web_search: options.runtimeSettings.webSearch,
            deep_thinking: options.runtimeSettings.deepThinking,
            discussion_rounds: options.runtimeSettings.discussionRounds,
          }
        : undefined,
      attachments: options.attachments,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('event:')) continue;
      if (line.startsWith('data:')) {
        const data = line.slice(5).trim();
        if (!data) continue;

        try {
          const parsed = JSON.parse(data) as Record<string, unknown>;

          if (parsed.token !== undefined) {
            handlers.onToken?.(String(parsed.token));
          } else if (parsed.reasoning_delta !== undefined) {
            handlers.onReasoningDelta?.(String(parsed.reasoning_delta));
          } else if (parsed.phase && Array.isArray(parsed.tasks)) {
            handlers.onPlanProgress?.({
              phase: String(parsed.phase) as PlanProgressEvent['phase'],
              tasks: parsed.tasks as PlanTask[],
              current_task_id: parsed.current_task_id == null
                ? null
                : Number(parsed.current_task_id),
              iteration: Number(parsed.iteration) || 0,
              message: parsed.message ? String(parsed.message) : undefined,
            });
          } else if (parsed.node_name) {
            handlers.onNode?.({
              node_name: String(parsed.node_name),
              status: String(parsed.status) as 'processing' | 'completed',
              message: parsed.message ? String(parsed.message) : undefined,
            });
          } else if (parsed.reasoning !== undefined) {
            handlers.onReasoning?.({ reasoning: String(parsed.reasoning) });
          } else if (parsed.docs !== undefined && parsed.count !== undefined) {
            handlers.onWebDocs?.({
              docs: parsed.docs as WebDoc[],
              count: Number(parsed.count),
            });
          } else if (parsed.answer !== undefined && parsed.handled_by !== undefined) {
            handlers.onAgentFinalAnswer?.({
              answer: String(parsed.answer),
              handled_by: String(parsed.handled_by),
            });
          } else if (parsed.answer !== undefined) {
            handlers.onDone?.({
              answer: String(parsed.answer),
              reasoning_steps: Number(parsed.reasoning_steps) || 0,
              mode: String(parsed.mode) || 'standard',
              web_docs: parsed.web_docs as WebDoc[] | undefined,
            });
          } else if (parsed.from_agent && parsed.to_agent && parsed.action) {
            // 多智能体 agent_talk 事件
            handlers.onAgentTalk?.({
              from_agent: String(parsed.from_agent),
              to_agent: String(parsed.to_agent),
              action: String(parsed.action),
              content: parsed.content ? String(parsed.content) : undefined,
              timestamp: Number(parsed.timestamp) || 0,
            });
          } else if (parsed.answer !== undefined && parsed.handled_by !== undefined) {
            // 多智能体 final_answer 事件
            handlers.onAgentFinalAnswer?.({
              answer: String(parsed.answer),
              handled_by: String(parsed.handled_by),
            });
          } else if (parsed.status === 'success' && parsed.mode === 'agent') {
            handlers.onDone?.({
              answer: '',
              reasoning_steps: 0,
              mode: 'agent',
            });
          } else if (parsed.message && !parsed.error) {
            handlers.onSystemStatus?.({ message: String(parsed.message) });
          } else if (parsed.message) {
            handlers.onError?.({ message: String(parsed.message) });
          }
        } catch (e) {
          console.error('Failed to parse SSE data:', e);
        }
      }
    }
  }
}

// ==========================================
// 深度调研（Query Fan-out → 抓取 → 切片 → Rerank）
// ==========================================

export async function sendDeepResearch(
  query: string,
  handlers: ResearchHandlers,
  sessionId?: string,
  runtimeSettings?: RuntimeSettings,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/deep_research`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: query,
      mode: 'research',
      session_id: sessionId,
      runtime_settings: runtimeSettings
        ? {
            response_length: runtimeSettings.responseLength,
            web_search: runtimeSettings.webSearch,
            deep_thinking: runtimeSettings.deepThinking,
            discussion_rounds: runtimeSettings.discussionRounds,
          }
        : undefined,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('event:')) continue;
      if (line.startsWith('data:')) {
        const data = line.slice(5).trim();
        if (!data) continue;

        try {
          const parsed = JSON.parse(data) as Record<string, unknown>;

          // 各阶段进度事件
          if (parsed.stage && parsed.status) {
            handlers.onResearchProcess?.({
              stage: String(parsed.stage) as ResearchProcessEvent['stage'],
              status: String(parsed.status) as 'running' | 'done',
              message: parsed.message ? String(parsed.message) : undefined,
              message_detail: parsed.message_detail as string | string[] | undefined,
              queries: parsed.queries as string[] | undefined,
              pages: parsed.pages as Array<{ title: string; url: string }> | undefined,
              chunk_count: parsed.chunk_count !== undefined ? Number(parsed.chunk_count) : undefined,
              top_chunks: parsed.top_chunks as ResearchProcessEvent['top_chunks'],
            });
          }
          // R1 推理完成事件
          else if (parsed.reasoning !== undefined) {
            handlers.onResearchReasonDone?.({
              reasoning: String(parsed.reasoning),
              report: String(parsed.report),
              reasoning_time: Number(parsed.reasoning_time) || 0,
            });
          }
          // 调研完成事件
          else if (parsed.total_pages !== undefined) {
            handlers.onResearchDone?.({
              total_pages: Number(parsed.total_pages) || 0,
              total_chunks: Number(parsed.total_chunks) || 0,
              top_chunks: (parsed.top_chunks as unknown[]) || [],
              report: parsed.report ? String(parsed.report) : undefined,
              reasoning: parsed.reasoning ? String(parsed.reasoning) : undefined,
            });
          }
          // 错误事件
          else if (parsed.message) {
            handlers.onError?.({ message: String(parsed.message) });
          }
        } catch (e) {
          console.error('Failed to parse SSE data:', e);
        }
      }
    }
  }
}

export async function generateWebCode(
  prompt: string,
  onEvent: (event: CodeGenerationEvent) => void,
  signal?: AbortSignal,
  attachments: ChatAttachment[] = [],
  meta?: { workspace_id?: string; run_id?: string },
): Promise<void> {
  const base: Record<string, unknown> = { prompt };
  if (attachments.length) base.attachments = attachments;
  if (meta?.workspace_id) base.workspace_id = meta.workspace_id;
  if (meta?.run_id) base.run_id = meta.run_id;
  return streamCodeRequest('/api/code/generate', base, onEvent, signal);
}

export async function fixWebCode(
  code: string,
  error: string,
  onEvent: (event: CodeGenerationEvent) => void,
  signal?: AbortSignal,
  meta?: { workspace_id?: string; run_id?: string },
): Promise<void> {
  const base: Record<string, unknown> = { code, error };
  if (meta?.workspace_id) base.workspace_id = meta.workspace_id;
  if (meta?.run_id) base.run_id = meta.run_id;
  return streamCodeRequest('/api/code/fix', base, onEvent, signal);
}

export async function modifyWebCode(
  code: string,
  instruction: string,
  targetElement: {
    selector: string;
    tag_name: string;
    class_name: string;
    element_id: string;
    outer_html: string;
  } | null,
  onEvent: (event: CodeGenerationEvent) => void,
  signal?: AbortSignal,
  diagnostics = '',
  attachments: ChatAttachment[] = [],
  meta?: { workspace_id?: string; run_id?: string },
): Promise<void> {
  const base: Record<string, unknown> = targetElement
    ? { code, instruction, target_element: targetElement, diagnostics }
    : { code, instruction, diagnostics };
  if (attachments.length) base.attachments = attachments;
  if (meta?.workspace_id) base.workspace_id = meta.workspace_id;
  if (meta?.run_id) base.run_id = meta.run_id;
  return streamCodeRequest('/api/code/modify', base, onEvent, signal);
}

export async function generateFullstackCode(
  prompt: string,
  onEvent: (event: CodeGenerationEvent) => void,
  signal?: AbortSignal,
  attachments: ChatAttachment[] = [],
  meta?: { workspace_id?: string; run_id?: string },
): Promise<void> {
  const base: Record<string, unknown> = { prompt };
  if (attachments.length) base.attachments = attachments;
  if (meta?.workspace_id) base.workspace_id = meta.workspace_id;
  if (meta?.run_id) base.run_id = meta.run_id;
  return streamCodeRequest('/api/code/fullstack/generate', base, onEvent, signal);
}

export async function modifyFullstackCode(
  vfs: Record<string, string>,
  instruction: string,
  targetElement: {
    selector: string;
    tag_name: string;
    class_name: string;
    element_id: string;
    outer_html: string;
  } | null,
  onEvent: (event: CodeGenerationEvent) => void,
  signal?: AbortSignal,
  diagnostics = '',
  attachments: ChatAttachment[] = [],
  meta?: { workspace_id?: string; run_id?: string },
  // Why: Day57 @file 剪枝——前端把用户 @ 的文件清单传给后端,
  // 后端仅向模型注入这些文件的全量源码,其余文件用路径占位符替换以降低 Token。
  mentionedFiles: string[] = [],
): Promise<void> {
  const base: Record<string, unknown> = targetElement
    ? { vfs, instruction, target_element: targetElement, diagnostics }
    : { vfs, instruction, diagnostics };
  if (attachments.length) base.attachments = attachments;
  if (mentionedFiles.length) base.mentioned_files = mentionedFiles;
  if (meta?.workspace_id) base.workspace_id = meta.workspace_id;
  if (meta?.run_id) base.run_id = meta.run_id;
  return streamCodeRequest('/api/code/fullstack/modify', base, onEvent, signal);
}

export async function fixFullstackCode(
  vfs: Record<string, string>,
  error: string,
  onEvent: (event: CodeGenerationEvent) => void,
  signal?: AbortSignal,
  meta?: { workspace_id?: string; run_id?: string },
): Promise<void> {
  const base: Record<string, unknown> = { vfs, error };
  if (meta?.workspace_id) base.workspace_id = meta.workspace_id;
  if (meta?.run_id) base.run_id = meta.run_id;
  return streamCodeRequest('/api/code/fullstack/fix', base, onEvent, signal);
}

export async function runCodeAcceptanceTest(
  body: {
    user_request: string;
    preview_html: string;
    console_entries: Array<{ level: 'log' | 'info' | 'warn' | 'error'; text: string }>;
  },
  signal?: AbortSignal,
): Promise<CodeAcceptanceReport> {
  const timeoutController = new AbortController();
  let didTimeout = false;
  const handleExternalAbort = () => timeoutController.abort(signal?.reason);
  signal?.addEventListener('abort', handleExternalAbort, { once: true });
  if (signal?.aborted) handleExternalAbort();
  const timeoutId = window.setTimeout(() => {
    didTimeout = true;
    timeoutController.abort();
  }, ACCEPTANCE_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}/api/code/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: timeoutController.signal,
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    return response.json() as Promise<CodeAcceptanceReport>;
  } catch (error) {
    if (didTimeout) {
      throw new Error(`测试请求超过 ${ACCEPTANCE_REQUEST_TIMEOUT_MS / 1000} 秒，已自动终止。`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener('abort', handleExternalAbort);
  }
}

async function streamCodeRequest(
  path: string,
  body: Record<string, unknown>,
  onEvent: (event: CodeGenerationEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    throw new Error(await parseApiError(response));
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('代码生成响应为空。');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const data = frame
        .split('\n')
        .find((line) => line.startsWith('data:'))
        ?.slice(5)
        .trim();
      if (!data) continue;
      onEvent(JSON.parse(data) as CodeGenerationEvent);
    }

    if (done) break;
  }
}

// ==========================================
// 健康检查
// ==========================================

export async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function parseApiError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { detail?: string };
    return payload.detail || `请求失败（${response.status}）`;
  } catch {
    return `请求失败（${response.status}）`;
  }
}

export async function listAgents(): Promise<AgentListResponse> {
  const response = await fetch(`${API_BASE_URL}/api/agents`);
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<AgentListResponse>;
}

export async function generateAgent(userIdea: string): Promise<AgentConfig> {
  const response = await fetch(`${API_BASE_URL}/api/agents/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_idea: userIdea }),
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<AgentConfig>;
}

export async function saveAgent(agent: AgentDraft): Promise<AgentConfig> {
  const response = await fetch(`${API_BASE_URL}/api/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(agent),
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  const payload = await response.json() as { agent: AgentConfig };
  return payload.agent;
}

export async function deleteAgent(agentId: string): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/api/agents/${encodeURIComponent(agentId)}`,
    { method: 'DELETE' },
  );
  if (!response.ok) throw new Error(await parseApiError(response));
}

export async function listSessions(): Promise<{
  sessions: SessionSummary[];
  count: number;
}> {
  const response = await fetch(`${API_BASE_URL}/api/sessions`);
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

export async function createSession(
  mode: ChatMode,
  title = '新会话',
): Promise<SessionSummary> {
  const response = await fetch(`${API_BASE_URL}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, title }),
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

export async function getSessionHistory(
  sessionId: string,
): Promise<SessionHistoryResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/sessions/${encodeURIComponent(sessionId)}/history`,
  );
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

export async function saveSessionSnapshot(
  sessionId: string,
  snapshot: SessionSnapshot,
  generateTitle = false,
): Promise<SessionSummary> {
  const response = await fetch(
    `${API_BASE_URL}/api/sessions/${encodeURIComponent(sessionId)}/history`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        snapshot,
        generate_title: generateTitle,
      }),
    },
  );
  if (!response.ok) throw new Error(await parseApiError(response));
  const payload = await response.json() as { session: SessionSummary };
  return payload.session;
}

export async function deleteSession(sessionId: string): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/api/sessions/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' },
  );
  if (!response.ok) throw new Error(await parseApiError(response));
}

export async function clearSessions(): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/sessions`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error(await parseApiError(response));
}
