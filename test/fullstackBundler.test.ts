import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bundleFullstackVFS,
  getProjectManifest,
  isFullstackVFS,
  PROJECT_MANIFEST_PATH,
} from '../src/Code/fullstackBundler.ts';

test('manifest-based projects can use arbitrary frontend/backend paths', () => {
  const vfs = {
    [PROJECT_MANIFEST_PATH]: JSON.stringify({
      schema_version: 1,
      kind: 'fullstack',
      frontend: { entry: 'web/home.html', asset_roots: ['web'] },
      backend: { entry: 'services/main.py', source_roots: ['services'] },
      data: { files: ['storage/tasks.json'] },
      preview: { api_mode: 'mock' },
    }),
    'web/home.html': '<!doctype html><head><link rel="stylesheet" href="assets/site.css"></head><body><script src="scripts/app.js"></script></body>',
    'web/assets/site.css': 'body { color: red; }',
    'web/scripts/app.js': "fetch('/api/tasks')",
    'services/main.py': "@app.get('/api/tasks')\ndef tasks(): pass",
    'services/routes.py': '# route helpers',
    'storage/tasks.json': '{"tasks": []}',
  };

  assert.equal(isFullstackVFS(vfs), true);
  assert.equal(getProjectManifest(vfs)?.frontend.entry, 'web/home.html');

  const bundled = bundleFullstackVFS(vfs, { runId: 'manifest-test' });
  assert.match(bundled, /body \{ color: red; \}/);
  assert.match(bundled, /fetch\('\/api\/tasks'\)/);
  assert.match(bundled, /tasks/);
  assert.match(bundled, /manifest-test/);
});

test('static manifest is not mistaken for a full-stack project', () => {
  const vfs = {
    [PROJECT_MANIFEST_PATH]: JSON.stringify({
      schema_version: 1,
      kind: 'static',
      frontend: { entry: 'site/index.html' },
    }),
    'site/index.html': '<main>static</main>',
  };

  assert.equal(isFullstackVFS(vfs), false);
  assert.equal(getProjectManifest(vfs)?.kind, 'static');
});
