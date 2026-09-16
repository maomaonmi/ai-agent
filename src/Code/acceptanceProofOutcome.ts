export type AcceptanceProofOutcome =
  | 'verified'
  | 'contradicted'
  | 'inconclusive'
  | 'unverifiable'
  | 'invalid_test'
  | 'infra_failure';

const ALIASES: Record<string, AcceptanceProofOutcome> = {
  pass: 'verified',
  passed: 'verified',
  verified: 'verified',
  fail: 'contradicted',
  failed: 'contradicted',
  contradicted: 'contradicted',
  inconclusive: 'inconclusive',
  unknown: 'inconclusive',
  unobservable: 'unverifiable',
  unverifiable: 'unverifiable',
  unavailable: 'unverifiable',
  verification_unavailable: 'unverifiable',
  pending: 'unverifiable',
  skipped: 'unverifiable',
  not_executable: 'unverifiable',
  waiting_for_patch: 'unverifiable',
  waiting_for_test_generation: 'unverifiable',
  waiting_for_observability: 'unverifiable',
  waiting_for_execution: 'unverifiable',
  waiting_for_result: 'inconclusive',
  invalid: 'invalid_test',
  invalid_test: 'invalid_test',
  contract_generation_failed: 'invalid_test',
  invalid_acceptance_contract: 'invalid_test',
  blocked: 'infra_failure',
  blocked_test_infra: 'infra_failure',
  infra_failure: 'infra_failure',
};

function normalize(value: unknown): AcceptanceProofOutcome | null {
  const key = String(value ?? '').trim().toLowerCase();
  return ALIASES[key] ?? null;
}

function uncertaintyFrom(item: unknown): AcceptanceProofOutcome | null {
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;
  const actual = record.actual && typeof record.actual === 'object'
    ? record.actual as Record<string, unknown>
    : undefined;
  const evidenceStatus = normalize(
    actual?.evidence_status
      ?? record.evidence_status
      ?? record.observation_status,
  );
  if (evidenceStatus && [
    'infra_failure', 'invalid_test', 'unverifiable', 'inconclusive',
  ].includes(evidenceStatus)) return evidenceStatus;

  // Older browser/test reports often put the uncertainty only in a
  // domain-neutral finding kind (for example ``state_not_observable``).
  // That evidence must still outrank a legacy top-level ``failed`` flag.
  const kind = String(record.kind ?? record.code ?? '').trim().toLowerCase();
  if (kind.includes('infra') || kind.includes('infrastructure')) return 'infra_failure';
  if (kind.includes('invalid_test') || kind.includes('invalid-test')) return 'invalid_test';
  if (
    kind.includes('unobservable')
    || kind.includes('not_observable')
    || kind.includes('not-observable')
    || kind.includes('observability')
    || kind.includes('measurement_unavailable')
    || kind.includes('measurement-unavailable')
  ) return 'unverifiable';
  if (kind.includes('inconclusive') || kind.includes('incomplete_window')) return 'inconclusive';
  return null;
}

/** Reduce browser output to the domain-neutral proof protocol vocabulary. */
export function reduceAcceptanceProofOutcome(report: unknown): AcceptanceProofOutcome {
  if (!report || typeof report !== 'object') return 'unverifiable';
  const value = report as Record<string, unknown>;
  const assertions = Array.isArray(value.assertions) ? value.assertions : [];
  const findings = Array.isArray(value.deterministic_findings)
    ? value.deterministic_findings
    : [];
  const uncertain = [...assertions, ...findings]
    .map(uncertaintyFrom)
    .filter((item): item is AcceptanceProofOutcome => item !== null);
  if (uncertain.includes('infra_failure')) return 'infra_failure';
  if (uncertain.includes('invalid_test')) return 'invalid_test';
  if (uncertain.includes('unverifiable')) return 'unverifiable';
  if (uncertain.includes('inconclusive')) return 'inconclusive';

  const obligationStatuses = value.obligation_statuses;
  if (obligationStatuses && typeof obligationStatuses === 'object') {
    const normalizedStatuses = Object.values(obligationStatuses as Record<string, unknown>)
      .map(normalize)
      .filter((item): item is AcceptanceProofOutcome => item !== null);
    if (normalizedStatuses.includes('infra_failure')) return 'infra_failure';
    if (normalizedStatuses.includes('invalid_test')) return 'invalid_test';
    if (normalizedStatuses.includes('unverifiable')) return 'unverifiable';
    if (normalizedStatuses.includes('inconclusive')) return 'inconclusive';
    if (normalizedStatuses.includes('contradicted')) return 'contradicted';
    if (normalizedStatuses.includes('verified')) return 'verified';
  }

  if (value.verification_inconclusive === true || value.inconclusive === true) {
    return 'inconclusive';
  }
  for (const key of ['proof_outcome', 'outcome', 'verification_status']) {
    const explicit = normalize(value[key]);
    if (explicit) return explicit;
  }
  if (value.passed === true || value.goal_verified === true) return 'verified';
  if (assertions.some((item) => (
    item && typeof item === 'object' && (item as Record<string, unknown>).passed === false
  ))) return 'contradicted';
  if (findings.length > 0) return 'contradicted';
  return 'unverifiable';
}

export function canTriggerAcceptanceRepair(report: unknown): boolean {
  return reduceAcceptanceProofOutcome(report) === 'contradicted';
}
