/**
 * Zero-dependency lightweight syntax highlighter + line-oriented diff.
 *
 * Why self-hosted:
 * - package.json 没有任何高亮/ diff 库；补装 shiki / prism / diff 会引入 300MB+ node_modules
 *   并把 CI/冷启动成本拉高，在当前 "单文件网页生成" 体量下不值。
 * - 覆盖 Code 模式真实产出的 5 类文件：HTML / CSS / JavaScript / JSON / Python。
 *   实现优先级是 "区分度足够" 而不是完全严谨（出错时降级成纯文本，不会阻塞渲染）。
 */

export type TokenKind =
  | 'plain'
  | 'keyword'
  | 'string'
  | 'number'
  | 'comment'
  | 'tag'
  | 'attr'
  | 'selector'
  | 'property'
  | 'function'
  | 'operator'
  | 'punct';

export interface HighlightToken {
  text: string;
  kind: TokenKind;
}

export interface HighlightLine {
  tokens: HighlightToken[];
  raw: string;
}

export type DiffLineKind = 'equal' | 'insert' | 'delete';

export interface DiffLine {
  kind: DiffLineKind;
  /** 新版本中的 1-based 行号（删除行在新版本中不存在时为 null）。 */
  newLineNo: number | null;
  /** 旧版本中的 1-based 行号（新增行在旧版本中不存在时为 null）。 */
  oldLineNo: number | null;
  tokens: HighlightToken[];
  raw: string;
}

const JS_KEYWORDS = new Set([
  'const','let','var','function','return','if','else','for','while','do','switch','case','break','continue',
  'new','class','extends','super','this','import','export','from','default','try','catch','finally','throw',
  'typeof','instanceof','in','of','delete','void','yield','await','async','static','public','private',
  'protected','true','false','null','undefined','NaN','Infinity','as','interface','type','enum','implements',
]);

const PY_KEYWORDS = new Set([
  'def','return','if','elif','else','for','while','break','continue','pass','import','from','as','class',
  'try','except','finally','raise','with','lambda','yield','global','nonlocal','True','False','None',
  'async','await','and','or','not','in','is','self',
]);

const CSS_PROPS: ReadonlySet<string> = (() => {
  const props = [
    'color','background','background-color','background-image','background-size','background-position',
    'font-family','font-size','font-weight','font-style','line-height','letter-spacing','text-align',
    'text-decoration','text-transform','margin','padding','border','border-radius','border-color','border-width',
    'border-style','box-shadow','width','height','min-width','min-height','max-width','max-height',
    'display','flex','flex-direction','flex-wrap','justify-content','align-items','align-content','gap',
    'grid','grid-template-columns','grid-template-rows','grid-area','position','top','left','right','bottom',
    'z-index','overflow','opacity','transform','transition','animation','cursor','outline','list-style',
    'float','clear','visibility','pointer-events','white-space','word-break','resize','filter','backdrop-filter',
  ];
  return new Set(props);
})();

