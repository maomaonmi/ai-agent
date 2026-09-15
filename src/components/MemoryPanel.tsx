'use client';

// Why: Phase3 记忆面板——集中展示当前会话的四层记忆：
// 第2层档案卡 + 第3层摘要 + VFS Checkpoint + 追加账本事件，外加 Skill 胶囊。
// sessionId 从 localStorage 读取（ChatInterface 写入 activeSessionId），避免向
// CodeWorkspace 层层透传 props。
import { useCallback, useEffect, useState } from 'react';
import {
  clearSessionMemory,
  deleteMemorySummary,
  deleteProfileCard,
  deleteVfsCheckpoint,
  getMemoryEvents,
  getMemorySummaries,
  getProfileCards,
  enqueueGoldenTraceEvaluation,
  listGoldenTraces,
  setGoldenTraceStatus,
  listVfsCheckpoints,
  type GoldenTraceCase,
  type MemoryEvent,
  type MemorySummary,
  type ProfileCard,
  type VFSCheckpointMeta,
} from '../lib/api';
import SkillInspector from './SkillInspector';

// Why: 档案卡 field_value 可能是任意 JSON 对象，统一转成可读字符串展示。
function valueToString(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  try {
    const s = JSON.stringify(value);
    return s && s.length > 120 ? `${s.slice(0, 120)}…` : s ?? '—';
  } catch {
    return String(value);
  }
}

function formatTime(ts: number): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false });
}

function goldenEvaluationLabel(status: string | undefined): string {
  switch (status) {
    case 'passed': return '通过';
    case 'failed': return '失败';
    case 'blocked': return '阻塞';
    case 'running': return '执行中';
    case 'queued': return '排队中';
    case 'cancelled': return '已取消';
    default: return '未评估';
  }
}

type Tab = 'profile' | 'summary' | 'vfs' | 'golden' | 'skill' | 'events';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'profile', label: '档案卡' },
  { key: 'summary', label: '摘要' },
  { key: 'vfs', label: 'VFS' },
  { key: 'golden', label: 'Golden' },
  { key: 'skill', label: 'Skill' },
  { key: 'events', label: '事件' },
];

function getSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('activeSessionId');
}

// Why 抽公共组件: 四个 Tab 的行级删除交互一致（confirm + busy 态 + 触发刷新），
// 三处以上重复即违反 DRY，收敛为单组件。事件 Tab 保持 append-only 不渲染删除。
function RowDeleteButton({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        if (!window.confirm('确定删除该条记录？')) return;
        setBusy(true);
        void onConfirm().finally(() => setBusy(false));
      }}
      className="rounded border border-red-200 bg-white px-1.5 py-0.5 text-[10px] text-red-600 hover:bg-red-50 disabled:opacity-50"
    >
      {busy ? '删除中' : '删除'}
    </button>
  );
}

