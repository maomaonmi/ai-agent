import assert from "node:assert/strict";
import test from "node:test";

import { createStore } from "zustand/vanilla";

import {
  PptApiError,
  createPptApi,
  type PptPresentationResponse,
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


test("presentation API creates, loads, and commits operations with camel-case contract", async () => {
  const originalFetch = globalThis.fetch;
  const api = createPptApi("http://ppt.test");
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const response: PptPresentationResponse = {
    presentationId: "presentation-1",
    title: "协作",
    templateId: null,
    revision: 0,
    document: {} as PptPresentationResponse["document"],
    createdAt: "2026-08-20T00:00:00Z",
    updatedAt: "2026-08-20T00:00:00Z",
  };
  try {
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify(response), {
        status: calls.length === 1 ? 201 : 200,
        headers: { "content-type": "application/json" },
      });
    };

    await api.createPresentation({ title: "协作", templateId: "blank" });
    await api.getPresentation("presentation-1");
    await api.applyOperations("presentation-1", {
      baseRevision: 0,
      operations: [{ operationId: "op-1", type: "SET_NOTES", slideId: "slide-1", notes: "备注" }],
    });

    assert.equal(calls[0].url, "http://ppt.test/api/ppt/presentations");
    assert.equal(calls[1].url, "http://ppt.test/api/ppt/presentations/presentation-1");
    assert.equal(calls[2].url, "http://ppt.test/api/ppt/presentations/presentation-1/operations");
    assert.deepEqual(JSON.parse(String(calls[2].init?.body)), {
      baseRevision: 0,
      operations: [{ operationId: "op-1", type: "SET_NOTES", slideId: "slide-1", notes: "备注" }],
    });
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
