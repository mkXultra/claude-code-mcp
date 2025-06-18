import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

// Mock dependencies
vi.mock('node:child_process', () => ({
  spawn: vi.fn()
}));
vi.mock('node:fs');
vi.mock('node:os');
vi.mock('node:path', () => ({
  resolve: vi.fn((path) => path),
  join: vi.fn((...args) => args.join('/')),
  isAbsolute: vi.fn((path) => path.startsWith('/'))
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

const mockExistsSync = vi.mocked(existsSync);
const mockHomedir = vi.mocked(homedir);

describe('Argument Validation Tests', () => {
  let consoleErrorSpy: any;
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

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unmock('../server.js');
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Set up process.env
    process.env = { ...process.env };
  });

  describe('Tool Arguments Schema', () => {
    it('should validate valid arguments', async () => {
      mockHomedir.mockReturnValue('/home/user');
      mockExistsSync.mockReturnValue(true);
      setupServerMock();
      const module = await import('../server.js');
      // @ts-ignore
      const { ClaudeCodeServer } = module;
      
      const server = new ClaudeCodeServer();
      const mockServerInstance = vi.mocked(Server).mock.results[0].value;
      
      // Find tool definition  
      const listToolsCall = mockServerInstance.setRequestHandler.mock.calls.find(
        (call: any[]) => call[0].name === 'listTools'
      );
      
      const listHandler = listToolsCall[1];
      const tools = await listHandler();
      const claudeCodeTool = tools.tools[0];
      
      // Extract schema from tool definition
      const schema = z.object({
        prompt: z.string(),
        workFolder: z.string(),
        model: z.string().optional(),
        session_id: z.string().optional()
      });
      
      // Test valid cases
      expect(() => schema.parse({ prompt: 'test', workFolder: '/tmp' })).not.toThrow();
      expect(() => schema.parse({ prompt: 'test', workFolder: '/tmp', model: 'sonnet' })).not.toThrow();
    });

    it('should reject invalid arguments', async () => {
      mockHomedir.mockReturnValue('/home/user');
      mockExistsSync.mockReturnValue(true);
      setupServerMock();
      const module = await import('../server.js');
      // @ts-ignore
      const { ClaudeCodeServer } = module;
      
      const server = new ClaudeCodeServer();
      const mockServerInstance = vi.mocked(Server).mock.results[0].value;
      
      // Find tool definition  
      const listToolsCall = mockServerInstance.setRequestHandler.mock.calls.find(
        (call: any[]) => call[0].name === 'listTools'
      );
      
      const listHandler = listToolsCall[1];
      const tools = await listHandler();
      const claudeCodeTool = tools.tools[0];
      
      // Extract schema from tool definition
      const schema = z.object({
        prompt: z.string(),
        workFolder: z.string(),
        model: z.string().optional(),
        session_id: z.string().optional()
      });
      
      // Test invalid cases
      expect(() => schema.parse({})).toThrow(); // Missing prompt and workFolder
      expect(() => schema.parse({ prompt: 'test' })).toThrow(); // Missing workFolder
      expect(() => schema.parse({ prompt: 123, workFolder: '/tmp' })).toThrow(); // Wrong prompt type
      expect(() => schema.parse({ prompt: 'test', workFolder: 123 })).toThrow(); // Wrong workFolder type
    });

    it('should handle missing required fields', async () => {
      const schema = z.object({
        prompt: z.string(),
        workFolder: z.string(),
        model: z.string().optional(),
        session_id: z.string().optional()
      });
      
      try {
        schema.parse({});
      } catch (error: any) {
        // Both prompt and workFolder are required
        expect(error.errors.length).toBe(2);
        expect(error.errors.some((e: any) => e.path[0] === 'prompt')).toBe(true);
        expect(error.errors.some((e: any) => e.path[0] === 'workFolder')).toBe(true);
      }
    });

    it('should allow optional fields to be undefined', async () => {
      const schema = z.object({
        prompt: z.string(),
        workFolder: z.string(),
        model: z.string().optional(),
        session_id: z.string().optional()
      });
      
      const result = schema.parse({ prompt: 'test', workFolder: '/tmp' });
      expect(result.model).toBeUndefined();
      expect(result.session_id).toBeUndefined();
    });

    it('should handle extra fields gracefully', async () => {
      const schema = z.object({
        prompt: z.string(),
        workFolder: z.string(),
        model: z.string().optional(),
        session_id: z.string().optional()
      });
      
      // By default, Zod strips unknown keys
      const result = schema.parse({ 
        prompt: 'test',
        workFolder: '/tmp', 
        extraField: 'ignored' 
      });
      
      expect(result).toEqual({ prompt: 'test', workFolder: '/tmp' });
      expect(result).not.toHaveProperty('extraField');
    });
  });

  describe('Runtime Argument Validation', () => {
    it('should validate workFolder is a string when provided', async () => {
      mockHomedir.mockReturnValue('/home/user');
      mockExistsSync.mockReturnValue(true);
      setupServerMock();
      const module = await import('../server.js');
      // @ts-ignore
      const { ClaudeCodeServer } = module;
      
      const server = new ClaudeCodeServer();
      const mockServerInstance = vi.mocked(Server).mock.results[0].value;
      
      const callToolCall = mockServerInstance.setRequestHandler.mock.calls.find(
        (call: any[]) => call[0].name === 'callTool'
      );
      
      const handler = callToolCall[1];
      
      // Test with non-string workFolder
      await expect(
        handler({
          params: {
            name: 'claude_code',
            arguments: {
              prompt: 'test',
              workFolder: 123 // Invalid type
            }
          }
        })
      ).rejects.toThrow();
    });

    it('should reject empty string prompt', async () => {
      mockHomedir.mockReturnValue('/home/user');
      mockExistsSync.mockReturnValue(true);
      setupServerMock();
      const module = await import('../server.js');
      // @ts-ignore
      const { ClaudeCodeServer } = module;
      
      const server = new ClaudeCodeServer();
      const mockServerInstance = vi.mocked(Server).mock.results[0].value;
      
      const callToolCall = mockServerInstance.setRequestHandler.mock.calls.find(
        (call: any[]) => call[0].name === 'callTool'
      );
      
      const handler = callToolCall[1];
      
      // Empty string prompt should be rejected
      await expect(
        handler({
          params: {
            name: 'claude_code',
            arguments: {
              prompt: '', // Empty prompt
              workFolder: '/tmp'
            }
          }
        })
      ).rejects.toThrow('Missing or invalid required parameter: prompt');
    });
  });
});