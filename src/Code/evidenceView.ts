import type {
  CodeObservatoryApiError,
  CodeObservatoryEvidenceView,
} from '../lib/codeObservatoryApi';

const STATUS_LABELS: Record<CodeObservatoryEvidenceView['status'], string> = {
  available: '来源可读',
  missing: '引用不存在',
  stale: '旧候选证据',
  retention_missing: '来源已清理',
  untrusted: '来源未通过校验',
  unavailable: '来源不可用',
  unknown: '状态未知',
  reference_only: '只有引用',
};

const STORAGE_LABELS: Record<CodeObservatoryEvidenceView['storage_kind'], string> = {
  runtime_action_journal: 'Runtime 持久回执',
  artifact_store: 'Artifact',
  memory_observation: '运行内存观察',
  reference_only: '未绑定持久资产',
};

const SOURCE_GAP_LABELS: Record<string, string> = {
  candidate_revision_mismatch: '证据绑定到了其他候选版本',
  content_not_present_in_this_receipt: '该回执没有正文',
  action_not_successful: '来源动作未成功完成',
  memory_body_not_persisted: '正文只在运行内存中，未写入持久来源',
  persistent_artifact_binding_not_recorded: '未记录持久 Artifact 绑定',
  preview_media_type_not_allowed: '该文件类型不允许预览',
  read_action_not_successful: '读取动作未成功',
  source_not_runtime_committed: '该引用来自未提交的报告或传输事件',
  unsafe_or_missing_path: '来源路径缺失或不安全',
};

export function evidenceStatusLabel(status: CodeObservatoryEvidenceView['status']): string {
  return STATUS_LABELS[status] ?? '状态未知';
}

export function evidenceStorageLabel(storage: CodeObservatoryEvidenceView['storage_kind']): string {
  return STORAGE_LABELS[storage] ?? '未绑定持久资产';
}

export function evidenceGapLabel(gap: string): string {
  return SOURCE_GAP_LABELS[gap] ?? '来源未记录此字段';
}

export function evidencePreviewErrorLabel(code: CodeObservatoryApiError['code']): string {
  if (code === 'EVIDENCE_RETENTION_MISSING') return '原始来源已清理，无法恢复预览。';
  if (code === 'EVIDENCE_STALE') return '证据属于旧候选版本，不能作为当前候选的证明。';
  if (code === 'EVIDENCE_NOT_FOUND') return '当前 Run 中没有这条证据引用。';
  if (code === 'EVIDENCE_PREVIEW_UNAVAILABLE') return '该引用没有可安全预览的持久正文。';
  return '暂时无法读取证据来源。';
}
