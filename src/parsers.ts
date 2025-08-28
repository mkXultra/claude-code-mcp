import { debugLog } from './server.js';

/**
 * Parse Codex NDJSON output to extract the last agent message and token count
 */
export function parseCodexOutput(stdout: string): any {
  if (!stdout) return null;
  
  try {
    const lines = stdout.trim().split('\n');
    let lastMessage = null;
    let tokenCount = null;
    
    for (const line of lines) {
      if (line.trim()) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.msg?.type === 'agent_message') {
            lastMessage = parsed.msg.message;
          } else if (parsed.msg?.type === 'token_count') {
            tokenCount = parsed.msg;
          }
        } catch (e) {
          // Skip invalid JSON lines
          debugLog(`[Debug] Skipping invalid JSON line: ${line}`);
        }
      }
    }
    
    if (lastMessage || tokenCount) {
      return {
        message: lastMessage,
        token_count: tokenCount
      };
    }
  } catch (e) {
    debugLog(`[Debug] Failed to parse Codex NDJSON output: ${e}`);
  }
  
  return null;
}

/**
 * Parse Claude JSON output
 */
export function parseClaudeOutput(stdout: string): any {
  if (!stdout) return null;
  
  try {
    return JSON.parse(stdout);
  } catch (e) {
    debugLog(`[Debug] Failed to parse Claude JSON output: ${e}`);
    return null;
  }
}