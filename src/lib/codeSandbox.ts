import {
  buildInspectorScript,
  SANDBOX_CONSOLE_EVENT,
  SANDBOX_DOM_SELECTED,
} from '../Code/inspectorScript';

export const CODE_RUNTIME_ERROR = 'code-sandbox-runtime-error' as const;

export interface RuntimeErrorReport {
  type: typeof CODE_RUNTIME_ERROR;
  runId: string;
  message: string;
  source?: string;
  line?: number;
  column?: number;
  stack?: string;
  consoleEntries?: Array<{ level: string; text: string }>;
}

export interface RepairLog {
  attempt: number;
  error: string;
  status: 'repairing' | 'fixed' | 'failed';
  diagnostic?: string;
  modelOutput?: string;
  fileChanges?: Array<{ path: string; additions: number; deletions: number }>;
  consoleEntries?: Array<{ level: string; text: string }>;
}

export interface SelectedElementContext {
  selector: string;
  tagName: string;
  className: string;
  id: string;
  outerHTML: string;
}

export interface SandboxConsoleEntry {
  level: 'log' | 'info' | 'warn' | 'error';
  args: string[];
  timestamp: number;
}

export type CodeGenerationStatus =
  | { state: 'idle' }
  | { state: 'generating'; charCount: number }
  | { state: 'modifying'; charCount: number }
  | { state: 'checking'; attempt: number }
  | { state: 'repairing'; attempt: number; charCount: number }
  | { state: 'done'; charCount: number; repairCount: number }
  | { state: 'error'; message: string };

export function injectErrorCatcher(code: string, runId: string): string {
  if (!code.trim() || !runId) return code;

  const safeRunId = JSON.stringify(runId);
  const catcher = `<script>
(function () {
  var runId = ${safeRunId};
  var report = function (message, source, line, column, stack) {
    window.parent.postMessage({
      type: '${CODE_RUNTIME_ERROR}',
      runId: runId,
      message: String(message || 'Unknown runtime error').slice(0, 2000),
      source: source ? String(source).slice(0, 500) : undefined,
      line: Number(line) || undefined,
      column: Number(column) || undefined,
      stack: stack ? String(stack).slice(0, 4000) : undefined
    }, '*');
  };
  window.onerror = function (message, source, line, column, error) {
    report(message, source, line, column, error && error.stack);
    return false;
  };
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    report(
      reason && reason.message ? reason.message : reason,
      'unhandledrejection',
      0,
      0,
      reason && reason.stack
    );
  });
})();
</script>`;
  const bridge = `${catcher}${buildInspectorScript(runId)}`;

  const headMatch = code.match(/<head(?:\s[^>]*)?>/i);
  if (headMatch?.index !== undefined) {
    const insertAt = headMatch.index + headMatch[0].length;
    return `${code.slice(0, insertAt)}${bridge}${code.slice(insertAt)}`;
  }

  const doctypeMatch = code.match(/<!doctype[^>]*>/i);
  if (doctypeMatch?.index !== undefined) {
    const insertAt = doctypeMatch.index + doctypeMatch[0].length;
    return `${code.slice(0, insertAt)}${bridge}${code.slice(insertAt)}`;
  }

  return `${bridge}${code}`;
}

export function isRuntimeErrorReport(
  value: unknown,
): value is RuntimeErrorReport {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RuntimeErrorReport>;
  return (
    candidate.type === CODE_RUNTIME_ERROR &&
    typeof candidate.runId === 'string' &&
    typeof candidate.message === 'string' &&
    candidate.message.length > 0 &&
    candidate.message.length <= 2000
  );
}

export function isSelectedElementContext(
  value: unknown,
): value is SelectedElementContext & { type: typeof SANDBOX_DOM_SELECTED; runId: string } {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SelectedElementContext> & {
    type?: string;
    runId?: string;
  };
  return (
    candidate.type === SANDBOX_DOM_SELECTED &&
    typeof candidate.runId === 'string' &&
    typeof candidate.selector === 'string' && candidate.selector.length > 0 && candidate.selector.length <= 500 &&
    typeof candidate.tagName === 'string' && candidate.tagName.length > 0 && candidate.tagName.length <= 100 &&
    typeof candidate.className === 'string' && candidate.className.length <= 500 &&
    typeof candidate.id === 'string' && candidate.id.length <= 200 &&
    typeof candidate.outerHTML === 'string' && candidate.outerHTML.length > 0 && candidate.outerHTML.length <= 4000
  );
}

export function isSandboxConsoleEntry(
  value: unknown,
): value is SandboxConsoleEntry & { type: typeof SANDBOX_CONSOLE_EVENT; runId: string } {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SandboxConsoleEntry> & {
    type?: string;
    runId?: string;
  };
  return (
    candidate.type === SANDBOX_CONSOLE_EVENT &&
    typeof candidate.runId === 'string' &&
    (candidate.level === 'log' || candidate.level === 'info' || candidate.level === 'warn' || candidate.level === 'error') &&
    Array.isArray(candidate.args) && candidate.args.length <= 10 &&
    candidate.args.every((item) => typeof item === 'string' && item.length <= 1000)
  );
}
