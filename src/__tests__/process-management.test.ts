import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { EventEmitter } from 'node:events';

// Mock dependencies
vi.mock('node:child_process');
vi.mock('node:fs');
vi.mock('node:os');
vi.mock('@modelcontextprotocol/sdk/server/stdio.js');
vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  ListToolsRequestSchema: { name: 'listTools' },
  CallToolRequestSchema: { name: 'callTool' },
  ErrorCode: { 
    InternalError: 'InternalError',
    MethodNotFound: 'MethodNotFound',
    InvalidParams: 'InvalidParams'
  },
  McpError: class McpError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'McpError';
    }
  }
}));
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: vi.fn().mockImplementation(function() {
    return {
      setRequestHandler: vi.fn(),
      connect: vi.fn(),
      close: vi.fn(),
      onerror: undefined,
    };
  }),
}));

const mockExistsSync = vi.mocked(existsSync);
const mockSpawn = vi.mocked(spawn);
const mockHomedir = vi.mocked(homedir);

describe('Process Management Tests', () => {
  let consoleErrorSpy: any;
  let originalEnv: any;
  let mockServerInstance: any;
  let handlers: Map<string, Function>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    originalEnv = { ...process.env };
    process.env = { ...originalEnv };
    handlers = new Map();
    
    // Set up default mocks
    mockHomedir.mockReturnValue('/home/user');
    mockExistsSync.mockReturnValue(true);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    process.env = originalEnv;
  });

  async function setupServer() {
    const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
    
    vi.mocked(Server).mockImplementation(() => {
      mockServerInstance = {
        setRequestHandler: vi.fn((schema: any, handler: Function) => {
          handlers.set(schema.name, handler);
        }),
        connect: vi.fn(),
        close: vi.fn(),
        onerror: undefined
      };
      return mockServerInstance as any;
    });

    const module = await import('../server.js');
    const { ClaudeCodeServer } = module;
    
    const server = new ClaudeCodeServer();
    
    return { server, module, handlers };
  }

  describe('claude_code tool with PID return', () => {
    it('should return PID immediately when starting a process', async () => {
      const { handlers } = await setupServer();
      
      // Create a mock process
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = vi.fn();
      
      mockSpawn.mockReturnValue(mockProcess);
      
      const callToolHandler = handlers.get('callTool')!;
      const result = await callToolHandler!({
        params: {
          name: 'claude_code',
          arguments: {
            prompt: 'test prompt',
            workFolder: '/tmp'
          }
        }
      });
      
      const response = JSON.parse(result.content[0].text);
      expect(response.pid).toBe(12345);
      expect(response.status).toBe('started');
      expect(response.message).toBe('Claude Code process started successfully');
    });

    it('should handle process with model parameter', async () => {
      const { handlers } = await setupServer();
      
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12346;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = vi.fn();
      
      mockSpawn.mockReturnValue(mockProcess);
      
      const callToolHandler = handlers.get('callTool')!;
      await callToolHandler!({
        params: {
          name: 'claude_code',
          arguments: {
            prompt: 'test prompt',
            workFolder: '/tmp',
            model: 'opus'
          }
        }
      });
      
      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['--model', 'opus']),
        expect.any(Object)
      );
    });

    it('should handle Japanese prompts with newlines', async () => {
      const { handlers } = await setupServer();
      
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12360;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = vi.fn();
      
      mockSpawn.mockReturnValue(mockProcess);
      
      const japanesePrompt = `日本語のテストプロンプトです。
これは改行を含んでいます。
さらに、特殊文字も含みます：「こんにちは」、『世界』
最後の行です。`;
      
      const callToolHandler = handlers.get('callTool')!;
      const result = await callToolHandler!({
        params: {
          name: 'claude_code',
          arguments: {
            prompt: japanesePrompt,
            workFolder: '/tmp'
          }
        }
      });
      
      // Verify PID is returned
      const response = JSON.parse(result.content[0].text);
      expect(response.pid).toBe(12360);
      
      // Verify spawn was called with the correct prompt including newlines
      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['-p', japanesePrompt]),
        expect.any(Object)
      );
      
      // Verify the prompt is stored correctly in process manager
      const getResult = await callToolHandler!({
        params: {
          name: 'get_claude_result',
          arguments: {
            pid: 12360
          }
        }
      });
      
      const processInfo = JSON.parse(getResult.content[0].text);
      expect(processInfo.prompt).toBe(japanesePrompt);
    });

    it('should handle very long Japanese prompts with multiple paragraphs', async () => {
      const { handlers } = await setupServer();
      
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12361;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = vi.fn();
      
      mockSpawn.mockReturnValue(mockProcess);
      
      const longJapanesePrompt = `# タスク：ファイル管理システムの作成

以下の要件に従って、ファイル管理システムを作成してください：

1. **基本機能**
   - ファイルの作成、読み取り、更新、削除（CRUD）
   - ディレクトリの作成と管理
   - ファイルの検索機能

2. **追加機能**
   - ファイルのバージョン管理
   - アクセス権限の設定
   - ログ記録機能

3. **技術要件**
   - TypeScriptを使用
   - テストコードを含める
   - ドキュメントを日本語で作成

注意事項：
- エラーハンドリングを適切に行う
- パフォーマンスを考慮した実装
- セキュリティに配慮すること

よろしくお願いします。`;
      
      const callToolHandler = handlers.get('callTool')!;
      const result = await callToolHandler!({
        params: {
          name: 'claude_code',
          arguments: {
            prompt: longJapanesePrompt,
            workFolder: '/tmp',
            model: 'sonnet'
          }
        }
      });
      
      // Verify PID is returned
      const response = JSON.parse(result.content[0].text);
      expect(response.pid).toBe(12361);
      
      // Verify spawn was called with the complete long prompt
      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['-p', longJapanesePrompt]),
        expect.any(Object)
      );
      
      // Check list_claude_processes truncates long prompts correctly
      const listResult = await callToolHandler!({
        params: {
          name: 'list_claude_processes',
          arguments: {}
        }
      });
      
      const processes = JSON.parse(listResult.content[0].text);
      const process = processes.find((p: any) => p.pid === 12361);
      expect(process.prompt).toHaveLength(103); // 100 chars + '...'
      expect(process.prompt.endsWith('...')).toBe(true);
      expect(process.prompt).toContain('タスク：ファイル管理システムの作成');
    });

    it('should handle prompts with special characters and escape sequences', async () => {
      const { handlers } = await setupServer();
      
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12362;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = vi.fn();
      
      mockSpawn.mockReturnValue(mockProcess);
      
      // Test with various special characters
      const specialPrompt = `特殊文字のテスト:
\t- タブ文字
\n- 明示的な改行
"ダブルクォート" と 'シングルクォート'
バックスラッシュ: \\
Unicodeテスト: 🎌 🗾 ✨
環境変数風: $HOME と \${USER}`;
      
      const callToolHandler = handlers.get('callTool')!;
      const result = await callToolHandler!({
        params: {
          name: 'claude_code',
          arguments: {
            prompt: specialPrompt,
            workFolder: '/tmp'
          }
        }
      });
      
      // Verify PID is returned
      const response = JSON.parse(result.content[0].text);
      expect(response.pid).toBe(12362);
      
      // Verify spawn was called with the special characters intact
      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['-p', specialPrompt]),
        expect.any(Object)
      );
    });

    it('should throw error if process fails to start', async () => {
      const { handlers } = await setupServer();
      
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = undefined; // No PID means process failed to start
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      
      mockSpawn.mockReturnValue(mockProcess);
      
      const callToolHandler = handlers.get('callTool')!;
      await expect(callToolHandler!({
        params: {
          name: 'claude_code',
          arguments: {
            prompt: 'test prompt',
            workFolder: '/tmp/test'
          }
        }
      })).rejects.toThrow('Failed to start Claude CLI process');
    });
  });

  describe('list_claude_processes tool', () => {
    it('should list all processes', async () => {
      const { handlers } = await setupServer();
      
      // Start a process first
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12347;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = vi.fn();
      
      mockSpawn.mockReturnValue(mockProcess);
      
      const callToolHandler = handlers.get('callTool')!;
      
      // Start a process
      await callToolHandler!({
        params: {
          name: 'claude_code',
          arguments: {
            prompt: 'test prompt for listing',
            workFolder: '/tmp',
            model: 'sonnet'
          }
        }
      });
      
      // Simulate JSON output with session_id
      const jsonOutput = {
        session_id: 'list-test-session-789',
        status: 'running'
      };
      mockProcess.stdout.emit('data', JSON.stringify(jsonOutput));
      
      // List processes
      const listResult = await callToolHandler!({
        params: {
          name: 'list_claude_processes',
          arguments: {}
        }
      });
      
      const processes = JSON.parse(listResult.content[0].text);
      expect(processes).toHaveLength(1);
      expect(processes[0].pid).toBe(12347);
      expect(processes[0].status).toBe('running');
      expect(processes[0].prompt).toContain('test prompt for listing');
      expect(processes[0].model).toBe('sonnet');
      expect(processes[0].session_id).toBe('list-test-session-789');
    });

    it('should truncate long prompts in list', async () => {
      const { handlers } = await setupServer();
      
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12348;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = vi.fn();
      
      mockSpawn.mockReturnValue(mockProcess);
      
      const callToolHandler = handlers.get('callTool');
      
      // Start a process with a very long prompt
      const longPrompt = 'a'.repeat(150);
      await callToolHandler!({
        params: {
          name: 'claude_code',
          arguments: {
            prompt: longPrompt,
            workFolder: '/tmp'
          }
        }
      });
      
      // List processes
      const listResult = await callToolHandler!({
        params: {
          name: 'list_claude_processes',
          arguments: {}
        }
      });
      
      const processes = JSON.parse(listResult.content[0].text);
      expect(processes[0].prompt).toHaveLength(103); // 100 chars + '...'
      expect(processes[0].prompt.endsWith('...')).toBe(true);
    });
  });

  describe('get_claude_result tool', () => {
    it('should get process output', async () => {
      const { handlers } = await setupServer();
      
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12349;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = vi.fn();
      
      mockSpawn.mockReturnValue(mockProcess);
      
      const callToolHandler = handlers.get('callTool')!;
      
      // Start a process
      await callToolHandler!({
        params: {
          name: 'claude_code',
          arguments: {
            prompt: 'test prompt',
            workFolder: '/tmp'
          }
        }
      });
      
      // Simulate JSON output from Claude CLI
      const claudeJsonOutput = {
        session_id: 'test-session-123',
        status: 'success',
        message: 'Task completed'
      };
      mockProcess.stdout.emit('data', JSON.stringify(claudeJsonOutput));
      mockProcess.stderr.emit('data', 'Warning from stderr\n');
      
      // Get result
      const result = await callToolHandler!({
        params: {
          name: 'get_claude_result',
          arguments: {
            pid: 12349
          }
        }
      });
      
      const processInfo = JSON.parse(result.content[0].text);
      expect(processInfo.pid).toBe(12349);
      expect(processInfo.status).toBe('running');
      expect(processInfo.claudeOutput).toEqual(claudeJsonOutput);
      expect(processInfo.session_id).toBe('test-session-123');
    });

    it('should show completed status when process exits', async () => {
      const { handlers } = await setupServer();
      
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12350;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = vi.fn();
      
      mockSpawn.mockReturnValue(mockProcess);
      
      const callToolHandler = handlers.get('callTool')!;
      
      // Start a process
      await callToolHandler!({
        params: {
          name: 'claude_code',
          arguments: {
            prompt: 'test prompt',
            workFolder: '/tmp'
          }
        }
      });
      
      // Simulate process completion with JSON output
      const completedJsonOutput = {
        session_id: 'completed-session-456',
        status: 'completed',
        files_created: ['test.txt'],
        summary: 'Created test file successfully'
      };
      mockProcess.stdout.emit('data', JSON.stringify(completedJsonOutput));
      mockProcess.emit('close', 0);
      
      // Get result
      const result = await callToolHandler!({
        params: {
          name: 'get_claude_result',
          arguments: {
            pid: 12350
          }
        }
      });
      
      const processInfo = JSON.parse(result.content[0].text);
      expect(processInfo.status).toBe('completed');
      expect(processInfo.exitCode).toBe(0);
      expect(processInfo.claudeOutput).toEqual(completedJsonOutput);
      expect(processInfo.session_id).toBe('completed-session-456');
    });

    it('should throw error for non-existent PID', async () => {
      const { handlers } = await setupServer();
      
      const callToolHandler = handlers.get('callTool');
      
      await expect(callToolHandler!({
        params: {
          name: 'get_claude_result',
          arguments: {
            pid: 99999
          }
        }
      })).rejects.toThrow('Process with PID 99999 not found');
    });

    it('should throw error for invalid PID parameter', async () => {
      const { handlers } = await setupServer();
      
      const callToolHandler = handlers.get('callTool');
      
      await expect(callToolHandler!({
        params: {
          name: 'get_claude_result',
          arguments: {
            pid: 'not-a-number'
          }
        }
      })).rejects.toThrow('Missing or invalid required parameter: pid');
    });

    it('should handle non-JSON output gracefully', async () => {
      const { handlers } = await setupServer();
      
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12355;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = vi.fn();
      
      mockSpawn.mockReturnValue(mockProcess);
      
      const callToolHandler = handlers.get('callTool')!;
      
      // Start a process
      await callToolHandler!({
        params: {
          name: 'claude_code',
          arguments: {
            prompt: 'test prompt',
            workFolder: '/tmp'
          }
        }
      });
      
      // Simulate non-JSON output
      mockProcess.stdout.emit('data', 'This is plain text output, not JSON');
      mockProcess.stderr.emit('data', 'Some error occurred');
      
      // Get result
      const result = await callToolHandler!({
        params: {
          name: 'get_claude_result',
          arguments: {
            pid: 12355
          }
        }
      });
      
      const processInfo = JSON.parse(result.content[0].text);
      expect(processInfo.pid).toBe(12355);
      expect(processInfo.status).toBe('running');
      expect(processInfo.stdout).toBe('This is plain text output, not JSON');
      expect(processInfo.stderr).toBe('Some error occurred');
      expect(processInfo.claudeOutput).toBeUndefined();
      expect(processInfo.session_id).toBeUndefined();
    });
  });

  describe('kill_claude_process tool', () => {
    it('should kill a running process', async () => {
      const { handlers } = await setupServer();
      
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12351;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = vi.fn();
      
      mockSpawn.mockReturnValue(mockProcess);
      
      const callToolHandler = handlers.get('callTool')!;
      
      // Start a process
      await callToolHandler!({
        params: {
          name: 'claude_code',
          arguments: {
            prompt: 'test prompt',
            workFolder: '/tmp'
          }
        }
      });
      
      // Kill the process
      const killResult = await callToolHandler!({
        params: {
          name: 'kill_claude_process',
          arguments: {
            pid: 12351
          }
        }
      });
      
      const response = JSON.parse(killResult.content[0].text);
      expect(response.status).toBe('terminated');
      expect(response.message).toBe('Process terminated successfully');
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should handle already terminated process', async () => {
      const { handlers } = await setupServer();
      
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12352;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = vi.fn();
      
      mockSpawn.mockReturnValue(mockProcess);
      
      const callToolHandler = handlers.get('callTool');
      
      // Start and complete a process
      await callToolHandler!({
        params: {
          name: 'claude_code',
          arguments: {
            prompt: 'test prompt',
            workFolder: '/tmp'
          }
        }
      });
      
      // Simulate process completion
      mockProcess.emit('close', 0);
      
      // Try to kill the already completed process
      const killResult = await callToolHandler!({
        params: {
          name: 'kill_claude_process',
          arguments: {
            pid: 12352
          }
        }
      });
      
      const response = JSON.parse(killResult.content[0].text);
      expect(response.status).toBe('completed');
      expect(response.message).toBe('Process already terminated');
      expect(mockProcess.kill).not.toHaveBeenCalled();
    });

    it('should throw error for non-existent PID', async () => {
      const { handlers } = await setupServer();
      
      const callToolHandler = handlers.get('callTool');
      
      await expect(callToolHandler!({
        params: {
          name: 'kill_claude_process',
          arguments: {
            pid: 99999
          }
        }
      })).rejects.toThrow('Process with PID 99999 not found');
    });
  });

  describe('Tool routing', () => {
    it('should throw error for unknown tool', async () => {
      const { handlers } = await setupServer();
      
      const callToolHandler = handlers.get('callTool');
      
      await expect(callToolHandler!({
        params: {
          name: 'unknown_tool',
          arguments: {}
        }
      })).rejects.toThrow('Tool unknown_tool not found');
    });
  });

  describe('Process error handling', () => {
    it('should handle process errors', async () => {
      const { handlers } = await setupServer();
      
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12353;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = vi.fn();
      
      mockSpawn.mockReturnValue(mockProcess);
      
      const callToolHandler = handlers.get('callTool')!;
      
      // Start a process
      await callToolHandler!({
        params: {
          name: 'claude_code',
          arguments: {
            prompt: 'test prompt',
            workFolder: '/tmp'
          }
        }
      });
      
      // Simulate process error
      mockProcess.emit('error', new Error('spawn error'));
      
      // Get result to check error was recorded
      const result = await callToolHandler!({
        params: {
          name: 'get_claude_result',
          arguments: {
            pid: 12353
          }
        }
      });
      
      const processInfo = JSON.parse(result.content[0].text);
      expect(processInfo.status).toBe('failed');
      expect(processInfo.stderr).toContain('Process error: spawn error');
    });
  });
});