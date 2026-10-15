import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(resolve(frontendRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

test('Next.js development and production servers bind to loopback', () => {
  for (const scriptName of ['dev', 'dev:webpack', 'start']) {
    assert.match(packageJson.scripts[scriptName], /--hostname\s+127\.0\.0\.1/);
    assert.doesNotMatch(packageJson.scripts[scriptName], /0\.0\.0\.0/);
  }
});

test('Vite workbench and AI input servers bind to loopback on a stable port', () => {
  for (const configPath of [
    'src/Code/vite.config.ts',
    'ai-input/vite.config.ts',
  ]) {
    const config = readFileSync(resolve(frontendRoot, configPath), 'utf8');
    assert.match(config, /host:\s*['"]127\.0\.0\.1['"]/);
    assert.match(config, /strictPort:\s*true/);
    assert.doesNotMatch(config, /host:\s*true/);
  }
});
