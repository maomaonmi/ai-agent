export type MusicProvider = 'deepseek' | 'qwen' | 'glm' | 'minimax';

export interface ParsedMusicDraft {
  title: string;
  lyrics: string;
  note: string;
}

export interface StreamingMusicDraft extends ParsedMusicDraft {
  complete: boolean;
}

const tagValue = (value: string, tag: string) => {
  const match = value.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match?.[1]?.trim() ?? '';
};

export function parseMusicDraft(value: string): ParsedMusicDraft {
  const title = tagValue(value, 'title');
  const lyrics = tagValue(value, 'lyrics');
  const note = tagValue(value, 'note');
  if (lyrics) return { title: title || '未命名歌词', lyrics, note };

  return {
    title: title || '未命名歌词',
    lyrics: value.trim(),
    note,
  };
}

export function parseStreamingMusicDraft(value: string): StreamingMusicDraft {
  const lyricsStart = value.search(/<lyrics>/i);
  const closedLyrics = tagValue(value, 'lyrics');
  const partialLyrics = lyricsStart >= 0
    ? value.slice(lyricsStart).replace(/^<lyrics>/i, '').split(/<\/lyrics>/i)[0].trimStart()
    : '';
  return {
    title: tagValue(value, 'title'),
    note: tagValue(value, 'note'),
    lyrics: closedLyrics || partialLyrics,
    complete: /<\/lyrics>/i.test(value),
  };
}

export function musicSessionTitle(inspiration: string): string {
  const cleaned = inspiration.replace(/\s+/g, ' ').trim();
  return cleaned.length > 18 ? `${cleaned.slice(0, 18)}…` : cleaned || '新的音乐灵感';
}

export function buildMusicAgentPrompt(inspiration: string): string {
  return `你是音乐工坊的词曲创作 Agent。请把用户的灵感发展成一份可以直接谱曲的中文歌词。
要求：先理解主题、情绪与叙事视角，再设计 Verse/Pre-Chorus/Chorus/Bridge/Outro 等合理结构；歌词要具体、有画面、可演唱，避免空泛套话。用户信息较少时请作合理创作，不要反问。不要联网，不要调用工具。
只用下面的格式输出最终结果，标签之外不要输出其他内容：
<title>歌曲标题</title>
<note>一句话说明创作方向、情绪和结构</note>
<lyrics>
[Verse 1]
歌词……
[Chorus]
歌词……
</lyrics>

用户灵感：${inspiration.trim()}`;
}
