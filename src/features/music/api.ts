"use client";

export type SunoMode = "inspiration" | "custom";
export type SunoTaskStatus =
  | "SUBMITTED"
  | "QUEUED"
  | "PROCESSING"
  | "TEXT_SUCCESS"
  | "FIRST_SUCCESS"
  | "SUCCESS"
  | "FAILED"
  | "TIMED_OUT"
  | (string & {});

export interface SunoClip {
  id: string;
  variant_index: number;
  provider_clip_id?: string | null;
  title?: string | null;
  prompt?: string | null;
  tags?: string | null;
  model_name?: string | null;
  duration?: number | null;
  audio_url?: string | null;
  stream_audio_url?: string | null;
  image_url?: string | null;
  audio_asset_id?: string | null;
  image_asset_id?: string | null;
  status?: string | null;
  lyrics?: unknown;
  waveform?: unknown;
}

export interface SunoTask {
  id: string;
  task_id: string;
  provider_task_id?: string | null;
  mode: SunoMode;
  model: string;
  status: SunoTaskStatus;
  progress: number;
  provider_status?: string | null;
  request: Record<string, unknown>;
  clips: SunoClip[];
  error?: { code?: string | null; message?: string | null } | null;
  created_at?: number | null;
  updated_at?: number | null;
  completed_at?: number | null;
}

export interface SunoGenerateInput {
  mode: SunoMode;
  prompt?: string;
  style?: string;
  title?: string;
  instrumental?: boolean;
  model?: string;
  negativeTags?: string;
  vocalGender?: "m" | "f";
  clientRequestId?: string;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = body?.error;
    throw new Error(error?.message || "Suno 请求失败");
  }
  return body as T;
}

export function generateSunoMusic(input: SunoGenerateInput): Promise<SunoTask> {
  return requestJson<SunoTask>("/api/suno/generate", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getSunoTask(taskId: string): Promise<SunoTask> {
  return requestJson<SunoTask>(`/api/suno/tasks/${encodeURIComponent(taskId)}`);
}

export async function listSunoTasks(): Promise<SunoTask[]> {
  const result = await requestJson<{ tasks: SunoTask[] }>("/api/suno/tasks?pageSize=50");
  return result.tasks || [];
}

export function deleteSunoTask(taskId: string): Promise<{ deleted: boolean; task_id: string }> {
  return requestJson(`/api/suno/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" });
}

export function openSunoTaskStream(
  taskId: string,
  onTask: (task: SunoTask) => void,
  onError?: () => void,
): EventSource {
  const source = new EventSource(`${API_BASE_URL}/api/suno/tasks/${encodeURIComponent(taskId)}/stream`);
  const handle = (event: MessageEvent<string>) => {
    try {
      const payload = JSON.parse(event.data) as SunoTask | { payload?: unknown };
      if ("clips" in payload && "status" in payload) onTask(payload as SunoTask);
      else if (payload && typeof payload === "object" && "payload" in payload) {
        void getSunoTask(taskId).then(onTask).catch(() => undefined);
      }
    } catch {
      onError?.();
    }
  };
  source.addEventListener("snapshot", handle);
  source.addEventListener("status", handle);
  source.addEventListener("result", handle);
  source.addEventListener("error", () => onError?.());
  return source;
}

export function resolveSunoAssetUrl(url?: string | null): string | null {
  if (!url) return null;
  return url.startsWith("/") ? `${API_BASE_URL}${url}` : url;
}
