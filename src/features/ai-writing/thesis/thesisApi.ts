import { ThesisBodyEvent, ThesisOutlineEvent, ThesisOutlineState, ThesisTargetWords } from './thesisTypes';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface StreamThesisOutlineInput {
  instruction: string;
  thesisType: string;
  educationLevel: string;
  targetWords: ThesisTargetWords | null;
  sessionId?: string;
  previousOutline?: object;
}

export async function streamThesisOutline(input: StreamThesisOutlineInput, onEvent: (event: ThesisOutlineEvent) => void, signal?: AbortSignal): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/writing/thesis/outline/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      instruction: input.instruction,
      thesis_type: input.thesisType,
      education_level: input.educationLevel,
      target_words: input.targetWords,
      session_id: input.sessionId,
      previous_outline: input.previousOutline,
    }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(detail?.detail || `论文大纲请求失败（${response.status}）`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('论文大纲响应为空');
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      const dataLine = block.split('\n').find((line) => line.startsWith('data:'));
      if (!dataLine) continue;
      try { onEvent(JSON.parse(dataLine.slice(5).trim()) as ThesisOutlineEvent); }
      catch { /* ignore malformed transport frames, semantic errors arrive explicitly */ }
    }
  }
}

export async function streamThesisReferences(input: { instruction: string; chapters: Array<{ id: string; title: string; summary: string }> }, onEvent: (event: ThesisOutlineEvent) => void, signal?: AbortSignal): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/writing/thesis/references/stream`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(detail?.detail || `参考资料搜索失败（${response.status}）`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('参考资料搜索响应为空');
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n'); buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      const dataLine = block.split('\n').find((line) => line.startsWith('data:'));
      if (!dataLine) continue;
      try { onEvent(JSON.parse(dataLine.slice(5).trim()) as ThesisOutlineEvent); } catch { /* malformed frame */ }
    }
  }
}

export async function streamThesisBody(input: { outline: ThesisOutlineState; completedChapterIds?: string[] }, onEvent: (event: ThesisBodyEvent) => void, signal?: AbortSignal): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/writing/thesis/body/stream`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({
      title: input.outline.title,
      completed_chapter_ids: input.completedChapterIds ?? [],
      chapters: input.outline.chapters.map((chapter) => ({
        id: chapter.id, title: chapter.title, summary: chapter.summary, target_words: chapter.targetWords,
        sections: chapter.sections.map((section) => ({ id: section.id, title: section.title, writing_brief: section.writingBrief, target_words: section.targetWords })),
        references: chapter.references.map((reference) => ({ id: reference.id, title: reference.title, url: reference.url, snippet: reference.snippet })),
      })),
    }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(detail?.detail || `论文正文生成失败（${response.status}）`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('论文正文响应为空');
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n'); buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      const dataLine = block.split('\n').find((line) => line.startsWith('data:'));
      if (!dataLine) continue;
      try { onEvent(JSON.parse(dataLine.slice(5).trim()) as ThesisBodyEvent); } catch { /* malformed frame */ }
    }
  }
}
