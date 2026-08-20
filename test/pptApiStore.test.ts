import assert from "node:assert/strict";
import test from "node:test";

import { createStore } from "zustand/vanilla";

import {
  PptApiError,
  createPptApi,
  type PptTemplateListResponse,
} from "../src/features/ppt/api.ts";
import {
  createPptMarketState,
  type PptMarketState,
} from "../src/features/ppt/store.ts";


const template = (id: string) => ({
  id,
  name: id,
  description: null,
  scene: "BUSINESS",
  source: "SYSTEM" as const,
  isPrivate: false,
  status: "READY" as const,
  pageCount: 12,
  coverUrl: null,
  createdAt: "2026-08-20T00:00:00Z",
  updatedAt: "2026-08-20T00:00:00Z",
});


test("PPT API types list responses and stable errors", async () => {
  const originalFetch = globalThis.fetch;
  const api = createPptApi("http://ppt.test");
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      templates: [template("template-1")],
      pagination: { page: 1, pageSize: 24, hasMore: false },
    }), { status: 200, headers: { "content-type": "application/json" } });
    const result = await api.listTemplates({ page: 1, pageSize: 24 });
    assert.equal(result.templates[0].id, "template-1");

    globalThis.fetch = async () => new Response(JSON.stringify({
      error: { code: "PPT_TEMPLATE_NOT_FOUND", message: "missing" },
    }), { status: 404, headers: { "content-type": "application/json" } });
    await assert.rejects(
      () => api.getTemplate("missing"),
      (error: unknown) => error instanceof PptApiError
        && error.code === "PPT_TEMPLATE_NOT_FOUND"
        && error.status === 404,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("market store cancels stale list requests before applying results", async () => {
  const pending: Array<{
    signal: AbortSignal;
    resolve: (value: PptTemplateListResponse) => void;
  }> = [];
  const api = {
    listTemplates: (_params: unknown, signal?: AbortSignal) => new Promise<PptTemplateListResponse>((resolve) => {
      pending.push({ signal: signal!, resolve });
    }),
  };
  const store = createStore<PptMarketState>(createPptMarketState(api));

  const first = store.getState().loadFirstPage();
  const second = store.getState().loadFirstPage();
  assert.equal(pending[0].signal.aborted, true);
  pending[1].resolve({ templates: [template("new")], pagination: { page: 1, pageSize: 24, hasMore: false } });
  await second;
  pending[0].resolve({ templates: [template("stale")], pagination: { page: 1, pageSize: 24, hasMore: false } });
  await first;

  assert.deepEqual(store.getState().templates.map((item) => item.id), ["new"]);
});


test("upload task state can be restored after remount", () => {
  const api = { listTemplates: async () => ({ templates: [], pagination: { page: 1, pageSize: 24, hasMore: false } }) };
  const first = createStore<PptMarketState>(createPptMarketState(api));
  first.getState().upsertUpload({
    id: "upload-1",
    fileName: "brand.pptx",
    status: "PROCESSING",
    progress: 62,
  });
  const snapshot = first.getState().uploads;
  const remounted = createStore<PptMarketState>(createPptMarketState(api));

  remounted.getState().restoreUploads(snapshot);

  assert.equal(remounted.getState().uploads[0].progress, 62);
});
