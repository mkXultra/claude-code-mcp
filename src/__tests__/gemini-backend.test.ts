import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  DEFAULT_GEMINI_BACKEND_MODE,
  getDefaultGeminiCliName,
  isAntigravityCommand,
  readGeminiBackendMode,
  readGeminiBackendModeSafe,
  resolveConfiguredGeminiBackend,
  resolveGeminiBackend,
  validateGeminiBackendEnv,
} from '../model-catalog.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('readGeminiBackendMode', () => {
  it('defaults to the gemini-cli backend when the variable is absent', () => {
    expect(DEFAULT_GEMINI_BACKEND_MODE).toBe('gemini-cli');
    expect(readGeminiBackendMode({})).toBe('gemini-cli');
  });

  it('defaults to the gemini-cli backend for an empty value', () => {
    expect(readGeminiBackendMode({ GEMINI_CLI_BACKEND: '' })).toBe('gemini-cli');
    expect(readGeminiBackendMode({ GEMINI_CLI_BACKEND: '   ' })).toBe('gemini-cli');
  });

  it('accepts every documented value, case-insensitively', () => {
    expect(readGeminiBackendMode({ GEMINI_CLI_BACKEND: 'gemini-cli' })).toBe('gemini-cli');
    expect(readGeminiBackendMode({ GEMINI_CLI_BACKEND: 'antigravity' })).toBe('antigravity');
    expect(readGeminiBackendMode({ GEMINI_CLI_BACKEND: 'auto' })).toBe('auto');
    expect(readGeminiBackendMode({ GEMINI_CLI_BACKEND: ' Antigravity ' })).toBe('antigravity');
  });

  it('throws a clear error for an unknown value', () => {
    expect(() => readGeminiBackendMode({ GEMINI_CLI_BACKEND: 'agy' })).toThrow(
      'Invalid GEMINI_CLI_BACKEND: agy. Allowed values: gemini-cli, antigravity, auto.'
    );
    expect(() => validateGeminiBackendEnv({ GEMINI_CLI_BACKEND: 'nope' })).toThrow(
      /Invalid GEMINI_CLI_BACKEND/
    );
  });

  it('falls back to the default in the non-throwing variant', () => {
    expect(readGeminiBackendModeSafe({ GEMINI_CLI_BACKEND: 'nope' })).toBe('gemini-cli');
  });
});

describe('isAntigravityCommand', () => {
  it('matches the agy binary and its variants', () => {
    expect(isAntigravityCommand('agy')).toBe(true);
    expect(isAntigravityCommand('/usr/local/bin/agy')).toBe(true);
    expect(isAntigravityCommand('agy-nightly')).toBe(true);
    expect(isAntigravityCommand('C:\\tools\\agy.exe')).toBe(true);
    expect(isAntigravityCommand('AGY')).toBe(true);
  });

  it('does not match the gemini binary or unrelated names', () => {
    expect(isAntigravityCommand('gemini')).toBe(false);
    expect(isAntigravityCommand('/usr/bin/gemini')).toBe(false);
    expect(isAntigravityCommand('agyx')).toBe(false);
    expect(isAntigravityCommand('')).toBe(false);
  });
});

describe('resolveGeminiBackend', () => {
  it('returns gemini-cli by default regardless of the resolved binary', () => {
    expect(resolveGeminiBackend({ cliPath: '/usr/local/bin/agy', env: {} })).toBe('gemini-cli');
  });

  it('honours an explicit backend selection', () => {
    expect(resolveGeminiBackend({ cliPath: '/usr/bin/gemini', env: { GEMINI_CLI_BACKEND: 'antigravity' } })).toBe('antigravity');
    expect(resolveGeminiBackend({ cliPath: '/usr/local/bin/agy', env: { GEMINI_CLI_BACKEND: 'gemini-cli' } })).toBe('gemini-cli');
  });

  it('infers the backend from the resolved binary in auto mode', () => {
    const env = { GEMINI_CLI_BACKEND: 'auto' };
    expect(resolveGeminiBackend({ cliPath: '/usr/local/bin/agy', env })).toBe('antigravity');
    expect(resolveGeminiBackend({ cliPath: 'agy-nightly', env })).toBe('antigravity');
    expect(resolveGeminiBackend({ cliPath: '/usr/bin/gemini', env })).toBe('gemini-cli');
    expect(resolveGeminiBackend({ env })).toBe('gemini-cli');
  });

  it('propagates the validation error for an unknown value', () => {
    expect(() => resolveGeminiBackend({ cliPath: 'agy', env: { GEMINI_CLI_BACKEND: 'antigravty' } })).toThrow(
      /Invalid GEMINI_CLI_BACKEND/
    );
  });
});

describe('getDefaultGeminiCliName', () => {
  it('keeps gemini as the default binary unless Antigravity is selected', () => {
    expect(getDefaultGeminiCliName({})).toBe('gemini');
    expect(getDefaultGeminiCliName({ GEMINI_CLI_BACKEND: 'auto' })).toBe('gemini');
    expect(getDefaultGeminiCliName({ GEMINI_CLI_BACKEND: 'antigravity' })).toBe('agy');
  });
});

describe('resolveConfiguredGeminiBackend', () => {
  it('reads the process environment when no explicit env is given', () => {
    vi.stubEnv('GEMINI_CLI_BACKEND', '');
    expect(resolveConfiguredGeminiBackend()).toBe('gemini-cli');
    vi.stubEnv('GEMINI_CLI_BACKEND', 'antigravity');
    expect(resolveConfiguredGeminiBackend()).toBe('antigravity');
  });

  it('resolves auto mode through GEMINI_CLI_NAME', () => {
    expect(resolveConfiguredGeminiBackend({ GEMINI_CLI_BACKEND: 'auto' })).toBe('gemini-cli');
    expect(resolveConfiguredGeminiBackend({ GEMINI_CLI_BACKEND: 'auto', GEMINI_CLI_NAME: 'agy' })).toBe('antigravity');
  });
});
