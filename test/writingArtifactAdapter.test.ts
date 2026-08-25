import assert from 'node:assert/strict';
import test from 'node:test';

import { createWritingArtifactInput } from '../src/features/omni/writingArtifactAdapter.ts';

test('写作适配器把聊天答案映射为可独立预览的不可变文档版本', () => {
  const input = createWritingArtifactInput({
    messageId: 'message-1',
    prompt: '写一份产品发布稿',
    content: '# 星河产品发布稿\n\n这是第一版正文。',
  });

  assert.equal(input.kind, 'document');
  assert.equal(input.title, '星河产品发布稿');
  assert.deepEqual(input.sourceRef, {
    type: 'writing_document',
    documentId: 'omni-writing-message-1',
    revision: 1,
  });
  assert.deepEqual(input.payload, { format: 'markdown', content: '# 星河产品发布稿\n\n这是第一版正文。' });
});

test('写作适配器移除过程性开场但保留 Markdown 文档结构', () => {
  const input = createWritingArtifactInput({
    messageId: 'message-2',
    prompt: '写一份研究报告',
    content: '我将为您撰写一篇研究报告。首先让我搜索一些资料，以确保内容准确。 # 研究报告\n\n**摘要**\n\n正文。',
  });

  assert.equal(input.title, '研究报告');
  assert.equal(input.payload && typeof input.payload === 'object' && 'content' in input.payload ? input.payload.content : '', '# 研究报告\n\n**摘要**\n\n正文。');
});
