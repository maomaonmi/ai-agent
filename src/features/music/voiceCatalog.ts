export interface VoiceApiModel {
  voice_id: string;
  model: string;
  name: string;
  description: string;
  tags: string[];
  is_new?: boolean;
  is_hot?: boolean;
  is_premium?: boolean;
  // 筛选字段（来自数据库）
  gender?: string | null;
  age?: number | string | null;  // CosyVoice用字符串如"20~30岁"
  trait?: string | null;
  scenario?: string | null;
  language?: string | null;
  preview_audio?: string | null;
  // CosyVoice 功能支持字段
  support_ssml?: boolean | null;
  support_instruct?: boolean | null;
  support_timestamp?: boolean | null;
  is_custom?: boolean;
  is_favorite?: boolean;
  status?: string;
  created_at?: string;
  updated_at?: string;
}

export interface VoiceModel {
  voiceId: string;
  model: string;
  name: string;
  description: string;
  tags: string[];
  avatar?: string;
  isNew?: boolean;
  isHot?: boolean;
  isPremium?: boolean;
  // 筛选字段
  gender?: string | null;
  age?: number | string | null;  // CosyVoice用字符串如"20~30岁"
  trait?: string | null;
  scenario?: string | null;
  language?: string | null;
  previewAudio?: string | null;
  // CosyVoice 功能支持字段
  supportSsml?: boolean | null;
  supportInstruct?: boolean | null;
  supportTimestamp?: boolean | null;
  isCustom?: boolean;
  isFavorite?: boolean;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

// Keep this manifest in the same lexical order as public/music/Minimax.
// The browser cannot enumerate a public directory, so the manifest provides
// deterministic URLs while keeping voice IDs independent from image names.
export const VOICE_AVATAR_FILES = [
  '1732170866308466098-207331589840960.png',
  '1732170867731770888-207331589840961.png',
  '1732170878687085062-207331589840962.png',
  '1732170882883038555-207331589840963.png',
  '1732170896048578798-207331589840965.png',
  '1732170897805491285-207331589840966.png',
  '1732170901734942457-207331589840967.png',
  '1732170904917391630-207331589840968.png',
  '1732170913072244575-207331589840969.png',
  '1732170920833747678-207331589840970.png',
  '1732170924379894273-207331589840971.png',
  '1732170928701079772-207331589840972.png',
  '1732170931210906334-207331589840973.png',
  '1732170934771435569-207331589840974.png',
  '1732170948643791003-207331589840975.png',
  '1732170962250014225-207331589840976.png',
  '1732170987980918894-207331589840977.png',
  '1732171021069154419-207331589840979.png',
  '1732171043061635298-207331589840980.png',
  '1732171070538161266-207331589840981.png',
  '1732171071679118750-207331589840982.png',
  '1732171072685650758-207331589840983.png',
  '1732171095224499748-207331589840985.png',
  '1732171096838268941-207331589840986.png',
  '1732171098868054785-207331589840987.png',
  '1732171101706191124-207331589840988.png',
  '1732171109317563903-207331589840990.png',
  '1732171117402918970-207331589840991.png',
  '1732171120518357003-207331589840992.png',
  '1732171132209534867-207331589840993.png',
  '1732171153909046522-207331589840994.png',
  '1732171217986331571-207331589840997.png',
  '1732171254763978891-207331589840999.png',
  '1732171314141304047-207331589841002.png',
  '1732171317811403975-207331589841003.png',
  '1732171337682957645-207331589841004.png',
  '1732171341151224733-207331589841005.png',
  '1732171343843598564-207331589841006.png',
  '1732171352409438116-207331589841008.png',
  '1732171366610354441-207331589841009.png',
  '1732171368584252870-207331589841010.png',
  '1732171372062349715-207331589841011.png',
  '1732171380094675085-207331589841012.png',
  '1732171400945633248-207331589841014.png',
  '1732171402294404786-207331589841015.png',
  '1732171403950960108-207331589841016.png',
  '1732171430549457151-207331589841017.png',
  '1732171434676353759-207331589841018.png',
  '1732171437768943140-207331589841019.png',
  '1732171458622199983-207331589841020.png',
  '1732171485782365231-207331589841021.png',
  '1732171547634375627-207334257025089.png',
  '1732171556053389397-207334257025090.png',
  '1732171563752588843-207334257025091.png',
  '1732171565701695345-207334257025092.png',
  '1732171568557177196-207334257025093.png',
  '1741781512504627113-211191879486668801oversize.png',
  '576fe884-63dc-4d83-a5d4-9e51e96fbe64.png',
  '5a64e0b2-432b-4f66-98e7-93529fb0fce7.png',
  '5d4f142c-c23f-4c75-971e-0430c3804111.png',
  'audio-speech-2-5-1.png',
  'audio-speech-2-5.jpeg',
  'cf015c5c-59b0-4908-b209-5e013b88a58b.png',
  'hailuo-voice-model6.png',
  'hailuo-voice-model7.png',
  'voice-model-1.png',
  'voice-model-2.png',
] as const;

export function normalizeVoices(voices: VoiceApiModel[]): VoiceModel[] {
  return voices.map((voice, index) => ({
    voiceId: voice.voice_id,
    model: voice.model,
    name: voice.name,
    description: voice.description,
    tags: voice.tags,
    avatar: VOICE_AVATAR_FILES[index]
      ? `/music/Minimax/${VOICE_AVATAR_FILES[index]}`
      : undefined,
    isNew: voice.is_new,
    isHot: voice.is_hot,
    isPremium: voice.is_premium,
    // 映射筛选字段
    gender: voice.gender,
    age: voice.age,
    trait: voice.trait,
    scenario: voice.scenario,
    language: voice.language,
    previewAudio: voice.preview_audio,
    // 映射 CosyVoice 功能支持字段
    supportSsml: voice.support_ssml,
    supportInstruct: voice.support_instruct,
    supportTimestamp: voice.support_timestamp,
    isCustom: voice.is_custom,
    isFavorite: voice.is_favorite,
    status: voice.status,
    createdAt: voice.created_at,
    updatedAt: voice.updated_at,
  }));
}

export function normalizeCustomVoices(voices: VoiceApiModel[]): VoiceModel[] {
  return voices.map((voice) => ({
    voiceId: voice.voice_id,
    model: voice.model,
    name: voice.name,
    description: voice.description,
    tags: voice.tags || ['自定义'],
    isCustom: true,
    isFavorite: Boolean(voice.is_favorite),
    status: voice.status,
    createdAt: voice.created_at,
    updatedAt: voice.updated_at,
    gender: voice.gender,
    language: voice.language,
    previewAudio: voice.preview_audio,
  }));
}
