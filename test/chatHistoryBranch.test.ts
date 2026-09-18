import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const chatInterfaceSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/components/ChatInterface.tsx'),
  'utf8',
);
const apiSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/lib/api.ts'),
  'utf8',
);

test('rewrite/delete persists an explicit memory branch before the next request', () => {
  assert.match(apiSource, /replaceSessionChatMemory/);
  assert.match(chatInterfaceSource, /replaceSessionChatMemory\(requestSessionId, messagesForMemory\(nextMessagesWithUser\)\)/);
  assert.match(chatInterfaceSource, /await memoryBranchSyncRef\.current/);
  assert.match(chatInterfaceSource, /persistEditedConversation\(nextMessages, nextAgentRuns\)/);
});

test('code rewrites restore the selected prompt base instead of reusing the latest candidate', () => {
  assert.match(apiSource, /codeBaseVersionId\?: string/);
  assert.match(chatInterfaceSource, /ensureCodeBaseSnapshot\(/);
  assert.match(chatInterfaceSource, /resolveCodeRewriteBase\(/);
  assert.match(chatInterfaceSource, /restoreCode\(codeForTurn\)/);
  assert.match(chatInterfaceSource, /generatedCode: codeForTurn/);
  assert.match(chatInterfaceSource, /activeCodeVersionId: branchActiveCodeVersionId/);
});

test('streaming responses are anchored to their own assistant message', () => {
  assert.match(chatInterfaceSource, /findIndex\(\(message\) => message\.id === assistantMessageId\)/);
  assert.match(chatInterfaceSource, /key=\{msg\.id \?\? `\$\{msg\.role\}-\$\{index\}`\}/);
  assert.match(chatInterfaceSource, /if \(requestToken !== activeRequestTokenRef\.current\) return;/);
});
