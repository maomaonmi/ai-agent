import type { PresentationDocument } from "./types.ts";

const DEFAULT_API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type PptTemplateSource = "SYSTEM" | "PRIVATE";
export type PptTemplateStatus = "UPLOADING" | "SCANNING" | "PARSING" | "RENDERING" | "READY" | "FAILED";

export interface PptTemplate {
  id: string;
  name: string;
  description: string | null;
  scene: string;
  source: PptTemplateSource;
  isPrivate: boolean;
  status: PptTemplateStatus;
  pageCount: number;
  coverUrl: string | null;
  createdAt: string;
  updatedAt: string;
  manifest?: Record<string, unknown>;
}

export interface PptTemplatePage {
  pageNumber: number;
  status: string;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  errorCode?: string;
}

export interface PptTemplateListParams {
  page: number;
  pageSize: number;
  scene?: string;
  source?: PptTemplateSource;
  query?: string;
}

export interface PptTemplateListResponse {
  templates: PptTemplate[];
  pagination: {
    page: number;
    pageSize: number;
    hasMore: boolean;
  };
}

export interface PptPresentationResponse {
  presentationId: string;
  title: string;
  templateId: string | null;
  revision: number;
  document: PresentationDocument;
  createdAt: string;
  updatedAt: string;
  ignoredOperationIds?: string[];
}

export interface CreatePptPresentationInput {
  presentationId?: string;
  templateId?: string;
  title?: string;
  document?: PresentationDocument;
}

export interface ApplyPptOperationsInput {
  baseRevision: number;
  operations: Array<Record<string, unknown>>;
}

export type PptRunStatus = "QUEUED" | "RUNNING" | "PAUSED" | "COMPLETED" | "CANCELLED" | "FAILED";

export interface PptRunResponse {
  runId: string;
  presentationId: string;
  status: PptRunStatus;
  phase: string;
  state: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PptRunListResponse {
  runs: PptRunResponse[];
}

export interface PptRunEvent {
  id: number;
  type: string;
  data: Record<string, unknown>;
}

export interface PptRunEventOptions {
  after?: number;
  signal?: AbortSignal;
}

export interface CreatePptRunInput {
  runId?: string;
  presentationId: string;
  prompt: string;
  maxIterations?: number;
  modelProvider?: "deepseek" | "qwen" | "glm";
  searchProvider?: "auto" | "firecrawl" | "qwen" | "glm";
  searchLimit?: number;
}

interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

export class PptApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "PptApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function jsonOrEmpty(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (response.status === 204 || !contentType.includes("application/json")) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function queryString(params: PptTemplateListParams): string {
  const search = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.scene) search.set("scene", params.scene);
  if (params.source) search.set("source", params.source);
  if (params.query) search.set("q", params.query);
  return search.toString();
}

export interface PptApi {
  listTemplates(params: PptTemplateListParams, signal?: AbortSignal): Promise<PptTemplateListResponse>;
  getTemplate(templateId: string, signal?: AbortSignal): Promise<PptTemplate>;
  getTemplatePages(templateId: string, signal?: AbortSignal): Promise<PptTemplatePage[]>;
  updateTemplate(templateId: string, patch: { name?: string; description?: string; scene?: string }): Promise<PptTemplate>;
  deleteTemplate(templateId: string): Promise<void>;
  createPresentation(input?: CreatePptPresentationInput, signal?: AbortSignal): Promise<PptPresentationResponse>;
  getPresentation(presentationId: string, signal?: AbortSignal): Promise<PptPresentationResponse>;
  applyOperations(presentationId: string, input: ApplyPptOperationsInput, signal?: AbortSignal): Promise<PptPresentationResponse>;
  createRun(input: CreatePptRunInput, signal?: AbortSignal): Promise<PptRunResponse>;
  listResumableRuns(signal?: AbortSignal): Promise<PptRunListResponse>;
  getRun(runId: string, signal?: AbortSignal): Promise<PptRunResponse>;
  subscribeRunEvents(runId: string, onEvent: (event: PptRunEvent) => void, options?: PptRunEventOptions): Promise<void>;
  cancelRun(runId: string): Promise<PptRunResponse>;
}

