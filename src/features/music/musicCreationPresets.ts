export const STYLE_PRESETS = [
  '中国风', '流行', '民谣', '摇滚', '电子', 'R&B', '嘻哈', '爵士', '蓝调',
  '古典', '管弦乐', '世界音乐', 'Lo-fi', 'Synthwave', 'City Pop', '轻音乐',
  '电影配乐', '游戏配乐', '治愈', '伤感', '欢快', '史诗', '梦幻', '暗黑',
] as const;

export const INSTRUMENT_PRESETS = [
  '钢琴', '木吉他', '电吉他', '贝斯', '架子鼓', '小提琴', '大提琴', '萨克斯',
  '长笛', '古筝', '琵琶', '二胡', '笛子', '合成器', '808 鼓机', '弦乐团',
] as const;

export function composeMusicStyle(base: string, styles: readonly string[], instruments: readonly string[]): string {
  return [...new Set([base.trim(), ...styles, ...instruments].filter(Boolean))].join(', ');
}

export function referenceAudioLimitSeconds(model: string): number {
  return model === 'V4_5ALL' ? 60 : 8 * 60;
}
