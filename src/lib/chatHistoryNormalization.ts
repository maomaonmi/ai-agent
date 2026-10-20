/**
 * Canonicalize user-visible chat history at the persistence boundary.
 *
 * Model prompts and user-visible turns are different representations. A legacy
 * Code workbench read-only path once serialized its internal prompt as a user
 * message; this boundary normalizer prevents that protocol envelope from
 * entering snapshots sent to the backend. It mirrors Core/chat_history.py.
 */

const READ_ONLY_PROMPT_PREFIX = "你是 Code 工作台的只读对话助手。";
const USER_QUESTION_MARKER = "用户问题：";
const PROJECT_CONTEXT_MARKERS = ["\n\n项目类型：", "\n项目类型："] as const;

export interface ChatMessage {
  role: string;
  content: string;
  [key: string]: unknown;
}

export function unwrapInternalUserPrompt(content: unknown): string {
  const text = String(content ?? "");
  if (!text.startsWith(READ_ONLY_PROMPT_PREFIX)) {
    return text;
  }
  const questionStart = text.indexOf(USER_QUESTION_MARKER);
  if (questionStart < 0) {
    return text;
  }
  const start = questionStart + USER_QUESTION_MARKER.length;
  let questionEnd = text.length;
  for (const marker of PROJECT_CONTEXT_MARKERS) {
    const markerIndex = text.indexOf(marker, start);
    if (markerIndex >= 0) {
      questionEnd = Math.min(questionEnd, markerIndex);
    }
  }
  const question = text.slice(start, questionEnd).trim();
  return question || text;
}

export function normalizeChatMessages<T extends object>(messages: unknown): T[] {
  if (!Array.isArray(messages)) {
    return [];
  }
  const normalized: T[] = [];
  for (const message of messages) {
    if (typeof message !== "object" || message === null || Array.isArray(message)) {
      continue;
    }
    const item = { ...(message as Record<string, unknown>) };
    if (String(item.role ?? "") === "user") {
      item.content = unwrapInternalUserPrompt(item.content);
    }
    normalized.push(item as T);
  }
  return normalized;
}
