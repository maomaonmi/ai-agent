'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CodeObservatoryApiError,
  getCodeObservatoryOperationSnapshot,
  type CodeObservatoryOperationSnapshot,
} from '../lib/codeObservatoryApi';
import type { CodeAgentRun } from '../lib/api';
import { projectCodeObservatoryRunRelations } from '../Code/runRelations';
import { projectOperationUsage } from '../Code/operationUsage';

const RELATION_LABELS = {
  execution_claim: '执行声明',
  execution_takeover: '崩溃恢复接管',
  resume: '显式恢复',
  verification: '验证子执行',
  repair_authorization: '修复授权',
} as const;

const BINDING_LABELS = {
  explicit: '来源明确',
  candidate_match: '候选匹配',
  candidate_mismatch: '候选不匹配',
  verification_missing: '验证来源缺失',
  identity_mismatch: '授权身份不一致',
} as const;

const EPOCH_BINDING_LABELS = {
  matched: 'epoch 匹配',
  mismatched: 'epoch 不匹配',
  unknown: 'epoch 未知',
} as const;

const ATTEMPT_LABELS: Record<string, string> = {
  started: '已开始，结果待确认',
  completed: '已完成',
  failed: '失败',
  unknown: '结果未知',
  cancelled: '已取消',
};

const ASSOCIATION_LABELS = {
  explicit_event: '持久事件',
  operation_projection: 'Operation 恢复记录',
  current_pointer: '当前 Run 指针',
} as const;

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; snapshot: CodeObservatoryOperationSnapshot }
  | { status: 'error'; message: string };

function errorMessage(error: unknown): string {
  if (error instanceof CodeObservatoryApiError && error.code === 'NOT_FOUND') {
    return 'Operation 尚无可读取的持久记录。';
  }
  if (error instanceof CodeObservatoryApiError && error.code === 'PROJECTION_INCOMPLETE') {
    return 'Operation 正在变化，刷新后可重新读取一致快照。';
  }
  return 'Operation 关系读取失败，请刷新链路面板重试。';
}

