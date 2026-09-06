/**
 * Backend selection for the "gemini" agent.
 *
 * The agent can be served either by the historical Gemini CLI (`gemini`) or by
 * the Antigravity CLI (`agy`). The two CLIs share nothing: different flags,
 * different model identifiers and a different output format, so the backend is
 * selected explicitly through the GEMINI_CLI_BACKEND environment variable.
 *
 * The default is `gemini-cli`, which keeps the historical behavior byte for
 * byte for anyone who does not opt in.
 */

export const GEMINI_BACKEND_ENV_VAR = 'GEMINI_CLI_BACKEND';

/** Backends the agent can actually run on, once `auto` has been resolved. */
export const GEMINI_BACKENDS = ['gemini-cli', 'antigravity'] as const;
export type GeminiBackend = (typeof GEMINI_BACKENDS)[number];

/** Accepted values of GEMINI_CLI_BACKEND. */
export const GEMINI_BACKEND_MODES = ['gemini-cli', 'antigravity', 'auto'] as const;
export type GeminiBackendMode = (typeof GEMINI_BACKEND_MODES)[number];

export const DEFAULT_GEMINI_BACKEND_MODE: GeminiBackendMode = 'gemini-cli';

/** Default binary name per backend. Both are overridable with GEMINI_CLI_NAME. */
export const DEFAULT_GEMINI_CLI_NAME = 'gemini';
export const DEFAULT_ANTIGRAVITY_CLI_NAME = 'agy';

const WINDOWS_EXECUTABLE_EXTENSION_PATTERN = /\.(exe|cmd|bat|com|ps1)$/;

function invalidBackendError(rawValue: string): Error {
  return new Error(
    `Invalid ${GEMINI_BACKEND_ENV_VAR}: ${rawValue}. Allowed values: ${GEMINI_BACKEND_MODES.join(', ')}.`
  );
}

/**
 * Reads GEMINI_CLI_BACKEND. Throws on an unknown value so a typo fails loudly
 * instead of silently falling back to the wrong CLI.
 */
export function readGeminiBackendMode(env: NodeJS.ProcessEnv = process.env): GeminiBackendMode {
  const rawValue = env[GEMINI_BACKEND_ENV_VAR];
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return DEFAULT_GEMINI_BACKEND_MODE;
  }

  const normalized = rawValue.trim().toLowerCase();
  if ((GEMINI_BACKEND_MODES as readonly string[]).includes(normalized)) {
    return normalized as GeminiBackendMode;
  }

  throw invalidBackendError(rawValue);
}

/**
 * Same as readGeminiBackendMode, but falls back to the default instead of
 * throwing. Used by diagnostics that must keep reporting on a bad value.
 */
export function readGeminiBackendModeSafe(env: NodeJS.ProcessEnv = process.env): GeminiBackendMode {
  try {
    return readGeminiBackendMode(env);
  } catch {
    return DEFAULT_GEMINI_BACKEND_MODE;
  }
}

/** Throws when GEMINI_CLI_BACKEND holds an unknown value. */
export function validateGeminiBackendEnv(env: NodeJS.ProcessEnv = process.env): void {
  readGeminiBackendMode(env);
}

/** True when the command basename is the Antigravity CLI (`agy`, `agy-*`). */
export function isAntigravityCommand(command: string): boolean {
  if (typeof command !== 'string' || !command.trim()) {
    return false;
  }

  const normalized = command.trim().replace(/\\/g, '/');
  const basename = normalized.slice(normalized.lastIndexOf('/') + 1).toLowerCase();
  const withoutExtension = basename.replace(WINDOWS_EXECUTABLE_EXTENSION_PATTERN, '');
  return withoutExtension === DEFAULT_ANTIGRAVITY_CLI_NAME
    || withoutExtension.startsWith(`${DEFAULT_ANTIGRAVITY_CLI_NAME}-`);
}

