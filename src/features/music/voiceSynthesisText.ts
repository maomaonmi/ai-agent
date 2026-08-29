/**
 * Inline controls in the speech editor are UI metadata, not text to be read.
 *
 * The Qwen VC realtime model accepts plain text and does not implement the
 * emotion/interjection/pause markers used by the editor.  Keeping this
 * normalization in a pure helper makes the DOM extraction deterministic and
 * prevents a control marker from accidentally reaching any TTS provider.
 */

const INTERJECTION_AND_STYLE_TAGS = [
  '轻笑',
  '笑声',
  '咳嗽',
  '清嗓子',
  '呻吟',
  '正常换气',
  '喘气',
  '吸气',
  '开心',
  '生气',
  '悲伤',
  '害怕',
  '温柔',
  '坚定',
  '平静',
  '惊讶',
  '厌恶',
  '中性',
  '新闻播报',
  '聊天',
  '广播剧',
  '客服',
  '旁白',
  '睡前故事',
  '直播带货',
  '严肃',
  '兴奋',
] as const;

const PARENTHESIZED_CONTROL_TAG = new RegExp(
  `\\(\\s*(?:${INTERJECTION_AND_STYLE_TAGS.join('|')})\\s*\\)`,
  'g',
);

/** Remove editor-only pause and expression markers from plain text. */
export function stripVoiceControlTags(value: string): string {
  return value
    .replace(/<#\s*\d+(?:\.\d+)?\s*#>/g, '')
    .replace(PARENTHESIZED_CONTROL_TAG, '')
    // Do not leave a run of spaces where a marker was removed.
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Extract spoken text from the contenteditable editor without mutating it.
 * Emotion chips are removed as a whole (their hidden value is metadata), and
 * text-based controls are filtered by {@link stripVoiceControlTags}.
 */
export function extractVoiceSynthesisText(root: HTMLElement | null, fallback = ''): string {
  if (!root) return stripVoiceControlTags(fallback);

  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.emotion-tag').forEach((tag) => tag.remove());
  return stripVoiceControlTags(clone.innerText || fallback);
}