export default function MemoryPanel() {
  const [tab, setTab] = useState<Tab>('profile');
  const [sessionId, setSessionId] = useState<string | null>(() => getSessionId());

  const [profile, setProfile] = useState<Record<string, unknown>>({});
  const [cards, setCards] = useState<ProfileCard[]>([]);
  const [summaries, setSummaries] = useState<MemorySummary[]>([]);
  const [checkpoints, setCheckpoints] = useState<VFSCheckpointMeta[]>([]);
  const [goldenTraces, setGoldenTraces] = useState<GoldenTraceCase[]>([]);
  const [goldenTraceError, setGoldenTraceError] = useState<string | null>(null);
  const [goldenTraceBusy, setGoldenTraceBusy] = useState<string | null>(null);
  const [goldenTraceNotice, setGoldenTraceNotice] = useState<string | null>(null);
  const [events, setEvents] = useState<MemoryEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const sid = getSessionId();
    setSessionId(sid);
    if (!sid) {
      setError('未找到当前会话，请先开始一个会话。');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [profileRes, summaryRes, vfsRes, eventRes] = await Promise.all([
        getProfileCards(sid),
        getMemorySummaries(sid),
        listVfsCheckpoints(sid, 10),
        getMemoryEvents(sid, 50),
      ]);
      setProfile(profileRes.profile);
      setCards(profileRes.cards);
      setSummaries(summaryRes.summaries);
      setCheckpoints(vfsRes.checkpoints);
      setEvents(eventRes.events);
      try {
        const goldenRes = await listGoldenTraces({ page: 1, pageSize: 50 });
        setGoldenTraces(goldenRes.data);
        setGoldenTraceError(null);
      } catch (e) {
        // Golden Trace is an additive memory capability; an older backend
        // should not make the existing memory tabs unusable during rollout.
        setGoldenTraceError(e instanceof Error ? e.message : 'Golden Trace 暂不可用');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载记忆数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Why 统一入口: 删除失败统一落到 error 态展示，成功后走 loadAll 全量刷新，
  // 避免手工维护五个局部状态的同步删除。
  const runDelete = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        await loadAll();
      } catch (e) {
        setError(e instanceof Error ? e.message : '删除失败');
      }
    },
    [loadAll],
  );

  const handleReplay = useCallback(async (item: GoldenTraceCase) => {
    setGoldenTraceBusy(item.case_id);
    setGoldenTraceNotice(null);
    setGoldenTraceError(null);
    try {
      const clientRequestId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `golden-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await enqueueGoldenTraceEvaluation(item.case_id, {
        clientRequestId,
        mode: 'replay',
      });
      const evaluationLabel = goldenEvaluationLabel(result.evaluation.status);
      setGoldenTraceNotice(result.existing
        ? `${item.title}：该回放请求已存在，当前状态：${evaluationLabel}。`
        : `${item.title}：回放评估${evaluationLabel}。`);
      await loadAll();
    } catch (e) {
      setGoldenTraceError(e instanceof Error ? e.message : '回放评估失败');
    } finally {
      setGoldenTraceBusy(null);
    }
  }, [loadAll]);

  const handleGoldenStatus = useCallback(async (
    item: GoldenTraceCase,
    status: 'draft' | 'golden' | 'retired',
  ) => {
    setGoldenTraceBusy(`${status}:${item.case_id}`);
    setGoldenTraceNotice(null);
    setGoldenTraceError(null);
    try {
      const result = await setGoldenTraceStatus(item.case_id, status);
      setGoldenTraces((previous) => previous.map((candidate) => (
        candidate.case_id === item.case_id
          ? { ...result.case, latest_evaluation: candidate.latest_evaluation }
          : candidate
      )));
      setGoldenTraceNotice(
        status === 'golden'
          ? 'Golden Trace 已上架。'
          : status === 'draft'
            ? 'Golden Trace 已恢复为草稿。'
            : 'Golden Trace 已退役。',
      );
    } catch (e) {
      setGoldenTraceError(e instanceof Error ? e.message : 'Golden Trace 状态更新失败');
    } finally {
      setGoldenTraceBusy(null);
    }
  }, []);

  // 清空会话全部记忆（核弹操作）：二次确认，Skill 为全局资产不受影响。
  const handleClearAll = useCallback(() => {
    const sid = getSessionId();
    if (!sid) return;
    if (!window.confirm('确定清空当前会话的全部记忆？（事件/摘要/档案卡/VFS，不含全局 Skill）')) return;
    if (!window.confirm('此操作不可恢复，请再次确认。')) return;
    void runDelete(() => clearSessionMemory(sid));
  }, [runDelete]);

  // Why: 监听 useCodeAutoRepair 从 SSE memory_update 派发的 window 事件，
  // 记忆变更时自动刷新面板，避免手动点刷新。
  useEffect(() => {
    const onMemoryUpdated = () => {
      void loadAll();
    };
    window.addEventListener('memory-updated', onMemoryUpdated);
    return () => window.removeEventListener('memory-updated', onMemoryUpdated);
  }, [loadAll]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">🧠 记忆</h3>
        <div className="flex items-center gap-2">
          <span className="max-w-[160px] truncate font-mono text-[10px] text-slate-400">
            {sessionId ?? '未关联会话'}
          </span>
          <button
            type="button"
            onClick={() => void loadAll()}
            className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
          >
            刷新
          </button>
          {sessionId && (
            <button
              type="button"
              onClick={handleClearAll}
              className="rounded border border-red-200 bg-white px-2 py-0.5 text-[11px] text-red-600 hover:bg-red-50"
            >
              清空
            </button>
          )}
        </div>
      </div>

      {/* 子 Tab：档案卡 / 摘要 / VFS / Golden / Skill / 事件 */}
      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
              tab === t.key
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && <div className="py-6 text-center text-xs text-slate-400">加载中...</div>}
      {error && !loading && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && tab === 'skill' && <SkillInspector />}

      {!loading && !error && tab === 'golden' && (
        <div className="space-y-2">
          {goldenTraceNotice && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              {goldenTraceNotice}
            </div>
          )}
          {goldenTraceError && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {goldenTraceError}
            </div>
          )}
          {goldenTraces.length === 0 && !goldenTraceError && (
            <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm leading-6 text-slate-500">
              暂无 Golden Trace。请在通过真实浏览器验收的 AgentLoop 时间线上保存成功轨迹。
            </div>
          )}
          {goldenTraces.map((item) => (
            <div key={item.case_id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-slate-800" title={item.title}>{item.title}</div>
                  <div className="mt-1 truncate font-mono text-[10px] text-slate-400" title={item.case_id}>
                    {item.case_id} · 来源 {item.source_quality === 'complete' ? '完整轨迹' : '摘要轨迹'}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${item.quality_state === 'invalidated' ? 'bg-rose-50 text-rose-700' : item.status === 'golden' ? 'bg-emerald-50 text-emerald-700' : item.status === 'retired' ? 'bg-slate-100 text-slate-500' : 'bg-amber-50 text-amber-700'}`}>
                    {item.quality_state === 'invalidated' ? '已失效' : item.status === 'golden' ? '已上架' : item.status === 'retired' ? '已退役' : '待确认'}
                  </span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${item.latest_evaluation?.status === 'passed' ? 'bg-emerald-50 text-emerald-700' : item.latest_evaluation?.status === 'failed' || item.latest_evaluation?.status === 'blocked' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>
                    回放 · {goldenEvaluationLabel(item.latest_evaluation?.status)}
                  </span>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-slate-400">
                <span>范围 · {item.contract.required_scope}</span>
                <div className="flex items-center gap-1.5">
                  {item.status === 'draft' && item.quality_state !== 'invalidated' && (
                    <>
                      <button
                        type="button"
                        disabled={goldenTraceBusy === `golden:${item.case_id}`}
                        onClick={() => void handleGoldenStatus(item, 'golden')}
                        className="rounded border border-emerald-200 bg-white px-2 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                      >
                        上架
                      </button>
                      <button
                        type="button"
                        disabled={goldenTraceBusy === `retired:${item.case_id}`}
                        onClick={() => void handleGoldenStatus(item, 'retired')}
                        className="rounded border border-rose-200 bg-white px-2 py-1 text-[10px] font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                      >
                        退役
                      </button>
                    </>
                  )}
                  {item.status === 'retired' && item.quality_state !== 'invalidated' && (
                    <button
                      type="button"
                      disabled={goldenTraceBusy === `draft:${item.case_id}`}
                      onClick={() => void handleGoldenStatus(item, 'draft')}
                      className="rounded border border-amber-200 bg-white px-2 py-1 text-[10px] font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                    >
                      恢复草稿
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={goldenTraceBusy === item.case_id}
                    onClick={() => void handleReplay(item)}
                    className="rounded border border-blue-200 bg-white px-2 py-1 text-[10px] font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                  >
                    {goldenTraceBusy === item.case_id ? '评估中…' : '回放评估'}
                  </button>
                </div>
              </div>
              {item.quality_state === 'invalidated' && item.invalidated_reason && (
                <div className="mt-2 rounded border border-rose-100 bg-rose-50/70 px-2 py-1.5 text-[10px] leading-relaxed text-rose-700">
                  已从可复用记忆移除 · {item.invalidated_reason}
                </div>
              )}
              <div className="mt-3 grid gap-2 text-[10px] leading-relaxed text-slate-600 sm:grid-cols-2">
                <div className="rounded border border-violet-100 bg-violet-50/60 px-2 py-1.5">
                  <div className="font-medium text-violet-700">Semantic Trace · 可复用策略</div>
                  <div className="mt-0.5">
                    根因 · {item.semantic_trace?.root_cause_category || '未归纳'}
                  </div>
                  <div>
                    验收 · {item.semantic_trace?.verification_strategy?.join(' → ') || '—'}
                  </div>
                  <div>
                    成功标准 · {item.semantic_trace?.success_criteria?.join('、') || '—'}
                  </div>
                </div>
                <div className="rounded border border-slate-200 bg-slate-50/70 px-2 py-1.5">
                  <div className="font-medium text-slate-700">Concrete Trace · 本次证据</div>
                  <div className="mt-0.5">
                    读取 {item.concrete_trace?.read_count ?? item.concrete_trace?.read_order?.length ?? 0} 次 · 工具 {item.concrete_trace?.tool_order?.length ?? 0} 次
                  </div>
                  <div>
                    修改文件 · {valueToString(item.concrete_trace?.patch?.changed_files)}
                  </div>
                  <div>
                    浏览器 · {valueToString(item.concrete_trace?.browser_evidence?.browser_run_id)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && !error && tab === 'profile' && (
        <div className="space-y-3">
          {cards.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm leading-6 text-slate-500">
              暂无档案卡。Agent 成功完成修改后会自动记录项目画像。
            </div>
          )}
          {cards.map((card, i) => {
            const isCurrent = card.valid_end > Date.now() / 1000;
            return (
              <div
                key={`${card.field_key}-${i}`}
                className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                    {card.field_key}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {isCurrent && (
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">
                        生效中
                      </span>
                    )}
                    <span className="text-[10px] text-slate-400">{card.source}</span>
                  </div>
                </div>
                <div className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-700">
                  {valueToString(card.field_value)}
                </div>
                <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                  <span>生效 {formatTime(card.valid_start)}</span>
                  <span className="flex items-center gap-2">
                    {isCurrent ? '至今' : `失效 ${formatTime(card.valid_end)}`}
                    {/* Why 仅失效卡可删: 生效卡是 build_context 输入，后端同样拒绝（409） */}
                    {!isCurrent && (
                      <RowDeleteButton
                        onConfirm={() => runDelete(() => deleteProfileCard(card.card_id))}
                      />
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && !error && tab === 'summary' && (
        <div className="space-y-3">
          {summaries.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm leading-6 text-slate-500">
              暂无对话摘要。
            </div>
          )}
          {summaries.map((s) => (
            <div
              key={s.summary_id}
              className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
            >
              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span>轮次 {s.turn_start}–{s.turn_end}</span>
                <span className="flex items-center gap-2">
                  {formatTime(s.created_at)}
                  <RowDeleteButton
                    onConfirm={() => runDelete(() => deleteMemorySummary(s.summary_id))}
                  />
                </span>
              </div>
              {s.topics.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {s.topics.map((t) => (
                    <span
                      key={t}
                      className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-700">
                {s.summary_text}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && !error && tab === 'vfs' && (
        <div className="space-y-2">
          {checkpoints.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm leading-6 text-slate-500">
              暂无 VFS Checkpoint。每次成功 patch 后会自动保存快照。
            </div>
          )}
          {checkpoints.map((cp) => (
            <div
              key={cp.checkpoint_id}
              className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm"
            >
              <div className="min-w-0">
                <div className="font-mono text-[11px] text-slate-700">
                  #{cp.checkpoint_id} · {cp.run_id || '—'}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-400">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5">{cp.trigger_reason}</span>
                  {cp.is_compressed && (
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">
                      zlib 压缩
                    </span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-[10px] text-slate-400">{formatTime(cp.created_at)}</span>
                <RowDeleteButton
                  onConfirm={() => runDelete(() => deleteVfsCheckpoint(cp.checkpoint_id))}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && !error && tab === 'events' && (
        <div className="space-y-2">
          {events.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm leading-6 text-slate-500">
              暂无事件记录。
            </div>
          )}
          {events.map((ev) => (
            <div
              key={ev.event_id}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                  {ev.event_type}
                </span>
                <span className="text-[10px] text-slate-400">{formatTime(ev.created_at)}</span>
              </div>
              <div className="mt-1.5 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-600">
                {valueToString(ev.event_data)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
