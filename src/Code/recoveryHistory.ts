export interface RecoveryRouteAvailability {
  status: string;
  remaining_executor_ids: string[];
  remaining_agent_action_ids: string[];
}

const STATUS_LABELS: Record<string, string> = {
  complete: '完整',
  partial: '部分',
  unavailable: '不可用',
  not_enumerated: '未盘点',
  not_applicable: '不适用',
  started: '已开始',
  completed: '已完成',
  failed: '失败',
  unknown: '结果未知',
  cancelled: '已取消',
  continue: '继续',
  wait: '等待',
  stop: '停止',
  eligible: '可执行',
  inapplicable: '不适用',
  blocked: '受阻',
  undetermined: '未确定',
  already_attempted: '已尝试',
  reconciliation_required: '需要对账',
};

export function recoveryStatusLabel(status: string): string {
  return (STATUS_LABELS[status] ?? status) || '未知';
}

export function describeRemainingRoutes(inventory: RecoveryRouteAvailability): string {
  if (inventory.remaining_executor_ids.length || inventory.remaining_agent_action_ids.length) {
    return [
      ...inventory.remaining_executor_ids.map((item) => `执行器 ${item}`),
      ...inventory.remaining_agent_action_ids.map((item) => `Agent 动作 ${item}`),
    ].join('、');
  }
  if (inventory.status === 'complete') return '完整盘点后没有符合条件的剩余路线';
  if (inventory.status === 'not_enumerated') return '尚未盘点，不能判定是否还有路线';
  if (inventory.status === 'unavailable') return '候选来源不可用，是否有剩余路线未知';
  return '盘点不完整，尚不能确认剩余路线';
}

export function appendRecoveryHistoryPage<T extends { sequence: number }>(
  current: T[],
  next: T[],
): T[] {
  const bySequence = new Map<number, T>();
  for (const item of [...current, ...next]) bySequence.set(item.sequence, item);
  return [...bySequence.values()].sort((left, right) => left.sequence - right.sequence);
}