/**
 * Resolves the effective backend. In `auto` mode the decision comes from the
 * resolved gemini command: an `agy`-like basename selects Antigravity.
 */
export function resolveGeminiBackend(
  options: { cliPath?: string | null; env?: NodeJS.ProcessEnv } = {},
): GeminiBackend {
  const mode = readGeminiBackendMode(options.env ?? process.env);
  if (mode !== 'auto') {
    return mode;
  }

  return isAntigravityCommand(options.cliPath ?? '') ? 'antigravity' : 'gemini-cli';
}

/** Default binary name for the currently selected backend. */
export function getDefaultGeminiCliName(env: NodeJS.ProcessEnv = process.env): string {
  return readGeminiBackendModeSafe(env) === 'antigravity'
    ? DEFAULT_ANTIGRAVITY_CLI_NAME
    : DEFAULT_GEMINI_CLI_NAME;
}

/**
 * Backend implied by the environment alone, without a resolved CLI path. Used
 * where only the configuration is available (`ai-cli models`, docs strings).
 */
export function resolveConfiguredGeminiBackend(env: NodeJS.ProcessEnv = process.env): GeminiBackend {
  return resolveGeminiBackend({
    cliPath: env.GEMINI_CLI_NAME || getDefaultGeminiCliName(env),
    env,
  });
}

export const CLAUDE_MODELS = ['sonnet', 'sonnet[1m]', 'opus', 'opusplan', 'fable', 'haiku'] as const;
export const CODEX_MODELS = [
  'gpt-6-astra',
  'gpt-5.4',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.4-mini',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
  'gpt-5.2',
] as const;
/** Models of the "gemini" agent when it is served by the Gemini CLI (default). */
export const GEMINI_MODELS = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-3.1-pro-preview',
  'gemini-3-pro-preview',
  'gemini-3-flash-preview',
] as const;
/**
 * Models of the "gemini" agent when it is served by the Antigravity CLI (agy),
 * i.e. when GEMINI_CLI_BACKEND=antigravity.
 *
 * These display names are the identifiers `agy --model` accepts, and they
 * encode the reasoning level in the name itself. The lowercase slugs below
 * (e.g. "gemini-3.8-flash-high") are accepted as aliases for convenience.
 */
export const ANTIGRAVITY_GEMINI_MODELS = [
  'Gemini 3.8 Flash (High)',
  'Gemini 3.8 Flash (Medium)',
  'Gemini 3.8 Flash (Low)',
  'Gemini 3.7 Flash (High)',
  'Gemini 3.7 Flash (Medium)',
  'Gemini 3.7 Flash (Low)',
  'Gemini 3.6 Flash (High)',
  'Gemini 3.6 Flash (Medium)',
  'Gemini 3.6 Flash (Low)',
  'Gemini 3.1 Pro (High)',
  'Gemini 3.1 Pro (Low)',
] as const;
export const FORGE_MODELS = ['forge'] as const;
export const OPENCODE_MODELS = ['opencode'] as const;

export const MODEL_ALIASES: Record<string, string> = {
  'claude-ultra': 'opus',
  'codex-ultra': 'gpt-6-astra',
  'gemini-ultra': 'gemini-3.1-pro-preview',
};

/**
 * Aliases that only exist under GEMINI_CLI_BACKEND=antigravity. They are purely
 * additive: none of these keys collides with a Gemini CLI model name, and
 * "gemini-ultra" is the single shared alias, resolved per backend.
 */
