import type { PlanProgressEvent, PlanTask, PlanTaskStatus } from '../../lib/api';

export type PlanFlowNodeKind = 'planner' | 'search' | 'agent' | 'report';

export interface PlanFlowGraphNode {
  id: string;
  kind: PlanFlowNodeKind;
  taskId?: number;
  title: string;
  agentLabel?: string;
  status: PlanTaskStatus;
}

export interface PlanFlowGraphEdge {
  id: string;
  source: string;
  target: string;
}

export interface PlanFlowGraph {
  nodes: PlanFlowPositionedNode[];
  edges: PlanFlowGraphEdge[];
  compact: boolean;
  replanning: boolean;
}

/** 布局输出节点：在语义节点之上补充画布坐标 */
export type PlanFlowPositionedNode = PlanFlowGraphNode & { x: number; y: number };

// 分层布局常量：列距 230 / 行距 96，配合 fitView 自适应容器。
const COL_W = 230;
const ROW_H = 96;

/** 智能体显示名（唯一实现，PlanWorkspace 与流程图共用） */
export function agentDisplayName(agent?: string): string {
  if (!agent) return '自主执行器';
  if (agent.includes('web')) return '联网搜索专家';
  if (agent.includes('think')) return '深度思考专家';
  if (agent.includes('data')) return '数据分析专家';
  return agent;
}

/**
 * Why 由前端确定性推导而非后端下发：PlanTask 无显式 depends_on 字段，
 * 但后端执行语义固定（联网任务串行 → 其余并行 → 汇总报告），
 * 按该语义推导的 DAG 与真实执行顺序一致，且同输入恒同输出（SSR 安全）。
 */
export function buildPlanFlowGraph(progress: PlanProgressEvent | null | undefined): PlanFlowGraph {
  const tasks = progress?.tasks || [];
  const searchTasks = tasks.filter((task) => task.requires_web);
  const agentTasks = tasks.filter((task) => !task.requires_web);
  const settled = tasks.every((task) => task.status === 'completed' || task.status === 'failed');
  const plannerStatus: PlanTaskStatus = progress?.phase === 'planning' ? 'in_progress' : 'completed';
  const reportStatus: PlanTaskStatus = progress?.phase === 'completed'
    ? 'completed'
    : tasks.length > 0 && settled ? 'in_progress' : 'pending';

  const planner: PlanFlowGraphNode = {
    id: 'planner', kind: 'planner',
    title: progress?.phase === 'planning' ? '正在规划任务…' : '任务规划',
    status: plannerStatus,
  };
  const report: PlanFlowGraphNode = { id: 'report', kind: 'report', title: '汇总报告', status: reportStatus };
  const toNode = (task: PlanTask): PlanFlowGraphNode => ({
    id: `task-${task.id}`,
    kind: task.requires_web ? 'search' : 'agent',
    taskId: task.id,
    title: task.title,
    agentLabel: task.requires_web ? undefined : agentDisplayName(task.assigned_agent),
    status: task.status,
  });

  // 节点分列：planner | 搜索链（每列一个） | 并行任务（同列多行） | report
  const columns: PlanFlowGraphNode[][] = [
    [planner],
    ...searchTasks.map((task) => [toNode(task)]),
    ...(agentTasks.length ? [agentTasks.map(toNode)] : []),
    [report],
  ];
  const maxRows = Math.max(...columns.map((column) => column.length));
  const nodes: PlanFlowPositionedNode[] = columns.flatMap((column, columnIndex) =>
    column.map((node, rowIndex) => ({
      ...node,
      x: columnIndex * COL_W,
      // 列内垂直居中：让单节点列与多行并行列视觉对齐
      y: ((maxRows - column.length) * ROW_H) / 2 + rowIndex * ROW_H,
    })),
  );

  const edges: PlanFlowGraphEdge[] = [];
  const connect = (source: string, target: string) => edges.push({ id: `${source}->${target}`, source, target });
  const lastSearchId = searchTasks.length ? `task-${searchTasks[searchTasks.length - 1].id}` : null;
  if (searchTasks.length) {
    connect('planner', `task-${searchTasks[0].id}`);
    searchTasks.slice(1).forEach((task, index) => connect(`task-${searchTasks[index].id}`, `task-${task.id}`));
  }
  if (agentTasks.length) {
    const entry = lastSearchId ?? 'planner';
    agentTasks.forEach((task) => {
      connect(entry, `task-${task.id}`);
      connect(`task-${task.id}`, 'report');
    });
  } else {
    connect(lastSearchId ?? 'planner', 'report');
  }

  return {
    nodes,
    edges,
    compact: tasks.length > 14,
    replanning: progress?.phase === 'replanning',
  };
}
