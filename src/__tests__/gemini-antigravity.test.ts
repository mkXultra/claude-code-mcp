import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { CliProcessService } from '../cli-process-service.js';
import { buildCliCommand, getReasoningEffort, resolveModelAlias } from '../cli-builder.js';
import {
  ANTIGRAVITY_GEMINI_MODELS,
  ANTIGRAVITY_MODEL_ALIASES,
  GEMINI_MODELS,
  getGeminiModelsForBackend,
  getModelsPayload,
  getRequiredGeminiBackendForModel,
  MODEL_ALIASES,
} from '../model-catalog.js';
import { parseAntigravityOutput, parseGeminiOutput, PeekEventExtractor, PeekMessageExtractor } from '../parsers.js';

const CLI_PATHS = {
  claude: '/usr/bin/claude',
  codex: '/usr/bin/codex',
  gemini: '/usr/bin/gemini',
  forge: '/usr/bin/forge',
  opencode: '/usr/bin/opencode',
};

const ANTIGRAVITY_CLI_PATHS = { ...CLI_PATHS, gemini: '/usr/local/bin/agy' };

function build(overrides: Record<string, any> = {}) {
  return buildCliCommand({
    prompt: 'hello',
    workFolder: process.cwd(),
    cliPaths: CLI_PATHS,
    ...overrides,
  } as any);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('gemini backend selection in buildCliCommand', () => {
  it('keeps the Gemini CLI arguments untouched when no backend is configured', () => {
    vi.stubEnv('GEMINI_CLI_BACKEND', '');
    const cmd = build({ model: 'gemini-2.5-pro', session_id: 'abc' });

    expect(cmd.agent).toBe('gemini');
    expect(cmd.geminiBackend).toBe('gemini-cli');
    expect(cmd.cliPath).toBe('/usr/bin/gemini');
    expect(cmd.args).toEqual([
      '-y',
      '--output-format',
      'stream-json',
      '-r',
      'abc',
      '--model',
      'gemini-2.5-pro',
      'hello',
    ]);
  });

  it('builds Antigravity arguments when the backend is selected', () => {
    vi.stubEnv('GEMINI_CLI_BACKEND', 'antigravity');
    const cmd = build({
      model: 'gemini-3.8-flash-high',
      session_id: 'conv-1',
      log_file: '/tmp/agy.log',
      cliPaths: ANTIGRAVITY_CLI_PATHS,
    });

    expect(cmd.agent).toBe('gemini');
    expect(cmd.geminiBackend).toBe('antigravity');
    expect(cmd.cliPath).toBe('/usr/local/bin/agy');
    expect(cmd.args).toEqual([
      '--dangerously-skip-permissions',
      '--print-timeout',
      '2h',
      '--log-file',
      '/tmp/agy.log',
      '--conversation',
      'conv-1',
      '--model',
      'Gemini 3.8 Flash (High)',
      '-p',
      'hello',
    ]);
    expect(cmd.resolvedModel).toBe('Gemini 3.8 Flash (High)');
  });

  it('omits --log-file and --conversation when they are not provided', () => {
    vi.stubEnv('GEMINI_CLI_BACKEND', 'antigravity');
    const cmd = build({ model: 'gemini-3.6-flash', cliPaths: ANTIGRAVITY_CLI_PATHS });

    expect(cmd.args).toEqual([
      '--dangerously-skip-permissions',
      '--print-timeout',
      '2h',
      '--model',
      'Gemini 3.6 Flash (Medium)',
      '-p',
      'hello',
    ]);
  });

  it('selects Antigravity in auto mode only when the resolved binary is agy', () => {
    vi.stubEnv('GEMINI_CLI_BACKEND', 'auto');

    const antigravity = build({ model: 'gemini-3.7-flash-low', cliPaths: ANTIGRAVITY_CLI_PATHS });
    expect(antigravity.geminiBackend).toBe('antigravity');
    expect(antigravity.args).toContain('--dangerously-skip-permissions');

    const geminiCli = build({ model: 'gemini-2.5-flash' });
    expect(geminiCli.geminiBackend).toBe('gemini-cli');
    expect(geminiCli.args).toContain('--output-format');
  });

  it('fails loudly on an unknown GEMINI_CLI_BACKEND value', () => {
    vi.stubEnv('GEMINI_CLI_BACKEND', 'antigravty');
    expect(() => build({ model: 'gemini-2.5-pro' })).toThrow(
      'Invalid GEMINI_CLI_BACKEND: antigravty. Allowed values: gemini-cli, antigravity, auto.'
    );
  });

  it('reads the print timeout from GEMINI_PRINT_TIMEOUT and from the build option', () => {
    vi.stubEnv('GEMINI_CLI_BACKEND', 'antigravity');
    vi.stubEnv('GEMINI_PRINT_TIMEOUT', '45m');

    const fromEnv = build({ model: 'gemini-3.8-flash', cliPaths: ANTIGRAVITY_CLI_PATHS });
    expect(fromEnv.args).toEqual(expect.arrayContaining(['--print-timeout', '45m']));

    const fromOption = build({
      model: 'gemini-3.8-flash',
      cliPaths: ANTIGRAVITY_CLI_PATHS,
      antigravityPrintTimeout: '10m',
    });
    expect(fromOption.args).toEqual(expect.arrayContaining(['--print-timeout', '10m']));
  });

  it('accepts an Antigravity display name directly', () => {
    vi.stubEnv('GEMINI_CLI_BACKEND', 'antigravity');
    const cmd = build({ model: 'Gemini 3.1 Pro (Low)', cliPaths: ANTIGRAVITY_CLI_PATHS });

    expect(cmd.agent).toBe('gemini');
    expect(cmd.args).toEqual(expect.arrayContaining(['--model', 'Gemini 3.1 Pro (Low)']));
  });

  it('leaves the other agents untouched under the Antigravity backend', () => {
    vi.stubEnv('GEMINI_CLI_BACKEND', 'antigravity');
    const cmd = build({ model: 'sonnet', cliPaths: ANTIGRAVITY_CLI_PATHS });

    expect(cmd.agent).toBe('claude');
    expect(cmd.geminiBackend).toBeNull();
  });
});

describe('per-backend gemini catalog', () => {
  it('keeps the Gemini CLI catalog exactly as it is', () => {
    expect([...GEMINI_MODELS]).toEqual([
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-3.1-pro-preview',
      'gemini-3-pro-preview',
      'gemini-3-flash-preview',
    ]);
    expect(getGeminiModelsForBackend()).toBe(GEMINI_MODELS);
    expect(getGeminiModelsForBackend('gemini-cli')).toBe(GEMINI_MODELS);
  });

  it('publishes the Antigravity catalog separately', () => {
    expect(getGeminiModelsForBackend('antigravity')).toBe(ANTIGRAVITY_GEMINI_MODELS);
    expect([...ANTIGRAVITY_GEMINI_MODELS]).toEqual([
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
    ]);
  });

  it('adds Antigravity aliases without colliding with the legacy catalog', () => {
    const legacyNames = new Set<string>([...GEMINI_MODELS, ...Object.keys(MODEL_ALIASES)]);
    const collisions = Object.keys(ANTIGRAVITY_MODEL_ALIASES)
      .filter((alias) => legacyNames.has(alias) && alias !== 'gemini-ultra');

    expect(collisions).toEqual([]);
    expect(Object.keys(ANTIGRAVITY_MODEL_ALIASES)).toEqual(expect.arrayContaining([
      'gemini-3.8-flash-high',
      'gemini-3.8-flash',
      'gemini-3.8-flash-low',
      'gemini-3.7-flash-high',
      'gemini-3.7-flash',
      'gemini-3.7-flash-low',
      'gemini-3.6-flash-high',
      'gemini-3.6-flash',
      'gemini-3.6-flash-low',
      'gemini-3.1-pro',
      'gemini-3.1-pro-low',
    ]));
  });

  it('resolves gemini-ultra per backend', () => {
    expect(resolveModelAlias('gemini-ultra')).toBe('gemini-3.1-pro-preview');
    expect(resolveModelAlias('gemini-ultra', 'gemini-cli')).toBe('gemini-3.1-pro-preview');
    expect(resolveModelAlias('gemini-ultra', 'antigravity')).toBe('Gemini 3.1 Pro (High)');
  });

  it('reports the backend a model requires', () => {
    expect(getRequiredGeminiBackendForModel('gemini-2.5-pro')).toBe('gemini-cli');
    expect(getRequiredGeminiBackendForModel('gemini-3.8-flash-high')).toBe('antigravity');
    expect(getRequiredGeminiBackendForModel('Gemini 3.8 Flash (High)')).toBe('antigravity');
    expect(getRequiredGeminiBackendForModel('gemini-ultra')).toBeNull();
    expect(getRequiredGeminiBackendForModel('gemini-experimental')).toBeNull();
  });
});

describe('cross-backend model rejection', () => {
  it('rejects an Antigravity model while the Gemini CLI backend is active', () => {
    vi.stubEnv('GEMINI_CLI_BACKEND', 'gemini-cli');
    expect(() => build({ model: 'gemini-3.8-flash-high' })).toThrow(
      'Model "gemini-3.8-flash-high" belongs to the antigravity Gemini backend and requires GEMINI_CLI_BACKEND=antigravity. The active Gemini backend is gemini-cli.'
    );
    expect(() => build({ model: 'Gemini 3.1 Pro (High)' })).toThrow(
      /requires GEMINI_CLI_BACKEND=antigravity/
    );
  });

  it('rejects a Gemini CLI model while the Antigravity backend is active', () => {
    vi.stubEnv('GEMINI_CLI_BACKEND', 'antigravity');
    expect(() => build({ model: 'gemini-2.5-pro', cliPaths: ANTIGRAVITY_CLI_PATHS })).toThrow(
      'Model "gemini-2.5-pro" belongs to the gemini-cli Gemini backend and requires GEMINI_CLI_BACKEND=gemini-cli. The active Gemini backend is antigravity.'
    );
    expect(() => build({ model: 'gemini-ultra', cliPaths: ANTIGRAVITY_CLI_PATHS })).not.toThrow();
  });
});

describe('reasoning_effort for the gemini agent', () => {
  it('stays unsupported on the Gemini CLI backend', () => {
    expect(() => getReasoningEffort('gemini-2.5-pro', 'high')).toThrow(
      'reasoning_effort is only supported for Claude and Codex models.'
    );
    expect(() => getReasoningEffort('gemini-2.5-pro', 'high', 'gemini-cli')).toThrow(
      'reasoning_effort is only supported for Claude and Codex models.'
    );

    vi.stubEnv('GEMINI_CLI_BACKEND', 'gemini-cli');
    expect(() => build({ model: 'gemini-2.5-pro', reasoning_effort: 'high' })).toThrow(
      'reasoning_effort is only supported for Claude and Codex models.'
    );
  });

  it('selects the matching model variant on the Antigravity backend', () => {
    vi.stubEnv('GEMINI_CLI_BACKEND', 'antigravity');

    for (const [effort, expected] of [
      ['low', 'Gemini 3.8 Flash (Low)'],
      ['medium', 'Gemini 3.8 Flash (Medium)'],
      ['high', 'Gemini 3.8 Flash (High)'],
    ] as const) {
      const cmd = build({
        model: 'gemini-3.8-flash',
        reasoning_effort: effort,
        cliPaths: ANTIGRAVITY_CLI_PATHS,
      });
      expect(cmd.resolvedModel).toBe(expected);
      expect(cmd.args).toEqual(expect.arrayContaining(['--model', expected]));
      // The level lives in the model name, never in an --effort flag.
      expect(cmd.args).not.toContain('--effort');
    }
  });

  it('overrides the level already encoded in the requested model', () => {
    vi.stubEnv('GEMINI_CLI_BACKEND', 'antigravity');
    const cmd = build({
      model: 'gemini-3.7-flash-low',
      reasoning_effort: 'high',
      cliPaths: ANTIGRAVITY_CLI_PATHS,
    });

    expect(cmd.resolvedModel).toBe('Gemini 3.7 Flash (High)');
  });

  it('rejects a level the CLI does not define', () => {
    expect(() => getReasoningEffort('gemini-3.8-flash', 'ultra', 'antigravity')).toThrow(
      'Gemini reasoning_effort supports only low, medium, high.'
    );
  });

  it('rejects a level the model family does not publish', () => {
    vi.stubEnv('GEMINI_CLI_BACKEND', 'antigravity');
    expect(() => build({
      model: 'gemini-3.1-pro',
      reasoning_effort: 'medium',
      cliPaths: ANTIGRAVITY_CLI_PATHS,
    })).toThrow('Gemini reasoning_effort for Gemini 3.1 Pro supports only high, low.');
  });
});

describe('output parsing per backend', () => {
  it('keeps parsing Gemini CLI stream-json output', () => {
    const output = [
      '{"type":"init","timestamp":"2026-04-11T14:44:42.293Z","session_id":"gemini-session","model":"gemini-3.1-pro-preview"}',
      '{"type":"message","role":"assistant","content":"Hello","delta":true}',
      '{"type":"result","stats":{"tokens":7}}',
    ].join('\n');

    expect(parseGeminiOutput(output)).toEqual({
      message: 'Hello',
      session_id: 'gemini-session',
      stats: { tokens: 7 },
      tools: undefined,
    });
  });

  it('parses Antigravity plain text plus the conversation id from the log file', () => {
    const log = [
      'I0606 11:20:31.000000 main.go:1] Starting agy',
      'I0606 11:20:32.000000 conv.go:9] Created conversation conv-abc123',
    ].join('\n');

    expect(parseAntigravityOutput('The answer is 42.\n', log)).toEqual({
      message: 'The answer is 42.',
      session_id: 'conv-abc123',
    });
  });

  it('recognizes the alternative conversation id log formats', () => {
    expect(parseAntigravityOutput('ok', 'Print mode: conversation=conv-xyz')).toEqual({
      message: 'ok',
      session_id: 'conv-xyz',
    });
    expect(parseAntigravityOutput('ok', 'starting conversationID="conv-quoted"')).toEqual({
      message: 'ok',
      session_id: 'conv-quoted',
    });
  });

  it('returns the message without a session id when the log has none', () => {
    expect(parseAntigravityOutput('plain answer', '')).toEqual({
      message: 'plain answer',
      session_id: null,
    });
    expect(parseAntigravityOutput('', '')).toBeNull();
    expect(parseAntigravityOutput('', 'Created conversation conv-only')).toEqual({
      message: null,
      session_id: 'conv-only',
    });
  });

  it('does not treat JSON-shaped Antigravity output as structured events', () => {
    expect(parseAntigravityOutput('{"status":"ok"}', '')).toEqual({
      message: '{"status":"ok"}',
      session_id: null,
    });
  });
});

describe('peek on the Antigravity backend', () => {
  const ts = '2026-04-11T14:44:53.820Z';

  it('emits plain stdout text as peek messages', () => {
    const extractor = new PeekMessageExtractor('gemini', { geminiBackend: 'antigravity' });

    expect(extractor.push('Working on it\n', ts)).toEqual([{ ts, text: 'Working on it' }]);
    expect(extractor.flush(ts)).toEqual([]);
  });

  it('emits JSON-shaped stdout lines as message text', () => {
    const extractor = new PeekMessageExtractor('gemini', { geminiBackend: 'antigravity' });

    expect(extractor.push('{"status":"ok"}\n', ts)).toEqual([{ ts, text: '{"status":"ok"}' }]);
  });

  it('flushes a trailing partial line', () => {
    const extractor = new PeekMessageExtractor('gemini', { geminiBackend: 'antigravity' });

    expect(extractor.push('no newline yet', ts)).toEqual([]);
    expect(extractor.flush(ts)).toEqual([{ ts, text: 'no newline yet' }]);
  });

  it('suppresses the internal log lines written to stderr', () => {
    const extractor = new PeekEventExtractor('gemini', {
      source: 'stderr',
      geminiBackend: 'antigravity',
    });

    expect(extractor.push('I0606 11:20:31.000000 main.go:1] Starting agy\n', ts)).toEqual([]);
    expect(extractor.flush(ts)).toEqual([]);
  });

  it('keeps the Gemini CLI peek behaviour untouched by default', () => {
    const extractor = new PeekMessageExtractor('gemini');

    expect(extractor.push('{"type":"message","role":"assistant","content":"Visible","delta":true}\n', ts)).toEqual([]);
    expect(extractor.flush(ts)).toEqual([{ ts, text: 'Visible' }]);
  });
});

describe('models payload', () => {
  it('exposes the legacy catalog and both backends by default', () => {
    const payload = getModelsPayload();

    expect(payload.gemini).toBe(GEMINI_MODELS);
    expect(payload.geminiBackend).toBe('gemini-cli');
    expect(payload.aliases).toEqual(expect.arrayContaining([
      { name: 'gemini-ultra', resolvesTo: 'gemini-3.1-pro-preview', agent: 'gemini' },
    ]));
    expect(payload.geminiBackends['gemini-cli'].active).toBe(true);
    expect(payload.geminiBackends['gemini-cli'].models).toBe(GEMINI_MODELS);
    expect(payload.geminiBackends['gemini-cli'].cliBinaryDefault).toBe('gemini');
    expect(payload.geminiBackends.antigravity.active).toBe(false);
    expect(payload.geminiBackends.antigravity.models).toBe(ANTIGRAVITY_GEMINI_MODELS);
    expect(payload.geminiBackends.antigravity.cliBinaryDefault).toBe('agy');
  });

  it('switches the gemini key to the Antigravity catalog when it is active', () => {
    const payload = getModelsPayload('antigravity');

    expect(payload.gemini).toBe(ANTIGRAVITY_GEMINI_MODELS);
    expect(payload.geminiBackend).toBe('antigravity');
    expect(payload.geminiBackends.antigravity.active).toBe(true);
    expect(payload.geminiBackends['gemini-cli'].active).toBe(false);
    expect(payload.aliases).toEqual(expect.arrayContaining([
      { name: 'gemini-ultra', resolvesTo: 'Gemini 3.1 Pro (High)', agent: 'gemini' },
    ]));
    expect(payload.aliases.some((alias) => alias.resolvesTo === 'gemini-3.1-pro-preview')).toBe(false);
  });
});

describe('CliProcessService on the Antigravity backend', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes --log-file through and reads the conversation id back from it', async () => {
    vi.stubEnv('GEMINI_CLI_BACKEND', 'antigravity');

    const root = mkdtempSync(join(tmpdir(), 'ai-cli-antigravity-'));
    tempDirs.push(root);
    const stateDir = join(root, 'state');
    const workFolder = join(root, 'work');
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(workFolder, { recursive: true });

    const scriptPath = join(root, 'agy');
    writeFileSync(
      scriptPath,
      `#!/bin/bash
log=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --log-file) log="$2"; shift 2;;
    *) shift;;
  esac
done
if [[ -n "$log" ]]; then
  echo 'I0606 11:20:32.000000 conv.go:9] Created conversation conv-e2e' > "$log"
fi
echo "Antigravity says hi"
exit 0
`
    );
    chmodSync(scriptPath, 0o755);

    const service = new CliProcessService({
      stateDir,
      cliPaths: { ...ANTIGRAVITY_CLI_PATHS, gemini: scriptPath },
    });

    const started = await service.startProcess({
      cwd: workFolder,
      prompt: 'hi',
      model: 'gemini-3.8-flash-high',
    });
    expect(started.agent).toBe('gemini');

    const [result] = await service.waitForProcesses([started.pid], 30, true);
    expect(result.status).toBe('completed');
    expect(result.agentOutput).toEqual({
      message: 'Antigravity says hi',
      session_id: 'conv-e2e',
    });
  });
});
