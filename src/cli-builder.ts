import { existsSync, readFileSync } from 'node:fs';
import { resolve as pathResolve, isAbsolute } from 'node:path';
import type { CliPaths } from './cli-utils.js';
import {
  ANTIGRAVITY_REASONING_EFFORTS,
  getAntigravityEffortsForModel,
  getAntigravityModelBaseName,
  getModelAliases,
  getRequiredGeminiBackendForModel,
  isAntigravityOnlyModel,
  resolveAntigravityModelForEffort,
  resolveGeminiBackend,
  type GeminiBackend,
} from './model-catalog.js';

export const ALLOWED_REASONING_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const CLAUDE_REASONING_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const CODEX_REASONING_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);
const CODEX_MAX_REASONING_MODELS = new Set(['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);
const CODEX_ULTRA_REASONING_MODELS = new Set(['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra']);
const ANTIGRAVITY_ALLOWED_REASONING_EFFORTS = new Set<string>(ANTIGRAVITY_REASONING_EFFORTS);
const OPENCODE_MODEL_ERROR = 'Invalid OpenCode model. Expected exact syntax oc-<provider/model>.';
/** Antigravity runs headless one-shot prompts; two hours covers long agent runs. */
export const DEFAULT_ANTIGRAVITY_PRINT_TIMEOUT = '2h';

type Agent = 'codex' | 'claude' | 'gemini' | 'forge' | 'opencode';

interface ModelSelection {
  agent: Agent;
  resolvedModel: string;
  openCodeModel: string | null;
}

function getStandardAgentForModel(model: string): Exclude<Agent, 'opencode'> {
  if (model === 'forge') {
    return 'forge';
  }
  if (model === 'codex') {
    return 'codex';
  }
  if (model.startsWith('gpt-')) {
    return 'codex';
  }
  if (model.startsWith('gemini')) {
    return 'gemini';
  }
  // Antigravity display names such as "Gemini 3.8 Flash (High)" are also the
  // gemini agent; every other string keeps routing to Claude as before.
  if (isAntigravityOnlyModel(model)) {
    return 'gemini';
  }
  return 'claude';
}

function isPotentialOpenCodeExplicitModel(rawModel: string): boolean {
  return rawModel.startsWith('oc-') || rawModel.trim().startsWith('oc-');
}

function extractOpenCodeModel(rawModel: string): string {
  if (rawModel !== rawModel.trim()) {
    throw new Error(OPENCODE_MODEL_ERROR);
  }

  if (!rawModel.startsWith('oc-')) {
    throw new Error(OPENCODE_MODEL_ERROR);
  }

  const remainder = rawModel.slice(3);
  const slashIndex = remainder.indexOf('/');
  if (slashIndex === -1) {
    throw new Error(OPENCODE_MODEL_ERROR);
  }

  const provider = remainder.slice(0, slashIndex);
  const model = remainder.slice(slashIndex + 1);
  if (!provider || !model) {
    throw new Error(OPENCODE_MODEL_ERROR);
  }

  return remainder;
}

function resolveModelSelection(rawModel: string, geminiBackend: GeminiBackend): ModelSelection {
  if (rawModel === 'opencode') {
    return {
      agent: 'opencode',
      resolvedModel: rawModel,
      openCodeModel: null,
    };
  }

  if (isPotentialOpenCodeExplicitModel(rawModel)) {
    return {
      agent: 'opencode',
      resolvedModel: rawModel,
      openCodeModel: extractOpenCodeModel(rawModel),
    };
  }

  const resolvedModel = resolveModelAlias(rawModel, geminiBackend);
  return {
    agent: getStandardAgentForModel(resolvedModel),
    resolvedModel,
    openCodeModel: null,
  };
}

export function resolveModelAlias(model: string, geminiBackend: GeminiBackend = 'gemini-cli'): string {
  return getModelAliases(geminiBackend)[model] || model;
}

/**
 * Rejects a Gemini model that belongs to the other backend, naming the
 * GEMINI_CLI_BACKEND value it requires. Identifiers unknown to both catalogs
 * are passed through to the selected CLI untouched.
 */
function assertGeminiModelMatchesBackend(rawModel: string, resolvedModel: string, geminiBackend: GeminiBackend): void {
  const requiredBackend = getRequiredGeminiBackendForModel(rawModel)
    ?? getRequiredGeminiBackendForModel(resolvedModel);
  if (!requiredBackend || requiredBackend === geminiBackend) {
    return;
  }

  throw new Error(
    `Model "${rawModel}" belongs to the ${requiredBackend} Gemini backend and requires GEMINI_CLI_BACKEND=${requiredBackend}. The active Gemini backend is ${geminiBackend}.`
  );
}

export function getReasoningEffort(
  model: string,
  rawValue: unknown,
  geminiBackend: GeminiBackend = 'gemini-cli',
): string {
  if (typeof rawValue !== 'string') {
    return '';
  }
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return '';
  }

  if (model === 'opencode' || model.startsWith('oc-')) {
    throw new Error('reasoning_effort is not supported for opencode.');
  }

  const normalized = trimmed.toLowerCase();
  if (!ALLOWED_REASONING_EFFORTS.has(normalized)) {
    throw new Error(
      `Invalid reasoning_effort: ${rawValue}. Allowed values: low, medium, high, xhigh, max, ultra.`
    );
  }
  const agent = getStandardAgentForModel(model);
  if (agent === 'forge') {
    throw new Error('reasoning_effort is not supported for forge.');
  }
  if (agent === 'gemini') {
    if (geminiBackend !== 'antigravity') {
      throw new Error(
        'reasoning_effort is only supported for Claude and Codex models.'
      );
    }
    if (!ANTIGRAVITY_ALLOWED_REASONING_EFFORTS.has(normalized)) {
      throw new Error(
        'Gemini reasoning_effort supports only low, medium, high.'
      );
    }
    return normalized;
  }
  if (agent === 'claude' && !CLAUDE_REASONING_EFFORTS.has(normalized)) {
    throw new Error(
      'Claude reasoning_effort supports only low, medium, high, xhigh, max.'
    );
  }
  if (agent === 'codex') {
    const supportedEfforts = new Set(CODEX_REASONING_EFFORTS);
    if (CODEX_MAX_REASONING_MODELS.has(model)) {
      supportedEfforts.add('max');
    }
    if (CODEX_ULTRA_REASONING_MODELS.has(model)) {
      supportedEfforts.add('ultra');
    }
    if (supportedEfforts.has(normalized)) {
      return normalized;
    }
    throw new Error(
      `Codex reasoning_effort for ${model} supports only ${[...supportedEfforts].join(', ')}.`
    );
  }
  return normalized;
}

export interface CliCommand {
  cliPath: string;
  args: string[];
  cwd: string;
  agent: Agent;
  prompt: string;
  resolvedModel: string;
  /** Backend serving the gemini agent, or null for every other agent. */
  geminiBackend: GeminiBackend | null;
}

export interface BuildCliCommandOptions {
  prompt?: string;
  prompt_file?: string;
  workFolder: string;
  model?: string;
  session_id?: string;
  reasoning_effort?: string;
  /** Antigravity only: file the CLI writes its internal log to. */
  log_file?: string;
  /** Antigravity only: value of --print-timeout. */
  antigravityPrintTimeout?: string;
  cliPaths: CliPaths;
}

export function buildCliCommand(options: BuildCliCommandOptions): CliCommand {
  if (!options.workFolder || typeof options.workFolder !== 'string') {
    throw new Error('Missing or invalid required parameter: workFolder');
  }

  const hasPrompt = !!options.prompt && typeof options.prompt === 'string' && options.prompt.trim() !== '';
  const hasPromptFile = !!options.prompt_file && typeof options.prompt_file === 'string' && options.prompt_file.trim() !== '';

  if (!hasPrompt && !hasPromptFile) {
    throw new Error('Either prompt or prompt_file must be provided');
  }

  if (hasPrompt && hasPromptFile) {
    throw new Error('Cannot specify both prompt and prompt_file. Please use only one.');
  }

  let prompt: string;
  if (hasPrompt) {
    prompt = options.prompt!;
  } else {
    const promptFilePath = isAbsolute(options.prompt_file!)
      ? options.prompt_file!
      : pathResolve(options.workFolder, options.prompt_file!);

    if (!existsSync(promptFilePath)) {
      throw new Error(`Prompt file does not exist: ${promptFilePath}`);
    }

    try {
      prompt = readFileSync(promptFilePath, 'utf-8');
    } catch (error: any) {
      throw new Error(`Failed to read prompt file: ${error.message}`);
    }
  }

  const cwd = pathResolve(options.workFolder);
  if (!existsSync(cwd)) {
    throw new Error(`Working folder does not exist: ${options.workFolder}`);
  }

  const rawModel = options.model || '';
  const geminiBackend = resolveGeminiBackend({ cliPath: options.cliPaths.gemini });
  const { agent, resolvedModel, openCodeModel } = resolveModelSelection(rawModel, geminiBackend);
  if (agent === 'gemini') {
    assertGeminiModelMatchesBackend(rawModel, resolvedModel, geminiBackend);
  }

  let reasoningEffortArg: string | undefined = options.reasoning_effort;
  if (!reasoningEffortArg) {
    if (rawModel === 'codex-ultra') {
      reasoningEffortArg = 'ultra';
    } else if (rawModel === 'claude-ultra') {
      reasoningEffortArg = 'max';
    }
  }

  const reasoningTargetModel = rawModel === 'opencode' || rawModel.startsWith('oc-')
    ? rawModel
    : (resolvedModel || rawModel);
  const reasoningEffort = getReasoningEffort(reasoningTargetModel, reasoningEffortArg, geminiBackend);

  // Antigravity picks the reasoning level through the model NAME, so a
  // reasoning_effort for the gemini agent becomes the (Low|Medium|High) variant.
  let effectiveModel = resolvedModel;
  if (agent === 'gemini' && geminiBackend === 'antigravity' && reasoningEffort) {
    const variant = resolveAntigravityModelForEffort(resolvedModel, reasoningEffort);
    if (!variant) {
      const supported = getAntigravityEffortsForModel(resolvedModel);
      const baseName = getAntigravityModelBaseName(resolvedModel) || resolvedModel;
      throw new Error(
        supported.length > 0
          ? `Gemini reasoning_effort for ${baseName} supports only ${supported.join(', ')}.`
          : `reasoning_effort is not supported for Gemini model ${resolvedModel}.`
      );
    }
    effectiveModel = variant;
  }

  let cliPath: string;
  let args: string[];

  if (agent === 'codex') {
    cliPath = options.cliPaths.codex;

    if (options.session_id && typeof options.session_id === 'string') {
      args = ['exec', 'resume', options.session_id];
    } else {
      args = ['exec'];
    }

    if (reasoningEffort) {
      args.push('-c', `model_reasoning_effort=${reasoningEffort}`);
    }
    if (resolvedModel && resolvedModel !== 'codex') {
      args.push('--model', resolvedModel);
    }

    args.push('--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--json', prompt);
  } else if (agent === 'gemini' && geminiBackend === 'antigravity') {
    // Antigravity CLI (agy), headless one-shot mode: -p prints the answer,
    // --dangerously-skip-permissions auto-approves tools, --model takes the
    // display name (or its slug), and sessions resume through --conversation.
    // agy supports neither -y nor --output-format; stdout is plain text.
    cliPath = options.cliPaths.gemini;
    const printTimeout = options.antigravityPrintTimeout?.trim()
      || process.env.GEMINI_PRINT_TIMEOUT?.trim()
      || DEFAULT_ANTIGRAVITY_PRINT_TIMEOUT;
    args = ['--dangerously-skip-permissions', '--print-timeout', printTimeout];

    if (options.log_file && typeof options.log_file === 'string' && options.log_file.trim()) {
      args.push('--log-file', options.log_file);
    }

    if (options.session_id && typeof options.session_id === 'string') {
      args.push('--conversation', options.session_id);
    }

    if (effectiveModel) {
      args.push('--model', effectiveModel);
    }

    args.push('-p', prompt);
  } else if (agent === 'gemini') {
    cliPath = options.cliPaths.gemini;
    args = ['-y', '--output-format', 'stream-json'];

    if (options.session_id && typeof options.session_id === 'string') {
      args.push('-r', options.session_id);
    }

    if (resolvedModel) {
      args.push('--model', resolvedModel);
    }

    args.push(prompt);
  } else if (agent === 'forge') {
    cliPath = options.cliPaths.forge;
    args = ['-C', cwd];

    if (options.session_id && typeof options.session_id === 'string') {
      args.push('--conversation-id', options.session_id);
    }

    args.push('-p', prompt);
  } else if (agent === 'opencode') {
    cliPath = options.cliPaths.opencode;
    args = ['run', '--format', 'json', '--dir', cwd];

    if (options.session_id && typeof options.session_id === 'string') {
      args.push('--session', options.session_id);
    }

    if (openCodeModel) {
      args.push('--model', openCodeModel);
    }

    args.push(prompt);
  } else {
    cliPath = options.cliPaths.claude;
    args = ['--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose'];

    if (options.session_id && typeof options.session_id === 'string') {
      args.push('-r', options.session_id, '--fork-session');
    }

    if (reasoningEffort) {
      args.push('--effort', reasoningEffort);
    }

    args.push('-p', prompt);
    if (resolvedModel) {
      args.push('--model', resolvedModel);
    }
  }

  return {
    cliPath,
    args,
    cwd,
    agent,
    prompt,
    resolvedModel: effectiveModel,
    geminiBackend: agent === 'gemini' ? geminiBackend : null,
  };
}