export const ANTIGRAVITY_MODEL_ALIASES: Record<string, string> = {
  'gemini-ultra': 'Gemini 3.1 Pro (High)',
  'gemini-3.8-flash-high': 'Gemini 3.8 Flash (High)',
  'gemini-3.8-flash-medium': 'Gemini 3.8 Flash (Medium)',
  'gemini-3.8-flash': 'Gemini 3.8 Flash (Medium)',
  'gemini-3.8-flash-low': 'Gemini 3.8 Flash (Low)',
  'gemini-3.7-flash-high': 'Gemini 3.7 Flash (High)',
  'gemini-3.7-flash-medium': 'Gemini 3.7 Flash (Medium)',
  'gemini-3.7-flash': 'Gemini 3.7 Flash (Medium)',
  'gemini-3.7-flash-low': 'Gemini 3.7 Flash (Low)',
  'gemini-3.6-flash-high': 'Gemini 3.6 Flash (High)',
  'gemini-3.6-flash-medium': 'Gemini 3.6 Flash (Medium)',
  'gemini-3.6-flash': 'Gemini 3.6 Flash (Medium)',
  'gemini-3.6-flash-low': 'Gemini 3.6 Flash (Low)',
  'gemini-3.1-pro-high': 'Gemini 3.1 Pro (High)',
  'gemini-3.1-pro': 'Gemini 3.1 Pro (High)',
  'gemini-3.1-pro-low': 'Gemini 3.1 Pro (Low)',
};

export const MODEL_ALIAS_DETAILS = [
  { name: 'claude-ultra', resolvesTo: 'opus', agent: 'claude', defaultReasoningEffort: 'max' },
  { name: 'codex-ultra', resolvesTo: 'gpt-6-astra', agent: 'codex', defaultReasoningEffort: 'ultra' },
  { name: 'gemini-ultra', resolvesTo: 'gemini-3.1-pro-preview', agent: 'gemini' },
] as const;

export const ANTIGRAVITY_MODEL_ALIAS_DETAILS = Object.entries(ANTIGRAVITY_MODEL_ALIASES)
  .map(([name, resolvesTo]) => ({ name, resolvesTo, agent: 'gemini' as const }));

export interface ModelAliasDetail {
  name: string;
  resolvesTo: string;
  agent: string;
  defaultReasoningEffort?: string;
}

/** Alias table in effect for the given Gemini backend. */
export function getModelAliases(geminiBackend: GeminiBackend = 'gemini-cli'): Record<string, string> {
  if (geminiBackend !== 'antigravity') {
    return MODEL_ALIASES;
  }

  return { ...MODEL_ALIASES, ...ANTIGRAVITY_MODEL_ALIASES };
}

/** Documented alias list in effect for the given Gemini backend. */
export function getModelAliasDetails(geminiBackend: GeminiBackend = 'gemini-cli'): ReadonlyArray<ModelAliasDetail> {
  if (geminiBackend !== 'antigravity') {
    return MODEL_ALIAS_DETAILS;
  }

  const nonGeminiAliases = MODEL_ALIAS_DETAILS.filter((alias) => alias.agent !== 'gemini');
  return [...nonGeminiAliases, ...ANTIGRAVITY_MODEL_ALIAS_DETAILS];
}

/** Model list of the "gemini" agent for the given backend. */
export function getGeminiModelsForBackend(geminiBackend: GeminiBackend = 'gemini-cli'): ReadonlyArray<string> {
  return geminiBackend === 'antigravity' ? ANTIGRAVITY_GEMINI_MODELS : GEMINI_MODELS;
}

const GEMINI_CLI_ONLY_MODELS = new Set<string>(GEMINI_MODELS);

const ANTIGRAVITY_ONLY_MODELS = new Set<string>([
  ...ANTIGRAVITY_GEMINI_MODELS.map((model) => model.toLowerCase()),
  ...Object.keys(ANTIGRAVITY_MODEL_ALIASES).filter((alias) => !(alias in MODEL_ALIASES)),
]);

/** True for an identifier only the Antigravity CLI understands. */
export function isAntigravityOnlyModel(model: string): boolean {
  return typeof model === 'string' && ANTIGRAVITY_ONLY_MODELS.has(model.trim().toLowerCase());
}

/** True for an identifier only the Gemini CLI understands. */
export function isGeminiCliOnlyModel(model: string): boolean {
  return typeof model === 'string' && GEMINI_CLI_ONLY_MODELS.has(model.trim());
}

