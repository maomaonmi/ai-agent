import test from 'node:test';
import assert from 'node:assert/strict';
import { editorTrackHasAudio, selectGenerationAssetId, type EditorTrackInput } from '../src/features/music/lib/musicEditorApi.ts';

const tracks: EditorTrackInput[] = [
  { id: 'vocal-1', name: '人声', type: 'vocal', muted: false, solo: false, volume: 1, clips: [{ id: 'v1', name: 'vocal.mp3', start: 0, duration: 4, assetId: 'asset-vocal' }] },
  { id: 'inst-1', name: '伴奏', type: 'instrument', muted: false, solo: false, volume: 1, clips: [{ id: 'i1', name: 'inst.mp3', start: 0, duration: 4, assetId: 'asset-inst' }] },
];

test('伴奏配人声优先使用所选伴奏，未选择时自动使用首个伴奏素材', () => {
  assert.equal(selectGenerationAssetId(tracks, 'vocal', 'vocal-1', 'inst-1'), 'asset-inst');
  assert.equal(selectGenerationAssetId(tracks, 'vocal', 'vocal-1', ''), 'asset-inst');
});

test('空轨道不会被视为可选择的音频轨道', () => {
  assert.equal(editorTrackHasAudio(tracks[0]), true);
  assert.equal(editorTrackHasAudio({ clips: [{ id: 'empty', name: '空', start: 0, duration: 1 }] }), false);
});

test('生成伴奏优先使用所选人声，找不到时回退到可用音轨', () => {
  assert.equal(selectGenerationAssetId(tracks, 'instrumental', 'vocal-1', ''), 'asset-vocal');
  assert.equal(selectGenerationAssetId(tracks, 'instrumental', '', ''), 'asset-vocal');
});
