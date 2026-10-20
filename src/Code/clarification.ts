/** Format only the stable user-facing clarification contract. */
export function formatMissingInformation(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const key = typeof record.key === 'string' ? record.key.trim() : '';
    const description = typeof record.description === 'string'
      ? record.description.trim()
      : '';
    if (!key || !description) return [];
    return [`${key}：${description}`];
  });
}

/** Hide the old malformed placeholder in already persisted clarification messages. */
export function cleanClarificationContent(content: string, kind: string): string {
  if (kind !== 'clarify') return content;

  return content
    .split(/\r?\n/)
    .filter((line) => !/^\s*undefined\s*[:：]\s*undefined\s*$/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}
