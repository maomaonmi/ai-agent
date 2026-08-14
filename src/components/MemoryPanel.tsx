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
  listVfsCheckpoints,
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

type Tab = 'profile' | 'summary' | 'vfs' | 'skill' | 'events';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'profile', label: '档案卡' },
  { key: 'summary', label: '摘要' },
  { key: 'vfs', label: 'VFS' },
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

      {/* 子 Tab：档案卡 / 摘要 / VFS / Skill / 事件 */}
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