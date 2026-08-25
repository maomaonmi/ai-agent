import assert from 'node:assert/strict';
import test from 'node:test';

import { buildProjectConversationTree } from '../src/features/projects/projectTree.ts';
import type { ProjectWithConversations } from '../src/features/projects/api.ts';
import type { SessionSummary } from '../src/lib/api.ts';

const sessions: SessionSummary[] = [
  { session_id: 'session-1', title: '市场研究', mode: 'research', created_at: 1, updated_at: 3 },
  { session_id: 'session-2', title: '宣传创意', mode: 'standard', created_at: 1, updated_at: 2 },
  { session_id: 'session-3', title: '普通聊天', mode: 'standard', created_at: 1, updated_at: 1 },
];

const projects = [
  {
    id: 'project-1',
    name: '新能源汽车发布',
    description: undefined,
    summary: undefined,
    createdAt: '2026-08-23T00:00:00Z',
    updatedAt: '2026-08-23T00:00:00Z',
    conversationIds: ['session-2', 'session-1', 'missing-session'],
  },
] as ProjectWithConversations[];

test('project tree contains only real sessions and keeps server conversation order', () => {
  const tree = buildProjectConversationTree(projects, sessions);

  assert.deepEqual(tree.groups[0].conversations.map((session) => session.session_id), [
    'session-2',
    'session-1',
  ]);
});

test('unassigned conversations remain in regular history', () => {
  const tree = buildProjectConversationTree(projects, sessions);

  assert.deepEqual(tree.unassigned.map((session) => session.session_id), ['session-3']);
  assert.equal(tree.projectByConversationId.get('session-1')?.name, '新能源汽车发布');
});
