import type { Project, ProjectId } from '../omni/types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export interface ProjectWithConversations extends Project {
  conversationIds: string[];
}

export interface ProjectListResponse {
  projects: ProjectWithConversations[];
  count: number;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  isArchived?: boolean;
}

export interface ConversationProjectAssignment {
  status: 'success';
  sessionId: string;
  projectId: ProjectId | null;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => null) as { detail?: string } | null;
  if (!response.ok) {
    throw new Error(payload?.detail || `项目请求失败（${response.status}）`);
  }
  return payload as T;
}

export function listProjects(includeArchived = false): Promise<ProjectListResponse> {
  const query = includeArchived ? '?include_archived=true' : '';
  return requestJson<ProjectListResponse>(`/api/projects${query}`);
}

export function createProject(input: CreateProjectInput): Promise<ProjectWithConversations> {
  return requestJson<ProjectWithConversations>('/api/projects', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateProject(
  projectId: ProjectId | string,
  input: UpdateProjectInput,
): Promise<ProjectWithConversations> {
  return requestJson<ProjectWithConversations>(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteProject(projectId: ProjectId | string): Promise<{ status: 'success'; deleted: string }> {
  return requestJson(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
}

export function assignConversationToProject(
  projectId: ProjectId | string,
  sessionId: string,
): Promise<ConversationProjectAssignment> {
  return requestJson(
    `/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(sessionId)}`,
    { method: 'POST' },
  );
}

export function removeConversationFromProject(
  projectId: ProjectId | string,
  sessionId: string,
): Promise<ConversationProjectAssignment> {
  return requestJson(
    `/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' },
  );
}
