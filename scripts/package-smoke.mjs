import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const outputDirectory = mkdtempSync(join(tmpdir(), 'cirelay-pack-'));
const packages = [
  {
    directory: 'packages/core',
    name: '@cirelay/core',
    version: '0.1.0-alpha.3',
    outputs: ['dist/index.js', 'dist/index.d.ts'],
  },
  {
    directory: 'packages/github',
    name: '@cirelay/github',
    version: '0.1.0-alpha.3',
    outputs: ['dist/index.js', 'dist/index.d.ts'],
    internalDependencies: ['@cirelay/core'],
  },
  {
    directory: 'packages/mcp',
    name: '@cirelay/mcp',
    version: '0.1.0-alpha.4',
    outputs: [
      'dist/index.js',
      'dist/index.d.ts',
      'dist/main.js',
      'dist/tool-descriptions.js',
      'dist/build-metadata.js',
    ],
    bin: 'dist/main.js',
    internalDependencies: ['@cirelay/core', '@cirelay/github'],
  },
];

function fail(message) {
  throw new Error(`Package smoke check failed: ${message}`);
}

function mcpSourceHash() {
  const sourceDirectory = join(root, 'packages/mcp/src');
  const hash = createHash('sha256');
  for (const file of readdirSync(sourceDirectory, { recursive: true })
    .filter((entry) => typeof entry === 'string')
    .filter((entry) => entry.endsWith('.ts') && entry !== 'build-metadata.ts')
    .sort()) {
    hash.update(file);
    hash.update('\0');
    hash.update(readFileSync(join(sourceDirectory, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

try {
  for (const candidate of packages) {
    // npm publish uses npm's pack implementation. Inspect that exact artifact
    // rather than relying on pnpm's workspace-protocol rewriting behavior.
    const output = execFileSync(
      'npm',
      ['pack', '--json', '--pack-destination', outputDirectory],
      {
        cwd: join(root, candidate.directory),
        encoding: 'utf8',
      },
    );
    // npm lifecycle output can precede the JSON when prepack builds the package.
    const jsonStart = output.lastIndexOf('\n[') + 1;
    const [{ filename: tarball } = {}] = JSON.parse(
      output.slice(jsonStart > 0 ? jsonStart : 0),
    );
    if (!tarball?.endsWith('.tgz'))
      fail(`npm pack did not report a tarball for ${candidate.name}`);

    const archive = join(outputDirectory, tarball);
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

    const packedLicense = execFileSync(
      'tar',
      ['-xOzf', archive, 'package/LICENSE'],
      { encoding: 'utf8' },
    );
    if (
      !packedLicense.includes('Apache License') ||
      !packedLicense.includes('Version 2.0')
    ) {
      fail(`${candidate.name} does not contain the Apache License 2.0 text`);
    }

    const packedManifest = JSON.parse(
      execFileSync('tar', ['-xOzf', archive, 'package/package.json'], {
        encoding: 'utf8',
      }),
    );
    if (packedManifest.name !== candidate.name)
      fail(`unexpected manifest name ${packedManifest.name}`);
    if (packedManifest.version !== candidate.version)
      fail(
        `${candidate.name} has version ${packedManifest.version}; expected ${candidate.version}`,
      );
    for (const dependency of candidate.internalDependencies ?? []) {
      const workspacePackage = packages.find(({ name }) => name === dependency);
      if (
        packedManifest.dependencies?.[dependency] !== workspacePackage?.version
      ) {
        fail(
          `${candidate.name} depends on ${dependency} at ${packedManifest.dependencies?.[dependency]}; expected ${workspacePackage?.version}`,
        );
      }
    }
    for (const dependencyField of [
      'dependencies',
      'optionalDependencies',
      'peerDependencies',
    ]) {
      for (const [dependency, version] of Object.entries(
        packedManifest[dependencyField] ?? {},
      )) {
        if (String(version).startsWith('workspace:'))
          fail(`${candidate.name} leaves ${dependency} as ${version}`);
      }
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
    if (candidate.name === '@cirelay/mcp') {
      const descriptionsRuntime = execFileSync(
        'tar',
        ['-xOzf', archive, 'package/dist/tool-descriptions.js'],
        { encoding: 'utf8' },
      );
      for (const policyPhrase of [
        'Primary diagnostic tool for CI failures',
        'complete raw CI job log only as a final fallback',
      ]) {
        if (!descriptionsRuntime.includes(policyPhrase))
          fail(`@cirelay/mcp runtime is missing ${policyPhrase}`);
      }
      const serverRuntime = execFileSync(
        'tar',
        ['-xOzf', archive, 'package/dist/server.js'],
        { encoding: 'utf8' },
      );
      if (!serverRuntime.includes("from './tool-descriptions.js'"))
        fail('@cirelay/mcp server does not import compiled tool descriptions');
      for (const staleDescription of [
        'Get the raw log for a CI job',
        'Resolve a single CI run and build structured failure evidence',
      ]) {
        if (serverRuntime.includes(staleDescription))
          fail(
            `@cirelay/mcp server contains stale inline text: ${staleDescription}`,
          );
      }
      if (!serverRuntime.includes("from './build-metadata.js'"))
        fail('@cirelay/mcp server does not import generated package metadata');
      const metadataRuntime = execFileSync(
        'tar',
        ['-xOzf', archive, 'package/dist/build-metadata.js'],
        { encoding: 'utf8' },
      );
      if (
        !metadataRuntime.includes(
          `PACKAGE_VERSION = ${JSON.stringify(packedManifest.version)}`,
        )
      )
        fail('@cirelay/mcp runtime version does not match its package version');
      const sourceHash = metadataRuntime.match(
        /SOURCE_HASH = "([a-f0-9]{64})"/,
      )?.[1];
      if (!sourceHash || sourceHash !== mcpSourceHash())
        fail('@cirelay/mcp tarball was not built from the current source');

      // Exercise the exact regression: a source edit made after the artifact was
      // built must invalidate that artifact, even if stale dist/ is still present.
      const descriptionsSource = join(
        root,
        'packages/mcp/src/tool-descriptions.ts',
      );
      const originalDescriptions = readFileSync(descriptionsSource, 'utf8');
      try {
        appendFileSync(
          descriptionsSource,
          '\n// stale-artifact regression probe\n',
        );
        if (sourceHash === mcpSourceHash())
          fail('source changes do not invalidate an existing MCP artifact');
      } finally {
        writeFileSync(descriptionsSource, originalDescriptions);
      }
      process.stdout.write('checked MCP stale-artifact regression\n');
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
