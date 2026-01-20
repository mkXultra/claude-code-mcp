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
    let threadId = null;
    
    for (const line of lines) {
      if (line.trim()) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'thread.started' && parsed.thread_id) {
            threadId = parsed.thread_id;
          } else if (parsed.item?.type === 'agent_message') {
            lastMessage = parsed.item.text;
          } else if (parsed.msg?.type === 'agent_message') {
            lastMessage = parsed.msg.message;
          } else if (parsed.item?.type === 'reasoning') {
            // Ignore reasoning-only items for message selection.
          } else if (parsed.msg?.type === 'token_count') {
            tokenCount = parsed.msg;
          }
        } catch (e) {
          // Skip invalid JSON lines
          debugLog(`[Debug] Skipping invalid JSON line: ${line}`);
        }
      }
    }
    
    if (lastMessage || tokenCount || threadId) {
      return {
        message: lastMessage,
        token_count: tokenCount,
        session_id: threadId
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

/**
 * Parse Gemini JSON output
 */
export function parseGeminiOutput(stdout: string): any {
  if (!stdout) return null;

  try {
    return JSON.parse(stdout);
  } catch (e) {
    debugLog(`[Debug] Failed to parse Gemini JSON output: ${e}`);
    return null;
  }
}