function tokenizeRegex(source: string, rules: Array<{ regex: RegExp; kind: TokenKind }>): HighlightToken[] {
  const tokens: HighlightToken[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while (last < source.length) {
    let earliest: { index: number; length: number; kind: TokenKind } | null = null;
    for (const rule of rules) {
      // Why: 我们的规则大多用 sticky (y) flag，它只在 lastIndex 处匹配；但是为了让"跳过一段未知字符（比如空白）"
      // 的场景也能正常工作，每次同时给 rule.lastIndex 设 last —— sticky 规则会严格从 last 开始，
      // 非 sticky 规则可以从 >= last 的任意位置开始匹配。
      rule.regex.lastIndex = last;
      match = rule.regex.exec(source);
      if (!match) continue;
      // Sticky regex 命中时 match.index 一定等于 lastIndex；非 sticky（g flag）可能返回一个 >= lastIndex 的值。
      // 我们允许二者混用，并取最靠左、同位置下最长的那个。
      if (earliest == null || match.index < earliest.index || (match.index === earliest.index && match[0].length > earliest.length)) {
        earliest = { index: match.index, length: match[0].length, kind: rule.kind };
      }
    }
    if (!earliest) {
      // Why: 之前这里直接把 source.slice(last) 当 plain 并 break，导致只要有一个字符（通常是空格）
      // 不在任何规则的 sticky 范围内，整段后续代码就失去高亮。修复为一次推进一个字符，让后续规则继续参与匹配。
      tokens.push({ text: source[last], kind: 'plain' });
      last += 1;
      continue;
    }
    if (earliest.index > last) {
      tokens.push({ text: source.slice(last, earliest.index), kind: 'plain' });
    }
    tokens.push({ text: source.slice(earliest.index, earliest.index + earliest.length), kind: earliest.kind });
    last = earliest.index + earliest.length;
  }
  return tokens;
}

function mergePlain(tokens: HighlightToken[]): HighlightToken[] {
  const result: HighlightToken[] = [];
  for (const token of tokens) {
    if (!token.text) continue;
    const prev = result[result.length - 1];
    if (prev && prev.kind === token.kind && token.kind === 'plain') {
      prev.text += token.text;
    } else {
      result.push({ ...token });
    }
  }
  return result;
}

function tokenizeJS(source: string): HighlightToken[] {
  const rules: Array<{ regex: RegExp; kind: TokenKind }> = [
    { regex: /\/\/[^\n]*/gy, kind: 'comment' },
    { regex: /\/\*[\s\S]*?\*\//gy, kind: 'comment' },
    { regex: /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/gy, kind: 'string' },
    { regex: /\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\.\d+\b/gy, kind: 'number' },
    // identifier-looking words, post-processed below to split keywords / functions.
    { regex: /[A-Za-z_$][\w$]*/gy, kind: 'plain' },
    { regex: /[A-Za-z_$][\w$]*\s*\(/gy, kind: 'function' },
    { regex: /[+\-*/%=<>!&|^~?:.]+/gy, kind: 'operator' },
    { regex: /[{}()[\],;]/gy, kind: 'punct' },
  ];
  return mergePlain(tokenizeRegex(source, rules)).map((token): HighlightToken => {
    if (token.kind !== 'plain') return token;
    // Scan through the plain chunk and recognize keywords / function-call starts to upgrade
    // their leading token kind. The renderer walks tokens sequentially so visually this gives
    // enough differentiation; if finer granularity is needed we can flatten later.
    const wordRe = /[A-Za-z_$][\w$]*/gy;
    let upgraded: TokenKind = token.kind;
    let m: RegExpExecArray | null;
    while ((m = wordRe.exec(token.text)) !== null) {
      const word = m[0];
      if (JS_KEYWORDS.has(word)) { upgraded = 'keyword'; break; }
      if (token.text[m.index + word.length] === '(') { upgraded = 'function'; break; }
    }
    return { text: token.text, kind: upgraded };
  });
}

function tokenizePython(source: string): HighlightToken[] {
  const rules: Array<{ regex: RegExp; kind: TokenKind }> = [
    { regex: /#[^\n]*/gy, kind: 'comment' },
    { regex: /([frb]*['"]{3})[\s\S]*?\1|(['"])((?:\\.|(?!\2)[^\\\n])*)\2/gy, kind: 'string' },
    { regex: /\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?j?\b|\.\d+j?\b/gy, kind: 'number' },
    // Why: identifier 规则放在 operator/punct 前面以便先吃到完整单词，后面 post-process 再做关键字升级。
    { regex: /[A-Za-z_][\w]*/gy, kind: 'plain' },
    { regex: /[+\-*/%=<>!&|^~?:.@]+/gy, kind: 'operator' },
    { regex: /[{}()[\],;:]/gy, kind: 'punct' },
  ];
  return mergePlain(tokenizeRegex(source, rules)).map((token): HighlightToken => {
    if (token.kind !== 'plain') return token;
    // Python 中 identifier 和空白/符号等都会落进 plain；这里只对单词形状做关键字/函数升级，空白保持 plain 即可。
    const wordRe = /[A-Za-z_][\w]*/gy;
    let upgraded: TokenKind = token.kind;
    let m: RegExpExecArray | null;
    while ((m = wordRe.exec(token.text)) !== null) {
      const word = m[0];
      if (PY_KEYWORDS.has(word)) { upgraded = 'keyword'; break; }
      if (token.text[m.index + word.length] === '(') { upgraded = 'function'; break; }
    }
    return { text: token.text, kind: upgraded };
  });
}

function tokenizeJSON(source: string): HighlightToken[] {
  return mergePlain(
    tokenizeRegex(source, [
      { regex: /"(?:\\.|[^"\\\n])*"(?=\s*:)/gy, kind: 'attr' },
      { regex: /"(?:\\.|[^"\\\n])*"/gy, kind: 'string' },
      { regex: /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\.\d+\b/gy, kind: 'number' },
      { regex: /\b(?:true|false|null)\b/gy, kind: 'keyword' },
      { regex: /[\[\]{}:,]/gy, kind: 'punct' },
    ]),
  );
}

function tokenizeCSS(source: string): HighlightToken[] {
  // 先按字符串/注释切分，再按 selector / property / value 着色。
  return mergePlain(
    tokenizeRegex(source, [
      { regex: /\/\*[\s\S]*?\*\//gy, kind: 'comment' },
      { regex: /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/gy, kind: 'string' },
      // 选择器阶段：{ 之前；属性阶段：{ ... } 中以 名: 值 的形式出现。
      // 先不区分，统一识别属性名：行首 冒号前的 词；这里用“标识符紧跟 :”识别 property。
      { regex: /#[0-9a-fA-F]{3,8}\b/gy, kind: 'number' },
      { regex: /\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg|ch|ex)?\b/gy, kind: 'number' },
      { regex: /[-_a-zA-Z][-\w]*(?=\s*:)/gy, kind: 'property' },
      { regex: /[-_a-zA-Z][-\w]*(?=\s*\{)/gy, kind: 'selector' },
      { regex: /[.][-_a-zA-Z][-\w]*/gy, kind: 'selector' },
      { regex: /#[A-Za-z_][-\w]*/gy, kind: 'selector' },
      { regex: /@[-\w]+/gy, kind: 'keyword' },
    // Why: 兜底值 token（如 Arial / sans-serif / flex / hidden）。放在 punct 前面，
    // 确保值内部的字母不是一个字符一个字符地 push 成 plain，导致渲染和 mergePlain 开销飙升。
    { regex: /[-_a-zA-Z][-\w]*/gy, kind: 'plain' },
    { regex: /[{};:,()]/gy, kind: 'punct' },
  ]),
  ).map((token): HighlightToken => {
    if (token.kind === 'property' && !CSS_PROPS.has(token.text.toLowerCase())) {
      return { text: token.text, kind: 'plain' };
    }
    return token;
  });
}

function tokenizeHTML(source: string): HighlightToken[] {
  const tokens: HighlightToken[] = [];
  let index = 0;
  while (index < source.length) {
    const tagStart = source.indexOf('<', index);
    if (tagStart === -1) {
      tokens.push({ text: source.slice(index), kind: 'plain' });
      break;
    }
    if (tagStart > index) tokens.push({ text: source.slice(index, tagStart), kind: 'plain' });
    const commentEnd = source.indexOf('-->', tagStart);
    if (source.startsWith('<!--', tagStart) && commentEnd !== -1) {
      tokens.push({ text: source.slice(tagStart, commentEnd + 3), kind: 'comment' });
      index = commentEnd + 3;
      continue;
    }
    const tagEnd = findHTMLTagEnd(source, tagStart);
    if (tagEnd === -1) {
      tokens.push({ text: source.slice(tagStart), kind: 'tag' });
      break;
    }
    const tag = source.slice(tagStart, tagEnd + 1);
    tokens.push(...tokenizeHTMLTag(tag));
    index = tagEnd + 1;
  }
  return mergePlain(tokens);
}

function findHTMLTagEnd(source: string, openIndex: number): number {
  let inString: string | null = null;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (ch === inString && source[i - 1] !== '\\') inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = ch; continue; }
    if (ch === '>') return i;
  }
  return -1;
}

function tokenizeHTMLTag(tag: string): HighlightToken[] {
  const tokens: HighlightToken[] = [];
  // 匹配：< / ? tagname  attrs  > / ?
  const re = /<\/?\??([A-Za-z][\w-]*)|([^\s=>'"<]+)(?=\s*=)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|([A-Za-z][\w-]*)|(\/?\??>)|(\s+)/gy;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag)) !== null) {
    const [match, tagName, attrName, stringVal, bareAttr, close, whitespace] = m;
    if (whitespace) { tokens.push({ text: whitespace, kind: 'plain' }); continue; }
    if (tagName != null) {
      tokens.push({ text: match.slice(0, match.length - tagName.length), kind: 'tag' });
      tokens.push({ text: tagName, kind: 'tag' });
    } else if (attrName != null) {
      tokens.push({ text: attrName, kind: 'attr' });
    } else if (stringVal != null) {
      tokens.push({ text: stringVal, kind: 'string' });
    } else if (bareAttr != null) {
      tokens.push({ text: bareAttr, kind: 'attr' });
    } else if (close != null) {
      tokens.push({ text: close, kind: 'tag' });
    } else {
      tokens.push({ text: match, kind: 'plain' });
    }
  }
  return tokens;
}

export function detectLanguage(fileName: string): 'html' | 'css' | 'js' | 'json' | 'py' {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.jsx') || lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'js';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.py')) return 'py';
  // 默认行为：兜底用 JS，因为在该项目内绝大多数非 HTML 是 JS。
  return 'js';
}

export function highlightLine(line: string, language: ReturnType<typeof detectLanguage>): HighlightToken[] {
  switch (language) {
    case 'html': return tokenizeHTML(line);
    case 'css': return tokenizeCSS(line);
    case 'json': return tokenizeJSON(line);
    case 'py': return tokenizePython(line);
    case 'js': return tokenizeJS(line);
  }
}

export function highlight(source: string, language: ReturnType<typeof detectLanguage>): HighlightLine[] {
  const lines = source.split(/\r?\n/);
  return lines.map((raw) => ({ raw, tokens: highlightLine(raw, language) || [{ text: raw, kind: 'plain' }] }));
}

// ── line-based diff (Myers-ish, trimmed for our sizes) ────────────────────

/**
 * Compute a line-oriented diff between `oldLines` and `newLines`.
 *
 * Why not the full Myers O(ND): files in this workspace are bounded to 200k chars
 * per file, so an O(N*M) DP is acceptable. We use DP with LCS-reconstruction
 * because it produces correct diffs without pathological worst cases.
 */
export function diffLines(oldSource: string | null, newSource: string): DiffLine[] {
  const oldLines = oldSource == null ? [] : oldSource.split(/\r?\n/);
  const newLines = newSource.split(/\r?\n/);
  const N = oldLines.length;
  const M = newLines.length;
  const maxDpSize = 9_000_000; // 3k * 3k 足以覆盖单文件上限
  if (N * M > maxDpSize) {
    // 文件过大时降级为“全部 new，不标记删除”，避免 OOM。
    const result: DiffLine[] = [];
    for (let i = 0; i < M; i++) {
      const tokens = [{ text: newLines[i], kind: 'plain' as TokenKind }];
      result.push({ kind: 'equal', newLineNo: i + 1, oldLineNo: i < N ? i + 1 : null, tokens, raw: newLines[i] });
    }
    return result;
  }
  // LCS DP
  const dp: Uint16Array = new Uint16Array((N + 1) * (M + 1));
  const indexOf = (i: number, j: number) => i * (M + 1) + j;
  for (let i = 1; i <= N; i++) {
    for (let j = 1; j <= M; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[indexOf(i, j)] = dp[indexOf(i - 1, j - 1)] + 1;
      } else {
        const a = dp[indexOf(i - 1, j)];
        const b = dp[indexOf(i, j - 1)];
        dp[indexOf(i, j)] = a >= b ? a : b;
      }
    }
  }
  const reversed: Array<{ kind: DiffLineKind; oldIdx: number; newIdx: number }> = [];
  let i = N, j = M;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      reversed.push({ kind: 'equal', oldIdx: i, newIdx: j });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[indexOf(i, j - 1)] >= dp[indexOf(i - 1, j)])) {
      reversed.push({ kind: 'insert', oldIdx: 0, newIdx: j });
      j--;
    } else {
      reversed.push({ kind: 'delete', oldIdx: i, newIdx: 0 });
      i--;
    }
  }
  // 输出顺序按“新版本顺序”走：equal / insert 出现在新版本中；delete 紧随其后（diff gutter 风格）。
  // 这样在“单文件视图”里用户能直接看到：删掉的红行 + 它被替换成的绿行。
  const out: DiffLine[] = [];
  const language = detectLanguage('_.js'); // 下方由调用方覆写 tokens/raw
  for (let k = reversed.length - 1; k >= 0; k--) {
    const step = reversed[k];
    if (step.kind === 'equal') {
      out.push({
        kind: 'equal',
        newLineNo: step.newIdx,
        oldLineNo: step.oldIdx,
        tokens: [{ text: newLines[step.newIdx - 1], kind: 'plain' }],
        raw: newLines[step.newIdx - 1],
      });
    } else if (step.kind === 'insert') {
      out.push({
        kind: 'insert',
        newLineNo: step.newIdx,
        oldLineNo: null,
        tokens: [{ text: newLines[step.newIdx - 1], kind: 'plain' }],
        raw: newLines[step.newIdx - 1],
      });
    } else {
      out.push({
        kind: 'delete',
        newLineNo: null,
        oldLineNo: step.oldIdx,
        tokens: [{ text: oldLines[step.oldIdx - 1], kind: 'plain' }],
        raw: oldLines[step.oldIdx - 1],
      });
    }
    void language;
  }
  return out;
}

/**
 * Attach syntax-highlighted tokens to each diff line.
 */
export function highlightDiff(diff: DiffLine[], language: ReturnType<typeof detectLanguage>): DiffLine[] {
  return diff.map((line): DiffLine => ({
    ...line,
    tokens: highlightLine(line.raw, language) || [{ text: line.raw, kind: 'plain' }],
  }));
}
