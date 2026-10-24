import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

test('e2e entry point replaces an obsolete dist before running Playwright', () => {
  mkdirSync('dist', { recursive: true });
  writeFileSync(
    'dist/index.html',
    '<!doctype html><title>Old build</title><p>Still-image-only release</p>',
  );
  const env = { ...process.env };
  delete env.TEST_BASE_URL;
  const result = spawnSync(process.execPath, ['scripts/run-e2e.mjs', '--list'], {
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const rebuilt = readFileSync('dist/index.html', 'utf8');
  assert.match(rebuilt, /crtvd-version/);
  assert.doesNotMatch(rebuilt, /Still-image-only release/);
  assert.match(result.stdout, /animated GIF uses one C\+\+ palette/);
});
