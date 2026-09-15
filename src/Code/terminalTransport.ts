const DEFAULT_INPUT_BUFFER_LIMIT = 32_000;

/**
 * The terminal effect only depends on which sessions exist, not on labels or
 * other fields returned by the periodic `list` message. Keeping this key
 * stable prevents a harmless list refresh from tearing down xterm/WS.
 */
export function createTerminalSessionKey(runIds: Iterable<string>): string {
  return Array.from(new Set(Array.from(runIds).filter(Boolean))).sort().join('\u0000');
}

/** Keep keystrokes typed while the socket is connecting for the next OPEN. */
export function appendPendingTerminalInput(
  current: string,
  data: string,
  limit = DEFAULT_INPUT_BUFFER_LIMIT,
): string {
  if (!data) return current;
  const next = `${current}${data}`;
  return next.length > limit ? next.slice(-limit) : next;
}
