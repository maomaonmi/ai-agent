export interface TransportClip {
  start: number;
  duration: number;
}

export interface TimelineMoveClip extends TransportClip {
  id: string;
  sourceOffset?: number;
  sourceDuration?: number;
}

export interface TimelineMoveTrack<T extends TimelineMoveClip = TimelineMoveClip> {
  id: string;
  clips: T[];
}

export function timelineDurationSeconds(
  clips: TransportClip[],
  bpm: number,
  timeSignature: string,
  bars = 16,
): number {
  const numerator = Number(timeSignature.split('/')[0]) || 4;
  const safeBpm = Math.max(1, bpm || 120);
  const secondsPerBar = (60 / safeBpm) * numerator;
  const clipEnd = clips.reduce((max, clip) => Math.max(max, (clip.start + clip.duration) * secondsPerBar), 0);
  return Math.max(secondsPerBar * bars, clipEnd, 1);
}

export function formatTransportTime(seconds: number): string {
  const safeSeconds = Math.max(0, seconds || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(1).padStart(4, '0')}`;
}

/**
 * Creates a deterministic, audio-like amplitude envelope for clips that do not
 * expose decoded waveform samples in the browser. The three slow oscillators
 * provide the broad dynamics while the seeded jitter preserves the fine,
 * irregular edge that a real waveform has. Keeping the seed stable prevents
 * the waveform from jumping on every render.
 */
export function buildWaveformValues(seed: number, length = 2200): number[] {
  const values: number[] = [];
  let state = Math.abs(Math.trunc(seed)) >>> 0;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
  const f1 = 0.013 + random() * 0.02;
  const f2 = 0.041 + random() * 0.05;
  const f3 = 0.11 + random() * 0.06;
  const phase1 = random() * Math.PI * 2;
  const phase2 = random() * Math.PI * 2;
  const phase3 = random() * Math.PI * 2;

  for (let index = 0; index < Math.max(1, length); index += 1) {
    const envelope =
      0.55 +
      0.35 * Math.sin(f1 * index + phase1) +
      0.2 * Math.sin(f2 * index + phase2) +
      0.12 * Math.sin(f3 * index + phase3);
    const jitter = (random() - 0.5) * 0.45;
    values.push(Math.max(0.05, Math.min(0.98, Math.abs(envelope + jitter))));
  }
  return values;
}

export type ClipResizeEdge = 'start' | 'end';

export interface ClipResizeInput {
  edge: ClipResizeEdge;
  startBars: number;
  durationBars: number;
  deltaBars: number;
  maxDurationBars?: number;
  minDurationBars?: number;
  /** Current source-window start in seconds. When supplied, resizing trims the source window. */
  sourceOffsetSeconds?: number;
  /** Complete source asset duration in seconds. */
  sourceDurationSeconds?: number;
  /** Timeline conversion used to translate a bar drag into source seconds. */
  secondsPerBar?: number;
}

export interface ClipResizeResult {
  startBars: number;
  durationBars: number;
  sourceOffsetSeconds?: number;
}

/** Resize a clip edge while keeping the timeline coordinates valid. */
export function resizeClip({
  edge,
  startBars,
  durationBars,
  deltaBars,
  maxDurationBars,
  minDurationBars = 0.05,
  sourceOffsetSeconds,
  sourceDurationSeconds,
  secondsPerBar,
}: ClipResizeInput): ClipResizeResult {
  const safeStart = Math.max(0, startBars || 0);
  const safeDuration = Math.max(minDurationBars, durationBars || 0);
  const endBars = safeStart + safeDuration;
  const minimum = Math.max(0.01, minDurationBars);
  const hasSourceWindow = Number.isFinite(sourceOffsetSeconds)
    && Number.isFinite(sourceDurationSeconds)
    && Number.isFinite(secondsPerBar)
    && (secondsPerBar ?? 0) > 0;
  const sourceOffset = Math.max(0, sourceOffsetSeconds ?? 0);
  const sourceDuration = Math.max(sourceOffset, sourceDurationSeconds ?? sourceOffset);
  const timelineSecondsPerBar = Math.max(0.0001, secondsPerBar ?? 1);

  if (edge === 'start') {
    const requestedDelta = deltaBars || 0;
    const sourceLimitedDelta = hasSourceWindow
      ? Math.max(-sourceOffset / timelineSecondsPerBar, requestedDelta)
      : requestedDelta;
    const nextStart = Math.max(0, Math.min(endBars - minimum, safeStart + sourceLimitedDelta));
    const result: ClipResizeResult = { startBars: nextStart, durationBars: endBars - nextStart };
    if (hasSourceWindow) {
      result.sourceOffsetSeconds = Math.max(0, sourceOffset + (nextStart - safeStart) * timelineSecondsPerBar);
    }
    return result;
  }

  const requested = safeDuration + (deltaBars || 0);
  const sourceMaxDurationBars = hasSourceWindow
    ? Math.max(minimum, (sourceDuration - sourceOffset) / timelineSecondsPerBar)
    : undefined;
  const upperBound = sourceMaxDurationBars !== undefined
    ? sourceMaxDurationBars
    : Number.isFinite(maxDurationBars) && (maxDurationBars ?? 0) > 0
    ? Math.max(minimum, maxDurationBars as number)
    : Number.POSITIVE_INFINITY;
  const result: ClipResizeResult = {
    startBars: safeStart,
    durationBars: Math.max(minimum, Math.min(upperBound, requested)),
  };
  if (hasSourceWindow) result.sourceOffsetSeconds = sourceOffset;
  return result;
}

function sliceTimelineClip<T extends TimelineMoveClip>(
  clip: T,
  startBars: number,
  endBars: number,
  id: string,
  secondsPerBar: number,
): T | null {
  const durationBars = endBars - startBars;
  if (durationBars <= 0) return null;
  const sourceOffset = Math.max(0, (clip.sourceOffset ?? 0) + (startBars - clip.start) * secondsPerBar);
  const sourceDuration = clip.sourceDuration;
  const safeSourceOffset = sourceDuration === undefined ? sourceOffset : Math.min(sourceOffset, sourceDuration);
  return {
    ...clip,
    id,
    start: startBars,
    duration: durationBars,
    sourceOffset: safeSourceOffset,
  };
}

/** Split a clip at a timeline position while preserving each piece's source range. */
export function splitClipAtPosition<T extends TimelineMoveClip>(
  clip: T,
  splitBars: number,
  secondsPerBar: number,
  leftId: string,
  rightId: string,
): T[] {
  const startBars = Math.max(0, clip.start || 0);
  const endBars = startBars + Math.max(0, clip.duration || 0);
  const positionBars = Math.max(startBars, Math.min(endBars, splitBars || 0));
  if (positionBars <= startBars || positionBars >= endBars) return [clip];

  const left = sliceTimelineClip(clip, startBars, positionBars, leftId, secondsPerBar);
  const right = sliceTimelineClip(clip, positionBars, endBars, rightId, secondsPerBar);
  return [left, right].filter((piece): piece is T => piece !== null);
}

/**
 * Moves a complete clip to another timeline position. Existing clips at the
 * destination are split around the insertion range instead of being covered.
 */
export function moveClipWithInsertion<TClip extends TimelineMoveClip, TTrack extends TimelineMoveTrack<TClip>>(
  tracks: TTrack[],
  sourceTrackId: string,
  clipId: string,
  targetTrackId: string,
  targetStartBars: number,
  secondsPerBar: number,
): TTrack[] | null {
  const sourceTrack = tracks.find((track) => track.id === sourceTrackId);
  const movingClip = sourceTrack?.clips.find((clip) => clip.id === clipId);
  const targetTrack = tracks.find((track) => track.id === targetTrackId);
  if (!sourceTrack || !movingClip || !targetTrack) return null;

  const startBars = Math.max(0, targetStartBars || 0);
  const endBars = startBars + Math.max(0.01, movingClip.duration);
  const targetClips = targetTrack.clips.filter((clip) => clip.id !== clipId);
  const nextTargetClips: TClip[] = [];

  targetClips.forEach((clip) => {
    const clipStart = Math.max(0, clip.start);
    const clipEnd = clipStart + Math.max(0, clip.duration);
    if (clipEnd <= startBars || clipStart >= endBars) {
      nextTargetClips.push(clip);
      return;
    }

    const hasLeft = clipStart < startBars;
    const hasRight = clipEnd > endBars;
    if (hasLeft) {
      const left = sliceTimelineClip(clip, clipStart, Math.min(clipEnd, startBars), hasRight ? `${clip.id}:left` : clip.id, secondsPerBar);
      if (left) nextTargetClips.push(left);
    }
    if (hasRight) {
      const right = sliceTimelineClip(clip, Math.max(clipStart, endBars), clipEnd, hasLeft ? `${clip.id}:right` : clip.id, secondsPerBar);
      if (right) nextTargetClips.push(right);
    }
  });

  const moved = { ...movingClip, start: startBars };
  nextTargetClips.push(moved);
  const sortClips = (clips: TClip[]) => clips.sort((left, right) => left.start - right.start || left.id.localeCompare(right.id));

  return tracks.map((track): TTrack => {
    if (track.id === sourceTrackId && track.id === targetTrackId) {
      return { ...track, clips: sortClips(nextTargetClips) } as TTrack;
    }
    if (track.id === sourceTrackId) {
      return { ...track, clips: track.clips.filter((clip) => clip.id !== clipId) } as TTrack;
    }
    if (track.id === targetTrackId) {
      return { ...track, clips: sortClips(nextTargetClips) } as TTrack;
    }
    return track;
  });
}

export function buildWaveformPath(values: number[], width = 100, height = 100): string {
  if (!values.length) return `M 0 ${height / 2} H ${width}`;
  const center = height / 2;
  const amplitude = height * 0.42;
  const top = values.map((value, index) => {
    const x = values.length === 1 ? 0 : (index / (values.length - 1)) * width;
    const y = center - Math.max(0, Math.min(1, value)) * amplitude;
    return `${x.toFixed(2)} ${y.toFixed(2)}`;
  });
  const bottom = values.map((value, index) => {
    const reversedIndex = values.length - 1 - index;
    const x = values.length === 1 ? 0 : (reversedIndex / (values.length - 1)) * width;
    const y = center + Math.max(0, Math.min(1, value)) * amplitude;
    return `${x.toFixed(2)} ${y.toFixed(2)}`;
  });
  return `M ${top[0]} L ${top.slice(1).join(' L ')} L ${bottom.join(' L ')} Z`;
}
