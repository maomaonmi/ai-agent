export interface PlannerBudgetPresentation {
  summary: string;
  completionLimitLabel: string;
  completionUsageLabel: string;
  reasoningBudgetLabel: string;
}

/** Keep UI labels aligned with the provider's actual reasoning/output limits. */
export function plannerBudgetPresentation(mode: unknown): PlannerBudgetPresentation {
  if (mode === 'shared_completion') {
    return {
      summary: '推理与回答共用总生成额度',
      completionLimitLabel: '总生成上限',
      completionUsageLabel: '总生成用量',
      reasoningBudgetLabel: '上游推理 token 用量',
    };
  }
  if (mode === 'separate') {
    return {
      summary: '推理预算与可见输出上限分别控制',
      completionLimitLabel: '可见输出 token 上限',
      completionUsageLabel: '可见输出 token 用量',
      reasoningBudgetLabel: '独立推理 token 上限',
    };
  }
  return {
    summary: '由模型推理档位控制，未设置独立推理 token 上限',
    completionLimitLabel: '请求生成上限',
    completionUsageLabel: '上游生成用量',
    reasoningBudgetLabel: '上游推理 token 用量',
  };
}
