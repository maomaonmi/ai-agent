import type { ChatMessage } from '../../lib/api';

let clientMessageCounter = 0;

export function createClientMessageId(): string {
  clientMessageCounter += 1;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `message-${crypto.randomUUID()}`;
  }
  return `message-client-${Date.now().toString(36)}-${clientMessageCounter.toString(36)}`;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function legacyMessageId(message: ChatMessage, index: number, namespace: string): string {
  const fingerprint = [namespace, index, message.role, message.content].join('\u001f');
  return `message-${stableHash(fingerprint)}-${index.toString(36)}`;
}

/**
 * Adds stable IDs to legacy or newly-created messages without replacing messages
 * that already carry identity. Returning the original array when no work is
 * needed keeps React synchronization idempotent.
 */
export function ensureChatMessageIds(
  messages: ChatMessage[],
  namespace: string,
): ChatMessage[] {
  if (messages.every((message) => Boolean(message.id))) return messages;

  return messages.map((message, index) => (
    message.id
      ? message
      : { ...message, id: legacyMessageId(message, index, namespace) }
  ));
}
