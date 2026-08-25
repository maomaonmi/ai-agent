import type {
  Artifact,
  ArtifactId,
  ArtifactVersion,
  ArtifactVersionId,
  MessageArtifactLink,
  MessageId,
  ArtifactSummary,
} from './types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export interface ArtifactListResponse {
  artifacts: Artifact[];
  count: number;
}

export interface ArtifactVersionListResponse {
  versions: ArtifactVersion[];
  count: number;
}

export interface MessageArtifactLinkListResponse {
  links: MessageArtifactLink[];
  count: number;
}

export interface CreateArtifactInput {
  messageId: MessageId | string;
  kind: Artifact['kind'];
  title: string;
  summary: string;
  sourceRef: ArtifactVersion['sourceRef'];
  payload?: unknown;
  metadata?: Record<string, unknown>;
  status?: Extract<Artifact['status'], 'draft' | 'generating' | 'ready' | 'failed'>;
}

export interface CreateArtifactResponse {
  artifact: Artifact;
  version: ArtifactVersion;
  link: MessageArtifactLink;
}

export interface ConversationOmniContextResponse {
  projectId: string | null;
  projectSummary: string | null;
  candidateArtifactSummaries: ArtifactSummary[];
  projects: Record<string, string>;
}

async function requestJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`);
  const payload = await response.json().catch(() => null) as { detail?: string } | null;
  if (!response.ok) throw new Error(payload?.detail || `作品请求失败（${response.status}）`);
  return payload as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as { detail?: string } | null;
  if (!response.ok) throw new Error(payload?.detail || `作品保存失败（${response.status}）`);
  return payload as T;
}

export function createConversationArtifact(
  conversationId: string,
  input: CreateArtifactInput,
): Promise<CreateArtifactResponse> {
  return postJson(`/api/conversations/${encodeURIComponent(conversationId)}/artifacts`, input);
}

export function createArtifactVersion(
  artifactId: ArtifactId | string,
  input: {
    conversationId: string;
    messageId: MessageId | string;
    summary: string;
    sourceRef: ArtifactVersion['sourceRef'];
    payload?: unknown;
    status?: ArtifactVersion['status'];
  },
): Promise<CreateArtifactResponse> {
  return postJson(`/api/artifacts/${encodeURIComponent(artifactId)}/versions`, input);
}

export function listConversationArtifacts(conversationId: string): Promise<ArtifactListResponse> {
  return requestJson(`/api/conversations/${encodeURIComponent(conversationId)}/artifacts`);
}

export function listMessageArtifactLinks(messageId: MessageId | string): Promise<MessageArtifactLinkListResponse> {
  return requestJson(`/api/messages/${encodeURIComponent(messageId)}/artifacts`);
}

export function listConversationArtifactLinks(conversationId: string): Promise<MessageArtifactLinkListResponse> {
  return requestJson(`/api/conversations/${encodeURIComponent(conversationId)}/artifact-links`);
}

export function getArtifact(artifactId: ArtifactId | string): Promise<Artifact> {
  return requestJson(`/api/artifacts/${encodeURIComponent(artifactId)}`);
}

export function listArtifactVersions(artifactId: ArtifactId | string): Promise<ArtifactVersionListResponse> {
  return requestJson(`/api/artifacts/${encodeURIComponent(artifactId)}/versions`);
}

export function getArtifactVersion(
  artifactId: ArtifactId | string,
  versionId: ArtifactVersionId | string,
): Promise<ArtifactVersion> {
  return requestJson(
    `/api/artifacts/${encodeURIComponent(artifactId)}/versions/${encodeURIComponent(versionId)}`,
  );
}

export function getConversationOmniContext(conversationId: string, query = ''): Promise<ConversationOmniContextResponse> {
  return requestJson(`/api/conversations/${encodeURIComponent(conversationId)}/omni-context?query=${encodeURIComponent(query)}`);
}

export function referenceConversationArtifact(
  conversationId: string,
  input: { messageId: MessageId | string; artifactId: ArtifactId | string; versionId?: ArtifactVersionId | string; displayOrder?: number },
): Promise<{ link: MessageArtifactLink; artifact: Artifact; fromOtherProject: boolean }> {
  return postJson(`/api/conversations/${encodeURIComponent(conversationId)}/artifact-references`, input);
}
