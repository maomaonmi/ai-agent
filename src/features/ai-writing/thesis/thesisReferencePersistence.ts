import type { ThesisOutlineState } from './thesisTypes';

/**
 * 已恢复的大纲不是新检索任务。只要章节已有来源，或曾进入过检索流程，
 * 就交由会话快照恢复；只有全新的 idle 章节才允许自动检索。
 */
export function createRestoredReferenceSearchKeys(outline: ThesisOutlineState): Set<string> {
  return new Set(
    outline.chapters
      .filter((chapter) => chapter.references.length > 0 || chapter.searchStatus !== 'idle')
      .map((chapter) => chapter.id),
  );
}
