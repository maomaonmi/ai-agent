const DISABLED_VALUES = new Set(['0', 'false', 'off', 'disabled']);

export function isCodeObservatoryEnabled(
  value = process.env.NEXT_PUBLIC_CODE_OBSERVATORY_ENABLED,
): boolean {
  const normalized = value?.trim().toLowerCase();
  return !normalized || !DISABLED_VALUES.has(normalized);
}
