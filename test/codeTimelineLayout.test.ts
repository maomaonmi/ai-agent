import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const timelineSource = readFileSync(
  resolve(testDirectory, '../src/components/CodeAgentTimeline.tsx'),
  'utf8',
);
const taskListSource = readFileSync(
  resolve(testDirectory, '../src/components/CodeTaskListCard.tsx'),
  'utf8',
);
const workspaceSource = readFileSync(
  resolve(testDirectory, '../src/components/CodeWorkspace.tsx'),
  'utf8',
);

assert.match(
  timelineSource,
  /<section aria-label="代码 AgentLoop 时间线" className="border-t border-slate-200 bg-slate-50 p-2">/,
  'The execution timeline should use a compact gray background',
);
assert.match(
  timelineSource,
  /<ol className="space-y-1">/,
  'The execution timeline should use compact event spacing',
);
assert.doesNotMatch(
  timelineSource,
  /className="[^\"]*border border-slate-200[^\"]*"/,
  'Timeline event cards should not render repeated slate borders',
);
const actorStyleBlock = timelineSource.match(
  /const ACTOR_STYLE:[\s\S]*?\n\};/,
)?.[0];
assert.ok(actorStyleBlock, 'Actor style map should be present');
assert.doesNotMatch(
  actorStyleBlock,
  /border-(blue|violet|amber|slate)-200/,
  'Actor labels should not add another border to every timeline lane',
);
assert.match(
  timelineSource,
  /<details className="rounded-md bg-slate-50"/g,
  'Expandable timeline entries should use the shared gray surface',
);
assert.doesNotMatch(
  timelineSource,
  /className="rounded-md bg-white[^\"]*"/,
  'Timeline event cards should not alternate back to the white surface',
);
assert.doesNotMatch(
  timelineSource,
  /bg-white px-2 py-2 text-sm leading-5 text-slate-700/,
  'Timeline output entries should use the shared gray surface instead of white',
);
assert.doesNotMatch(
  taskListSource,
  /className="mb-3 rounded-xl border border-slate-200[^\"]*"/,
  'The task list should not be another bordered card inside the timeline',
);
assert.doesNotMatch(
  taskListSource,
  /className="mb-2 rounded-lg bg-slate-50[^\"]*"/,
  'The task list should use the same gray surface as timeline events',
);

assert.doesNotMatch(
  workspaceSource,
  /className="border-l-2 border-slate-200 pl-2"/,
  'The expanded timeline should not add a second vertical border',
);
const modelControlStart = workspaceSource.indexOf(
  '<div className="mb-1 flex min-w-0 items-center justify-between gap-2">',
);
const selectedElementStart = workspaceSource.indexOf('{selectedElement &&', modelControlStart);
assert.ok(modelControlStart >= 0 && selectedElementStart > modelControlStart, 'Code input controls row should be present');
const modelControlRow = workspaceSource.slice(modelControlStart, selectedElementStart);
assert.match(modelControlRow, /modelControl/, 'Model selector should remain in the first input controls row');
assert.match(modelControlRow, /\{isMultimodal && \(/, 'Image attachment control should share the first input controls row');
assert.match(modelControlRow, /\+ 图片/, 'The + 图片 action should share the first input controls row');
