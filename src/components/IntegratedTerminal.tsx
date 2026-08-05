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

// Why: Next.js rewrites 只代理 HTTP 请求，WebSocket 升级请求不会被转发。
// 所以必须直接连后端端口（8000），不能依赖当前页面的 host。
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

function buildWebSocketUrl(workspaceId: string, runId: string): string {
  // 从 API_BASE_URL 推导 WS 地址：http:// → ws://, https:// → wss://
  const wsProto = API_BASE_URL.startsWith('https') ? 'wss:' : 'ws:';
  const url = new URL(API_BASE_URL);
  return `${wsProto}//${url.host}/ws/terminal/${encodeURIComponent(workspaceId)}/${encodeURIComponent(runId)}`;
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

interface TermInstance {
  term: Terminal;
  fit: FitAddon;
  inputDisposable: { dispose: () => void };
  host: HTMLDivElement;
}

export function IntegratedTerminal(props: IntegratedTerminalProps) {
  const {
    workspaceId, activeRunId, onChangeActiveRunId,
    agentRuns, isManualTerminal, onCreateManual, onCloseTerminal,
    dark, allowUserStdin, onPropositionUpdate,
    trustedPrefixesByRun,
  } = props;

  const wsRef = useRef<WebSocket | null>(null);
  const attachRef = useRef<AttachAddon | null>(null);
  // Why: 每个 session 拥有独立的 xterm 实例，切换 runId 时只显示对应实例，
  // 避免多个终端输出叠加在同一个窗口里（用户反馈像"所有终端叠在一个窗口"）。
  const termMapRef = useRef<Map<string, TermInstance>>(new Map());
  const hostMapRef = useRef<Map<string, HTMLDivElement>>(new Map());
  // termRef / fitRef 始终指向当前 activeRunId 的实例，保持 WS effect 改动最小。
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [termReady, setTermReady] = useState(false);
  const [sessions, setSessions] = useState<TerminalSessionDescriptor[]>([]);
  const [proposition, setProposition] = useState<TerminalProposition | null>(null);
  const [propositionSecondConfirm, setPropositionSecondConfirm] = useState(false);
  const [editingCommand, setEditingCommand] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [trustThisCommand, setTrustThisCommand] = useState(false);
  const autoApprovedRef = useRef<Set<string>>(new Set());
  // Why: Fast Refresh 重建 term 时，输入绑定 onData 放在 term 创建 effect 里，回调需要读取最新的
  // allowUserStdin（手动/agent 切换），用 ref 保存避免闭包读到旧值。
  const allowStdinRef = useRef(allowUserStdin);
  allowStdinRef.current = allowUserStdin;
  // Why: 智能体终端 Tab 由持久化的 agentRuns 派生，后端 close 成功后 agentRuns 仍保留该 run，
  // 若不过滤，Tab 会一直留在列表里删不掉。这里记录已关闭的 agent run_id，
  // 从合并列表里排除，实现"点 × 即消失"。
  // 持久化到 localStorage（按 workspaceId 区分）：否则刷新/切 tab 组件重挂载后已删的终端又回来。
  const closedRunKey = `closed-agent-terminal:${workspaceId}`;
  const [closedAgentRunIds, setClosedAgentRunIds] = useState<Set<string>>(() => {
    try {
      const saved = window.localStorage.getItem(closedRunKey);
      if (saved) return new Set<string>(JSON.parse(saved) as string[]);
    } catch { /* noop */ }
    return new Set<string>();
  });

  // 组合 session 列表：后端 sessions（list 接口推的真实 ConPTY） + 前端已知但后端还没 spawn 的 agent run（保证用户没审批也能先看到 tab）
  // Why: 必须在 effect 之前定义，因为多实例终端管理 effect 依赖 allSessions。
  const allSessions = useMemo<TerminalSessionDescriptor[]>(() => {
    const byRunId = new Map<string, TerminalSessionDescriptor>();
    for (const s of sessions) {
      if (!closedAgentRunIds.has(s.run_id)) byRunId.set(s.run_id, s);
    }
    for (const run of agentRuns) {
      if (closedAgentRunIds.has(run.id)) continue;
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
    // Why: 用户点"+ 我的终端"会立即设置 activeRunId，但此时新 run 还没进入后端 sessions 列表，
    // 若 allSessions 里没有它，渲染区就不会生成 host div，term.open() 因找不到宿主而失败。
    // 把 activeRunId 预注入列表，确保 host div 始终存在。
    if (activeRunId && !closedAgentRunIds.has(activeRunId) && !byRunId.has(activeRunId)) {
      byRunId.set(activeRunId, {
        workspace_id: workspaceId,
        run_id: activeRunId,
        title: isManualTerminal(activeRunId) ? activeRunId.slice(-6) : `Agent ${activeRunId.slice(0, 8)}`,
        is_manual: isManualTerminal(activeRunId),
        exit_code: null,
      });
    }
    return Array.from(byRunId.values());
  }, [sessions, agentRuns, workspaceId, closedAgentRunIds, activeRunId, isManualTerminal]);

  useEffect(() => {
    try {
      window.localStorage.setItem(closedRunKey, JSON.stringify(Array.from(closedAgentRunIds)));
    } catch { /* noop */ }
  }, [closedRunKey, closedAgentRunIds]);

  // Why: 需求面板删除问答时上层会派发该事件，同步把对应 run_id 加入已关闭集合（移除终端 Tab）
  useEffect(() => {
    const handler = (e: Event) => {
      const runId = (e as CustomEvent<{ run_id?: string }>).detail?.run_id;
      if (!runId) return;
      setClosedAgentRunIds((prev) => new Set(prev).add(runId));
    };
    window.addEventListener('code-agent-terminal-close', handler);
    return () => window.removeEventListener('code-agent-terminal-close', handler);
  }, []);

  // 挂到父组件的提案回调（用于 agent_trace 里显示“正在等待用户选择终端命令审批”）
  useEffect(() => {
    onPropositionUpdate?.(proposition);
  }, [proposition, onPropositionUpdate]);

  // 1. 多实例终端管理：每个 session 拥有一个独立的 xterm 实例。
  // Why: 用户反馈"所有终端叠在一个窗口"，期望 VS Code 风格——每个 session 独立显示。
  // 切换 runId 时只显示对应实例，输出互不干扰；关闭/移除 session 时释放对应实例。
  useEffect(() => {
    const { theme, background, foreground } = termTheme(dark);

    // 清理已不存在的 session
    for (const [runId, inst] of termMapRef.current.entries()) {
      if (!allSessions.some((s) => s.run_id === runId)) {
        try { inst.inputDisposable.dispose(); } catch { /* noop */ }
        try { inst.term.dispose(); } catch { /* noop */ }
        termMapRef.current.delete(runId);
      }
    }

    // 主题变更时同步更新所有已创建实例的颜色
    for (const inst of termMapRef.current.values()) {
      inst.term.options.theme = theme;
      inst.host.style.backgroundColor = background;
      inst.host.style.color = foreground;
    }

    if (!activeRunId) {
      termRef.current = null;
      fitRef.current = null;
      setTermReady(false);
      return;
    }

    const host = hostMapRef.current.get(activeRunId);
    if (!host) {
      termRef.current = null;
      fitRef.current = null;
      setTermReady(false);
      return;
    }

    let inst = termMapRef.current.get(activeRunId);
    if (!inst) {
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
      const inputDisposable = term.onData((data) => {
        console.log('[terminal][input] onData allow=%s bytes=%d data=%s', allowStdinRef.current, data.length, JSON.stringify(data));
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        if (!allowStdinRef.current) {
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
      inst = { term, fit: fitAddon, inputDisposable, host };
      termMapRef.current.set(activeRunId, inst);
    }

    inst.host.style.backgroundColor = background;
    inst.host.style.color = foreground;
    inst.term.options.theme = theme;

    // 首次 open 时清掉 host 里可能残留的 .xterm（Fast Refresh 场景）。
    // Why: 必须延后到下一帧并确保 host 尺寸非 0，否则 xterm 在 display:none / 尺寸为 0 的容器上
    // open 会触发 Viewport._innerRefresh 读取 undefined.dimensions 的 TypeError。
    let openRaf: number | null = null;
    let openTimer: number | null = null;
    const tryOpenTerm = () => {
      if (!inst || inst.term.element) return;
      if (host.offsetWidth <= 0 || host.offsetHeight <= 0) {
        console.log('[terminal][open] skip: host size 0x0', host.offsetWidth, host.offsetHeight);
        openTimer = window.setTimeout(tryOpenTerm, 50);
        return;
      }
      console.log('[terminal][open] calling term.open size=%sx%s', host.offsetWidth, host.offsetHeight);
      host.querySelectorAll(':scope > .xterm').forEach((n) => n.remove());
      try {
        inst.term.open(host);
        inst.fit.fit();
        // Why: 新终端创建后默认不会自动获得焦点，用户需要手动点击才能输入；
        // 这里自动 focus，让"新建终端"后可以直接敲命令。
        inst.term.focus();
      } catch (err) {
        console.log('[terminal][open] term.open error:', err);
      }
    };
    openRaf = window.requestAnimationFrame(tryOpenTerm);
    openTimer = window.setTimeout(tryOpenTerm, 100);

    termRef.current = inst.term;
    fitRef.current = inst.fit;
    setTermReady(true);

    const ro = new ResizeObserver(() => {
      const active = termRef.current;
      if (!active) return;
      try { fitRef.current?.fit(); } catch { /* noop */ }
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'resize', cols: active.cols, rows: active.rows })); } catch { /* noop */ }
      }
    });
    ro.observe(host);

    const onWindowResize = () => {
      const active = termRef.current;
      if (!active) return;
      try { fitRef.current?.fit(); } catch { /* noop */ }
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'resize', cols: active.cols, rows: active.rows })); } catch { /* noop */ }
      }
    };
    window.addEventListener('resize', onWindowResize);

    return () => {
      if (openRaf !== null) cancelAnimationFrame(openRaf);
      if (openTimer !== null) window.clearTimeout(openTimer);
      ro.disconnect();
      window.removeEventListener('resize', onWindowResize);
      termRef.current = null;
      fitRef.current = null;
      setTermReady(false);
    };
  }, [allSessions, activeRunId, dark]);

  // 组件卸载（或 Fast Refresh 重建）时释放所有终端实例
  useEffect(() => {
    return () => {
      for (const inst of termMapRef.current.values()) {
        try { inst.inputDisposable.dispose(); } catch { /* noop */ }
        try { inst.term.dispose(); } catch { /* noop */ }
      }
      termMapRef.current.clear();
    };
  }, []);

  // 3. 根据 activeRunId 切换 WebSocket。
  // Why: 依赖 termReady 是因为 WebSocket 必须在 term.open() 成功后才能连接，
  // 否则 term.write() 会因 terminal 未就绪而抛出未捕获的异常。
  useEffect(() => {
    if (!activeRunId) return;
    if (!termReady) return;
    if (!termRef.current) return;

    // 关旧 WS
    try { attachRef.current?.dispose(); } catch { /* noop */ }
    attachRef.current = null;
    const oldWs = wsRef.current;
    if (oldWs && (oldWs.readyState === WebSocket.OPEN || oldWs.readyState === WebSocket.CONNECTING)) {
      try { oldWs.close(); } catch { /* noop */ }
    }
    wsRef.current = null;

    const url = buildWebSocketUrl(workspaceId, activeRunId);
    console.log('[terminal][ws] connecting url=%s workspaceId=%s runId=%s', url, workspaceId, activeRunId);
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      console.log('[terminal][ws] connection failed:', err);
      termRef.current?.writeln(`\r\n\x1b[31m[集成终端] 无法建立 WebSocket：${(err as Error).message}\x1b[0m`);
      return;
    }
    wsRef.current = ws;
    ws.onerror = (e) => { console.log('[terminal][ws] error event:', e); };
    ws.onclose = (e) => { console.log('[terminal][ws] closed code=%s reason=%s', e.code, e.reason); };

    // 开一条 attach 通道（xterm 输出由服务端推过来，用户输入则是“手动终端”时才会发）
    // 但 AttachAddon 默认会把所有 onData 都写 websocket，这里我们不直接用它的 attach，
    // 自己写一个更可控的监听：WS 的 pty_output 写到 term，term 的 onData 只有 allowUserStdin 才发。
    let destroyed = false;
    ws.onopen = () => {
      console.log('[terminal][ws] OPEN');
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
      // Why: 用 termRef.current 而非闭包 term——Fast Refresh / 组件重建时旧闭包 term 已被 dispose，
      // 但 termReady state 被保留导致 WS effect 不重跑，闭包 term.write 会失效（数据到了但不渲染=空白）。
      const liveTerm = termRef.current;
      if (!liveTerm) return;
      let payload: Partial<TerminalProposition> & {
        type?: string;
        data?: string;
        terminals?: TerminalSessionDescriptor[];
      } = { type: '' };
      try {
        payload = typeof ev.data === 'string' ? JSON.parse(ev.data) : { type: '' };
      } catch {
        // 非 JSON：当作原始 PTY 输出（兼容未来二进制）
        if (typeof ev.data === 'string') {
          console.log('[terminal][ws] raw text bytes=%d', ev.data.length);
          liveTerm.write(ev.data);
        }
        return;
      }
      switch (payload.type) {
        case 'pty_output':
          if (typeof payload.data === 'string') {
            console.log('[terminal][ws] pty_output bytes=%d sample=%s', payload.data.length, payload.data.slice(0, 60).replace(/\n/g, '\\n'));
            liveTerm.write(payload.data);
          }
          break;
        case 'list':
          if (Array.isArray(payload.terminals)) setSessions(payload.terminals);
          break;
        case 'proposition': {
          console.log('[terminal][ws] proposition received:', payload);
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
          console.log('[terminal][proposition] setProposition id=%s runId=%s command=%s status=%s', next.id, next.run_id, next.command, next.status);
          setProposition(next);
          setPropositionSecondConfirm(false);
          setEditingCommand(next.command);
          setTrustThisCommand(false);
          setShowEditor(false);
          break;
        }
        case 'error':
          termRef.current?.writeln(`\r\n\x1b[31m[集成终端] ${String(payload.data ?? '')}\x1b[0m`);
          break;
        default:
          break;
      }
    };
    ws.onclose = () => {
      if (destroyed) return;
      termRef.current?.writeln('\r\n\x1b[33m[集成终端] WebSocket 已断开。切换终端可重连。\x1b[0m');
    };

    // Why: 输入处理 onData 已在多实例 term 创建 effect 里按 runId 绑定到对应 Terminal 实例，
    // 此处不再重复绑定，避免每次 WS 重连都叠加一个 onData 导致同一按键发送多次。

    // 后端周期性广播 session list 也更新一次 UI：我们每次切 runId 主动请求一次 list。
    const listTimer = window.setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'list' })); } catch { /* noop */ }
      }
    }, 2000);

    return () => {
      destroyed = true;
      window.clearInterval(listTimer);
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
    console.log('[terminal][resolve] decision=%s ws=%s readyState=%s prop=%s', decision, ws ? 'yes' : 'no', ws?.readyState, proposition?.id);
    if (!ws || !proposition) return;
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      const payload = JSON.stringify({
        type: 'resolve',
        id: proposition.id,
        decision,
        edited_command: editedCommand,
        add_trust: Boolean(addTrust),
        second_confirm: Boolean(secondConfirm),
      });
      console.log('[terminal][resolve] sending payload=%s', payload);
      ws.send(payload);
    } catch (err) {
      console.log('[terminal][resolve] send error:', err);
    }
  }, [proposition]);

  const onApprove = () => {
    console.log('[terminal][onApprove] status=%s secondConfirm=%s', proposition?.status, propositionSecondConfirm);
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

  const onReject = () => {
    console.log('[terminal][onReject] prop=%s', proposition?.id);
    resolve('reject');
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
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
                onClick={onReject}
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
                <button
                  type="button"
                  title="关闭终端"
                  onClick={() => {
                  onCloseTerminal(s.run_id);
                  // Why: 手动终端由后端 sessions 驱动，close 后自动消失；
                  // 智能体终端 Tab 从 agentRuns 派生，需本地记录已关闭 run_id 才从列表移除。
                  setClosedAgentRunIds((prev) => new Set(prev).add(s.run_id));
                }}
                  className="rounded px-1 text-slate-500 opacity-60 hover:bg-slate-700 hover:text-rose-300 hover:opacity-100"
                >
                  ×
                </button>
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

      {/* xterm 渲染区：每个 session 一个独立的 host，通过 hidden 切换显示 */}
      <div className="relative min-h-[120px] w-full flex-1 overflow-hidden">
        {allSessions.length === 0 ? (
          <div className="flex h-full min-h-[180px] items-center justify-center text-xs text-slate-500">
            <div className="text-center">
              <p className="mb-2">暂无终端会话。</p>
              <button
                type="button"
                onClick={onCreateManual}
                className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 font-medium text-slate-200 hover:bg-slate-800"
              >
                + 新建手动终端
              </button>
            </div>
          </div>
        ) : allSessions.map((s) => {
          const { background, foreground } = termTheme(dark);
          return (
            <div
              key={s.run_id}
              ref={(el) => {
                if (el) hostMapRef.current.set(s.run_id, el);
                else hostMapRef.current.delete(s.run_id);
              }}
              className={`absolute inset-0 ${s.run_id === activeRunId ? '' : 'hidden'}`}
              style={{ backgroundColor: background, color: foreground }}
            />
          );
        })}
      </div>
    </div>
  );
}

export default IntegratedTerminal;