/**
 * Backend a model identifier requires, or null when the identifier is shared
 * (e.g. "gemini-ultra") or unknown to both catalogs, in which case it is passed
 * through to the selected CLI untouched.
 */
export function getRequiredGeminiBackendForModel(model: string): GeminiBackend | null {
  if (isAntigravityOnlyModel(model)) {
    return 'antigravity';
  }
  if (isGeminiCliOnlyModel(model)) {
    return 'gemini-cli';
  }
  return null;
}

/**
 * The Antigravity CLI encodes the reasoning level in the model name itself
 * ("Gemini 3.8 Flash (High)"), so a reasoning_effort of low/medium/high is
 * resolved into the matching catalog variant instead of a CLI flag.
 */
export const ANTIGRAVITY_REASONING_EFFORTS = ['low', 'medium', 'high'] as const;

const ANTIGRAVITY_EFFORT_SUFFIX_PATTERN = /\s*\((Low|Medium|High)\)\s*$/i;

/** Model name without its "(Low|Medium|High)" suffix. */
export function getAntigravityModelBaseName(model: string): string {
  return model.replace(ANTIGRAVITY_EFFORT_SUFFIX_PATTERN, '').trim();
}

/** Effort variants published for the family of the given model. */
export function getAntigravityEffortsForModel(model: string): string[] {
  const base = getAntigravityModelBaseName(model).toLowerCase();
  const efforts: string[] = [];
  for (const candidate of ANTIGRAVITY_GEMINI_MODELS) {
    if (getAntigravityModelBaseName(candidate).toLowerCase() !== base) {
      continue;
    }
    const suffix = ANTIGRAVITY_EFFORT_SUFFIX_PATTERN.exec(candidate);
    if (suffix) {
      efforts.push(suffix[1].toLowerCase());
    }
  }
  return efforts;
}

/**
 * Resolves the Antigravity model name for the requested effort, or null when
 * the model family does not publish that variant.
 */
export function resolveAntigravityModelForEffort(model: string, effort: string): string | null {
  const normalizedEffort = effort.trim().toLowerCase();
  if (!(ANTIGRAVITY_REASONING_EFFORTS as readonly string[]).includes(normalizedEffort)) {
    return null;
  }

  const base = getAntigravityModelBaseName(model);
  if (!base) {
    return null;
  }

  const label = `${normalizedEffort.charAt(0).toUpperCase()}${normalizedEffort.slice(1)}`;
  const candidate = `${base} (${label})`.toLowerCase();
  return ANTIGRAVITY_GEMINI_MODELS.find((known) => known.toLowerCase() === candidate) ?? null;
}

export interface DynamicModelBackendDescription {
  explicitPrefix: string;
  explicitPattern: string;
  discoveryCommand: string;
  modelsAreDynamic: boolean;
}

export interface GeminiBackendDescription {
  models: ReadonlyArray<string>;
  aliases: ReadonlyArray<ModelAliasDetail>;
  cliBinaryDefault: string;
  active: boolean;
}

export function getSupportedModelsDescription(geminiBackend: GeminiBackend = 'gemini-cli'): string {
  return [
    '"claude-ultra", "codex-ultra", "gemini-ultra"',
    ...CLAUDE_MODELS.map((model) => `"${model}"`),
    ...CODEX_MODELS.map((model) => `"${model}"`),
    ...getGeminiModelsForBackend(geminiBackend).map((model) => `"${model}"`),
    ...FORGE_MODELS.map((model) => `"${model}"`),
    ...OPENCODE_MODELS.map((model) => `"${model}"`),
    '"oc-<provider/model>"',
  ].join(', ');
}

