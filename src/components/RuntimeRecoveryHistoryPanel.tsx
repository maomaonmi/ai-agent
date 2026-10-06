'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  appendRecoveryHistoryPage,
  describeRemainingRoutes,
  recoveryStatusLabel,
} from '../Code/recoveryHistory.ts';

interface RecoveryActionEvaluation {
  action_id: string;
  executor_id: string;
  lane_id: string;
  status: string;
  reason_codes: string[];
  based_on_revision?: string;
  current_revision?: string;
  operation_version?: number | null;
  related_attempt_id?: string;
  applicable_obligation_ids: string[];
}

interface StopDecisionRecord {
  decision_id: string;
  run_id: string;
  scope: string;
  disposition: string;
  reason_code: string;
  based_on_operation_version: number;
  decided_at_ms: number;
  unresolved_obligation_ids: string[];
  attempted_attempt_ids: string[];
  remaining_executor_ids: string[];
  remaining_agent_action_ids: string[];
  required_external_inputs: string[];
  resume_condition: string;
  executor_evaluation_status: string;
  action_evaluations: RecoveryActionEvaluation[];
  candidate_inventory_status: string;
  expected_candidate_source_ids: string[];
  candidate_source_evaluations: Array<{
    source_id: string;
    status: string;
    reason_codes: string[];
    candidate_action_ids: string[];
  }>;
}

interface RecoveryAttemptRecord {
  attempt_id: string;
  run_id: string;
  action_id: string;
  executor_id: string;
  lane_id: string;
  status: string;
  attempt_number: number;
  started_at_ms: number;
  completed_at_ms: number | null;
  candidate_revision: string;
  based_on_operation_version: number | null;
  side_effect_class: string;
  required_authorizations: string[];
  error_code: string;
}

type RecoveryHistoryItem =
  | {
      kind: 'attempt';
      event_type: string;
      sequence: number;
      timestamp_ms: number;
      record: RecoveryAttemptRecord;
    }
  | {
      kind: 'stop_decision';
      event_type: string;
      sequence: number;
      timestamp_ms: number;
      record: StopDecisionRecord;
    };

interface RecoveryHistoryResponse {
  operation: {
    operation_id: string;
    lifecycle: string;
    version: number;
    source_run_id: string | null;
  };
  current_inventory: {
    status: string;
    remaining_routes_status: string;
    scope_id: string;
    scope_contract_valid?: boolean | null;
    lane_state: string;
    snapshot: Record<string, unknown>;
    source_evaluations: Array<{
      source_id?: string;
      status?: string;
      reason_codes?: string[];
      candidate_action_ids?: string[];
    }>;
    attempted_routes: Array<Record<string, unknown>>;
    remaining_routes: Array<unknown>;
    remaining_executor_ids: string[];
    remaining_agent_action_ids: string[];
    stop_decision: StopDecisionRecord | null;
    attempt_count: number;
  };
  items: RecoveryHistoryItem[];
  next_after_sequence: number;
  has_more: boolean;
}

interface RuntimeRecoveryHistoryPanelProps {
  operationId: string;
  sessionId: string;
  runId: string;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

function formatTimestamp(timestampMs: number): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return '时间未知';
  return new Date(timestampMs).toLocaleString();
}

async function requestRecoveryHistory(
  operationId: string,
  sessionId: string,
  afterSequence: number,
  signal?: AbortSignal,
): Promise<RecoveryHistoryResponse> {
  const query = new URLSearchParams({
    session_id: sessionId,
    after_sequence: String(afterSequence),
    limit: '30',
  });
  const response = await fetch(
    `${API_BASE_URL}/api/code/operations/${encodeURIComponent(operationId)}/recovery-history?${query}`,
    { method: 'GET', cache: 'no-store', signal },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: unknown } | null;
    const message = typeof body?.detail === 'string' ? body.detail : `读取失败 (${response.status})`;
    throw new Error(message);
  }
  return response.json() as Promise<RecoveryHistoryResponse>;
}

