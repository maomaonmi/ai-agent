import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { StateCreator } from "zustand/vanilla";

import {
  pptApi,
  type PptApi,
  type PptTemplate,
  type PptTemplateSource,
} from "./api.ts";


export interface PptTemplateFilters {
  scene: string | null;
  source: PptTemplateSource | null;
  query: string;
}

export interface PptUploadTask {
  id: string;
  fileName: string;
  status: "QUEUED" | "UPLOADING" | "PROCESSING" | "READY" | "FAILED";
  progress: number;
  templateId?: string;
  template?: PptTemplate;
  pageCount?: number;
  scene?: string;
  description?: string;
  coverUrl?: string | null;
  errorCode?: string;
}

export interface PptMarketState {
  templates: PptTemplate[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  filters: PptTemplateFilters;
  uploads: PptUploadTask[];
  setFilters: (patch: Partial<PptTemplateFilters>) => void;
  loadFirstPage: () => Promise<void>;
  loadMore: () => Promise<void>;
  upsertUpload: (upload: PptUploadTask) => void;
  removeUpload: (uploadId: string) => void;
  restoreUploads: (uploads: PptUploadTask[]) => void;
  reset: () => void;
}

type PptListApi = Pick<PptApi, "listTemplates">;

const initialFilters: PptTemplateFilters = { scene: null, source: null, query: "" };

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function createPptMarketState(api: PptListApi): StateCreator<PptMarketState> {
  let activeController: AbortController | null = null;
  return (set, get) => ({
    templates: [],
    page: 0,
    pageSize: 24,
    hasMore: true,
    loading: false,
    error: null,
    filters: initialFilters,
    uploads: [],
    setFilters: (patch) => set((state) => ({ filters: { ...state.filters, ...patch } })),
    loadFirstPage: async () => {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      const state = get();
      set({ loading: true, error: null });
      try {
        const response = await api.listTemplates({
          page: 1,
          pageSize: state.pageSize,
          scene: state.filters.scene ?? undefined,
          source: state.filters.source ?? undefined,
          query: state.filters.query.trim() || undefined,
        }, controller.signal);
        if (controller.signal.aborted) return;
        set({
          templates: response.templates,
          page: response.pagination.page,
          hasMore: response.pagination.hasMore,
          loading: false,
        });
      } catch (error) {
        if (!isAbort(error) && !controller.signal.aborted) {
          set({ loading: false, error: error instanceof Error ? error.message : "模板加载失败" });
        }
      } finally {
        if (activeController === controller) activeController = null;
      }
    },
    loadMore: async () => {
      const state = get();
      if (state.loading || !state.hasMore) return;
      const controller = new AbortController();
      activeController = controller;
      set({ loading: true, error: null });
      try {
        const response = await api.listTemplates({
          page: state.page + 1,
          pageSize: state.pageSize,
          scene: state.filters.scene ?? undefined,
          source: state.filters.source ?? undefined,
          query: state.filters.query.trim() || undefined,
        }, controller.signal);
        if (controller.signal.aborted) return;
        set((current) => {
          const byId = new Map(current.templates.map((item) => [item.id, item]));
          for (const item of response.templates) byId.set(item.id, item);
          return {
            templates: [...byId.values()],
            page: response.pagination.page,
            hasMore: response.pagination.hasMore,
            loading: false,
          };
        });
      } catch (error) {
        if (!isAbort(error) && !controller.signal.aborted) {
          set({ loading: false, error: error instanceof Error ? error.message : "模板加载失败" });
        }
      } finally {
        if (activeController === controller) activeController = null;
      }
    },
    upsertUpload: (upload) => set((state) => ({
      uploads: state.uploads.some((item) => item.id === upload.id)
        ? state.uploads.map((item) => item.id === upload.id ? upload : item)
        : [upload, ...state.uploads],
    })),
    removeUpload: (uploadId) => set((state) => ({
      uploads: state.uploads.filter((item) => item.id !== uploadId),
    })),
    restoreUploads: (uploads) => set({ uploads: uploads.slice(0, 20) }),
    reset: () => {
      activeController?.abort();
      activeController = null;
      set({
        templates: [],
        page: 0,
        hasMore: true,
        loading: false,
        error: null,
        filters: initialFilters,
      });
    },
  });
}

const memoryStorage: Storage = {
  length: 0,
  clear: () => undefined,
  getItem: () => null,
  key: () => null,
  removeItem: () => undefined,
  setItem: () => undefined,
};

export const usePptMarketStore = create<PptMarketState>()(persist(
  createPptMarketState(pptApi),
  {
    name: "ppt-market-store-v1",
    storage: createJSONStorage(() => typeof window === "undefined" ? memoryStorage : window.localStorage),
    partialize: (state) => ({ uploads: state.uploads }) as PptMarketState,
    skipHydration: true,
  },
));
