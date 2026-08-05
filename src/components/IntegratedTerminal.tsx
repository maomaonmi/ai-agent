'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { AttachAddon } from 'xterm-addon-attach';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';

import type { PropositionDecision, TerminalProposition, TerminalSessionDescriptor } from '../lib/terminalTypes';

export type { PropositionDecision, TerminalProposition, TerminalSessionDescriptor };

export interface IntegratedTerminalProps {
  workspaceId: string;
  // 当前选中的 terminal run_id；手动终端以 "manual-${suffix}" 命名。
  activeRunId: string;
  onChangeActiveRunId: (runId: string) => void;
  // agent_runs（来自 useCodeAutoRepair.agentRuns）+ 手动终端 一起列出来
  agentRuns: Array<{ id: string; request: string; createdAt: string; trace?: { isRunning?: boolean } }>;
  isManualTerminal: (runId: string) => boolean;
  onCreateManual: () => void;
  onCloseTerminal: (runId: string) => void;
  dark: boolean;
  // 是否允许当前终端接收用户 stdin（仅手动终端 true，agent 终端禁止直接敲命令避免把审批上下文搞乱）
  allowUserStdin: boolean;
  // 代理审批结果：父组件会把“信任此命令”“等待用户选择”注入 agent trace。
  onPropositionUpdate?: (props: TerminalProposition | null) => void;
  onTrustedPrefixAdd?: (runId: string, commandPrefix: string) => void;
  trustedPrefixesByRun?: Record<string, string[]>;
}

function buildWebSocketUrl(workspaceId: string, runId: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  // Why: 本地开发一般 Vite 3000 代理到后端 8000，/ws/* 走 vite 的 server.proxy 里的 "^/ws" 规则。
  // 没有代理时直接连当前 host 也行——用户自己的 main.py 监听 8000，若同源就对了。
  return `${proto}//${host}/ws/terminal/${encodeURIComponent(workspaceId)}/${encodeURIComponent(runId)}`;
}

// 主题色贴合现有 CodeWorkspace 的 dark/light 背景（syntaxHighlight 的配色体系，跟 SourceCodeViewer 一致）。
function termTheme(dark: boolean): { theme: { [k: string]: string }; background: string; foreground: string } {
  if (dark) {
    return {
      background: '#020617', // slate-950
      foreground: '#e2e8f0', // slate-200
      theme: {
        background: '#020617',
        foreground: '#e2e8f0',
        cursor: '#38bdf8', // sky-400
        cursorAccent: '#020617',
        selectionBackground: 'rgba(56, 189, 248, 0.35)',
        black: '#0f172a',
        red: '#fecaca',
        green: '#a7f3d0',
        yellow: '#fde68a',
        blue: '#bfdbfe',
        magenta: '#f5d0fe',
        cyan: '#a5f3fc',
        white: '#cbd5e1',
        brightBlack: '#475569',
        brightRed: '#f87171',
        brightGreen: '#34d399',
        brightYellow: '#fbbf24',
        brightBlue: '#60a5fa',
        brightMagenta: '#e879f9',
        brightCyan: '#22d3ee',
        brightWhite: '#f1f5f9',
      },
    };
  }
  return {
    background: '#f8fafc', // slate-50
    foreground: '#0f172a',
    theme: {
      background: '#f8fafc',
      foreground: '#0f172a',
      cursor: '#0ea5e9',
      cursorAccent: '#f8fafc',
      selectionBackground: 'rgba(14, 165, 233, 0.25)',
      black: '#0f172a',
      red: '#b91c1c',
      green: '#047857',
      yellow: '#a16207',
      blue: '#1d4ed8',
      magenta: '#9333ea',
      cyan: '#0e7490',
      white: '#e2e8f0',
      brightBlack: '#64748b',
      brightRed: '#ef4444',
      brightGreen: '#10b981',
      brightYellow: '#eab308',
      brightBlue: '#3b82f6',
      brightMagenta: '#c026d3',
      brightCyan: '#06b6d4',
      brightWhite: '#020617',
    },
  };
}

