import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  PresentationContractError,
  parsePresentationDocumentV1,
} from "../src/features/ppt/types.ts";


async function golden(): Promise<Record<string, unknown>> {
  const fixture = path.resolve(process.cwd(), "../../tests/fixtures/ppt_document_v1.json");
  return JSON.parse(await readFile(fixture, "utf8")) as Record<string, unknown>;
}


test("TypeScript accepts the shared PresentationDocument golden JSON", async () => {
  const raw = await golden();

  const document = parsePresentationDocumentV1(raw);

  assert.deepEqual(document, raw);
  assert.deepEqual(
    new Set(document.slides[0].elements.map((element) => element.type)),
    new Set(["TEXT", "IMAGE", "SHAPE", "TABLE", "CHART", "MEDIA", "GROUP"]),
  );
});


test("TypeScript rejects unknown fields and out-of-bounds geometry", async () => {
  const unknown = await golden();
  const unknownSlide = (unknown.slides as Array<Record<string, unknown>>)[0];
  unknownSlide.surprise = true;
  assert.throws(
    () => parsePresentationDocumentV1(unknown),
    (error: unknown) => error instanceof PresentationContractError && error.code === "PPT_DOCUMENT_INVALID",
  );

  const outOfBounds = await golden();
  const slide = (outOfBounds.slides as Array<Record<string, unknown>>)[0];
  const element = (slide.elements as Array<Record<string, unknown>>)[0];
  element.x = 0.99;
  assert.throws(() => parsePresentationDocumentV1(outOfBounds), /normalized canvas/);
});
