# AI CLI MCP Server

[![npm package](https://img.shields.io/npm/v/ai-cli-mcp)](https://www.npmjs.com/package/ai-cli-mcp)

MCP server for running AI CLI tools (Claude, Codex, Gemini) with automatic permission handling.

## Installation

```json
{
  "ai-cli-mcp": {
    "command": "npx",
    "args": ["-y", "ai-cli-mcp@latest"]
  }
}
```

Or via Claude CLI:
```bash
claude mcp add ai-cli '{"command":"npx","args":["-y","ai-cli-mcp@latest"]}'
```

## First-Time Setup

### Claude CLI
```bash
npm install -g @anthropic-ai/claude-code
claude --dangerously-skip-permissions
```

### Codex CLI (optional)
```bash
codex login
```

### Gemini CLI (optional)
```bash
gemini auth login
```

## Tools

### `run`
Execute prompts with AI CLI tools.

| Argument | Required | Description |
|----------|----------|-------------|
| `prompt` | Yes* | The prompt to send |
| `prompt_file` | Yes* | Path to prompt file |
| `workFolder` | Yes | Working directory (absolute path) |
| `model` | No | Model to use (see below) |
| `session_id` | No | Resume previous session |
| `reasoning_effort` | No | Codex only: low/medium/high |

*Either `prompt` or `prompt_file` required.

**Models:**
- Claude: `sonnet`, `opus`, `haiku`
- Codex: `gpt-5.2-codex`, `gpt-5.1-codex-mini`, `gpt-5.1-codex-max`, `gpt-5.2`, `gpt-5.1`, `gpt-5`
- Gemini: `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-3-pro-preview`

### `list_processes`
List all running/completed AI agent processes.

### `get_result`
Get output of a process by PID.

### `kill_process`
Terminate a process by PID.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

MIT
