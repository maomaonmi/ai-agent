import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  buildCodeReadOnlyPrompt,
  isCodeAgentRunUnfinished,
} from '../src/lib/codeWorkbenchConversation.ts';
import { summarizeAgentLoopRound } from '../src/Code/agentEventRouting.ts';

const chatInterfaceSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/components/ChatInterface.tsx'),
  'utf8',
);
const workspaceSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/components/CodeWorkspace.tsx'),
  'utf8',
);
const autoRepairSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/hooks/useCodeAutoRepair.ts'),
  'utf8',
);

test('只读 Code 回答使用有边界的项目上下文，不把源码全文塞进普通聊天', () => {
  const prompt = buildCodeReadOnlyPrompt('请总结当前项目状态', {
    projectKind: 'fullstack',
    files: ['frontend/index.html', 'backend/server.py', 'PLAN.md', 'todo.md'],
    latestRun: {
      request: '继续完成刚才的任务',
      phase: 'blocked',
      summary: '全栈清单仍缺少后端入口',
      taskPlan: {
        completedCount: 1,
        totalCount: 3,
        status: 'needs_attention',
      },
    },
  });

  assert.match(prompt, /请总结当前项目状态/);
  assert.match(prompt, /backend\/server\.py/);
  assert.match(prompt, /1\/3/);
  assert.ok(prompt.length <= 6_000);
  assert.doesNotMatch(prompt, /修改文件|执行命令|调用工具/);
});

test('只有未完成或明确可恢复的 Agent run 才能进入 resume', () => {
  const resumable = {
    id: 'run-1',
    request: '实现页面',
    projectKind: 'frontend' as const,
    createdAt: new Date().toISOString(),
    trace: {
      steps: [], output: '', phase: 'blocked', isRunning: false,
      resumeEligible: true,
    },
  };
  const completed = {
    ...resumable,
    id: 'run-2',
    trace: { ...resumable.trace, phase: 'completed', resumeEligible: false },
  };

  assert.equal(isCodeAgentRunUnfinished(resumable), true);
  assert.equal(isCodeAgentRunUnfinished(completed), false);
});

test('Code 工作台在调用写入 AgentLoop 之前必须先经过意图路由', () => {
  assert.match(chatInterfaceSource, /classifyCodeWorkbenchIntent\(userMessage/);
  assert.match(chatInterfaceSource, /decision\.intent === 'conversation'/);
  assert.match(chatInterfaceSource, /decision\.intent === 'resume'/);
  assert.match(chatInterfaceSource, /mcpMode:\s*'off'/);
  assert.match(workspaceSource, /conversationAnswer/);
});

test('可恢复的非终态 VFS 检查点不得被当成增量接口缺少完整代码', () => {
  assert.match(
    autoRepairSource,
    /if \(modifiedCode && agentTraceRef\.current\.resumeEligible\) \{[\s\S]*?updateCode\(modifiedCode\);[\s\S]*?return false;[\s\S]*?throw new Error\('增量修改接口没有返回完整代码。'\)/,
  );
});

test('AgentLoop 时间线展示有效进展分数而不是只展示文件变化', () => {
  assert.match(
    summarizeAgentLoopRound({
      iteration: 2,
      tool_calls_count: 1,
      files_changed: [],
      state_hash_before: 'same',
      state_hash_after: 'same',
      progress_score: 2,
      progress_facts: ['test_state:pytest=passed'],
    }),
    /有效进展 2 分.*test_state:pytest=passed/,
  );
  assert.match(
    summarizeAgentLoopRound({
      iteration: 3,
      tool_calls_count: 1,
      files_changed: [],
      state_hash_before: 'same',
      state_hash_after: 'same',
      progress_score: 0,
      progress_facts: [],
    }),
    /有效进展 0 分/,
  );
});