export default function RuntimeRecoveryHistoryPanel({
  operationId,
  sessionId,
  runId,
}: RuntimeRecoveryHistoryPanelProps) {
  const [history, setHistory] = useState<RecoveryHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const result = await requestRecoveryHistory(operationId, sessionId, 0, signal);
      if (!signal?.aborted) setHistory(result);
    } catch (requestError) {
      if (!signal?.aborted) {
        setError(requestError instanceof Error ? requestError.message : '恢复记录读取失败');
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [operationId, sessionId]);

  useEffect(() => {
    const controller = new AbortController();
    setHistory(null);
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload, runId]);

  const loadMore = async () => {
    if (!history?.has_more || loadingMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const result = await requestRecoveryHistory(
        operationId,
        sessionId,
        history.next_after_sequence,
      );
      setHistory((current) => current ? {
        ...result,
        items: appendRecoveryHistoryPage(current.items, result.items),
      } : result);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '更早的恢复记录读取失败');
    } finally {
      setLoadingMore(false);
    }
  };

  const currentInventory = history?.current_inventory;
  const currentDecision = currentInventory?.stop_decision;
  const latestSnapshot = currentInventory?.snapshot ?? {};
  const snapshotRunId = String(latestSnapshot.run_id ?? currentDecision?.run_id ?? '未记录');
  const snapshotId = String(latestSnapshot.snapshot_id ?? '未记录');

  return (
    <details className="mt-3 rounded-xl border border-amber-200 bg-amber-50/70 text-sm text-slate-700">
      <summary className="cursor-pointer list-none px-3.5 py-3 font-medium text-amber-900">
        Runtime 恢复历史
        <span className="ml-2 text-xs font-normal text-amber-700">
          {loading ? '读取中…' : `尝试 ${currentInventory?.attempt_count ?? 0} 次 · 记录 ${history?.items.length ?? 0} 条`}
        </span>
      </summary>
      <div className="space-y-3 border-t border-amber-200 px-3.5 py-3">
        {error && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
            <span>{error}</span>
            <button type="button" onClick={() => void reload()} className="shrink-0 underline">重试</button>
          </div>
        )}
        {loading && !history && <p className="text-xs text-slate-500">正在读取该 operation 的持久恢复记录…</p>}
        {history && (
          <>
            <section className="rounded-lg border border-white/80 bg-white/80 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-semibold text-slate-800">当前路线盘点</h4>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                  来源状态：{recoveryStatusLabel(currentInventory?.status ?? 'not_enumerated')}
                </span>
              </div>
              <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                <div><dt className="inline text-slate-500">operation：</dt><dd className="inline break-all font-mono">{history.operation.operation_id}</dd></div>
                <div><dt className="inline text-slate-500">生命周期：</dt><dd className="inline">{history.operation.lifecycle} · v{history.operation.version}</dd></div>
                <div><dt className="inline text-slate-500">盘点范围：</dt><dd className="inline">{currentInventory?.scope_id || currentDecision?.scope || '未知'}</dd></div>
                <div><dt className="inline text-slate-500">lane 状态：</dt><dd className="inline">{currentInventory?.lane_state || '未知'}</dd></div>
                <div><dt className="inline text-slate-500">范围契约：</dt><dd className="inline">{currentInventory?.scope_contract_valid === true ? '有效' : currentInventory?.scope_contract_valid === false ? '无效' : '未记录'}</dd></div>
                <div><dt className="inline text-slate-500">候选快照：</dt><dd className="inline break-all font-mono">{String(latestSnapshot.candidate_revision ?? currentDecision?.action_evaluations[0]?.current_revision ?? '未记录')}</dd></div>
                <div><dt className="inline text-slate-500">快照身份：</dt><dd className="inline break-all font-mono">{snapshotId}</dd></div>
                <div><dt className="inline text-slate-500">快照 run / 版本：</dt><dd className="inline break-all font-mono">{snapshotRunId} / {String(latestSnapshot.operation_version ?? currentDecision?.based_on_operation_version ?? '未记录')}</dd></div>
                <div className="sm:col-span-2"><dt className="inline text-slate-500">剩余路线：</dt><dd className="inline">{currentInventory ? describeRemainingRoutes(currentInventory) : '未知'}</dd></div>
              </dl>

              {currentInventory?.source_evaluations.length ? (
                <div className="mt-3 space-y-1.5">
                  <p className="text-xs font-medium text-slate-600">候选来源</p>
                  {currentInventory.source_evaluations.map((source, index) => (
                    <div key={`${source.source_id ?? 'source'}-${index}`} className="rounded-md bg-slate-50 px-2.5 py-2 text-xs">
                      <div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
                        <span className="font-mono">{source.source_id || '来源未命名'}</span>
                        <span>{recoveryStatusLabel(source.status ?? 'unknown')}</span>
                      </div>
                      {source.reason_codes?.length ? <p className="mt-1 text-slate-500">原因：{source.reason_codes.join('、')}</p> : null}
                      {source.candidate_action_ids?.length ? <p className="mt-1 break-all text-slate-500">候选动作：{source.candidate_action_ids.join('、')}</p> : null}
                    </div>
                  ))}
                </div>
              ) : null}

              {currentInventory?.attempted_routes.length ? (
                <div className="mt-3 space-y-1.5">
                  <p className="text-xs font-medium text-slate-600">路线尝试</p>
                  {currentInventory.attempted_routes.map((route, index) => (
                    <pre key={`route-${index}`} className="overflow-x-auto rounded-md bg-slate-900 px-2.5 py-2 text-[11px] leading-5 text-slate-100">
                      {JSON.stringify(route, null, 2)}
                    </pre>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs text-slate-500">当前清单未记录已派发路线；请结合下面的持久尝试记录和盘点完整度判断。</p>
              )}
            </section>

            {currentDecision && (
              <section className="rounded-lg border border-white/80 bg-white/80 p-3">
                <h4 className="font-semibold text-slate-800">最近 StopDecision</h4>
                <p className="mt-1 text-xs">
                  {currentDecision.disposition === 'stop' ? '停止' : recoveryStatusLabel(currentDecision.disposition)} · 原因码 <code>{currentDecision.reason_code}</code> · {formatTimestamp(currentDecision.decided_at_ms)}
                </p>
                <p className="mt-1 text-xs text-slate-600">执行器枚举：{recoveryStatusLabel(currentDecision.executor_evaluation_status)}；候选清单：{recoveryStatusLabel(currentDecision.candidate_inventory_status)}</p>
                {currentDecision.resume_condition && <p className="mt-2 text-xs leading-5 text-slate-600">恢复条件：{currentDecision.resume_condition}</p>}
                {currentDecision.required_external_inputs.length > 0 && <p className="mt-1 text-xs text-slate-600">需要外部输入：{currentDecision.required_external_inputs.join('、')}</p>}
              </section>
            )}

            <section>
              <h4 className="mb-2 font-semibold text-slate-800">持久尝试与决策事件</h4>
              {history.items.length === 0 ? (
                <p className="rounded-lg bg-white/80 px-3 py-2 text-xs text-slate-500">此 operation 尚无已持久化的恢复尝试或 StopDecision 事件。</p>
              ) : (
                <ol className="space-y-2">
                  {history.items.map((item) => item.kind === 'attempt' ? (
                    <li key={`${item.sequence}-${item.record.attempt_id}`} className="rounded-lg bg-white/90 px-3 py-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <strong>恢复尝试 · {recoveryStatusLabel(item.record.status)}</strong>
                        <time>{formatTimestamp(item.timestamp_ms || item.record.started_at_ms)}</time>
                      </div>
                      <p className="mt-1 break-all text-xs text-slate-600">{item.record.executor_id} / {item.record.action_id} · lane {item.record.lane_id} · 第 {item.record.attempt_number} 次</p>
                      <p className="mt-1 break-all font-mono text-[11px] text-slate-500">attempt {item.record.attempt_id} · run {item.record.run_id}</p>
                      <p className="mt-1 break-all text-[11px] text-slate-500">候选 {item.record.candidate_revision || '未记录'} · operation v{item.record.based_on_operation_version ?? '未知'} · side effect {item.record.side_effect_class}</p>
                      {item.record.error_code && <p className="mt-1 text-xs text-rose-700">错误码：{item.record.error_code}</p>}
                    </li>
                  ) : (
                    <li key={`${item.sequence}-${item.record.decision_id}`} className="rounded-lg bg-white/90 px-3 py-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <strong>StopDecision · {recoveryStatusLabel(item.record.disposition)}</strong>
                        <time>{formatTimestamp(item.timestamp_ms || item.record.decided_at_ms)}</time>
                      </div>
                      <p className="mt-1 break-all text-xs text-slate-600">{item.record.reason_code} · {item.record.scope} · run {item.record.run_id}</p>
                      <p className="mt-1 text-xs text-slate-600">未解决 obligation：{item.record.unresolved_obligation_ids.length ? item.record.unresolved_obligation_ids.join('、') : '无'}</p>
                      <p className="mt-1 text-xs text-slate-600">已尝试 attempt：{item.record.attempted_attempt_ids.length ? item.record.attempted_attempt_ids.join('、') : '无'}</p>
                      {item.record.action_evaluations.length > 0 && (
                        <ul className="mt-2 space-y-1 border-l-2 border-slate-200 pl-2 text-[11px] text-slate-500">
                          {item.record.action_evaluations.map((evaluation) => (
                            <li key={evaluation.action_id}>
                              {evaluation.executor_id} / {evaluation.action_id}：{recoveryStatusLabel(evaluation.status)}（{evaluation.reason_codes.join('、')}）
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ol>
              )}
              {history.has_more && (
                <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="mt-2 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 disabled:opacity-50">
                  {loadingMore ? '读取中…' : '读取更多记录'}
                </button>
              )}
            </section>
          </>
        )}
      </div>
    </details>
  );
}
