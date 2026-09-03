/**
 * 统一“短主题 -> 可演唱歌词”的扩展规则。
 *
 * 目标长度随用户输入长度线性增长，避免两个字和一整句主题得到同样
 * 冗长的结果；同时设置上下限，保证模型不会返回过短或不可控的文本。
 */
export function countLyricsSeedCharacters(seed: string): number {
  return Array.from(seed.trim()).length;
}

export function targetLyricsCharacters(seed: string): number {
  const length = countLyricsSeedCharacters(seed);
  if (length === 0) return 0;
  return Math.min(500, Math.max(80, length * 8));
}

export function buildLyricsPolishPrompt(seed: string): string {
  const cleanSeed = seed.trim();
  const target = targetLyricsCharacters(cleanSeed);
  return [
    '请把下面的短主题润色并扩展成一段可演唱的中文歌词。',
    '保留原始主题和情绪，不要解释创作过程，只输出歌词正文。',
    `原始输入：${cleanSeed}`,
    `请根据输入长度扩展，全文约 ${target} 字（允许上下浮动 20%），使用清晰的分行结构。`,
  ].join('\n');
}
