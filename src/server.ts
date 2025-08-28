#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type ServerResult,
} from '@modelcontextprotocol/sdk/types.js';
import { spawn, ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve as pathResolve } from 'node:path';
import * as path from 'path';
import { parseCodexOutput, parseClaudeOutput } from './parsers.js';

// Server version - update this when releasing new versions
const SERVER_VERSION = "2.0.0";

// Model alias mappings for user-friendly model names
const MODEL_ALIASES: Record<string, string> = {
  'haiku': 'claude-3-5-haiku-20241022'
};

// Define debugMode globally using const
const debugMode = process.env.MCP_CLAUDE_DEBUG === 'true';

// Track if this is the first tool use for version printing
let isFirstToolUse = true;

// Capture server startup time when the module loads
const serverStartupTime = new Date().toISOString();

// Process tracking
interface ClaudeProcess {
  pid: number;
  process: ChildProcess;
  prompt: string;
  workFolder: string;
  model?: string;
  toolType: 'claude' | 'codex';  // Identify which CLI tool
  startTime: string;
  stdout: string;
  stderr: string;
  status: 'running' | 'completed' | 'failed';
  exitCode?: number;
}

// Global process manager
const processManager = new Map<number, ClaudeProcess>();

// Dedicated debug logging function
export function debugLog(message?: any, ...optionalParams: any[]): void {
  if (debugMode) {
    console.error(message, ...optionalParams);
  }
}

/**
 * Determine the Codex CLI command/path.
 * Similar to findClaudeCli but for Codex
 */
export function findCodexCli(): string {
  debugLog('[Debug] Attempting to find Codex CLI...');

  // Check for custom CLI name from environment variable
  const customCliName = process.env.CODEX_CLI_NAME;
  if (customCliName) {
    debugLog(`[Debug] Using custom Codex CLI name from CODEX_CLI_NAME: ${customCliName}`);
    
    // If it's an absolute path, use it directly
    if (path.isAbsolute(customCliName)) {
      debugLog(`[Debug] CODEX_CLI_NAME is an absolute path: ${customCliName}`);
      return customCliName;
    }
    
    // If it starts with ~ or ./, reject as relative paths are not allowed
    if (customCliName.startsWith('./') || customCliName.startsWith('../') || customCliName.includes('/')) {
      throw new Error(`Invalid CODEX_CLI_NAME: Relative paths are not allowed. Use either a simple name (e.g., 'codex') or an absolute path (e.g., '/tmp/codex-test')`);
    }
  }
  
  const cliName = customCliName || 'codex';

  // Try local install path: ~/.codex/local/codex
  const userPath = join(homedir(), '.codex', 'local', 'codex');
  debugLog(`[Debug] Checking for Codex CLI at local user path: ${userPath}`);

  if (existsSync(userPath)) {
    debugLog(`[Debug] Found Codex CLI at local user path: ${userPath}. Using this path.`);
    return userPath;
  } else {
    debugLog(`[Debug] Codex CLI not found at local user path: ${userPath}.`);
  }

  // Fallback to CLI name (PATH lookup)
  debugLog(`[Debug] Falling back to "${cliName}" command name, relying on spawn/PATH lookup.`);
  console.warn(`[Warning] Codex CLI not found at ~/.codex/local/codex. Falling back to "${cliName}" in PATH. Ensure it is installed and accessible.`);
  return cliName;
}

/**
 * Determine the Claude CLI command/path.
 * 1. Checks for CLAUDE_CLI_NAME environment variable:
 *    - If absolute path, uses it directly
 *    - If relative path, throws error
 *    - If simple name, continues with path resolution
 * 2. Checks for Claude CLI at the local user path: ~/.claude/local/claude.
 * 3. If not found, defaults to the CLI name (or 'claude'), relying on the system's PATH for lookup.
 */
