import { load } from 'js-yaml';
import type { ExtractionProfileName } from './extraction-profiles.js';
import type { RepositoryRef } from './types.js';

export const CONFIG_LIMITS = {
  patterns: 20,
  patternLength: 200,
  context: 20,
  maxExcerptLines: 500,
} as const;

export interface CiRelayConfig {
  version: 1;
  extractionProfile?: ExtractionProfileName;
  logExtraction?: {
    include?: string[];
    exclude?: string[];
    context?: { before?: number; after?: number };
    maxExcerptLines?: number;
  };
}

export interface RepositoryConfigSource {
  getConfig(
    repository: RepositoryRef,
    ref?: string,
  ): Promise<CiRelayConfig | undefined>;
}

export type CiRelayConfigErrorCode = 'invalid-config' | 'unsupported-version';

export class CiRelayConfigError extends Error {
  constructor(
    public readonly code: CiRelayConfigErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CiRelayConfigError';
  }
}

const profiles = new Set(['generic', 'java-maven', 'java-spring', 'node-pnpm']);
const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

function allowedKeys(
  value: Record<string, unknown>,
  keys: string[],
  path: string,
) {
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  if (unknown) invalid(`${path} contains unsupported field ${unknown}`);
}

function invalid(message: string): never {
  throw new CiRelayConfigError('invalid-config', message);
}

function patterns(value: unknown, path: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > CONFIG_LIMITS.patterns)
    invalid(
      `${path} must be an array of at most ${CONFIG_LIMITS.patterns} literals`,
    );
  return value.map((item, index) => {
    if (
      typeof item !== 'string' ||
      item.length === 0 ||
      item.length > CONFIG_LIMITS.patternLength
    )
      invalid(
        `${path}[${index}] must be a non-empty literal of at most ${CONFIG_LIMITS.patternLength} characters`,
      );
    return item;
  });
}

function boundedInteger(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
) {
  if (
    !Number.isInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  )
    invalid(`${path} must be an integer from ${minimum} to ${maximum}`);
  return value as number;
}

export function validateCiRelayConfig(value: unknown): CiRelayConfig {
  const root = record(value);
  if (!root) invalid('configuration must be a YAML mapping');
  allowedKeys(
    root,
    ['version', 'extractionProfile', 'logExtraction'],
    'configuration',
  );
  if (root.version !== 1)
    throw new CiRelayConfigError(
      'unsupported-version',
      'Only CIRelay configuration version 1 is supported',
    );
  const profile = root.extractionProfile;
  if (
    profile !== undefined &&
    (typeof profile !== 'string' || !profiles.has(profile))
  )
    invalid('extractionProfile is not supported');
  const extraction =
    root.logExtraction === undefined ? undefined : record(root.logExtraction);
  if (root.logExtraction !== undefined && !extraction)
    invalid('logExtraction must be a mapping');
  if (extraction)
    allowedKeys(
      extraction,
      ['include', 'exclude', 'context', 'maxExcerptLines'],
      'logExtraction',
    );
  const context =
    extraction?.context === undefined ? undefined : record(extraction.context);
  if (extraction?.context !== undefined && !context)
    invalid('logExtraction.context must be a mapping');
  if (context)
    allowedKeys(context, ['before', 'after'], 'logExtraction.context');
  const include = patterns(extraction?.include, 'logExtraction.include');
  const exclude = patterns(extraction?.exclude, 'logExtraction.exclude');
  const before =
    context?.before === undefined
      ? undefined
      : boundedInteger(
          context.before,
          'logExtraction.context.before',
          0,
          CONFIG_LIMITS.context,
        );
  const after =
    context?.after === undefined
      ? undefined
      : boundedInteger(
          context.after,
          'logExtraction.context.after',
          0,
          CONFIG_LIMITS.context,
        );
  const maxExcerptLines =
    extraction?.maxExcerptLines === undefined
      ? undefined
      : boundedInteger(
          extraction.maxExcerptLines,
          'logExtraction.maxExcerptLines',
          1,
          CONFIG_LIMITS.maxExcerptLines,
        );
  return {
    version: 1,
    ...(profile ? { extractionProfile: profile as ExtractionProfileName } : {}),
    ...(extraction
      ? {
          logExtraction: {
            ...(include ? { include } : {}),
            ...(exclude ? { exclude } : {}),
            ...(context
              ? {
                  context: {
                    ...(before !== undefined ? { before } : {}),
                    ...(after !== undefined ? { after } : {}),
                  },
                }
              : {}),
            ...(maxExcerptLines !== undefined ? { maxExcerptLines } : {}),
          },
        }
      : {}),
  };
}

export function parseCiRelayConfig(yaml: string): CiRelayConfig {
  try {
    if (yaml.length > 65_536)
      invalid('configuration must not exceed 65536 characters');
    return validateCiRelayConfig(load(yaml));
  } catch (error) {
    if (error instanceof CiRelayConfigError) throw error;
    throw new CiRelayConfigError(
      'invalid-config',
      'Unable to parse CIRelay YAML configuration',
      { cause: error },
    );
  }
}

export interface ExtractionOptions {
  profile: ExtractionProfileName;
  includePatterns: string[];
  excludePatterns: string[];
  contextBefore: number;
  contextAfter: number;
  maxExcerptLines: number;
}

export function resolveExtractionOptions(input: {
  repositoryConfig?: CiRelayConfig;
  invocationOptions?: Partial<ExtractionOptions>;
}): ExtractionOptions {
  const config = input.repositoryConfig;
  const log = config?.logExtraction;
  return {
    profile:
      input.invocationOptions?.profile ??
      config?.extractionProfile ??
      'generic',
    includePatterns:
      input.invocationOptions?.includePatterns ?? log?.include ?? [],
    excludePatterns:
      input.invocationOptions?.excludePatterns ?? log?.exclude ?? [],
    contextBefore:
      input.invocationOptions?.contextBefore ?? log?.context?.before ?? 2,
    contextAfter:
      input.invocationOptions?.contextAfter ?? log?.context?.after ?? 4,
    maxExcerptLines:
      input.invocationOptions?.maxExcerptLines ?? log?.maxExcerptLines ?? 80,
  };
}
