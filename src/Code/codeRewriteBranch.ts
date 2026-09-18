import type { ChatMessage } from '../lib/api';
import type { VirtualFileSystem } from './vfsBundler';
import {
  createSnapshot,
  deepCopyVFS,
  isSameVFS,
  nextVersionNumber,
  type VersionSnapshot,
} from './versionManager.ts';

export type CodeRewriteBaseSource =
  | 'message'
  | 'legacy_empty'
  | 'legacy_prompt_order'
  | 'unavailable';

export interface CodeRewriteBase {
  snapshot: VersionSnapshot;
  source: CodeRewriteBaseSource;
  /** True only when the message explicitly points at this snapshot. */
  exact: boolean;
}

export interface EnsuredCodeBaseSnapshot {
  snapshots: VersionSnapshot[];
  versionId: string;
  created: boolean;
}

/**
 * Records the VFS that existed immediately before a code prompt is run.
 * The snapshot list is intentionally generic: it knows nothing about a
 * product domain or an acceptance goal.
 */
export function ensureCodeBaseSnapshot(
  snapshots: VersionSnapshot[],
  vfs: VirtualFileSystem,
  summary: string,
): EnsuredCodeBaseSnapshot {
  const existing = snapshots.find((snapshot) => isSameVFS(snapshot.vfs, vfs));
  if (existing) {
    return {
      snapshots,
      versionId: existing.versionId,
      created: false,
    };
  }

  const next = createSnapshot(nextVersionNumber(snapshots), summary, vfs);
  return {
    snapshots: [...snapshots, next],
    versionId: next.versionId,
    created: true,
  };
}

function promptIndexBefore(messages: ChatMessage[], targetMessageIndex: number): number {
  return messages
    .slice(0, targetMessageIndex)
    .filter((message) => message.role === 'user')
    .length;
}

function legacyPromptSnapshot(
  snapshots: VersionSnapshot[],
  promptIndex: number,
): CodeRewriteBase | null {
  // New snapshots carry an explicit message reference. This fallback only
  // helps sessions written before that field existed, and is deliberately
  // conservative: it accepts an unambiguous summary match only.
  if (promptIndex === 0) {
    const emptySnapshots = snapshots.filter((snapshot) => Object.keys(snapshot.vfs).length === 0);
    if (emptySnapshots.length === 1) {
      return {
        snapshot: emptySnapshots[0],
        source: 'legacy_empty',
        exact: false,
      };
    }
    return null;
  }

  const completedPromptNumber = promptIndex;
  const expectedPrefix = completedPromptNumber === 1
    ? '初始生成：'
    : `需求 ${completedPromptNumber + 1}：`;
  const matches = snapshots.filter((snapshot) => snapshot.summary.startsWith(expectedPrefix));
  if (matches.length !== 1) return null;
  return {
    snapshot: matches[0],
    source: 'legacy_prompt_order',
    exact: false,
  };
}

/**
 * Resolves the code that existed before a selected prompt. It never treats a
 * guessed snapshot as exact, which lets the UI warn instead of silently
 * presenting a destructive branch rewrite as deterministic.
 */
export function resolveCodeRewriteBase(options: {
  messages: ChatMessage[];
  targetMessageIndex: number;
  snapshots: VersionSnapshot[];
}): CodeRewriteBase | null {
  const target = options.messages[options.targetMessageIndex];
  if (!target || target.role !== 'user') return null;

  if (target.codeBaseVersionId) {
    const exact = options.snapshots.find((snapshot) => snapshot.versionId === target.codeBaseVersionId);
    if (exact) {
      return {
        snapshot: exact,
        source: 'message',
        exact: true,
      };
    }
  }

  return legacyPromptSnapshot(
    options.snapshots,
    promptIndexBefore(options.messages, options.targetMessageIndex),
  );
}

/** Copies the selected branch base before it is passed to the code runner. */
export function copyRewriteBase(base: CodeRewriteBase): VersionSnapshot {
  return {
    ...base.snapshot,
    vfs: deepCopyVFS(base.snapshot.vfs),
  };
}
