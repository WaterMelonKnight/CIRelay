import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const outputDirectory = mkdtempSync(join(tmpdir(), 'cirelay-pack-'));
const packages = [
  {
    directory: 'packages/core',
    name: '@cirelay/core',
    outputs: ['dist/index.js', 'dist/index.d.ts'],
  },
  {
    directory: 'packages/github',
    name: '@cirelay/github',
    outputs: ['dist/index.js', 'dist/index.d.ts'],
  },
  {
    directory: 'packages/mcp',
    name: '@cirelay/mcp',
    outputs: ['dist/index.js', 'dist/index.d.ts', 'dist/main.js'],
    bin: 'dist/main.js',
  },
];

function fail(message) {
  throw new Error(`Package smoke check failed: ${message}`);
}

try {
  for (const candidate of packages) {
    const output = execFileSync(
      'pnpm',
      ['pack', '--pack-destination', outputDirectory],
      {
        cwd: join(root, candidate.directory),
        encoding: 'utf8',
      },
    ).trim();
    const tarball = output.split(/\r?\n/).at(-1);
    if (!tarball?.endsWith('.tgz'))
      fail(`pnpm pack did not report a tarball for ${candidate.name}`);

    const archive = resolve(join(root, candidate.directory), tarball);
    const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
      .trim()
      .split(/\r?\n/);
    for (const expected of [
      'package/package.json',
      'package/README.md',
      'package/LICENSE',
      ...candidate.outputs.map((file) => `package/${file}`),
    ]) {
      if (!entries.includes(expected))
        fail(`${candidate.name} is missing ${expected}`);
    }
    const unwanted = entries.find((entry) =>
      /(^|\/)(src|coverage|node_modules|fixtures)(\/|$)/.test(entry),
    );
    if (unwanted) fail(`${candidate.name} includes unwanted path ${unwanted}`);

    const packedManifest = JSON.parse(
      execFileSync('tar', ['-xOzf', archive, 'package/package.json'], {
        encoding: 'utf8',
      }),
    );
    if (packedManifest.name !== candidate.name)
      fail(`unexpected manifest name ${packedManifest.name}`);
    for (const [dependency, version] of Object.entries(
      packedManifest.dependencies ?? {},
    )) {
      if (String(version).startsWith('workspace:'))
        fail(`${candidate.name} leaves ${dependency} as ${version}`);
    }
    if (candidate.bin) {
      const targets = Object.values(packedManifest.bin ?? {}).map((target) =>
        String(target).replace(/^\.\//, ''),
      );
      if (
        !targets.includes(candidate.bin) ||
        !entries.includes(`package/${candidate.bin}`)
      )
        fail(`${candidate.name} has an invalid bin target`);
      const main = execFileSync(
        'tar',
        ['-xOzf', archive, `package/${candidate.bin}`],
        { encoding: 'utf8' },
      );
      if (!main.startsWith('#!/usr/bin/env node'))
        fail(`${candidate.name} bin has no Node shebang`);
    }
    process.stdout.write(
      `checked ${candidate.name}: ${entries.length} files, ${readFileSync(archive).byteLength} bytes\n`,
    );
  }

  const startup = spawnSync(process.execPath, ['packages/mcp/dist/main.js'], {
    cwd: root,
    env: { ...process.env, GITHUB_TOKEN: '' },
    encoding: 'utf8',
  });
  if (
    startup.status === 0 ||
    startup.stdout !== '' ||
    !startup.stderr.includes('GITHUB_TOKEN is required')
  ) {
    fail(
      'MCP startup errors must fail on stderr without writing to protocol stdout',
    );
  }
  process.stdout.write('checked MCP startup error channel\n');
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}