export function getModelParameterDescription(geminiBackend: GeminiBackend = 'gemini-cli'): string {
  const geminiModels = getGeminiModelsForBackend(geminiBackend);
  // The default backend keeps the historical description untouched; the extra
  // sentence only shows up once the Antigravity backend is selected.
  const geminiNote = geminiBackend === 'antigravity'
    ? ` Gemini models are served by the Antigravity CLI (agy) because ${GEMINI_BACKEND_ENV_VAR}=antigravity; the reasoning level is part of the model name, lowercase aliases such as "gemini-3.8-flash-high", "gemini-3.8-flash" (Medium) and "gemini-3.8-flash-low" resolve to them, and reasoning_effort "low", "medium" or "high" selects the matching variant.`
    : '';
  return `The model to use. Aliases: "claude-ultra" (Opus with auto max effort; does not select Fable), "codex-ultra" (auto ultra reasoning), "gemini-ultra". Standard: ${[...CLAUDE_MODELS, ...CODEX_MODELS, ...geminiModels, ...FORGE_MODELS, ...OPENCODE_MODELS].map((model) => `"${model}"`).join(', ')}. Fable is an explicit selection and may require usage credits.${geminiNote} OpenCode also accepts explicit dynamic models using "oc-<provider/model>". "forge" is a provider key, not a Forge model family selector.`;
}

export function getReasoningEffortParameterDescription(geminiBackend: GeminiBackend = 'gemini-cli'): string {
  const geminiNote = geminiBackend === 'antigravity'
    ? 'Gemini on the Antigravity CLI (agy) accepts "low", "medium", "high" and selects the matching model variant, e.g. model "gemini-3.8-flash" with reasoning_effort "high" runs "Gemini 3.8 Flash (High)"; Gemini 3.1 Pro only has "low" and "high". Forge and OpenCode do not support reasoning_effort in this integration.'
    : 'Gemini, Forge, and OpenCode do not support reasoning_effort in this integration.';
  return `Reasoning control for Claude and Codex. Claude uses --effort with "low", "medium", "high", "xhigh", "max". Codex uses model_reasoning_effort with "low", "medium", "high", "xhigh"; GPT-6 Astra and GPT-5.6 Sol/Terra also support "max" and "ultra", while GPT-5.6 Luna supports "max". ${geminiNote}`;
}

export function getModelsPayload(geminiBackend: GeminiBackend = 'gemini-cli'): {
  aliases: ReadonlyArray<ModelAliasDetail>;
  claude: ReadonlyArray<string>;
  codex: ReadonlyArray<string>;
  gemini: ReadonlyArray<string>;
  forge: ReadonlyArray<string>;
  opencode: ReadonlyArray<string>;
  geminiBackend: GeminiBackend;
  geminiBackends: {
    'gemini-cli': GeminiBackendDescription;
    antigravity: GeminiBackendDescription;
  };
  dynamicModelBackends: {
    opencode: DynamicModelBackendDescription;
  };
} {
  return {
    aliases: getModelAliasDetails(geminiBackend),
    claude: CLAUDE_MODELS,
    codex: CODEX_MODELS,
    gemini: getGeminiModelsForBackend(geminiBackend),
    forge: FORGE_MODELS,
    opencode: OPENCODE_MODELS,
    geminiBackend,
    geminiBackends: {
      'gemini-cli': {
        models: GEMINI_MODELS,
        aliases: MODEL_ALIAS_DETAILS.filter((alias) => alias.agent === 'gemini'),
        cliBinaryDefault: DEFAULT_GEMINI_CLI_NAME,
        active: geminiBackend === 'gemini-cli',
      },
      antigravity: {
        models: ANTIGRAVITY_GEMINI_MODELS,
        aliases: ANTIGRAVITY_MODEL_ALIAS_DETAILS,
        cliBinaryDefault: DEFAULT_ANTIGRAVITY_CLI_NAME,
        active: geminiBackend === 'antigravity',
      },
    },
    dynamicModelBackends: {
      opencode: {
        explicitPrefix: 'oc-',
        explicitPattern: 'oc-<provider/model>',
        discoveryCommand: 'opencode models',
        modelsAreDynamic: true,
      },
    },
  };
}
