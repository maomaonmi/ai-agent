import type { CodeObservatoryDecisionView } from '../lib/codeObservatoryApi.ts';

const OUTCOME_LABELS: Record<string, string> = {
  accepted: 'FSM 已接受',
  not_accepted: 'FSM 未接受',
  verified: '验证通过',
  partially_verified: '部分通过',
  contradicted: '结论矛盾',
  assertion_failed: '断言失败',
  inconclusive: '验证不确定',
  unverifiable: '无法验证',
  invalid_test: '测试无效',
  infra_failure: '基础设施失败',
  continue: '继续',
  wait: '等待',
  complete: '完成',
  stop: '停止',
  unknown: '未知结论',
};

const OWNER_LABELS: Record<CodeObservatoryDecisionView['owner'], string> = {
  runtime: 'Runtime',
  control_plane: '控制面 FSM',
  verification_runtime: '验证 Runtime',
  unknown: '来源未知',
};

const GAP_LABELS: Record<string, string> = {
  rule_id_not_recorded: '规则编号未记录',
  rule_version_not_recorded: '规则版本未记录',
  candidate_revision_not_recorded: '候选版本未记录',
  verification_epoch_not_recorded: '验证 epoch 未记录',
  reason_code_not_recorded: '原因码未记录',
  based_on_operation_version_not_recorded: '决策依据 Operation 版本未记录',
  allowed_actions_not_enumerated: '恢复动作未完成枚举',
};

const ACTION_STATUS_LABELS: Record<string, string> = {
  eligible: '可用',
  inapplicable: '不适用',
  blocked: '受阻',
  undetermined: '未能判定',
  already_attempted: '已尝试',
  reconciliation_required: '需要对账',
};

const SOURCE_STATUS_LABELS: Record<string, string> = {
  complete: '完整',
  partial: '部分',
  unavailable: '不可用',
  not_applicable: '不适用',
  not_enumerated: '未枚举',
};

export function decisionOutcomeLabel(outcome: string): string {
  return OUTCOME_LABELS[outcome] ?? outcome;
}

export function decisionOwnerLabel(owner: CodeObservatoryDecisionView['owner']): string {
  return OWNER_LABELS[owner];
}

export function decisionGapLabel(gap: string): string {
  return GAP_LABELS[gap] ?? `来源缺口 · ${gap}`;
}

export function decisionActionStatusLabel(status: string): string {
  return ACTION_STATUS_LABELS[status] ?? status;
}

export function decisionSourceStatusLabel(status: string): string {
  return SOURCE_STATUS_LABELS[status] ?? status;
}

export function decisionVersionRows(decision: CodeObservatoryDecisionView): Array<[string, string]> {
  return [
    ['候选版本', decision.versions.candidate_revision ?? '未记录'],
    ['验证 epoch', decision.versions.verification_epoch?.toString() ?? '未记录'],
    ['Operation 版本', decision.based_on_operation_version?.toString() ?? decision.versions.operation_version?.toString() ?? '未记录'],
    ['规则编号', decision.rule_id ?? '未记录'],
    ['规则版本', decision.versions.rule_version ?? '未记录'],
  ];
}

export function decisionSourceLabel(decision: CodeObservatoryDecisionView): string {
  const { stream_key: streamKey, event_key: eventKey, stream_sequence: streamSequence } = decision.source_ref;
  const identity = eventKey ?? (streamSequence ? `#${streamSequence}` : '事件引用未记录');
  return `${streamKey ?? '来源流未记录'} · ${identity}`;
}

export function decisionRouteLabel(decision: CodeObservatoryDecisionView): string {
  if (decision.selected_route) return decision.selected_route;
  if (decision.owner === 'verification_runtime') return '不适用（验证结果）';
  return '未记录';
}

export function allowedRecoveryActionsLabel(decision: CodeObservatoryDecisionView): string {
  if (decision.allowed_actions.length > 0) return decision.allowed_actions.join('、');
  if (decision.executor_evaluation_status === 'enumerated') return '已枚举，无剩余动作';
  if (decision.executor_evaluation_status === 'unavailable') return '动作枚举不可用';
  if (decision.executor_evaluation_status === 'not_enumerated') return '未枚举';
  return '未记录';
}
