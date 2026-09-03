export interface EditorClipInput {
  id: string;
  name: string;
  start: number;
  duration: number;
  assetId?: string;
  /** Offset into the uploaded source after a split/trim operation. */
  sourceOffset?: number;
  sourceDuration?: number;
  muted?: boolean;
}

export interface EditorTrackInput {
  id: string;
  name: string;
  type: 'vocal' | 'instrument' | 'drum' | 'bass';
  muted: boolean;
  solo: boolean;
  volume: number;
  clips: EditorClipInput[];
}

export type EditorGenerationMode = 'vocal' | 'instrumental';

export function editorTrackHasAudio(track: Pick<EditorTrackInput, 'clips'>): boolean {
  return track.clips.some((clip) => Boolean(clip.assetId));
}

/** Pick the most appropriate source clip for a Suno editor operation. */
export function selectGenerationAssetId(
  tracks: EditorTrackInput[],
  mode: EditorGenerationMode,
  vocalTrackId = '',
  accompanimentTrackId = '',
): string | undefined {
  const selectedVocal = tracks.find((track) => track.id === vocalTrackId && track.type === 'vocal');
  const selectedAccompaniment = tracks.find((track) => track.id === accompanimentTrackId && track.type !== 'vocal');
  const firstAsset = (track?: EditorTrackInput) => (track && editorTrackHasAudio(track) ? track.clips.find((clip) => clip.assetId)?.assetId : undefined);
  const firstOfType = (type: EditorTrackInput['type']) => firstAsset(tracks.find((track) => track.type === type));

  const candidates = mode === 'vocal'
    ? [firstAsset(selectedAccompaniment), firstOfType('instrument'), firstOfType('drum'), firstOfType('bass'), firstAsset(selectedVocal)]
    : [firstAsset(selectedVocal), firstOfType('vocal'), firstAsset(selectedAccompaniment), firstOfType('instrument'), firstOfType('drum'), firstOfType('bass')];
  return candidates.find((assetId): assetId is string => Boolean(assetId));
}

export interface EditorProject {
  id: string;
  title: string;
  revision: number;
  document: ReturnType<typeof buildEditorDocument>;
}

export interface EditorOperation {
  id: string;
  status: string;
  progress: number;
  error: { code: string; message: string } | null;
  results: { id: string; title: string | null; duration: number | null; audioUrl: string | null }[];
}

const API_ROOT = '/api/music/editor';

function parseKey(selectedKey: string): { root: string; scale: 'major' | 'minor' | 'chromatic' } {
  const scale = selectedKey.includes('小调') ? 'minor' : selectedKey.includes('大调') ? 'major' : 'chromatic';
  const root = selectedKey.replace(/大调|小调/g, '') || 'C';
  return { root, scale };
}

export function buildEditorDocument(input: {
  bpm: number;
  timeSignature: string;
  selectedKey: string;
  volume: number;
  tracks: EditorTrackInput[];
}) {
  const [numerator, denominator] = input.timeSignature.split('/').map(Number);
  const secondsPerBar = (60 / input.bpm) * numerator;
  return {
    schemaVersion: 1 as const,
    tempo: { bpm: input.bpm, timeSignature: [numerator, denominator] as [number, number] },
    key: parseKey(input.selectedKey),
    master: { gainDb: input.volume > 0 ? 20 * Math.log10(input.volume) : -60, targetLufs: -14 },
    tracks: input.tracks.map((track, order) => ({
      id: track.id,
      name: track.name,
      kind: track.type,
      order,
      isMuted: track.muted,
      isSolo: track.solo,
      gainDb: track.volume > 0 ? 20 * Math.log10(track.volume) : -60,
      pan: 0,
      effects: [],
      clips: track.clips.filter((clip) => clip.assetId).map((clip) => ({
        id: clip.id,
        assetId: clip.assetId!,
        name: clip.name,
        startSeconds: clip.start * secondsPerBar,
        sourceInSeconds: Math.max(0, Math.min(clip.sourceDuration ?? clip.duration * secondsPerBar, clip.sourceOffset ?? 0)),
        // `sourceDuration` is the complete uploaded asset; `duration` is the
        // currently visible/resized portion on the timeline.
        sourceOutSeconds: Math.min(
          clip.sourceDuration ?? clip.duration * secondsPerBar,
          Math.max(0, clip.sourceOffset ?? 0) + clip.duration * secondsPerBar,
        ),
        isMuted: Boolean(clip.muted),
        gainDb: 0,
        fadeInSeconds: 0,
        fadeOutSeconds: 0,
        pitchSemitones: 0,
        playbackRate: 1,
      })),
    })),
    markers: [],
  };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || `请求失败 (${response.status})`);
  return payload as T;
}

export function createEditorProject(title: string, document: ReturnType<typeof buildEditorDocument>) {
  return request<EditorProject>(`${API_ROOT}/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, document }),
  });
}

export function getEditorProject(id: string) {
  return request<EditorProject>(`${API_ROOT}/projects/${encodeURIComponent(id)}`);
}

export function saveEditorProject(project: EditorProject, document: ReturnType<typeof buildEditorDocument>) {
  return request<EditorProject>(`${API_ROOT}/projects/${encodeURIComponent(project.id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document, expectedRevision: project.revision }),
  });
}

export function uploadEditorAsset(file: File) {
  const form = new FormData();
  form.append('file', file);
  return request<{ id: string; displayName: string; duration: number; streamUrl: string }>(`${API_ROOT}/assets/upload`, {
    method: 'POST', body: form,
  });
}

export function getEditorAsset(assetId: string) {
  return request<{ id: string; displayName: string; duration: number; streamUrl: string }>(
    `${API_ROOT}/assets/${encodeURIComponent(assetId)}`,
  );
}

export function createEditorOperation(projectId: string, body: Record<string, unknown>) {
  return request<EditorOperation>(`${API_ROOT}/projects/${encodeURIComponent(projectId)}/operations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

export function getEditorOperation(operationId: string) {
  return request<EditorOperation>(`${API_ROOT}/operations/${encodeURIComponent(operationId)}`);
}

export function importEditorOperationResult(operationId: string, clipId: string) {
  return request<{ id: string; displayName: string; duration: number; streamUrl: string }>(
    `${API_ROOT}/operations/${encodeURIComponent(operationId)}/results/${encodeURIComponent(clipId)}/import`,
    { method: 'POST' },
  );
}

export function getSingerPresets() {
  return request<{ presets: import('./singerPresets').SingerPreset[] }>(`${API_ROOT}/singer-presets`);
}
