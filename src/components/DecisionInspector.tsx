'use client';

import { ShieldAlert } from 'lucide-react';

import {
  allowedRecoveryActionsLabel,
  decisionActionStatusLabel,
  decisionGapLabel,
  decisionOutcomeLabel,
  decisionOwnerLabel,
  decisionRouteLabel,
  decisionSourceLabel,
  decisionSourceStatusLabel,
  decisionVersionRows,
} from '../Code/decisionView';
import type { CodeObservatoryDecisionView } from '../lib/codeObservatoryApi';

const OUTCOME_TONES: Record<string, string> = {
  accepted: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200',
  verified: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200',
  complete: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200',
  contradicted: 'border-red-200 bg-red-50 text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200',
  assertion_failed: 'border-red-200 bg-red-50 text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200',
  not_accepted: 'border-red-200 bg-red-50 text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200',
  invalid_test: 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-200',
  infra_failure: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-400/30 dark:bg-violet-400/10 dark:text-violet-200',
  inconclusive: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200',
  partially_verified: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200',
  wait: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200',
};

function DecisionCard({ decision }: { decision: CodeObservatoryDecisionView }) {
  const tone = OUTCOME_TONES[decision.outcome] ?? 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200';
  const versionRows = decisionVersionRows(decision);

  return (
    <li className="space-y-3 px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${tone}`}>
          {decisionOutcomeLabel(decision.outcome)}
        </span>
        <span className="text-[10px] text-slate-500 dark:text-slate-400">{decisionOwnerLabel(decision.owner)}</span>
        <span className="min-w-0 flex-1 truncate text-right font-mono text-[9px] text-slate-400" title={decision.decision_ref}>
          {decision.decision_ref}
        </span>
      </div>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[10px]">
        <dt className="text-slate-400">来源</dt>
        <dd className="truncate font-mono text-slate-600 dark:text-slate-300" title={decisionSourceLabel(decision)}>
          {decisionSourceLabel(decision)}
        </dd>
        <dt className="text-slate-400">来源可信度</dt>
        <dd className="text-slate-600 dark:text-slate-300">{decision.source_role}</dd>
        <dt className="text-slate-400">原因码</dt>
        <dd className="font-mono text-slate-600 dark:text-slate-300">{decision.reason_code ?? '未记录'}</dd>
        {decision.scope && <>
          <dt className="text-slate-400">范围</dt>
          <dd className="text-slate-600 dark:text-slate-300">{decision.scope}</dd>
        </>}
        {decision.from_state && <>
          <dt className="text-slate-400">FSM 路径</dt>
          <dd className="text-slate-600 dark:text-slate-300">
            {decision.from_state} → {decision.to_state ?? '未记录'}
          </dd>
        </>}
        <dt className="text-slate-400">决策路线</dt>
        <dd className="font-mono text-slate-600 dark:text-slate-300">{decisionRouteLabel(decision)}</dd>
      </dl>

      <div className="rounded-lg bg-slate-50 px-2.5 py-2 dark:bg-slate-800/70">
        <h3 className="mb-1 text-[10px] font-semibold text-slate-600 dark:text-slate-300">决策版本</h3>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[9px]">
          {versionRows.map(([label, value]) => (
            <div key={label} className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-slate-400">{label}</dt>
              <dd className="truncate font-mono text-slate-600 dark:text-slate-300" title={value}>{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {decision.owner === 'runtime' && (
        <div className="space-y-2 rounded-lg border border-slate-200 px-2.5 py-2 dark:border-slate-700">
          <h3 className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">恢复动作 · {allowedRecoveryActionsLabel(decision)}</h3>
          {decision.candidate_inventory_status && (
            <p className="text-[9px] text-slate-500 dark:text-slate-400">
              候选源清单：{decisionSourceStatusLabel(decision.candidate_inventory_status)}
              {decision.expected_candidate_source_ids.length > 0
                ? ` · 期望 ${decision.expected_candidate_source_ids.length} 个来源`
                : ' · 期望来源未记录'}
            </p>
          )}
          {decision.candidate_sources.length > 0 && (
            <ul className="space-y-1.5">
              {decision.candidate_sources.map((source) => (
                <li key={source.source_id} className="text-[9px] text-slate-500 dark:text-slate-400">
                  <span className="font-mono text-slate-700 dark:text-slate-200">{source.source_id}</span>
                  {' · '}{decisionSourceStatusLabel(source.status)}
                  {source.reason_codes.length > 0 && ` · ${source.reason_codes.join(', ')}`}
                  {source.candidate_action_ids.length > 0 && ` · 动作 ${source.candidate_action_ids.join(', ')}`}
                </li>
              ))}
            </ul>
          )}
          {decision.candidate_actions.length > 0 && (
            <ul className="divide-y divide-slate-100 dark:divide-slate-700">
              {decision.candidate_actions.map((action) => (
                <li key={action.action_id} className="py-1.5 text-[9px] text-slate-500 dark:text-slate-400">
                  <div className="flex flex-wrap justify-between gap-x-2">
                    <span className="font-mono text-slate-700 dark:text-slate-200">{action.action_id}</span>
                    <span>{decisionActionStatusLabel(action.status)} · {action.executor_id} / {action.lane_id}</span>
                  </div>
                  <div className="mt-0.5">
                    基于 {action.based_on_revision ?? '未记录'} · 当前 {action.current_revision ?? '未记录'}
                    {action.reason_codes.length > 0 && ` · ${action.reason_codes.join(', ')}`}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {decision.candidate_sources.length === 0 && decision.candidate_actions.length === 0 && (
            <p className="text-[9px] text-slate-400">候选动作明细未记录。</p>
          )}
        </div>
      )}

      {decision.source_gaps.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-2.5 py-2 dark:border-amber-400/20 dark:bg-amber-400/5">
          <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-amber-800 dark:text-amber-200">
            <ShieldAlert size={12} aria-hidden="true" /> 来源缺口
          </div>
          <ul className="flex flex-wrap gap-1">
            {decision.source_gaps.map((gap) => (
              <li key={gap} className="rounded-full border border-amber-200 px-2 py-0.5 text-[9px] text-amber-800 dark:border-amber-400/30 dark:text-amber-200">
                {decisionGapLabel(gap)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

export function DecisionInspector({ decisions }: { decisions: CodeObservatoryDecisionView[] }) {
  const latestFirst = [...decisions].reverse();

  if (latestFirst.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-5 text-center text-xs text-slate-400">
        后端尚无持久化决策记录；没有记录的规则、原因和路线会明确显示为“未记录”。
      </div>
    );
  }

  return (
    <ol aria-label="持久化决策记录" className="divide-y divide-slate-100 dark:divide-slate-800">
      {latestFirst.map((decision) => (
        <DecisionCard key={`${decision.source_ref.stream_key}:${decision.decision_ref}`} decision={decision} />
      ))}
    </ol>
  );
}