export function IntegratedTerminal(props: IntegratedTerminalProps) {
  const {
    workspaceId, activeRunId, onChangeActiveRunId,
    agentRuns, isManualTerminal, onCreateManual, onCloseTerminal,
    dark, allowUserStdin, onPropositionUpdate,
    trustedPrefixesByRun,
  } = props;

  const xtermHostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const attachRef = useRef<AttachAddon | null>(null);
  const [termReady, setTermReady] = useState(false);
  const [sessions, setSessions] = useState<TerminalSessionDescriptor[]>([]);
  const [proposition, setProposition] = useState<TerminalProposition | null>(null);
  const [propositionSecondConfirm, setPropositionSecondConfirm] = useState(false);
  const [editingCommand, setEditingCommand] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [trustThisCommand, setTrustThisCommand] = useState(false);
  const autoApprovedRef = useRef<Set<string>>(new Set());

  // 挂到父组件的提案回调（用于 agent_trace 里显示“正在等待用户选择终端命令审批”）
  useEffect(() => {
    onPropositionUpdate?.(proposition);
  }, [proposition, onPropositionUpdate]);

  // 1. 构造/销毁 Terminal 实例 + fit + weblinks
  // Why: 从 Console Tab 切到 Terminal Tab 时，父容器的 display 刚从 none 变成 block，
  // offsetWidth/Height 在同一帧内仍是 0。若此时调用 term.open()，xterm.js 内部的
  // Viewport._innerRefresh 会读取 buffer.dimensions 抛 TypeError（undefined.dimensions）。
  // 解决办法：延后 term.open() 直到容器尺寸非 0，再通过 setTermReady 通知 WebSocket effect 连接。
  useEffect(() => {
    if (!xtermHostRef.current) return;
    const host = xtermHostRef.current;
    const { theme, background, foreground } = termTheme(dark);

    host.style.backgroundColor = background;
    host.style.color = foreground;

    const term = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: 12,
      lineHeight: 1.35,
      cursorBlink: true,
      convertEol: true,
      scrollback: 5000,
      allowProposedApi: true,
      theme,
    });
    const fitAddon = new FitAddon();
    const linksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(linksAddon);

    let rafId: number | null = null;
    let timeoutId: number | null = null;
    let opened = false;

    const tryOpen = () => {
      if (opened) return;
      if (host.offsetWidth <= 0 || host.offsetHeight <= 0) return;
      try {
        term.open(host);
        fitAddon.fit();
      } catch {
        return;
      }
      opened = true;
      termRef.current = term;
      fitRef.current = fitAddon;
      setTermReady(true);
    };

    const ro = new ResizeObserver(() => {
      tryOpen();
      if (!opened) return;
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        } catch { /* noop */ }
      }
    });
    ro.observe(host);

    tryOpen();
    rafId = window.requestAnimationFrame(() => tryOpen());
    timeoutId = window.setTimeout(() => tryOpen(), 100);

    const onWindowResize = () => {
      if (!opened) { tryOpen(); return; }
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        } catch { /* noop */ }
      }
    };
    window.addEventListener('resize', onWindowResize);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      window.removeEventListener('resize', onWindowResize);
      ro.disconnect();
      try { attachRef.current?.dispose(); } catch { /* noop */ }
      try { term.dispose(); } catch { /* noop */ }
      termRef.current = null;
      fitRef.current = null;
      attachRef.current = null;
      setTermReady(false);
    };
  }, [dark]);

  // 2. 主题变更时，已存在的 term 直接替换 theme / 背景色（上面的 effect 只跑一次）
  useEffect(() => {
    const term = termRef.current;
    const host = xtermHostRef.current;
    if (!term || !host) return;
    const { theme, background, foreground } = termTheme(dark);
    term.options.theme = theme;
    host.style.backgroundColor = background;
    host.style.color = foreground;
    try { fitRef.current?.fit(); } catch { /* noop */ }
  }, [dark]);

  // 3. 根据 activeRunId 切换 WebSocket。
  // Why: 依赖 termReady 是因为 WebSocket 必须在 term.open() 成功后才能连接，
  // 否则 term.write() 会因 terminal 未就绪而抛出未捕获的异常。
  useEffect(() => {
    if (!activeRunId) return;
    if (!termReady) return;
    const term = termRef.current;
    if (!term) return;

    // 关旧 WS
    try { attachRef.current?.dispose(); } catch { /* noop */ }
    attachRef.current = null;
    const oldWs = wsRef.current;
    if (oldWs && (oldWs.readyState === WebSocket.OPEN || oldWs.readyState === WebSocket.CONNECTING)) {
      try { oldWs.close(); } catch { /* noop */ }
    }
    wsRef.current = null;

    const url = buildWebSocketUrl(workspaceId, activeRunId);
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      term.writeln(`\r\n\x1b[31m[集成终端] 无法建立 WebSocket：${(err as Error).message}\x1b[0m`);
      return;
    }
    wsRef.current = ws;

    // 开一条 attach 通道（xterm 输出由服务端推过来，用户输入则是“手动终端”时才会发）
    // 但 AttachAddon 默认会把所有 onData 都写 websocket，这里我们不直接用它的 attach，
    // 自己写一个更可控的监听：WS 的 pty_output 写到 term，term 的 onData 只有 allowUserStdin 才发。
    let destroyed = false;
    ws.onopen = () => {
      if (destroyed) return;
      try { fitRef.current?.fit(); } catch { /* noop */ }
      if (ws.readyState === WebSocket.OPEN && termRef.current) {
        try {
          ws.send(JSON.stringify({
            type: 'resize', cols: termRef.current.cols, rows: termRef.current.rows,
          }));
          ws.send(JSON.stringify({ type: 'list' }));
        } catch { /* noop */ }
      }
    };
    ws.onmessage = (ev) => {
      if (destroyed) return;
      let payload: Partial<TerminalProposition> & {
        type?: string;
        data?: string;
        terminals?: TerminalSessionDescriptor[];
      } = { type: '' };
      try {
        payload = typeof ev.data === 'string' ? JSON.parse(ev.data) : { type: '' };
      } catch {
        // 非 JSON：当作原始 PTY 输出（兼容未来二进制）
        if (typeof ev.data === 'string') term.write(ev.data);
        return;
      }
      switch (payload.type) {
        case 'pty_output':
          if (typeof payload.data === 'string') term.write(payload.data);
          break;
        case 'list':
          if (Array.isArray(payload.terminals)) setSessions(payload.terminals);
          break;
        case 'proposition': {
          // 把 proposition 标准化
          const next: TerminalProposition = {
            id: String(payload.id ?? ''),
            run_id: String(payload.run_id ?? ''),
            workspace_id: String(payload.workspace_id ?? ''),
            command: String(payload.command ?? ''),
            reason: String(payload.reason ?? ''),
            expected: String(payload.expected ?? ''),
            status: (payload.status as TerminalProposition['status']) ?? 'pending',
            status_message: String(payload.status_message ?? ''),
            created_at: Number(payload.created_at ?? 0),
            timeout_seconds: Number(payload.timeout_seconds ?? 90),
            remaining_seconds: Number(payload.remaining_seconds ?? 90),
          };
          setProposition(next);
          setPropositionSecondConfirm(false);
          setEditingCommand(next.command);
          setTrustThisCommand(false);
          setShowEditor(false);
          break;
        }
        case 'error':
          term.writeln(`\r\n\x1b[31m[集成终端] ${String(payload.data ?? '')}\x1b[0m`);
          break;
        default:
          break;
      }
    };
    ws.onclose = () => {
      if (destroyed) return;
      term.writeln('\r\n\x1b[33m[集成终端] WebSocket 已断开。切换终端可重连。\x1b[0m');
    };

    const disposable = term.onData((data) => {
      if (!allowUserStdin) {
        // Why: agent 终端里禁止用户直接敲命令，避免把审批/等待 PS1 状态搞乱；
        // 但允许 Ctrl+C 中断跑飞的命令（这是我们允许的唯一例外）。
        if (data === '\x03') {
          try { ws.send(data); } catch { /* noop */ }
        }
        return;
      }
      try {
        // 用户自己的输入：优先以 JSON 打包 {"type":"stdin","data":...} 发，
        // 服务端也支持 raw text（兼容 attach addon 的历史行为）。
        ws.send(JSON.stringify({ type: 'stdin', data }));
      } catch { /* noop */ }
    });

    // 后端周期性广播 session list 也更新一次 UI：我们每次切 runId 主动请求一次 list。
    const listTimer = window.setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'list' })); } catch { /* noop */ }
      }
    }, 2000);

    return () => {
      destroyed = true;
      window.clearInterval(listTimer);
      disposable.dispose();
      try { ws.close(); } catch { /* noop */ }
      wsRef.current = null;
    };
  }, [workspaceId, activeRunId, allowUserStdin, termReady]);

  // 4. 提案倒计时：前端自己数秒，让横幅的剩余时间更直观。
  useEffect(() => {
    if (!proposition) return;
    if (proposition.status !== 'pending' && proposition.status !== 'needs_confirm') return;
    const timer = window.setInterval(() => {
      setProposition((prev) => {
        if (!prev) return prev;
        const remaining = Math.max(0, prev.remaining_seconds - 1);
        return { ...prev, remaining_seconds: remaining };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [proposition?.id, proposition?.status]);

  // 5. 信任白名单自动批准：命令前缀命中 trustedPrefixesByRun[run_id] 列表中的任意前缀时，
  //    自动调 approve 并把“本次会话信任此类命令”勾选框勾上（用户没勾选也会被 add_trust 保持一致逻辑）。
  useEffect(() => {
    if (!proposition) return;
    if (proposition.status !== 'pending' && proposition.status !== 'needs_confirm') return;
    if (autoApprovedRef.current.has(proposition.id)) return;
    const list = trustedPrefixesByRun?.[proposition.run_id] ?? [];
    if (list.length === 0) return;
    const normalized = proposition.command.trim().toLowerCase();
    const firstLine = normalized.split(/\r?\n/)[0] ?? '';
    const matched = list.some((prefixRaw) => {
      const prefix = prefixRaw.trim().toLowerCase();
      if (!prefix) return false;
      if (firstLine.startsWith(prefix)) return true;
      // Why: 有的前缀是 "npm install"（2 词），但命令可能是 "npm install --registry=xxx"；
      // 另外也允许 split 后前 N 词逐词完全相等（N = prefix.split(' ').length），
      // 避免 "npm inst" 这种拼写错误意外命中。
      const prefixTokens = prefix.split(/\s+/).filter(Boolean);
      const commandTokens = firstLine.split(/\s+/).filter(Boolean);
      if (commandTokens.length < prefixTokens.length) return false;
      return prefixTokens.every((tok, i) => commandTokens[i] === tok);
    });
    if (!matched) return;
    autoApprovedRef.current.add(proposition.id);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({
          type: 'resolve',
          id: proposition.id,
          decision: 'approve',
          add_trust: true,
          // Why: trustedPrefixesByRun 命中时不需要二次确认（用户之前已经信任过"同类命令"）。
          second_confirm: true,
        }));
      } catch { /* noop */ }
    }
    // Why: 即便 WebSocket 没开，也让横幅先从 UI 消掉，避免用户看到“等待审批”但又没动作。
    setProposition((prev) => (prev && prev.id === proposition.id ? null : prev));
  }, [proposition, trustedPrefixesByRun]);

  const resolve = useCallback((decision: PropositionDecision, { editedCommand, addTrust, secondConfirm }: {
    editedCommand?: string; addTrust?: boolean; secondConfirm?: boolean;
  } = {}) => {
    const ws = wsRef.current;
    if (!ws || !proposition) return;
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({
        type: 'resolve',
        id: proposition.id,
        decision,
        edited_command: editedCommand,
        add_trust: Boolean(addTrust),
        second_confirm: Boolean(secondConfirm),
      }));
    } catch { /* noop */ }
  }, [proposition]);

  const onApprove = () => {
    if (!proposition) return;
    const finalCommand = showEditor ? editingCommand : undefined;
    if (proposition.status === 'needs_confirm' && !propositionSecondConfirm) {
      setPropositionSecondConfirm(true);
      return;
    }
    if (trustThisCommand && props.onTrustedPrefixAdd) {
      const cmd = (finalCommand ?? proposition.command).trim();
      const firstLine = cmd.split(/\r?\n/)[0] ?? '';
      const prefix = firstLine.split(/\s+/).slice(0, 2).join(' ').toLowerCase();
      if (prefix) props.onTrustedPrefixAdd(proposition.run_id, prefix);
    }
    resolve('approve', { editedCommand: finalCommand, addTrust: trustThisCommand, secondConfirm: true });
  };

  // 组合 session 列表：后端 sessions（list 接口推的真实 ConPTY） + 前端已知但后端还没 spawn 的 agent run（保证用户没审批也能先看到 tab）
  const allSessions = useMemo<TerminalSessionDescriptor[]>(() => {
    const byRunId = new Map<string, TerminalSessionDescriptor>();
    for (const s of sessions) byRunId.set(s.run_id, s);
    for (const run of agentRuns) {
      if (!byRunId.has(run.id)) {
        byRunId.set(run.id, {
          workspace_id: workspaceId,
          run_id: run.id,
          title: run.request ? run.request.slice(0, 24) : `Agent ${run.id.slice(0, 8)}`,
          is_manual: false,
          exit_code: null,
        });
      }
    }
    return Array.from(byRunId.values());
  }, [sessions, agentRuns, workspaceId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 提案横幅：紧贴终端 Tab 正上方，需求原文要求”位置最好加到终端上方，紧靠着“ */}
      {proposition && (proposition.status === 'pending' || proposition.status === 'needs_confirm') && (
        <div className={`flex shrink-0 flex-col gap-2 border-b px-3 py-2 ${
          proposition.status === 'needs_confirm' ? 'border-amber-700 bg-amber-500/10' : 'border-blue-700 bg-blue-500/10'
        }`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-100">
                <span className="rounded bg-blue-600 px-1.5 py-0.5 font-medium">Agent 请求执行命令</span>
                <span className={`rounded px-1.5 py-0.5 font-mono ${
                  proposition.remaining_seconds <= 10
                    ? 'bg-rose-600 text-white'
                    : proposition.remaining_seconds <= 30
                      ? 'bg-amber-500 text-slate-900'
                      : 'bg-slate-700 text-slate-200'
                }`}>
                  剩余 {proposition.remaining_seconds}s / {proposition.timeout_seconds}s
                </span>
                <span className="text-slate-300">
                  {proposition.reason || '未填写原因'}
                </span>
              </div>
              {proposition.expected ? (
                <p className="mt-1 text-[11px] text-slate-300">预期结果：{proposition.expected}</p>
              ) : null}
              {proposition.status_message ? (
                <p className="mt-1 text-[11px] text-amber-200">⚠ {proposition.status_message}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <label className="inline-flex cursor-pointer select-none items-center gap-1.5 rounded border border-slate-600 bg-slate-800/80 px-2 py-1 text-[11px] text-slate-200">
                <input
                  type="checkbox"
                  className="h-3 w-3 rounded border-slate-500 bg-slate-800 text-sky-500 focus:ring-sky-500"
                  checked={trustThisCommand}
                  onChange={(e) => setTrustThisCommand(e.target.checked)}
                />
                本次会话信任此类命令
              </label>
              <button
                type="button"
                onClick={() => { setShowEditor((v) => !v); if (!showEditor) setEditingCommand(proposition.command); }}
                className="rounded border border-slate-600 bg-slate-800/80 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
              >
                {showEditor ? '收起编辑' : '编辑后执行'}
              </button>
              <button
                type="button"
                onClick={() => resolve('reject')}
                className="rounded border border-rose-700 bg-rose-600/90 px-2 py-1 text-[11px] font-medium text-white hover:bg-rose-600"
              >
                拒绝
              </button>
              <button
                type="button"
                onClick={onApprove}
                className={`rounded px-2.5 py-1 text-[11px] font-semibold text-white ${
                  proposition.status === 'needs_confirm' && !propositionSecondConfirm
                    ? 'bg-amber-500 hover:bg-amber-600'
                    : 'bg-emerald-600 hover:bg-emerald-500'
                }`}
              >
                {proposition.status === 'needs_confirm' && !propositionSecondConfirm ? '再次确认执行' : '执行'}
              </button>
            </div>
          </div>
          {showEditor ? (
            <textarea
              value={editingCommand}
              onChange={(e) => setEditingCommand(e.target.value)}
              spellCheck={false}
              rows={Math.min(8, Math.max(3, editingCommand.split(/\r?\n/).length + 1))}
              className="w-full resize-y rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-[11px] text-emerald-200 focus:border-sky-500 focus:outline-none"
            />
          ) : (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-slate-800 bg-slate-950/80 px-2 py-1.5 font-mono text-[11px] leading-5 text-slate-100">
{proposition.command}
            </pre>
          )}
        </div>
      )}

      {/* 终端 Tab 条：右对齐下拉 + 新建手动终端 + 关闭 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-800 bg-slate-900/60 px-2 py-1.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {allSessions.length === 0 ? (
            <span className="px-2 text-[11px] text-slate-500">暂无终端，点右侧“+”可新建手动终端。</span>
          ) : allSessions.map((s) => {
            const active = s.run_id === activeRunId;
            const label = s.is_manual
              ? `🖥  我的终端 · ${s.title || s.run_id.slice(-6)}`
              : `🤖 ${s.title || s.run_id.slice(0, 10)}`;
            return (
              <div
                key={s.run_id}
                className={`group inline-flex max-w-[320px] items-center gap-1 rounded border px-2 py-0.5 text-[11px] ${
                  active ? 'border-sky-500 bg-slate-800 text-sky-200' : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <button
                  type="button"
                  title={s.run_id}
                  onClick={() => onChangeActiveRunId(s.run_id)}
                  className="truncate text-left"
                >
                  {label}
                </button>
                {s.is_manual ? (
                  <button
                    type="button"
                    title="关闭终端"
                    onClick={() => onCloseTerminal(s.run_id)}
                    className="rounded px-1 text-slate-500 opacity-60 hover:bg-slate-700 hover:text-rose-300 hover:opacity-100"
                  >
                    ×
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onCreateManual}
            className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
            title="新建我的终端（可直接敲命令，Agent 禁止写入）"
          >
            + 我的终端
          </button>
        </div>
      </div>

      {/* xterm 渲染区 */}
      <div ref={xtermHostRef} className="min-h-0 flex-1 w-full" />
    </div>
  );
}

export default IntegratedTerminal;
