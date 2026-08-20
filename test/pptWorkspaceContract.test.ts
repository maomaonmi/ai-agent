import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";


test("new PPT workspaces do not render the workflow chain before a request", async () => {
  const source = await readFile(path.resolve(process.cwd(), "src/features/ppt/workspace/PptWorkspace.tsx"), "utf8");

  assert.match(source, /\{started && <section aria-label="AI 工作流链路"/);
  assert.match(source, /disabled=\{!started\}/);
  assert.match(source, /\{started && <button type="button" onClick=\{onRestart\}/);
});