async function consumeSse(
  response: Response,
  onEvent: (event: PptRunEvent) => void,
): Promise<void> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventId = 0;
  let eventType = "message";
  let dataLines: string[] = [];

  const dispatch = () => {
    if (dataLines.length === 0) {
      eventType = "message";
      eventId = 0;
      return;
    }
    const raw = dataLines.join("\n");
    let data: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      data = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : { value: parsed };
    } catch {
      data = { value: raw };
    }
    onEvent({ id: eventId, type: eventType, data });
    eventType = "message";
    eventId = 0;
    dataLines = [];
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const rawLine = buffer.slice(0, newlineIndex).replace(/\r$/, "");
      buffer = buffer.slice(newlineIndex + 1);
      if (rawLine === "") dispatch();
      else if (!rawLine.startsWith(":")) {
        const separator = rawLine.indexOf(":");
        const field = separator >= 0 ? rawLine.slice(0, separator) : rawLine;
        const valueText = separator >= 0 ? rawLine.slice(separator + 1).replace(/^ /, "") : "";
        if (field === "id") {
          const parsedId = Number(valueText);
          if (Number.isFinite(parsedId)) eventId = parsedId;
        } else if (field === "event") eventType = valueText;
        else if (field === "data") dataLines.push(valueText);
      }
      newlineIndex = buffer.indexOf("\n");
    }
    if (done) break;
  }
  if (buffer.trim() || dataLines.length > 0) {
    if (buffer) {
      const rawLine = buffer.replace(/\r$/, "");
      const separator = rawLine.indexOf(":");
      const field = separator >= 0 ? rawLine.slice(0, separator) : rawLine;
      const valueText = separator >= 0 ? rawLine.slice(separator + 1).replace(/^ /, "") : "";
      if (field === "data") dataLines.push(valueText);
    }
    dispatch();
  }
}

export function createPptApi(baseUrl = DEFAULT_API_BASE_URL): PptApi {
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    const payload = await jsonOrEmpty(response);
    if (!response.ok) {
      const apiError = (payload ?? {}) as ApiErrorPayload;
      throw new PptApiError(
        apiError.error?.code ?? "PPT_REQUEST_FAILED",
        apiError.error?.message ?? `PPT request failed (${response.status})`,
        response.status,
        apiError.error?.details,
      );
    }
    return payload as T;
  };

  return {
    listTemplates: (params, signal) => request<PptTemplateListResponse>(
      `/api/ppt/templates?${queryString(params)}`,
      { signal },
    ),
    getTemplate: (templateId, signal) => request<PptTemplate>(
      `/api/ppt/templates/${encodeURIComponent(templateId)}`,
      { signal },
    ),
    getTemplatePages: async (templateId, signal) => {
      const payload = await request<{ pages: PptTemplatePage[] }>(
        `/api/ppt/templates/${encodeURIComponent(templateId)}/pages`,
        { signal },
      );
      return payload.pages;
    },
    updateTemplate: (templateId, patch) => request<PptTemplate>(
      `/api/ppt/templates/${encodeURIComponent(templateId)}`,
      { method: "PATCH", body: JSON.stringify(patch) },
    ),
    deleteTemplate: async (templateId) => {
      await request<null>(`/api/ppt/templates/${encodeURIComponent(templateId)}`, { method: "DELETE" });
    },
    createPresentation: (input = {}, signal) => request<PptPresentationResponse>(
      "/api/ppt/presentations",
      { method: "POST", body: JSON.stringify(input), signal },
    ),
    getPresentation: (presentationId, signal) => request<PptPresentationResponse>(
      `/api/ppt/presentations/${encodeURIComponent(presentationId)}`,
      { signal },
    ),
    applyOperations: (presentationId, input, signal) => request<PptPresentationResponse>(
      `/api/ppt/presentations/${encodeURIComponent(presentationId)}/operations`,
      { method: "POST", body: JSON.stringify(input), signal },
    ),
    createRun: (input, signal) => request<PptRunResponse>(
      "/api/ppt/runs",
      { method: "POST", body: JSON.stringify(input), signal },
    ),
    listResumableRuns: (signal) => request<PptRunListResponse>(
      "/api/ppt/runs/resumable",
      { signal },
    ),
    getRun: (runId, signal) => request<PptRunResponse>(
      `/api/ppt/runs/${encodeURIComponent(runId)}`,
      { signal },
    ),
    subscribeRunEvents: async (runId, onEvent, options = {}) => {
      const search = new URLSearchParams({ follow: "true" });
      const headers = new Headers();
      if (options.after && options.after > 0) headers.set("Last-Event-ID", String(options.after));
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/ppt/runs/${encodeURIComponent(runId)}/events?${search}`, {
        signal: options.signal,
        headers,
      });
      if (!response.ok) {
        const payload = await jsonOrEmpty(response);
        const apiError = (payload ?? {}) as ApiErrorPayload;
        throw new PptApiError(
          apiError.error?.code ?? "PPT_EVENT_STREAM_FAILED",
          apiError.error?.message ?? `PPT event stream failed (${response.status})`,
          response.status,
          apiError.error?.details,
        );
      }
      await consumeSse(response, onEvent);
    },
    cancelRun: (runId) => request<PptRunResponse>(
      `/api/ppt/runs/${encodeURIComponent(runId)}/cancel`,
      { method: "POST" },
    ),
  };
}

export const pptApi = createPptApi();
