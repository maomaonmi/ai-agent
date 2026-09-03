export interface BeatPreset {
  id: string;
  name: string;
  style: string;
  key: string;
  bpm: number;
  durationSeconds: number;
  audioUrl: string;
  coverUrl: string;
  fileName: string;
}

const BGM_ROOT = '/music/AI_Editor/bgm_pack';

const BEAT_METADATA: Array<[string, string, string, string, number, number]> = [
  ['01', '旧剑痕', '国潮古风战鼓', 'G大调', 102, 45],
  ['02', '余温日记', '国潮民谣', 'A#大调', 62, 55],
  ['03', 'Anime Battle', '日系动漫燃曲', 'A大调', 150, 33],
  ['04', '舞龙', '国潮舞曲', 'G大调', 125, 40],
  ['05', 'Trap Dark', 'Trap暗黑', 'G#小调', 140, 46],
  ['06', 'Old Sword', '80s复古迷幻', 'D#小调', 88, 47],
  ['07', 'Jazz Lounge', '爵士酒吧', 'F大调', 75, 37],
  ['08', 'Folk Warm', '民谣吉他', 'G大调', 95, 26],
  ['09', 'Bossa Nova', '拉丁爵士', 'C大调', 100, 33],
  ['10', 'Lo-Fi Chill', 'Lo-Fi', 'D大调', 85, 35],
  ['11', '走马灯（燃尽BGM）', '古风燃尽BGM', 'D大调', 140, 27],
  ['12', 'Chinese Dizi', '国风禅意笛子', 'A小调', 70, 58],
  ['13', 'Cyberpunk', '赛博朋克', 'F#小调', 128, 49],
  ['14', 'New Age', 'New Age治愈', 'E大调', 60, 25],
  ['15', 'Boom Bap', '90s嘻哈', 'E小调', 90, 25],
  ['16', 'String Quartet', '古典弦乐四重奏', 'D小调', 80, 50],
  ['17', 'Post-Rock', 'Post-Rock史诗', 'C小调', 90, 60],
  ['18', 'Film Tragic', '电影配乐/悲壮', 'C小调', 70, 42],
  ['19', '迎着阳光盛大逃亡（PHONK）', 'Phonk Drift', 'C#小调', 127, 62],
  ['20', 'ByteFeeling', '魔性电子实验', 'A小调', 113, 28],
];

export const BEAT_PRESETS: BeatPreset[] = BEAT_METADATA.map(([id, name, style, key, bpm, durationSeconds]) => {
  const fileName = `${id}_${({
    '01': 'iron_will', '02': 'yuwendiary', '03': 'anime_battle', '04': 'wulong', '05': 'trap_dark',
    '06': 'old_sword', '07': 'jazz_lounge', '08': 'folk_warm', '09': 'bossa_nova', '10': 'lofi_chill',
    '11': 'zoumadeng', '12': 'chinese_dizi', '13': 'cyberpunk', '14': 'new_age', '15': 'boom_bap',
    '16': 'string_quartet', '17': 'post_rock', '18': 'film_tragic', '19': 'phonk_drift', '20': 'byte_feeling',
  } as Record<string, string>)[id]}.mp3`;
  return {
    id: `beat-${id}`,
    name,
    style,
    key,
    bpm,
    durationSeconds,
    fileName,
    audioUrl: `${BGM_ROOT}/audio/${fileName}`,
    coverUrl: `${BGM_ROOT}/cover/DM_20260902180811_${id.padStart(3, '0')}.jpg`,
  };
});
