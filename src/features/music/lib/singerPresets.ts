export interface SingerPreset {
  id: string;
  name: string;
  voiceType: string;
  tags: string;
  gender: 'male' | 'female';
  avatarUrl: string;
  referenceAudioUrl: string;
  referenceKind: 'pure_vocal';
  presetOnly: true;
}

export const SINGER_PRESETS: SingerPreset[] = [
  { id: 'yexueru', name: '叶雪如', voiceType: '女高音 · 梦幻流行', tags: '温柔 磁性', gender: 'female', avatarUrl: '/music/singer_pack/avatars/01_yexueru_white_hair.jpg', referenceAudioUrl: '/music/singer_pack/audio/voice_01_yexueru.mp3', referenceKind: 'pure_vocal', presetOnly: true },
  { id: 'hasen', name: '哈森', voiceType: '男高音 · R&B', tags: '明亮 磁性', gender: 'male', avatarUrl: '/music/singer_pack/avatars/02_hasen_navy.png', referenceAudioUrl: '/music/singer_pack/audio/voice_02_hasen.mp3', referenceKind: 'pure_vocal', presetOnly: true },
  { id: 'aimi', name: 'Aimi芷', voiceType: '女低音 · 爵士', tags: '沙哑 醇厚 成熟', gender: 'female', avatarUrl: '/music/singer_pack/avatars/03_aimi_pink.jpg', referenceAudioUrl: '/music/singer_pack/audio/voice_03_aimi.mp3', referenceKind: 'pure_vocal', presetOnly: true },
  { id: 'chenguizhi', name: '陈癸之', voiceType: '男高音 · 民谣', tags: '温柔 慵懒', gender: 'male', avatarUrl: '/music/singer_pack/avatars/04_chenguizhi_orange.jpg', referenceAudioUrl: '/music/singer_pack/audio/voice_04_chenguizhi.mp3', referenceKind: 'pure_vocal', presetOnly: true },
  { id: 'taier', name: '太二', voiceType: '男中音 · 动漫', tags: '二次元 醇厚', gender: 'male', avatarUrl: '/music/singer_pack/avatars/05_taier_anime.png', referenceAudioUrl: '/music/singer_pack/audio/voice_05_taier.mp3', referenceKind: 'pure_vocal', presetOnly: true },
  { id: 'xuyijie', name: '绪艺洁', voiceType: '女高音 · J-pop', tags: '明亮 空灵', gender: 'female', avatarUrl: '/music/singer_pack/avatars/06_xuyijie_pink.jpg', referenceAudioUrl: '/music/singer_pack/audio/voice_06_xuyijie.mp3', referenceKind: 'pure_vocal', presetOnly: true },
  { id: 'hangzai', name: '航仔', voiceType: '男高音 · 独立民谣', tags: '温柔 沙哑', gender: 'male', avatarUrl: '/music/singer_pack/avatars/07_hangzai_blue.png', referenceAudioUrl: '/music/singer_pack/audio/voice_07_hangzai.mp3', referenceKind: 'pure_vocal', presetOnly: true },
  { id: 'shasha', name: '莎莎', voiceType: '女中音 · 波萨诺瓦', tags: '性感 慵懒', gender: 'female', avatarUrl: '/music/singer_pack/avatars/08_shasha_blue.jpg', referenceAudioUrl: '/music/singer_pack/audio/voice_08_shasha.mp3', referenceKind: 'pure_vocal', presetOnly: true },
  { id: 'leyi', name: '乐翊', voiceType: '男高音 · 原声', tags: '细腻 纯净', gender: 'male', avatarUrl: '/music/singer_pack/avatars/09_leyi_blue.jpg', referenceAudioUrl: '/music/singer_pack/audio/voice_09_leyi.mp3', referenceKind: 'pure_vocal', presetOnly: true },
  { id: 'magaigai', name: '马改改', voiceType: '女低音 · 骑士民谣', tags: '醇厚 叙事', gender: 'female', avatarUrl: '/music/singer_pack/avatars/10_magai_gai_yellow.png', referenceAudioUrl: '/music/singer_pack/audio/voice_10_magaigai.mp3', referenceKind: 'pure_vocal', presetOnly: true },
  { id: 'sanhao', name: '3号少女', voiceType: '女中音 · 独立流行', tags: '沙哑 磁性', gender: 'female', avatarUrl: '/music/singer_pack/avatars/11_san_hao_pink.png', referenceAudioUrl: '/music/singer_pack/audio/voice_11_sanhao.mp3', referenceKind: 'pure_vocal', presetOnly: true },
];
