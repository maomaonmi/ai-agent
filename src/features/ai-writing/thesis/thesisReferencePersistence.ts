import type { ThesisOutlineState } from './thesisTypes';

/**
 * 只有已经持久化下来的来源才能证明章节检索完成。
 * 恢复时如果只有 searchStatus 而没有 references，必须允许重新检索。
 */
export function createRestoredReferenceSearchKeys(outline: ThesisOutlineState): Set<string> {
  return new Set(
    outline.chapters
      .filter((chapter) => chapter.references.length > 0)
      .map((chapter) => chapter.id),
  );
}