export function findClaudeCli(): string {
  debugLog('[Debug] Attempting to find Claude CLI...');

  // Check for custom CLI name from environment variable
  const customCliName = process.env.CLAUDE_CLI_NAME;
  if (customCliName) {
    debugLog(`[Debug] Using custom Claude CLI name from CLAUDE_CLI_NAME: ${customCliName}`);
    
    // If it's an absolute path, use it directly
    if (path.isAbsolute(customCliName)) {
      debugLog(`[Debug] CLAUDE_CLI_NAME is an absolute path: ${customCliName}`);
      return customCliName;
    }
    
    // If it starts with ~ or ./, reject as relative paths are not allowed
    if (customCliName.startsWith('./') || customCliName.startsWith('../') || customCliName.includes('/')) {
      throw new Error(`Invalid CLAUDE_CLI_NAME: Relative paths are not allowed. Use either a simple name (e.g., 'claude') or an absolute path (e.g., '/tmp/claude-test')`);
    }
  }
  
  const cliName = customCliName || 'claude';

  // Try local install path: ~/.claude/local/claude (using the original name for local installs)
  const userPath = join(homedir(), '.claude', 'local', 'claude');
  debugLog(`[Debug] Checking for Claude CLI at local user path: ${userPath}`);

  if (existsSync(userPath)) {
    debugLog(`[Debug] Found Claude CLI at local user path: ${userPath}. Using this path.`);
    return userPath;
  } else {
    debugLog(`[Debug] Claude CLI not found at local user path: ${userPath}.`);
  }

  // 3. Fallback to CLI name (PATH lookup)
  debugLog(`[Debug] Falling back to "${cliName}" command name, relying on spawn/PATH lookup.`);
  console.warn(`[Warning] Claude CLI not found at ~/.claude/local/claude. Falling back to "${cliName}" in PATH. Ensure it is installed and accessible.`);
  return cliName;
}

/**
 * Interface for Claude Code tool arguments
 */
interface ClaudeCodeArgs {
  prompt?: string;
  prompt_file?: string;
  workFolder: string;
  model?: string;
  session_id?: string;
}

/**
 * Interface for Codex tool arguments
 */
interface CodexArgs {
  prompt?: string;
  prompt_file?: string;
  workFolder: string;
  model?: string;  // Format: gpt5-low, gpt5-middle, gpt5-high
}

/**
 * Resolves model aliases to their full model names
 * @param model - The model name or alias to resolve
 * @returns The full model name, or the original value if no alias exists
 */
export function resolveModelAlias(model: string): string {
  return MODEL_ALIASES[model] || model;
}

