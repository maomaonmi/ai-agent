import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  buildCodeIntentContext,
  buildCodeReadOnlyPrompt,
  isCodeAgentRunUnfinished,
  toCodeIntentResumeCandidate,
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
const apiSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/lib/api.ts'),
  'utf8',
);

test('只读 Code 回答使用有边界的项目上下文，不把旧 Agent run 当作当前事实', () => {
  const prompt = buildCodeReadOnlyPrompt('请总结当前项目状态', {
    projectKind: 'fullstack',
    files: ['frontend/index.html', 'backend/server.py', 'PLAN.md', 'todo.md'],
    recentTurns: [
      { role: 'user', content: '我想让他变为 3D 版的' },
      { role: 'assistant', content: '这是一条最近的只读回答' },
    ],
  });

  assert.match(prompt, /请总结当前项目状态/);
  assert.match(prompt, /backend\/server\.py/);
  assert.match(prompt, /我想让他变为 3D 版的/);
  assert.doesNotMatch(prompt, /最近的只读回答/);
  assert.match(prompt, /历史 Agent run 不作为当前问题证据/);
  assert.doesNotMatch(prompt, /上上轮旧任务|最近一轮的 AgentLoop 任务/);
  assert.ok(prompt.length <= 6_000);
  assert.doesNotMatch(prompt, /修改文件|执行命令|调用工具/);
});

test('新问题的路由上下文只保留用户对话，并排除未绑定到当前会话的旧 run', () => {
  const context = buildCodeIntentContext(
    [
      { id: 'user-1', role: 'user', content: '修复页面启动问题' },
      { id: 'assistant-1', role: 'assistant', content: '之前那个开始后立刻结束的错误已经定位。' },
      { id: 'user-2', role: 'user', content: '现在增加更多条蛇作为敌人' },
    ],
    [{
      id: 'old-run',
      request: '修复一个不知道从哪来的控制台错误',
      projectKind: 'frontend',
      createdAt: '2026-09-11T00:00:00.000Z',
      trace: {
        steps: [], output: '', phase: 'diagnosing', isRunning: false,
        resumeEligible: true,
        runtimeEvidence: {
          status: 'runtime_verification_failed', run_id: 'old-run', base_revision: 'a', candidate_revision: 'b',
          changed_files: [], diff_summary: '', new_errors: ['old error'], same_error_persisted: true,
          boot_completed: false, console_errors: ['old error'], diagnostic: 'old error',
        },
      },
    }],
  );

  assert.deepEqual(context.recentTurns.map((turn) => turn.role), ['user', 'user']);
  assert.equal(context.resumeCandidates.length, 0);
});

test('上一条助手回答作为参考保留，但不混入用户事实或运行时证据', () => {
  const context = buildCodeIntentContext(
    [
      { role: 'user', content: '先检查页面启动问题' },
      { role: 'assistant', content: '我判断可能是入口初始化顺序问题，但还没有完成浏览器验收。' },
      { role: 'user', content: '按你刚才的判断继续处理' },
    ],
    [],
  );

  assert.deepEqual(context.recentTurns.map((turn) => turn.role), ['user', 'user']);
  assert.equal(context.assistantReferences.length, 1);
  assert.match(context.assistantReferences[0].content, /入口初始化顺序/);

  const prompt = buildCodeReadOnlyPrompt('按你刚才的判断继续处理', {
    projectKind: 'frontend',
    files: ['index.html'],
    recentTurns: context.recentTurns,
    assistantReferences: context.assistantReferences,
  });
  assert.match(prompt, /助手历史回答（仅供参考，不是事实）/);
  assert.match(prompt, /入口初始化顺序/);
});

