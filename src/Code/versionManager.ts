import type { VirtualFileSystem } from './vfsBundler';

export interface VersionSnapshot {
  versionId: string;
  timestamp: string;
  summary: string;
  vfs: VirtualFileSystem;
  fileCount: number;
}

/** Copies every entry so subsequent edits cannot mutate a saved snapshot. */
export function deepCopyVFS(vfs: VirtualFileSystem): VirtualFileSystem {
  return Object.fromEntries(Object.entries(vfs).map(([path, content]) => [path, content]));
}

/** Compares file names and contents without depending on insertion order. */
export function isSameVFS(left: VirtualFileSystem, right: VirtualFileSystem): boolean {
  const leftPaths = Object.keys(left).sort();
  const rightPaths = Object.keys(right).sort();
  return (
    leftPaths.length === rightPaths.length &&
    leftPaths.every((path, index) => path === rightPaths[index] && left[path] === right[path])
  );
}

/** Returns a monotonic version number, including after restoring an old snapshot. */
export function nextVersionNumber(snapshots: VersionSnapshot[]): number {
  const highest = snapshots.reduce((maximum, snapshot) => {
    const match = /^v(\d+)$/.exec(snapshot.versionId);
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0);
  return highest + 1;
}

export function getFormattedTime(date = new Date()): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function createSnapshot(
  versionNumber: number,
  summary: string,
  vfs: VirtualFileSystem,
): VersionSnapshot {
  if (!Number.isSafeInteger(versionNumber) || versionNumber < 1) {
    throw new RangeError('versionNumber 必须是大于 0 的整数');
  }

  const copiedVfs = deepCopyVFS(vfs);
  return {
    versionId: `v${versionNumber}`,
    timestamp: getFormattedTime(),
    summary: summary.trim() || '增量修改',
    vfs: copiedVfs,
    fileCount: Object.keys(copiedVfs).length,
  };
}
