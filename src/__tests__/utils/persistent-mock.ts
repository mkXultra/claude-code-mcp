import { ClaudeMock } from './claude-mock.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

let sharedMock: ClaudeMock | null = null;
const workerId = process.env.VITEST_WORKER_ID || process.env.VITEST_POOL_ID || process.pid.toString();
const mockName = `claudeMocked-${workerId}`;
const mockPath = join('/tmp', 'claude-code-test-mock', mockName);

export async function getSharedMock(): Promise<ClaudeMock> {
  if (!sharedMock) {
    sharedMock = new ClaudeMock(mockName);
  }
  
  // Always ensure mock exists
  if (!existsSync(mockPath)) {
    console.error(`[DEBUG] Mock not found at ${mockPath}, creating it...`);
    await sharedMock.setup();
  } else {
    console.error(`[DEBUG] Mock already exists at ${mockPath}`);
  }

  process.env.TEST_CLAUDE_CLI_NAME = mockPath;
  
  return sharedMock;
}

export async function cleanupSharedMock(): Promise<void> {
  if (sharedMock) {
    await sharedMock.cleanup();
    sharedMock = null;
  }
}
