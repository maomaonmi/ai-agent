export type VocalEffectCategory = 'recommend' | 'enhance' | 'special' | 'style';

export type VocalEffectId =
  | 'rap'
  | 'pop'
  | 'punk'
  | 'vintage'
  | 'double_voice'
  | 'air_voice'
  | 'clarity'
  | 'texture'
  | 'minion'
  | 'monster'
  | 'surround_360'
  | 'seventies_pop'
  | 'disco';

export interface VocalEffectDefinition {
  id: VocalEffectId;
  category: VocalEffectCategory;
  name: string;
  description: string;
  backendPreset: VocalEffectId;
  iconKey: 'mic' | 'music' | 'zap' | 'disc' | 'layers' | 'wind' | 'clarity' | 'texture' | 'minion' | 'monster' | 'surround' | 'radio' | 'disco';
}

export const VOCAL_EFFECTS: readonly VocalEffectDefinition[] = [
  { id: 'rap', category: 'recommend', name: '说唱 Rap', description: '集中呈现说唱风格的人声，增强声线颗粒度', backendPreset: 'rap', iconKey: 'mic' },
  { id: 'pop', category: 'recommend', name: '流行', description: '经典流行音乐风格，使人声更加明亮突出', backendPreset: 'pop', iconKey: 'music' },
  { id: 'punk', category: 'recommend', name: '朋克', description: '增强朋克音乐特有的表现效果，强化失真以突出自由、亢奋的风格特征', backendPreset: 'punk', iconKey: 'zap' },
  { id: 'vintage', category: 'recommend', name: '复古', description: '拥有唱片与磁带效果，可以给人声增加复古感与年代感', backendPreset: 'vintage', iconKey: 'disc' },
  { id: 'double_voice', category: 'recommend', name: '一键叠声', description: '一键增加人声整体的厚度及声场宽度，使人声更加饱满', backendPreset: 'double_voice', iconKey: 'layers' },
  { id: 'air_voice', category: 'recommend', name: '空气人声', description: '增加人声通透度与空气感，增强个性化表现，适用于各类曲风', backendPreset: 'air_voice', iconKey: 'wind' },

  { id: 'clarity', category: 'enhance', name: '高清晰度', description: '一键将人声削频而出，提升人声细节和清晰度，适用于各类曲风', backendPreset: 'clarity', iconKey: 'clarity' },
  { id: 'texture', category: 'enhance', name: '提升质感', description: '提升人声质感，整体声音更加饱满，色彩丰富，减少大白嗓', backendPreset: 'texture', iconKey: 'texture' },
  { id: 'air_voice', category: 'enhance', name: '空气人声', description: '增加人声通透度与空气感，增强个性化表现，适用于各类曲风', backendPreset: 'air_voice', iconKey: 'wind' },
  { id: 'double_voice', category: 'enhance', name: '一键叠声', description: '一键增加人声整体的厚度及声场宽度，使人声更加饱满', backendPreset: 'double_voice', iconKey: 'layers' },

  { id: 'vintage', category: 'special', name: '复古', description: '拥有唱片与磁带效果，可以给人声增加复古感与年代感', backendPreset: 'vintage', iconKey: 'disc' },
  { id: 'minion', category: 'special', name: '小黄人', description: '充满童趣的俏皮音色，适合呈现出俏皮、搞怪的效果', backendPreset: 'minion', iconKey: 'minion' },
  { id: 'monster', category: 'special', name: '怪物', description: '一键拥有浑厚的效果，模拟低沉的怪物声音', backendPreset: 'monster', iconKey: 'monster' },
  { id: 'surround_360', category: 'special', name: '360环绕', description: '通过模拟声音在三维空间中的运动轨迹，帮助增加音乐整体的空间感及沉浸感', backendPreset: 'surround_360', iconKey: 'surround' },

  { id: 'seventies_pop', category: 'style', name: '70年代流行', description: '复古年代流行音乐效果，适用于人声复古基调的呈现', backendPreset: 'seventies_pop', iconKey: 'radio' },
  { id: 'pop', category: 'style', name: '流行', description: '经典流行音乐风格，使人声更加明亮突出', backendPreset: 'pop', iconKey: 'music' },
  { id: 'punk', category: 'style', name: '朋克', description: '增强朋克音乐特有的表现效果，强化失真以突出自由、亢奋的风格特征', backendPreset: 'punk', iconKey: 'zap' },
  { id: 'disco', category: 'style', name: '迪斯科 Disco', description: '呈现出复古迪斯科舞厅的大混响表现效果，人声声场更加宽阔', backendPreset: 'disco', iconKey: 'disco' },
  { id: 'rap', category: 'style', name: '说唱 Rap', description: '集中呈现说唱风格的人声，增强声线颗粒度', backendPreset: 'rap', iconKey: 'mic' },
];

export function listVocalEffects(category: VocalEffectCategory): VocalEffectDefinition[] {
  return VOCAL_EFFECTS.filter((effect) => effect.category === category);
}

export function getVocalEffect(id: VocalEffectId): VocalEffectDefinition {
  const effect = VOCAL_EFFECTS.find((candidate) => candidate.id === id);
  if (!effect) throw new Error(`不支持的人声效果: ${id}`);
  return effect;
}

export function clampVocalEffectIntensity(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Map the dial's 270° clockwise sweep (135° → 45°) to 1% steps. */
export function vocalEffectIntensityFromAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 100;
  const normalized = ((angle % 360) + 360) % 360;
  const relative = (normalized - 135 + 360) % 360;
  return clampVocalEffectIntensity((Math.min(270, relative) / 270) * 100);
}

export function buildVocalEffectParameters(id: string, intensity: number): { effectId: VocalEffectId; intensity: number } {
  const effect = getVocalEffect(id as VocalEffectId);
  return { effectId: effect.backendPreset, intensity: clampVocalEffectIntensity(intensity) };
}