test('恢复候选只携带可供语义选择的摘要，不携带旧运行时错误证据', () => {
  const candidate = toCodeIntentResumeCandidate({
    id: 'run-1',
    request: '继续修复页面',
    projectKind: 'frontend',
    createdAt: '2026-09-11T00:00:00.000Z',
    trace: {
      steps: [], output: '', phase: 'awaiting_runtime_verification', isRunning: false,
      resumeEligible: true,
      status: 'awaiting_runtime_verification',
      runtimeEvidence: {
        status: 'runtime_verification_failed', run_id: 'run-1', base_revision: 'a', candidate_revision: 'b',
        changed_files: [], diff_summary: '', new_errors: ['must not leak'], same_error_persisted: true,
        boot_completed: false, console_errors: ['must not leak'], diagnostic: 'must not leak',
      },
    },
  });

  assert.equal(candidate.run_id, 'run-1');
  assert.equal(candidate.runtime_verification, true);
  assert.equal('last_verification' in candidate, false);
  assert.equal('runtime_read_evidence' in candidate, false);
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

test('重写提交把入口上下文交给服务端语义路由器，而不是强制修改', () => {
  assert.match(
    chatInterfaceSource,
    /entrypoint:\s*isBranchRewrite\s*\?\s*'rewrite'\s*:\s*undefined/,
  );
  assert.match(apiSource, /entrypoint:\s*input\.entrypoint/);
  assert.doesNotMatch(chatInterfaceSource, /buildExplicitCodeRewriteDecision/);
});

test('Code 工作台在调用写入 AgentLoop 之前必须先经过意图路由', () => {
  assert.match(chatInterfaceSource, /classifyCodeWorkbenchIntent\(userMessage/);
  assert.match(chatInterfaceSource, /decision\.intent === 'conversation'/);
  assert.match(chatInterfaceSource, /decision\.intent === 'resume'/);
  assert.match(chatInterfaceSource, /mcpMode:\s*'off'/);
  assert.match(workspaceSource, /conversationAnswer/);
  assert.match(chatInterfaceSource, /conversationAnswers=\{codeConversationAnswers\}/);
  assert.match(workspaceSource, /conversationAnswers\.filter/);
});

test('只读回答使用聊天消息真相持久化，不能被旧 render 快照覆盖', () => {
  assert.match(chatInterfaceSource, /const snapshotMessages = messagesRef\.current;/);
  assert.match(chatInterfaceSource, /saveSessionSnapshot\(\s*input\.requestSessionId,[\s\S]*messages: messagesRef\.current/);
});

test('新 Code 请求继承任务范围但不携带上一 run 的运行时错误证据', () => {
  assert.match(chatInterfaceSource, /resumeCandidates: codeIntentContext\.resumeCandidates\.map\(toCodeIntentResumeCandidate\)/);
  assert.match(chatInterfaceSource, /selectedResumeRun = decision\.intent === 'resume'/);
  assert.match(chatInterfaceSource, /activeRun: undefined/);
  assert.doesNotMatch(chatInterfaceSource, /const latestCodeRun = \[\.\.\.agentRunsForTurn\]\.reverse\(\)\[0\]/);
  assert.match(
    chatInterfaceSource,
    /runtimeEvidence:\s*decision\.intent\s*===\s*'resume'\s*\?\s*routerActiveRun\?\.last_verification\s*:\s*undefined/,
  );
  assert.match(
    chatInterfaceSource,
    /last_verification:\s*selectedResumeRun\.trace\.resumeEligible\s*\?\s*selectedResumeRun\.trace\.runtimeEvidence\s*:\s*undefined/,
  );
  assert.match(chatInterfaceSource, /assistantReferences: codeIntentContext\.assistantReferences/);
  assert.match(autoRepairSource, /assistant_references: options\.assistantReferences/);
});

test('普通新修改不把 hook 内上一轮的错误历史当成当前诊断', () => {
  assert.match(
    autoRepairSource,
    /const pendingDiagnostics = \[\s*\.\.\.\(isResume \? \[recentErrorsRef\.current\.join\('\\n'\)\] : \[\]\)/,
  );
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