export function OperationRelationsInspector({
  operationId,
  focusedRunId,
  agentRuns,
}: {
  operationId: string;
  focusedRunId: string;
  agentRuns: CodeAgentRun[];
}) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    void getCodeObservatoryOperationSnapshot(operationId, controller.signal).then(
      (snapshot) => {
        if (!controller.signal.aborted) setState({ status: 'ready', snapshot });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'error', message: errorMessage(error) });
      },
    );
    return () => controller.abort();
  }, [operationId]);

  const projection = useMemo(() => state.status === 'ready'
    ? projectCodeObservatoryRunRelations(state.snapshot, operationId, focusedRunId)
    : null, [focusedRunId, operationId, state]);
  const usage = useMemo(() => projection
    ? projectOperationUsage(operationId, projection.operation.runs, agentRuns)
    : null, [agentRuns, operationId, projection]);

  if (state.status === 'loading') {
    return <div className="p-4 text-xs text-slate-500">正在读取 Operation 持久关系…</div>;
  }
  if (state.status === 'error') {
    return <div role="status" className="p-4 text-xs text-amber-700 dark:text-amber-300">{state.message}</div>;
  }
  if (!projection) {
    return <div role="status" className="p-4 text-xs text-amber-700 dark:text-amber-300">Operation 身份不匹配，已隐藏关联信息。</div>;
  }

  const { operation } = projection;
  const budget = operation.recovery_budget;
  const usageCoverageLabel = usage?.coverage === 'complete'
    ? '完整'
    : usage?.coverage === 'partial'
      ? '部分记录'
      : '暂无记录';
  return (
    <div className="space-y-4 p-3 text-xs text-slate-700 dark:text-slate-200">
      <section aria-labelledby="operation-overview-title" className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <h3 id="operation-overview-title" className="font-semibold">Operation 聚合</h3>
        <p className="mt-1 break-all font-mono text-[10px] text-slate-500">{operation.operation_id}</p>
        <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
          <span className="rounded bg-slate-100 px-2 py-1 dark:bg-slate-800">状态 · {operation.lifecycle ?? '未知'}</span>
          <span className="rounded bg-slate-100 px-2 py-1 dark:bg-slate-800">版本 · {operation.version ?? '未知'}</span>
          <span className="rounded bg-slate-100 px-2 py-1 dark:bg-slate-800">Claim generation · {operation.execution_generation ?? '未知'}</span>
          <span className="rounded bg-slate-100 px-2 py-1 dark:bg-slate-800">
            恢复预算 · {budget.takeovers_used ?? '未知'} / {budget.takeovers_limit ?? '未知'} · {budget.status === 'available' ? '可用' : budget.status === 'exhausted' ? '已耗尽' : '未记录'}
          </span>
        </div>
        {!projection.focusedRunFound && (
          <p className="mt-2 text-[10px] text-amber-700 dark:text-amber-300">当前 Run 尚未出现在 Operation 持久关系中；没有按名称或时间补连。</p>
        )}
      </section>

      {usage && (
        <section aria-labelledby="operation-usage-title" className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="operation-usage-title" className="font-semibold">Operation 用量</h3>
            <span className="rounded bg-slate-100 px-2 py-1 text-[10px] dark:bg-slate-800">
              {usageCoverageLabel} · {usage.recordedRunCount}/{usage.associatedRunCount} 个关联 Run
            </span>
          </div>
          {usage.totalTokens === null ? (
            <p role="status" className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">
              暂无可读取的 Run token telemetry；这不代表零消耗。
            </p>
          ) : (
            <>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] sm:grid-cols-3">
                <div><dt className="text-slate-500">输入 tokens</dt><dd className="font-medium">{usage.promptTokens?.toLocaleString() ?? '未报告'}</dd></div>
                <div><dt className="text-slate-500">输出 tokens</dt><dd className="font-medium">{usage.completionTokens?.toLocaleString() ?? '未报告'}</dd></div>
                <div><dt className="text-slate-500">总 tokens</dt><dd className="font-medium">{usage.totalTokens.toLocaleString()}</dd></div>
                <div><dt className="text-slate-500">缓存 tokens</dt><dd className="font-medium">{usage.cachedTokens?.toLocaleString() ?? '未报告'}</dd></div>
                <div><dt className="text-slate-500">推理 tokens</dt><dd className="font-medium">{usage.reasoningTokens?.toLocaleString() ?? '未报告'}</dd></div>
                <div><dt className="text-slate-500">Provider 调用</dt><dd className="font-medium">{usage.providerCalls?.toLocaleString() ?? '未报告'}</dd></div>
              </dl>
              {usage.coverage === 'partial' && (
                <p role="status" className="mt-2 text-[10px] text-amber-700 dark:text-amber-300">
                  以上仅合计已记录的 {usage.recordedRunCount}/{usage.associatedRunCount} 个关联 Run；缺失项不按 0 计。
                </p>
              )}
            </>
          )}
          <p className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">
            模型 · {usage.models.length > 0 ? usage.models.join('、') : '未报告'} · Provider 费用未报告，未作估算。
          </p>
        </section>
      )}

      <section aria-labelledby="operation-runs-title" className="rounded-lg border border-slate-200 dark:border-slate-700">
        <div className="border-b border-slate-200 px-3 py-2 font-semibold dark:border-slate-700" id="operation-runs-title">
          关联 Run · {operation.runs.length}
        </div>
        {operation.runs.length === 0 ? (
          <p className="p-3 text-slate-500">没有带稳定 ID 的 Run 关系。</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {operation.runs.map((run) => (
              <li key={run.run_id} className={`px-3 py-2 ${run.run_id === focusedRunId ? 'bg-cyan-50/70 dark:bg-cyan-950/30' : ''}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="break-all font-mono text-[10px]">{run.run_id}</span>
                  <span className="text-[9px] text-slate-500">{ASSOCIATION_LABELS[run.association_status]}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1 text-[9px] text-slate-500">
                  {run.execution_generations.map((generation) => <span key={generation} className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">generation {generation}</span>)}
                  {run.roles.map((role) => <span key={role} className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">{role}</span>)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {operation.run_links.length > 0 && (
        <section aria-labelledby="operation-links-title" className="rounded-lg border border-slate-200 dark:border-slate-700">
          <div id="operation-links-title" className="border-b border-slate-200 px-3 py-2 font-semibold dark:border-slate-700">持久关系</div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {operation.run_links.map((link, index) => (
              <li key={`${link.relation_kind}:${link.from_run_id}:${link.to_run_id}:${index}`} className="px-3 py-2">
                <div className="break-all font-mono text-[10px]">{link.from_run_id} → {link.to_run_id}</div>
                <div className="mt-1 text-[9px] text-slate-500">
                  {RELATION_LABELS[link.relation_kind]} · {BINDING_LABELS[link.binding_status]} · {link.source_kind === 'runtime_event' ? 'Runtime 事件' : 'Operation 恢复记录'}
                  {link.candidate_revision ? ` · candidate ${link.candidate_revision}` : ''}
                  {link.verification_epoch_status ? ` · ${EPOCH_BINDING_LABELS[link.verification_epoch_status]}` : ''}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {operation.recovery_attempts.length > 0 && (
        <section aria-labelledby="operation-attempts-title" className="rounded-lg border border-slate-200 dark:border-slate-700">
          <div id="operation-attempts-title" className="border-b border-slate-200 px-3 py-2 font-semibold dark:border-slate-700">恢复尝试 · {operation.recovery_attempts.length}</div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {operation.recovery_attempts.map((attempt) => (
              <li key={attempt.attempt_id} className="px-3 py-2">
                <div className="flex flex-wrap justify-between gap-2"><span className="font-mono">{attempt.attempt_id}</span><span>{ATTEMPT_LABELS[attempt.status]}</span></div>
                <div className="mt-1 break-all text-[9px] text-slate-500">Run {attempt.run_id} · action {attempt.action_id} · 第 {attempt.attempt_number} 次 · {attempt.side_effect_class}</div>
                {attempt.error_code && <div className="mt-1 text-[9px] text-amber-700 dark:text-amber-300">错误码 · {attempt.error_code}</div>}
                {attempt.required_authorization_ids.length > 0 && <div className="mt-1 break-all text-[9px] text-slate-500">授权引用 · {attempt.required_authorization_ids.join('、')}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {operation.repair_authorizations.length > 0 && (
        <section aria-labelledby="operation-auth-title" className="rounded-lg border border-slate-200 dark:border-slate-700">
          <div id="operation-auth-title" className="border-b border-slate-200 px-3 py-2 font-semibold dark:border-slate-700">修复授权绑定</div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {operation.repair_authorizations.map((authorization) => (
              <li key={authorization.authorization_id} className="px-3 py-2">
                <div className="break-all font-mono">{authorization.authorization_id}</div>
                <div className="mt-1 break-all text-[9px] text-slate-500">dispatch {authorization.dispatch_run_id} → verification {authorization.verification_run_id}</div>
                <div className="mt-1 break-all text-[9px]">candidate {authorization.candidate_revision} · epoch {authorization.verification_epoch} · {BINDING_LABELS[authorization.binding_status]} · {EPOCH_BINDING_LABELS[authorization.verification_epoch_status]}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(operation.unknown_actions.length > 0 || operation.reconciliations.length > 0) && (
        <section aria-labelledby="operation-actions-title" className="rounded-lg border border-slate-200 dark:border-slate-700">
          <div id="operation-actions-title" className="border-b border-slate-200 px-3 py-2 font-semibold dark:border-slate-700">副作用对账</div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {operation.unknown_actions.map((action) => (
              <li key={`unknown:${action.action_id}`} className="px-3 py-2">
                <div className="font-mono">{action.action_id} · 结果未知</div>
                <div className="mt-1 break-all text-[9px] text-slate-500">{action.tool_name} · Run {action.run_id ?? '未关联'} · generation {action.execution_generation ?? '未知'}</div>
              </li>
            ))}
            {operation.reconciliations.map((item) => (
              <li key={`reconciled:${item.action_id}:${item.execution_generation}`} className="px-3 py-2">
                <div className="font-mono">{item.action_id} · {item.outcome === 'confirmed_applied' ? '已确认执行' : '已确认未执行'}</div>
                <div className="mt-1 text-[9px] text-slate-500">{item.tool_name} · generation {item.execution_generation} · {item.binding_status === 'explicit' ? '持久对账' : '身份不一致'}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {operation.source_gaps.length > 0 && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[10px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          来源覆盖缺口：{operation.source_gaps.join('、')}
        </p>
      )}
    </div>
  );
}
