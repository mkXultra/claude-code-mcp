import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve as pathResolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { EventEmitter } from 'node:events';

// Mock dependencies
vi.mock('node:child_process');
vi.mock('node:fs');
vi.mock('node:os');
vi.mock('node:path', () => ({
  resolve: vi.fn((path) => path),
  join: vi.fn((...args) => args.join('/')),
  isAbsolute: vi.fn((path) => path.startsWith('/'))
}));
vi.mock('@modelcontextprotocol/sdk/server/stdio.js');
vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  ListToolsRequestSchema: { name: 'listTools' },
  CallToolRequestSchema: { name: 'callTool' },
  ErrorCode: { 
    InternalError: 'InternalError',
    MethodNotFound: 'MethodNotFound',
    InvalidParams: 'InvalidParams'
  },
  McpError: vi.fn().mockImplementation((code, message) => {
    const error = new Error(message);
    (error as any).code = code;
    return error;
  })
}));
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: vi.fn().mockImplementation(function(this: any) {
    this.setRequestHandler = vi.fn();
    this.connect = vi.fn();
    this.close = vi.fn();
    this.onerror = undefined;
    return this;
  }),
}));

// Mock package.json
vi.mock('../../package.json', () => ({
  default: { version: '1.0.0-test' }
}));

// Re-import after mocks
const mockExistsSync = vi.mocked(existsSync);
const mockSpawn = vi.mocked(spawn);
const mockHomedir = vi.mocked(homedir);
const mockPathResolve = vi.mocked(pathResolve);

// Module loading will happen in tests