// Ensure spawnAsync is defined correctly *before* the class
export async function spawnAsync(command: string, args: string[], options?: { timeout?: number, cwd?: string }): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    debugLog(`[Spawn] Running command: ${command} ${args.join(' ')}`);
    const process = spawn(command, args, {
      shell: false, // Reverted to false
      timeout: options?.timeout,
      cwd: options?.cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data) => { stdout += data.toString(); });
    process.stderr.on('data', (data) => {
      stderr += data.toString();
      debugLog(`[Spawn Stderr Chunk] ${data.toString()}`);
    });

    process.on('error', (error: NodeJS.ErrnoException) => {
      debugLog(`[Spawn Error Event] Full error object:`, error);
      let errorMessage = `Spawn error: ${error.message}`;
      if (error.path) {
        errorMessage += ` | Path: ${error.path}`;
      }
      if (error.syscall) {
        errorMessage += ` | Syscall: ${error.syscall}`;
      }
      errorMessage += `\nStderr: ${stderr.trim()}`;
      reject(new Error(errorMessage));
    });

    process.on('close', (code) => {
      debugLog(`[Spawn Close] Exit code: ${code}`);
      debugLog(`[Spawn Stderr Full] ${stderr.trim()}`);
      debugLog(`[Spawn Stdout Full] ${stdout.trim()}`);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Command failed with exit code ${code}\nStderr: ${stderr.trim()}\nStdout: ${stdout.trim()}`));
      }
    });
  });
}

/**
 * MCP Server for Claude Code
 * Provides a simple MCP tool to run Claude CLI in one-shot mode
 */
export class ClaudeCodeServer {
  private server: Server;
  private claudeCliPath: string;
  private codexCliPath: string;
  private sigintHandler?: () => Promise<void>;
  private packageVersion: string;

  constructor() {
    // Use the simplified findClaudeCli function
    this.claudeCliPath = findClaudeCli(); // Removed debugMode argument
    this.codexCliPath = findCodexCli();
    console.error(`[Setup] Using Claude CLI command/path: ${this.claudeCliPath}`);
    console.error(`[Setup] Using Codex CLI command/path: ${this.codexCliPath}`);
    this.packageVersion = SERVER_VERSION;

    this.server = new Server(
      {
        name: 'ai_cli_mcp',
        version: SERVER_VERSION,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();

    this.server.onerror = (error) => console.error('[Error]', error);
    this.sigintHandler = async () => {
      await this.server.close();
      process.exit(0);
    };
    process.on('SIGINT', this.sigintHandler);
  }

  /**
   * Set up the MCP tool handlers
   */
  private setupToolHandlers(): void {
    // Define available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'run',
          description: `AI Agent Runner: Starts a Claude or Codex CLI process in the background and returns a PID immediately. Use list_processes and get_result to monitor progress.

• File ops: Create, read, (fuzzy) edit, move, copy, delete, list files, analyze/ocr images, file content analysis
• Code: Generate / analyse / refactor / fix
• Git: Stage ▸ commit ▸ push ▸ tag (any workflow)
• Terminal: Run any CLI cmd or open URLs
• Web search + summarise content on-the-fly
• Multi-step workflows & GitHub integration

**IMPORTANT**: This tool now returns immediately with a PID. Use other tools to check status and get results.

**Supported models**: 
"sonnet", "opus", "haiku", "gpt-5-low", "gpt-5-medium", "gpt-5-high"

**Prompt input**: You must provide EITHER prompt (string) OR prompt_file (file path), but not both.

**Prompt tips**
1. Be concise, explicit & step-by-step for complex tasks.
2. Check process status with list_processes
3. Get results with get_result using the returned PID
4. Kill long-running processes with kill_process if needed

        `,
          inputSchema: {
            type: 'object',
            properties: {
              agent: {
                type: 'string',
                description: 'The agent to use: "claude" or "codex". Defaults to "claude".',
                enum: ['claude', 'codex'],
              },
              prompt: {
                type: 'string',
                description: 'The detailed natural language prompt for the agent to execute. Either this or prompt_file is required.',
              },
              prompt_file: {
                type: 'string',
                description: 'Path to a file containing the prompt. Either this or prompt is required. Must be an absolute path or relative to workFolder.',
              },
              workFolder: {
                type: 'string',
                description: 'The working directory for the agent execution. Must be an absolute path.',
              },
              model: {
                type: 'string',
                description: 'The model to use: "sonnet", "opus", "haiku", "gpt-5-low", "gpt-5-medium", "gpt-5-high".',
              },
              session_id: {
                type: 'string',
                description: 'Optional session ID to resume a previous session. Supported for: haiku, sonnet, opus.',
              },
            },
            required: ['workFolder'],
          },
        },
        {
          name: 'list_processes',
          description: 'List all running and completed AI agent processes with their status, PID, and basic info.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'get_result',
          description: 'Get the current output and status of an AI agent process by PID. Returns the output from the agent including session_id (if applicable), along with process metadata.',
          inputSchema: {
            type: 'object',
            properties: {
              pid: {
                type: 'number',
                description: 'The process ID returned by run tool.',
              },
            },
            required: ['pid'],
          },
        },
        {
          name: 'kill_process',
          description: 'Terminate a running AI agent process by PID.',
          inputSchema: {
            type: 'object',
            properties: {
              pid: {
                type: 'number',
                description: 'The process ID to terminate.',
              },
            },
            required: ['pid'],
          },
        }
      ],
    }));

    // Handle tool calls
    const executionTimeoutMs = 1800000; // 30 minutes timeout

    this.server.setRequestHandler(CallToolRequestSchema, async (args, call): Promise<ServerResult> => {
      debugLog('[Debug] Handling CallToolRequest:', args);

      const toolName = args.params.name;
      const toolArguments = args.params.arguments || {};

      switch (toolName) {
        case 'run':
          return this.handleRun(toolArguments);
        case 'list_processes':
          return this.handleListProcesses();
        case 'get_result':
          return this.handleGetResult(toolArguments);
        case 'kill_process':
          return this.handleKillProcess(toolArguments);
        default:
          throw new McpError(ErrorCode.MethodNotFound, `Tool ${toolName} not found`);
      }
    });
  }

  /**
   * Handle run tool - starts Claude or Codex process and returns PID immediately
   */
  private async handleRun(toolArguments: any): Promise<ServerResult> {
    // Validate workFolder is required
    if (!toolArguments.workFolder || typeof toolArguments.workFolder !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Missing or invalid required parameter: workFolder');
    }

    // Validate that either prompt or prompt_file is provided
    const hasPrompt = toolArguments.prompt && typeof toolArguments.prompt === 'string' && toolArguments.prompt.trim() !== '';
    const hasPromptFile = toolArguments.prompt_file && typeof toolArguments.prompt_file === 'string' && toolArguments.prompt_file.trim() !== '';

    if (!hasPrompt && !hasPromptFile) {
      throw new McpError(ErrorCode.InvalidParams, 'Either prompt or prompt_file must be provided');
    }

    if (hasPrompt && hasPromptFile) {
      throw new McpError(ErrorCode.InvalidParams, 'Cannot specify both prompt and prompt_file. Please use only one.');
    }

    // Determine the prompt to use
    let prompt: string;
    if (hasPrompt) {
      prompt = toolArguments.prompt;
    } else {
      // Read prompt from file
      const promptFilePath = path.isAbsolute(toolArguments.prompt_file) 
        ? toolArguments.prompt_file 
        : pathResolve(toolArguments.workFolder, toolArguments.prompt_file);
      
      if (!existsSync(promptFilePath)) {
        throw new McpError(ErrorCode.InvalidParams, `Prompt file does not exist: ${promptFilePath}`);
      }
      
      try {
        prompt = readFileSync(promptFilePath, 'utf-8');
      } catch (error: any) {
        throw new McpError(ErrorCode.InvalidParams, `Failed to read prompt file: ${error.message}`);
      }
    }
    
    // Determine working directory
    const resolvedCwd = pathResolve(toolArguments.workFolder);
    if (!existsSync(resolvedCwd)) {
      throw new McpError(ErrorCode.InvalidParams, `Working folder does not exist: ${toolArguments.workFolder}`);
    }
    const effectiveCwd = resolvedCwd;

    // Print version on first use
    if (isFirstToolUse) {
      console.error(`ai_cli_mcp v${SERVER_VERSION} started at ${serverStartupTime}`);
      isFirstToolUse = false;
    }

    // Determine which agent to use based on model name
    const model = toolArguments.model || '';
    const agent = model.startsWith('gpt-') ? 'codex' : 'claude';
    
    let cliPath: string;
    let processArgs: string[];
    
    if (agent === 'codex') {
      // Handle Codex
      cliPath = this.codexCliPath;
      processArgs = ['exec'];
      
      // Parse model format for Codex (e.g., gpt-5-low -> model: gpt-5, effort: low)
      if (toolArguments.model) {
        // Split by "gpt-5-" to get the effort level
        const effort = toolArguments.model.replace('gpt-5-', '');
        if (effort && effort !== toolArguments.model) {
          processArgs.push('-c', `model_reasoning_effort=${effort}`);
        }
        processArgs.push('--model', 'gpt-5');
      }
      
      processArgs.push('--full-auto', '--json', prompt);
      
    } else {
      // Handle Claude (default)
      cliPath = this.claudeCliPath;
      processArgs = ['--dangerously-skip-permissions', '--output-format', 'json'];
      
      // Add session_id if provided (Claude only)
      if (toolArguments.session_id && typeof toolArguments.session_id === 'string') {
        processArgs.push('-r', toolArguments.session_id);
      }
      
      processArgs.push('-p', prompt);
      if (toolArguments.model && typeof toolArguments.model === 'string') {
        const resolvedModel = resolveModelAlias(toolArguments.model);
        processArgs.push('--model', resolvedModel);
      }
    }

    // Spawn process without waiting
    const childProcess = spawn(cliPath, processArgs, {
      cwd: effectiveCwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false
    });

    const pid = childProcess.pid;
    if (!pid) {
      throw new McpError(ErrorCode.InternalError, `Failed to start ${agent} CLI process`);
    }

    // Create process tracking entry
    const processEntry: ClaudeProcess = {
      pid,
      process: childProcess,
      prompt,
      workFolder: effectiveCwd,
      model: toolArguments.model,
      toolType: agent as 'claude' | 'codex',
      startTime: new Date().toISOString(),
      stdout: '',
      stderr: '',
      status: 'running'
    };

    // Track the process
    processManager.set(pid, processEntry);

    // Set up output collection
    childProcess.stdout.on('data', (data) => {
      const entry = processManager.get(pid);
      if (entry) {
        entry.stdout += data.toString();
      }
    });

    childProcess.stderr.on('data', (data) => {
      const entry = processManager.get(pid);
      if (entry) {
        entry.stderr += data.toString();
      }
    });

    childProcess.on('close', (code) => {
      const entry = processManager.get(pid);
      if (entry) {
        entry.status = code === 0 ? 'completed' : 'failed';
        entry.exitCode = code !== null ? code : undefined;
      }
    });

    childProcess.on('error', (error) => {
      const entry = processManager.get(pid);
      if (entry) {
        entry.status = 'failed';
        entry.stderr += `\nProcess error: ${error.message}`;
      }
    });

    // Return PID immediately
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ 
          pid, 
          status: 'started',
          agent,
          message: `${agent} process started successfully`
        }, null, 2)
      }]
    };
  }

  /**
   * Handle list_processes tool
   */
  private async handleListProcesses(): Promise<ServerResult> {
    const processes: any[] = [];
    
    for (const [pid, process] of processManager.entries()) {
      const processInfo: any = {
        pid,
        agent: process.toolType,
        status: process.status,
        startTime: process.startTime,
        prompt: process.prompt.substring(0, 100) + (process.prompt.length > 100 ? '...' : ''),
        workFolder: process.workFolder,
        model: process.model,
        exitCode: process.exitCode
      };

      // Try to extract session_id from JSON output if available
      if (process.stdout) {
        try {
          const claudeOutput = JSON.parse(process.stdout);
          if (claudeOutput.session_id) {
            processInfo.session_id = claudeOutput.session_id;
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }

      processes.push(processInfo);
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(processes, null, 2)
      }]
    };
  }

  /**
   * Handle get_result tool
   */
  private async handleGetResult(toolArguments: any): Promise<ServerResult> {
    if (!toolArguments.pid || typeof toolArguments.pid !== 'number') {
      throw new McpError(ErrorCode.InvalidParams, 'Missing or invalid required parameter: pid');
    }

    const pid = toolArguments.pid;
    const process = processManager.get(pid);

    if (!process) {
      throw new McpError(ErrorCode.InvalidParams, `Process with PID ${pid} not found`);
    }

    // Parse output based on agent type
    let agentOutput: any = null;
    if (process.stdout) {
      if (process.toolType === 'codex') {
        agentOutput = parseCodexOutput(process.stdout);
      } else if (process.toolType === 'claude') {
        agentOutput = parseClaudeOutput(process.stdout);
      }
    }

    // Construct response with agent's output and process metadata
    const response: any = {
      pid,
      agent: process.toolType,
      status: process.status,
      exitCode: process.exitCode,
      startTime: process.startTime,
      workFolder: process.workFolder,
      prompt: process.prompt,
      model: process.model
    };

    // If we have valid output from agent, include it
    if (agentOutput) {
      response.agentOutput = agentOutput;
      // Extract session_id if available (Claude only)
      if (process.toolType === 'claude' && agentOutput.session_id) {
        response.session_id = agentOutput.session_id;
      }
    } else {
      // Fallback to raw output
      response.stdout = process.stdout;
      response.stderr = process.stderr;
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response, null, 2)
      }]
    };
  }

  /**
   * Handle kill_process tool
   */
  private async handleKillProcess(toolArguments: any): Promise<ServerResult> {
    if (!toolArguments.pid || typeof toolArguments.pid !== 'number') {
      throw new McpError(ErrorCode.InvalidParams, 'Missing or invalid required parameter: pid');
    }

    const pid = toolArguments.pid;
    const processEntry = processManager.get(pid);

    if (!processEntry) {
      throw new McpError(ErrorCode.InvalidParams, `Process with PID ${pid} not found`);
    }

    if (processEntry.status !== 'running') {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            pid,
            status: processEntry.status,
            message: 'Process already terminated'
          }, null, 2)
        }]
      };
    }

    try {
      processEntry.process.kill('SIGTERM');
      processEntry.status = 'failed';
      processEntry.stderr += '\nProcess terminated by user';
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            pid,
            status: 'terminated',
            message: 'Process terminated successfully'
          }, null, 2)
        }]
      };
    } catch (error: any) {
      throw new McpError(ErrorCode.InternalError, `Failed to terminate process: ${error.message}`);
    }
  }

  /**
   * Start the MCP server
   */
  async run(): Promise<void> {
    // Revert to original server start logic if listen caused errors
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('AI CLI MCP server running on stdio');
  }

  /**
   * Clean up resources (for testing)
   */
  async cleanup(): Promise<void> {
    if (this.sigintHandler) {
      process.removeListener('SIGINT', this.sigintHandler);
    }
    await this.server.close();
  }
}

// Create and run the server if this is the main module
const server = new ClaudeCodeServer();
server.run().catch(console.error);