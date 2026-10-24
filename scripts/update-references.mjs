import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const cases = JSON.parse(readFileSync('tests/reference/cases.json'));
const executable =
  process.platform === 'win32' ? 'build/native-release/crtvd.exe' : 'build/native-release/crtvd';
for (const entry of cases) {
  const args = ['tests/reference/input-scene.png', `tests/reference/${entry.name}.png`, '--force'];
  for (const [key, value] of Object.entries(entry.options)) args.push('--' + key, String(value));
  const result = spawnSync(executable, args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
writeFileSync(
  'tests/reference/manifest.json',
  JSON.stringify(
    {
      version: '0.3.0',
      inputSha256: createHash('sha256')
        .update(readFileSync('tests/reference/input-scene.png'))
        .digest('hex'),
      origin: 'Frozen native C++ baseline; inspect PNGs before committing an update.',
      tolerance: { rgbDifferentPixelsFraction: 0.005, ignoredChannelDelta: 2, alphaDelta: 0 },
      cases: cases.map((c) => c.name),
    },
    null,
    2,
  ) + '\n',
);