describe('ClaudeCodeServer Unit Tests', () => {
  let consoleErrorSpy: any;
  let consoleWarnSpy: any;
  let originalEnv: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unmock('../server.js');
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    originalEnv = { ...process.env };
    // Reset env
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    process.env = originalEnv;
  });

  describe('debugLog function', () => {
    it('should log when debug mode is enabled', async () => {
      process.env.MCP_CLAUDE_DEBUG = 'true';
      const module = await import('../server.js');
      // @ts-ignore - accessing private function for testing
      const { debugLog } = module;
      
      debugLog('Test message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Test message');
    });

    it('should not log when debug mode is disabled', async () => {
      // Reset modules to clear cache
      vi.resetModules();
      consoleErrorSpy.mockClear();
      process.env.MCP_CLAUDE_DEBUG = 'false';
      const module = await import('../server.js');
      // @ts-ignore
      const { debugLog } = module;
      
      debugLog('Test message');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });

  describe('findClaudeCli function', () => {
    it('should return local path when it exists', async () => {
      mockHomedir.mockReturnValue('/home/user');
      mockExistsSync.mockImplementation((path) => {
        // Mock returns true for real CLI path
        if (path === '/home/user/.claude/local/claude') return true;
        return false;
      });
      
      const module = await import('../server.js');
      // @ts-ignore
      const findClaudeCli = module.default?.findClaudeCli || module.findClaudeCli;
      
      const result = findClaudeCli();
      expect(result).toBe('/home/user/.claude/local/claude');
    });

    it('should fallback to PATH when local does not exist', async () => {
      mockHomedir.mockReturnValue('/home/user');
      mockExistsSync.mockReturnValue(false);
      
      const module = await import('../server.js');
      // @ts-ignore
      const findClaudeCli = module.default?.findClaudeCli || module.findClaudeCli;
      
      const result = findClaudeCli();
      expect(result).toBe('claude');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Claude CLI not found at ~/.claude/local/claude')
      );
    });

    it('should use custom name from CLAUDE_CLI_NAME', async () => {
      process.env.CLAUDE_CLI_NAME = 'my-claude';
      mockHomedir.mockReturnValue('/home/user');
      mockExistsSync.mockReturnValue(false);
      
      const module = await import('../server.js');
      // @ts-ignore
      const findClaudeCli = module.default?.findClaudeCli || module.findClaudeCli;
      
      const result = findClaudeCli();
      expect(result).toBe('my-claude');
    });

    it('should use absolute path from CLAUDE_CLI_NAME', async () => {
      process.env.CLAUDE_CLI_NAME = '/absolute/path/to/claude';
      
      const module = await import('../server.js');
      // @ts-ignore
      const findClaudeCli = module.default?.findClaudeCli || module.findClaudeCli;
      
      const result = findClaudeCli();
      expect(result).toBe('/absolute/path/to/claude');
    });

    it('should throw error for relative paths in CLAUDE_CLI_NAME', async () => {
      process.env.CLAUDE_CLI_NAME = './relative/path/claude';
      
      const module = await import('../server.js');
      // @ts-ignore
      const findClaudeCli = module.default?.findClaudeCli || module.findClaudeCli;
      
      expect(() => findClaudeCli()).toThrow('Invalid CLAUDE_CLI_NAME: Relative paths are not allowed');
    });

    it('should throw error for paths with ../ in CLAUDE_CLI_NAME', async () => {
      process.env.CLAUDE_CLI_NAME = '../relative/path/claude';
      
      const module = await import('../server.js');
      // @ts-ignore
      const findClaudeCli = module.default?.findClaudeCli || module.findClaudeCli;
      
      expect(() => findClaudeCli()).toThrow('Invalid CLAUDE_CLI_NAME: Relative paths are not allowed');
    });
  });

  describe('spawnAsync function', () => {
    let mockProcess: any;
    
    beforeEach(() => {
      // Create a mock process
      mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.stdout.on = vi.fn((event, handler) => {
        mockProcess.stdout[event] = handler;
      });
      mockProcess.stderr.on = vi.fn((event, handler) => {
        mockProcess.stderr[event] = handler;
      });
      mockSpawn.mockReturnValue(mockProcess);
    });

    it('should execute command successfully', async () => {
      const module = await import('../server.js');
      // @ts-ignore
      const { spawnAsync } = module;
      
      // mockProcess is already defined in the outer scope
      
      // Start the async operation
      const promise = spawnAsync('echo', ['test']);
      
      // Simulate successful execution
      setTimeout(() => {
        mockProcess.stdout['data']('test output');
        mockProcess.stderr['data']('');
        mockProcess.emit('close', 0);
      }, 10);
      
      const result = await promise;
      expect(result).toEqual({
        stdout: 'test output',
        stderr: ''
      });
    });

    it('should handle command failure', async () => {
      const module = await import('../server.js');
      // @ts-ignore
      const { spawnAsync } = module;
      
      // mockProcess is already defined in the outer scope
      
      // Start the async operation
      const promise = spawnAsync('false', []);
      
      // Simulate failed execution
      setTimeout(() => {
        mockProcess.stderr['data']('error output');
        mockProcess.emit('close', 1);
      }, 10);
      
      await expect(promise).rejects.toThrow('Command failed with exit code 1');
    });

    it('should handle spawn error', async () => {
      const module = await import('../server.js');
      // @ts-ignore
      const { spawnAsync } = module;
      
      // mockProcess is already defined in the outer scope
      
      // Start the async operation
      const promise = spawnAsync('nonexistent', []);
      
      // Simulate spawn error
      setTimeout(() => {
        const error: any = new Error('spawn error');
        error.code = 'ENOENT';
        error.path = 'nonexistent';
        error.syscall = 'spawn';
        mockProcess.emit('error', error);
      }, 10);
      
      await expect(promise).rejects.toThrow('Spawn error');
    });

    it('should respect timeout option', async () => {
      const module = await import('../server.js');
      // @ts-ignore
      const { spawnAsync } = module;
      
      const result = spawnAsync('sleep', ['10'], { timeout: 100 });
      
      expect(mockSpawn).toHaveBeenCalledWith('sleep', ['10'], expect.objectContaining({
        timeout: 100
      }));
    });

    it('should use provided cwd option', async () => {
      const module = await import('../server.js');
      // @ts-ignore
      const { spawnAsync } = module;
      
      const result = spawnAsync('ls', [], { cwd: '/tmp' });
      
      expect(mockSpawn).toHaveBeenCalledWith('ls', [], expect.objectContaining({
        cwd: '/tmp'
      }));
    });
  });

  describe('ClaudeCodeServer class', () => {
    it('should initialize with correct settings', async () => {
      mockHomedir.mockReturnValue('/home/user');
      mockExistsSync.mockReturnValue(true);
      
      // Set up Server mock before resetting modules
      vi.mocked(Server).mockImplementation(function(this: any) {
        this.setRequestHandler = vi.fn();
        this.connect = vi.fn();
        this.close = vi.fn();
        this.onerror = undefined;
        return this;
      });
      
      const module = await import('../server.js');
      // @ts-ignore
      const { ClaudeCodeServer } = module;
      
      const server = new ClaudeCodeServer();
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Setup] Using Claude CLI command/path:')
      );
    });

    it('should set up tool handlers', async () => {
      mockHomedir.mockReturnValue('/home/user');
      mockExistsSync.mockReturnValue(true);
      
      const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
      const mockSetRequestHandler = vi.fn();
      vi.mocked(Server).mockImplementation(function(this: any) {
        this.setRequestHandler = mockSetRequestHandler;
        this.connect = vi.fn();
        this.close = vi.fn();
        this.onerror = undefined;
        return this;
      });
      
      const module = await import('../server.js');
      // @ts-ignore
      const { ClaudeCodeServer } = module;
      
      const server = new ClaudeCodeServer();
      
      expect(mockSetRequestHandler).toHaveBeenCalled();
    });

    it('should set up error handler', async () => {
      mockHomedir.mockReturnValue('/home/user');
      mockExistsSync.mockReturnValue(true);
      
      const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
      let errorHandler: any = null;
      vi.mocked(Server).mockImplementation(function(this: any) {
        this.setRequestHandler = vi.fn();
        this.connect = vi.fn();
        this.close = vi.fn();
        Object.defineProperty(this, 'onerror', {
          get() { return errorHandler; },
          set(handler) { errorHandler = handler; },
          enumerable: true,
          configurable: true
        });
        return this;
      });
      
      const module = await import('../server.js');
      // @ts-ignore
      const { ClaudeCodeServer } = module;
      
      const server = new ClaudeCodeServer();
      
      // Test error handler
      errorHandler(new Error('Test error'));
      expect(consoleErrorSpy).toHaveBeenCalledWith('[Error]', expect.any(Error));
    });

    it('should handle SIGINT', async () => {
      mockHomedir.mockReturnValue('/home/user');
      mockExistsSync.mockReturnValue(true);
      
      // Set up Server mock first
      vi.mocked(Server).mockImplementation(function(this: any) {
        this.setRequestHandler = vi.fn();
        this.connect = vi.fn();
        this.close = vi.fn();
        this.onerror = undefined;
        return this;
      });
      
      const module = await import('../server.js');
      // @ts-ignore
      const { ClaudeCodeServer } = module;
      
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const server = new ClaudeCodeServer();
      const mockServerInstance = vi.mocked(Server).mock.results[0].value;
      
      // Emit SIGINT
      const sigintHandler = process.listeners('SIGINT').slice(-1)[0] as any;
      await sigintHandler();
      
      expect(mockServerInstance.close).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(0);
      
      exitSpy.mockRestore();
    });
  });

  describe('Tool handler implementation', () => {
    // Define setupServerMock for this describe block
    let errorHandler: any = null;
    function setupServerMock() {
      errorHandler = null;
      vi.mocked(Server).mockImplementation(function(this: any) {
        this.setRequestHandler = vi.fn();
        this.connect = vi.fn();
        this.close = vi.fn();
        Object.defineProperty(this, 'onerror', {
          get() { return errorHandler; },
          set(handler) { errorHandler = handler; },
          enumerable: true,
          configurable: true
        });
        return this;
      });
    }

    it('should handle ListToolsRequest', async () => {
      mockHomedir.mockReturnValue('/home/user');
      mockExistsSync.mockReturnValue(true);
      
      // Use the setupServerMock function from the beginning of the file
      setupServerMock();
      
      const module = await import('../server.js');
      // @ts-ignore
      const { ClaudeCodeServer } = module;
      
      const server = new ClaudeCodeServer();
      const mockServerInstance = vi.mocked(Server).mock.results[0].value;
      
      // Find the ListToolsRequest handler
      const listToolsCall = mockServerInstance.setRequestHandler.mock.calls.find(
        (call: any[]) => call[0].name === 'listTools'
      );
      
      expect(listToolsCall).toBeDefined();
      
      // Test the handler
      const handler = listToolsCall[1];
      const result = await handler();
      
      expect(result.tools).toHaveLength(4);
      expect(result.tools[0].name).toBe('claude_code');
      expect(result.tools[0].description).toContain('Claude Code Agent');
      expect(result.tools[1].name).toBe('list_claude_processes');
      expect(result.tools[2].name).toBe('get_claude_result');
      expect(result.tools[3].name).toBe('kill_claude_process');
    });

    it('should handle CallToolRequest', async () => {
      mockHomedir.mockReturnValue('/home/user');
      mockExistsSync.mockReturnValue(true);
      
      // Set up Server mock
      setupServerMock();
      
      const module = await import('../server.js');
      // @ts-ignore
      const { ClaudeCodeServer } = module;
      
      const server = new ClaudeCodeServer();
      const mockServerInstance = vi.mocked(Server).mock.results[0].value;
      
      // Find the CallToolRequest handler
      const callToolCall = mockServerInstance.setRequestHandler.mock.calls.find(
        (call: any[]) => call[0].name === 'callTool'
      );
      
      expect(callToolCall).toBeDefined();
      
      // Create a mock process for the tool execution
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.stdout.on = vi.fn();
      mockProcess.stderr.on = vi.fn();
      mockProcess.kill = vi.fn();
      
      mockSpawn.mockReturnValue(mockProcess);
      
      // Test the handler
      const handler = callToolCall[1];
      const result = await handler({
        params: {
          name: 'claude_code',
          arguments: {
            prompt: 'test prompt',
            workFolder: '/tmp'
          }
        }
      });
      
      // claude_code now returns PID immediately
      expect(result.content[0].type).toBe('text');
      const response = JSON.parse(result.content[0].text);
      expect(response.pid).toBe(12345);
      expect(response.status).toBe('started');
    });

    it('should require workFolder parameter', async () => {
      mockHomedir.mockReturnValue('/home/user');
      mockExistsSync.mockReturnValue(true);
      
      // Set up Server mock
      setupServerMock();
      
      const module = await import('../server.js');
      // @ts-ignore
      const { ClaudeCodeServer } = module;
      const server = new ClaudeCodeServer();
      const mockServerInstance = vi.mocked(Server).mock.results[0].value;
      
      // Find the CallToolRequest handler
      const callToolCall = mockServerInstance.setRequestHandler.mock.calls.find(
        (call: any[]) => call[0].name === 'callTool'
      );
      
      const handler = callToolCall[1];
      
      // Test missing workFolder
      await expect(handler({
        params: {
          name: 'claude_code',
          arguments: {
            prompt: 'test'
          }
        }
      })).rejects.toThrow('Missing or invalid required parameter: workFolder');
    });

    it('should handle non-existent workFolder', async () => {
      mockHomedir.mockReturnValue('/home/user');
      mockExistsSync.mockImplementation((path) => {
        // Make the CLI path exist but the workFolder not exist
        if (String(path).includes('.claude')) return true;
        if (path === '/nonexistent') return false;
        return false;
      });
      
      // Set up Server mock
      setupServerMock();
      
      const module = await import('../server.js');
      // @ts-ignore
      const { ClaudeCodeServer } = module;
      const server = new ClaudeCodeServer();
      const mockServerInstance = vi.mocked(Server).mock.results[0].value;
      
      // Find the CallToolRequest handler
      const callToolCall = mockServerInstance.setRequestHandler.mock.calls.find(
        (call: any[]) => call[0].name === 'callTool'
      );
      
      const handler = callToolCall[1];
      
      // Should throw error for non-existent workFolder
      await expect(
        handler({
          params: {
            name: 'claude_code',
            arguments: {
              prompt: 'test',
              workFolder: '/nonexistent'
            }
          }
        })
      ).rejects.toThrow('Working folder does not exist');
    });

    it('should handle session_id parameter', async () => {
      mockHomedir.mockReturnValue('/home/user');
      mockExistsSync.mockReturnValue(true);
      
      // Set up Server mock
      setupServerMock();
      
      const module = await import('../server.js');
      // @ts-ignore
      const { ClaudeCodeServer } = module;
      const server = new ClaudeCodeServer();
      const mockServerInstance = vi.mocked(Server).mock.results[0].value;
      
      // Find the CallToolRequest handler
      const callToolCall = mockServerInstance.setRequestHandler.mock.calls.find(
        (call: any[]) => call[0].name === 'callTool'
      );
      
      const handler = callToolCall[1];
      
      // Create mock process
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12347;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.stdout.on = vi.fn();
      mockProcess.stderr.on = vi.fn();
      mockProcess.kill = vi.fn();
      mockSpawn.mockReturnValue(mockProcess);
      
      const result = await handler({
        params: {
          name: 'claude_code',
          arguments: {
            prompt: 'test prompt',
            workFolder: '/tmp',
            session_id: 'test-session-123'
          }
        }
      });
      
      // Verify spawn was called with -r flag
      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['-r', 'test-session-123', '-p', 'test prompt']),
        expect.any(Object)
      );
    });

    it('should handle prompt_file parameter', async () => {
      mockHomedir.mockReturnValue('/home/user');
      mockExistsSync.mockImplementation((path) => {
        if (String(path).includes('.claude')) return true;
        if (path === '/tmp') return true;
        if (path === '/tmp/prompt.txt') return true;
        return false;
      });
      
      // Mock readFileSync
      const readFileSyncMock = vi.fn().mockReturnValue('Content from file');
      vi.doMock('node:fs', () => ({
        existsSync: mockExistsSync,
        readFileSync: readFileSyncMock
      }));
      
      // Set up Server mock
      setupServerMock();
      
      const module = await import('../server.js');
      // @ts-ignore
      const { ClaudeCodeServer } = module;
      const server = new ClaudeCodeServer();
      const mockServerInstance = vi.mocked(Server).mock.results[0].value;
      
      // Find the CallToolRequest handler
      const callToolCall = mockServerInstance.setRequestHandler.mock.calls.find(
        (call: any[]) => call[0].name === 'callTool'
      );
      
      const handler = callToolCall[1];
      
      // Create mock process
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12348;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.stdout.on = vi.fn();
      mockProcess.stderr.on = vi.fn();
      mockProcess.kill = vi.fn();
      mockSpawn.mockReturnValue(mockProcess);
      
      const result = await handler({
        params: {
          name: 'claude_code',
          arguments: {
            prompt_file: '/tmp/prompt.txt',
            workFolder: '/tmp'
          }
        }
      });
      
      // Verify file was read and spawn was called with content
      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['-p', 'Content from file']),
        expect.any(Object)
      );
    });

    it('should reject when both prompt and prompt_file are provided', async () => {
      mockHomedir.mockReturnValue('/home/user');
      mockExistsSync.mockReturnValue(true);
      
      // Set up Server mock
      setupServerMock();
      
      const module = await import('../server.js');
      // @ts-ignore
      const { ClaudeCodeServer } = module;
      const server = new ClaudeCodeServer();
      const mockServerInstance = vi.mocked(Server).mock.results[0].value;
      
      // Find the CallToolRequest handler
      const callToolCall = mockServerInstance.setRequestHandler.mock.calls.find(
        (call: any[]) => call[0].name === 'callTool'
      );
      
      const handler = callToolCall[1];
      
      // Test both parameters provided
      try {
        await handler({
          params: {
            name: 'claude_code',
            arguments: {
              prompt: 'test prompt',
              prompt_file: '/tmp/prompt.txt',
              workFolder: '/tmp'
            }
          }
        });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).toContain('Cannot specify both prompt and prompt_file');
      }
    });

    it('should reject when neither prompt nor prompt_file are provided', async () => {
      mockHomedir.mockReturnValue('/home/user');
      mockExistsSync.mockReturnValue(true);
      
      // Set up Server mock
      setupServerMock();
      
      const module = await import('../server.js');
      // @ts-ignore
      const { ClaudeCodeServer } = module;
      const server = new ClaudeCodeServer();
      const mockServerInstance = vi.mocked(Server).mock.results[0].value;
      
      // Find the CallToolRequest handler
      const callToolCall = mockServerInstance.setRequestHandler.mock.calls.find(
        (call: any[]) => call[0].name === 'callTool'
      );
      
      const handler = callToolCall[1];
      
      // Test neither parameter provided
      try {
        await handler({
          params: {
            name: 'claude_code',
            arguments: {
              workFolder: '/tmp'
            }
          }
        });
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).toContain('Either prompt or prompt_file must be provided');
      }
    });
  });
});