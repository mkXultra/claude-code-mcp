# AI CLI MCP Server

[![npm package](https://img.shields.io/npm/v/ai-cli-mcp)](https://www.npmjs.com/package/ai-cli-mcp)
[![View changelog](https://img.shields.io/badge/Explore%20Changelog-brightgreen)](/CHANGELOG.md)

> **📦 Package Migration Notice**: This package was formerly `@mkxultra/claude-code-mcp` and has been renamed to `ai-cli-mcp` to reflect its expanded support for multiple AI CLI tools.

An MCP (Model Context Protocol) server that allows running AI CLI tools (Claude, Codex, and Gemini) in background processes with automatic permission handling.

Did you notice that Cursor sometimes struggles with complex, multi-step edits or operations? This server, with its powerful unified `run` tool, enables multiple AI agents to handle your coding tasks more effectively.

<img src="assets/screenshot.png" width="300" alt="Screenshot">

## Overview

This MCP server provides tools that can be used by LLMs to interact with AI CLI tools. When integrated with MCP clients, it allows LLMs to:

- Run Claude CLI with all permissions bypassed (using `--dangerously-skip-permissions`)
- Execute Codex CLI with automatic approval mode (using `--full-auto`)
- Execute Gemini CLI with automatic approval mode (using `-y`)
- Support multiple AI models: Claude (sonnet, opus, haiku), Codex (gpt-5-low, gpt-5-medium, gpt-5-high), and Gemini (gemini-2.5-pro, gemini-2.5-flash)
- Manage background processes with PID tracking
- Parse and return structured outputs from both tools

## Benefits

- Claude/Windsurf often have trouble editing files. Claude Code is better and faster at it.
- Multiple commands can be queued instead of direct execution. This saves context space so more important stuff is retained longer, fewer compacts happen.
- File ops, git, or other operations don't need costy models. Claude Code is pretty cost effective if you sign up for Antropic Max. You can use Gemini or o3 in Max mode and save costs with offloading tasks to cheaper models.
- Claude has wider system access and can do things that Cursor/Windsurf can't do (or believe they can't), so whenever they are stuck just ask them "use claude code" and it will usually un-stuck them.
- Agents in Agents rules.

## Prerequisites

- Node.js v20 or later (Use fnm or nvm to install)
- Claude CLI installed locally (run it and call /doctor) and `--dangerously-skip-permissions` accepted
- Codex CLI installed (optional, for Codex support)
- Gemini CLI installed (optional, for Gemini support)

## Configuration

### Environment Variables

- `CLAUDE_CLI_NAME`: Override the Claude CLI binary name or provide an absolute path (default: `claude`)
- `CODEX_CLI_NAME`: Override the Codex CLI binary name or provide an absolute path (default: `codex`)
- `GEMINI_CLI_NAME`: Override the Gemini CLI binary name or provide an absolute path (default: `gemini`)
- `MCP_CLAUDE_DEBUG`: Enable debug logging (set to `true` for verbose output)

All CLI name variables support:
- Simple name: `CLAUDE_CLI_NAME=claude-custom` or `CODEX_CLI_NAME=codex-v2`
- Absolute path: `CLAUDE_CLI_NAME=/path/to/custom/claude`

Note: Relative paths are not allowed and will throw an error.

## Installation & Usage

The recommended way to use this server is by installing it by using `npx`.

### Using npx in your MCP configuration:

```json
    "ai-cli-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "ai-cli-mcp@latest"
      ]
    },
```

### Using Claude CLI mcp add command:

```bash
claude mcp add ai-cli '{"name":"ai-cli","command":"npx","args":["-y","ai-cli-mcp@latest"]}'
```

### With custom CLI binaries:

```json
    "ai-cli-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "ai-cli-mcp@latest"
      ],
      "env": {
        "CLAUDE_CLI_NAME": "claude-custom",
        "CODEX_CLI_NAME": "codex-custom"
      }
    },
```

## Important First-Time Setup

### For Claude CLI:

**Before the MCP server can use Claude, you must first run the Claude CLI manually once with the `--dangerously-skip-permissions` flag, login and accept the terms.**

```bash
npm install -g @anthropic-ai/claude-code
claude --dangerously-skip-permissions
```

Follow the prompts to accept. Once this is done, the MCP server will be able to use the flag non-interactively.

### For Codex CLI:

**For Codex, ensure you're logged in and have accepted any necessary terms:**

```bash
codex login
```

### For Gemini CLI:

**For Gemini, ensure you're logged in and have configured your credentials:**

```bash
gemini auth login
```

macOS might ask for folder permissions the first time any of these tools run. If the first run fails, subsequent runs should work.

## Connecting to Your MCP Client

After setting up the server, you need to configure your MCP client (like Cursor or others that use `mcp.json` or `mcp_config.json`).

### MCP Configuration File

The configuration is typically done in a JSON file. The name and location can vary depending on your client.

#### Cursor

Cursor uses `mcp.json`.
- **macOS:** `~/.cursor/mcp.json`
- **Windows:** `%APPDATA%\\Cursor\\mcp.json`
- **Linux:** `~/.config/cursor/mcp.json`

#### Windsurf

Windsurf users use `mcp_config.json`
- **macOS:** `~/.codeium/windsurf/mcp_config.json`
- **Windows:** `%APPDATA%\\Codeium\\windsurf\\mcp_config.json`
- **Linux:** `~/.config/.codeium/windsurf/mcp_config.json`

(Note: In some mixed setups, if Cursor is also installed, these clients might fall back to using Cursor's `~/.cursor/mcp.json` path. Prioritize the Codeium-specific paths if using the Codeium extension.)

Create this file if it doesn't exist. Add or update the configuration for `ai-cli-mcp`:

## Tools Provided

This server exposes the following tools:

### `run`

Executes a prompt using either Claude CLI or Codex CLI. The appropriate CLI is automatically selected based on the model name.

**Arguments:**
- `prompt` (string, optional): The prompt to send to the AI agent. Either `prompt` or `prompt_file` is required.
- `prompt_file` (string, optional): Path to a file containing the prompt. Either `prompt` or `prompt_file` is required. Can be absolute path or relative to `workFolder`.
- `workFolder` (string, required): The working directory for the CLI execution. Must be an absolute path.
- `model` (string, optional): The model to use:
  - Claude models: "sonnet", "opus", "haiku"
  - Codex models: "gpt-5-low", "gpt-5-medium", "gpt-5-high"
  - Gemini models: "gemini-2.5-pro", "gemini-2.5-flash"
- `session_id` (string, optional): Optional session ID to resume a previous session. Supported for: haiku, sonnet, opus.

### `list_processes`

Lists all running and completed AI agent processes with their status, PID, and basic info.

### `get_result`

Gets the current output and status of an AI agent process by PID.

**Arguments:**
- `pid` (number, required): The process ID returned by the `run` tool.

### `kill_process`

Terminates a running AI agent process by PID.

**Arguments:**
- `pid` (number, required): The process ID to terminate.

**Example with Claude:**
```json
{
  "toolName": "run",
  "arguments": {
    "prompt": "Refactor the function foo in main.py to be async.",
    "workFolder": "/Users/username/my_project",
    "model": "sonnet"
  }
}
```

**Example with Codex:**
```json
{
  "toolName": "run",
  "arguments": {
    "prompt": "Create a REST API with Express.js",
    "workFolder": "/Users/username/my_project",
    "model": "gpt-5-high"
  }
}
```

**Example with Gemini:**
```json
{
  "toolName": "run",
  "arguments": {
    "prompt": "Generate unit tests for the Calculator class",
    "workFolder": "/Users/username/my_project",
    "model": "gemini-2.5-pro"
  }
}
```

### Examples

Here are some visual examples of the server in action:

<img src="assets/claude_tool_git_example.png" alt="Claude Tool Git Example" width="50%">

<img src="assets/additional_claude_screenshot.png" alt="Additional Claude Screenshot" width="50%">

<img src="assets/cursor-screenshot.png" alt="Cursor Screenshot" width="50%">

### Fixing ESLint Setup

Here's an example of using the Claude Code MCP tool to interactively fix an ESLint setup by deleting old configuration files and creating a new one:

<img src="assets/eslint_example.png" alt="ESLint file operations example" width="50%">

### Listing Files Example

Here's an example of the Claude Code tool listing files in a directory:

<img src="assets/file_list_example.png" alt="File listing example" width="50%">

## Key Use Cases

This server, through its unified `run` tool, unlocks a wide range of powerful capabilities by giving your AI direct access to both Claude and Codex CLI tools. Here are some examples of what you can achieve:

1.  **Code Generation, Analysis & Refactoring:**
    -   `"Generate a Python script to parse CSV data and output JSON."`
    -   `"Analyze my_script.py for potential bugs and suggest improvements."`

2.  **File System Operations (Create, Read, Edit, Manage):**
    -   **Creating Files:** `"Your work folder is /Users/steipete/my_project\n\nCreate a new file named 'config.yml' in the 'app/settings' directory with the following content:\nport: 8080\ndatabase: main_db"`
    -   **Editing Files:** `"Your work folder is /Users/steipete/my_project\n\nEdit file 'public/css/style.css': Add a new CSS rule at the end to make all 'h2' elements have a 'color: navy'."`
    -   **Moving/Copying/Deleting:** `"Your work folder is /Users/steipete/my_project\n\nMove the file 'report.docx' from the 'drafts' folder to the 'final_reports' folder and rename it to 'Q1_Report_Final.docx'."`

3.  **Version Control (Git):**
    -   `"Your work folder is /Users/steipete/my_project\n\n1. Stage the file 'src/main.java'.\n2. Commit the changes with the message 'feat: Implement user authentication'.\n3. Push the commit to the 'develop' branch on origin."`

4.  **Running Terminal Commands:**
    -   `"Your work folder is /Users/steipete/my_project/frontend\n\nRun the command 'npm run build'."`
    -   `"Open the URL https://developer.mozilla.org in my default web browser."`

5.  **Web Search & Summarization:**
    -   `"Search the web for 'benefits of server-side rendering' and provide a concise summary."`

6.  **Complex Multi-Step Workflows:**
    -   Automate version bumps, update changelogs, and tag releases: `"Your work folder is /Users/steipete/my_project\n\nFollow these steps: 1. Update the version in package.json to 2.5.0. 2. Add a new section to CHANGELOG.md for version 2.5.0 with the heading '### Added' and list 'New feature X'. 3. Stage package.json and CHANGELOG.md. 4. Commit with message 'release: version 2.5.0'. 5. Push the commit. 6. Create and push a git tag v2.5.0."`

    <img src="assets/multistep_example.png" alt="Complex multi-step operation example" width="50%">

7.  **Repairing Files with Syntax Errors:**
    -   `"Your work folder is /path/to/project\n\nThe file 'src/utils/parser.js' has syntax errors after a recent complex edit that broke its structure. Please analyze it, identify the syntax errors, and correct the file to make it valid JavaScript again, ensuring the original logic is preserved as much as possible."`

8.  **Interacting with GitHub (e.g., Creating a Pull Request):**
    -   `"Your work folder is /Users/steipete/my_project\n\nCreate a GitHub Pull Request in the repository 'owner/repo' from the 'feature-branch' to the 'main' branch. Title: 'feat: Implement new login flow'. Body: 'This PR adds a new and improved login experience for users.'"`

9.  **Interacting with GitHub (e.g., Checking PR CI Status):**
    -   `"Your work folder is /Users/steipete/my_project\n\nCheck the status of CI checks for Pull Request #42 in the GitHub repository 'owner/repo'. Report if they have passed, failed, or are still running."`

### Correcting GitHub Actions Workflow

<img src="assets/github_actions_fix_example.png" alt="GitHub Actions workflow fix example" width="50%">

### Complex Multi-Step Operations

This example illustrates the AI agent handling a more complex, multi-step task, such as preparing a release by creating a branch, updating multiple files (`package.json`, `CHANGELOG.md`), committing changes, and initiating a pull request, all within a single, coherent operation.

<img src="assets/claude_code_multistep_example.png" alt="AI agent multi-step example" width="50%">

**CRITICAL: Remember to provide Current Working Directory (CWD) context in your prompts for file system or git operations (e.g., `"Your work folder is /path/to/project\n\n...your command..."`).**

## Troubleshooting

- **"Command not found" (claude-code-mcp):** If installed globally, ensure the npm global bin directory is in your system's PATH. If using `npx`, ensure `npx` itself is working.
- **"Command not found" (claude or ~/.claude/local/claude):** Ensure the Claude CLI is installed correctly. Run `claude/doctor` or check its documentation.
- **Permissions Issues:** Make sure you've run the "Important First-Time Setup" step.
- **JSON Errors from Server:** If `MCP_CLAUDE_DEBUG` is `true`, error messages or logs might interfere with MCP's JSON parsing. Set to `false` for normal operation.
- **ESM/Import Errors:** Ensure you are using Node.js v20 or later.

**For Developers: Local Setup & Contribution**

If you want to develop or contribute to this server, or run it from a cloned repository for testing, please see our [Local Installation & Development Setup Guide](./docs/local_install.md).

## Testing

The project includes comprehensive test suites:

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run e2e tests (with mocks)
npm run test:e2e

# Run e2e tests locally (requires Claude CLI)
npm run test:e2e:local

# Watch mode for development
npm run test:watch

# Coverage report
npm run test:coverage
```

For detailed testing documentation, see our [E2E Testing Guide](./docs/e2e-testing.md).

## Manual Testing with MCP Inspector

You can manually test the MCP server using the Model Context Protocol Inspector:

```bash
# Build the project first
npm run build

# Start the MCP Inspector with the server
npx @modelcontextprotocol/inspector node dist/server.js
```

This will open a web interface where you can:
1. View all available tools (`run`, `list_processes`, `get_result`, `kill_process`)
2. Test each tool with different parameters
3. Test different AI models including:
   - Claude models: `sonnet`, `opus`, `haiku`
   - Codex models: `gpt-5-low`, `gpt-5-medium`, `gpt-5-high`
   - Gemini models: `gemini-2.5-pro`, `gemini-2.5-flash`

Example test: Select the `run` tool and provide:
- `prompt`: "What is 2+2?"
- `workFolder`: "/tmp"
- `model`: "gemini-2.5-flash"

## Configuration via Environment Variables

The server's behavior can be customized using these environment variables:

- `CLAUDE_CLI_PATH`: Absolute path to the Claude CLI executable.
  - Default: Checks `~/.claude/local/claude`, then falls back to `claude` (expecting it in PATH).
- `MCP_CLAUDE_DEBUG`: Set to `true` for verbose debug logging from this MCP server. Default: `false`.

These can be set in your shell environment or within the `env` block of your `mcp.json` server configuration (though the `env` block in `mcp.json` examples was removed for simplicity, it's still a valid way to set them for the server process if needed).

## Contributing

Contributions are welcome! Please refer to the [Local Installation & Development Setup Guide](./docs/local_install.md) for details on setting up your environment.

Submit issues and pull requests to the [GitHub repository](https://github.com/mkXultra/claude-code-mcp).

## License

MIT