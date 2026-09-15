import type { CodeAgentRun } from '../lib/api';

export type GoldenTraceEligibility = {
  eligible: boolean;
  reason?: string;
};

/**
 * Keep the save affordance aligned with the backend's source-trace gate.
 * Missing evidence is deliberately ineligible; the backend remains the final
 * authority and re-checks the durable session snapshot on submit.
 */
export function getGoldenTraceEligibility(
  run: Pick<CodeAgentRun, 'trace'> | null | undefined,
): GoldenTraceEligibility {
  if (!run) return { eligible: false, reason: '没有可保存的 Agent run。' };
  if (run.trace.status !== 'completed') {
    return { eligible: false, reason: '只有已完成的 run 才能保存。' };
  }

  const verification = run.trace.runtimeVerification;
  const evidence = run.trace.runtimeEvidence;
  if (!verification?.browserRunId) {
    return { eligible: false, reason: '缺少真实浏览器验证 run id。' };
  }
  if (evidence?.status !== 'verified') {
    return { eligible: false, reason: '浏览器验收证据尚未通过。' };
  }
  if (!evidence.boot_completed) {
    return { eligible: false, reason: '页面尚未确认启动完成。' };
  }
  if (evidence.deterministic_verifier_passed === false) {
    return { eligible: false, reason: '确定性浏览器验证未通过。' };
  }
  if (evidence.goal_verified !== true) {
    return { eligible: false, reason: '目标级浏览器断言尚未通过，冒烟通过不能保存为 Golden Trace。' };
  }
  if (evidence.console_errors.length > 0 || evidence.new_errors.length > 0 || evidence.same_error_persisted) {
    return { eligible: false, reason: '仍存在 Console/page 错误或原错误持续。' };
  }
  return { eligible: true };
}
