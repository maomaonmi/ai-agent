import JSZip from 'jszip';

import { buildInspectorScript } from './inspectorScript';

/** A project stored entirely in the browser until the user exports or archives it. */
export type VirtualFileSystem = Record<string, string>;

export interface BundleVFSOptions {
  /** Used to associate inspector/console events with the current sandbox preview. */
  runId?: string;
  /** Set to false for an export that should not contain the editor bridge. */
  injectInspector?: boolean;
}

const FALLBACK_INDEX_HTML = '<!doctype html><html><head></head><body><div id="app"></div></body></html>';
const STYLESHEET_LINK = /<link\b(?=[^>]*\brel\s*=\s*["']?stylesheet["']?)(?=[^>]*\bhref\s*=\s*["']([^"']+)["'])[^>]*>/gi;
const SCRIPT_SOURCE = /<script\b(?=[^>]*\bsrc\s*=\s*["']([^"']+)["'])[^>]*>\s*<\/script\s*>/gi;

function localPath(reference: string): string | null {
  const cleanPath = reference.split(/[?#]/, 1)[0].replace(/^\.\//, '');
  if (!cleanPath || /^(?:https?:|\/\/|data:|#)/i.test(cleanPath)) return null;
  return cleanPath;
}

function injectBeforeClosingTag(html: string, tagName: 'head' | 'body', content: string): string {
  const closingTag = new RegExp(`</${tagName}\\s*>`, 'i');
  if (closingTag.test(html)) return html.replace(closingTag, `${content}\n</${tagName}>`);

  const openingTag = new RegExp(`<${tagName}(?:\\s[^>]*)?>`, 'i');
  if (openingTag.test(html)) return html.replace(openingTag, (tag) => `${tag}\n${content}`);

  if (tagName === 'head') {
    const htmlTag = /<html(?:\s[^>]*)?>/i;
    if (htmlTag.test(html)) return html.replace(htmlTag, (tag) => `${tag}\n<head>${content}</head>`);
    return `<head>${content}</head>\n${html}`;
  }

  const htmlClosingTag = /<\/html\s*>/i;
  if (htmlClosingTag.test(html)) return html.replace(htmlClosingTag, `<body>${content}</body>\n</html>`);
  return `${html}\n<body>${content}</body>`;
}

function inlineStylesheets(html: string, vfs: VirtualFileSystem): string {
  const inlinedFiles = new Set<string>();
  const withReferencedStyles = html.replace(STYLESHEET_LINK, (tag, href: string) => {
    const filePath = localPath(href);
    if (!filePath || !(filePath in vfs)) return tag;
    inlinedFiles.add(filePath);
    return `<style data-vfs-source="${filePath}">\n${vfs[filePath]}\n</style>`;
  });

  // A conventional VFS may contain styles.css without an explicit <link> yet.
  const fallback = ['styles.css', 'style.css'].find((filePath) => filePath in vfs && !inlinedFiles.has(filePath));
  return fallback
    ? injectBeforeClosingTag(withReferencedStyles, 'head', `<style data-vfs-source="${fallback}">\n${vfs[fallback]}\n</style>`)
    : withReferencedStyles;
}

function inlineScripts(html: string, vfs: VirtualFileSystem): string {
  const inlinedFiles = new Set<string>();
  const withReferencedScripts = html.replace(SCRIPT_SOURCE, (tag, src: string) => {
    const filePath = localPath(src);
    if (!filePath || !(filePath in vfs)) return tag;
    inlinedFiles.add(filePath);
    // Prevent a literal closing tag inside a JavaScript string from ending the injected script.
    const code = vfs[filePath].replace(/<\/script/gi, '<\\/script');
    return `<script data-vfs-source="${filePath}">\n${code}\n</script>`;
  });

  const fallback = ['main.js', 'app.js', 'script.js'].find((filePath) => filePath in vfs && !inlinedFiles.has(filePath));
  if (!fallback) return withReferencedScripts;
  const code = vfs[fallback].replace(/<\/script/gi, '<\\/script');
  return injectBeforeClosingTag(withReferencedScripts, 'body', `<script data-vfs-source="${fallback}">\n${code}\n</script>`);
}

/**
 * Converts legacy single-file output into the smallest conventional VFS.
 * External `<link>` and `<script src>` tags stay in index.html. Inline styles
 * and executable inline scripts move to styles.css and main.js respectively.
 */
export function splitHtmlToVFS(html: string): VirtualFileSystem {
  const styleBlocks: string[] = [];
  const scriptBlocks: string[] = [];
  let usesStylesheet = false;
  let usesMainScript = false;

  let indexHtml = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_tag, css: string) => {
    styleBlocks.push(css.trim());
    if (usesStylesheet) return '';
    usesStylesheet = true;
    return '<link rel="stylesheet" href="styles.css">';
  });

  indexHtml = indexHtml.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (tag, attributes: string, js: string) => {
    if (/\bsrc\s*=/i.test(attributes)) return tag;
    if (!js.trim()) return '';
    scriptBlocks.push(js.trim());
    if (usesMainScript) return '';
    usesMainScript = true;
    const typeAttribute = attributes.match(/\btype\s*=\s*(["'][^"']+["'])/i)?.[0];
    return `<script${typeAttribute ? ` ${typeAttribute}` : ''} src="main.js"></script>`;
  });

  const vfs: VirtualFileSystem = { 'index.html': indexHtml || FALLBACK_INDEX_HTML };
  if (styleBlocks.length > 0) vfs['styles.css'] = styleBlocks.join('\n\n');
  if (scriptBlocks.length > 0) vfs['main.js'] = scriptBlocks.join('\n\n');
  return vfs;
}

/**
 * Builds a self-contained iframe document from a multi-file browser VFS.
 * Local stylesheet and script references are inlined; remote URLs are deliberately retained.
 */
export function bundleVFS(vfs: VirtualFileSystem, options: BundleVFSOptions = {}): string {
  let html = vfs['index.html'] || FALLBACK_INDEX_HTML;
  html = inlineStylesheets(html, vfs);
  html = inlineScripts(html, vfs);

  if (options.injectInspector !== false) {
    html = injectBeforeClosingTag(html, 'head', buildInspectorScript(options.runId ?? 'vfs-preview'));
  }
  return html;
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Exports a previewable, self-contained HTML file. */
export function exportSingleFile(filename: string, content: string): void {
  downloadBlob(filename, new Blob([content], { type: 'text/html;charset=utf-8' }));
}

/** Packages the original project structure, rather than the bundled iframe document. */
export async function exportVFSAsZip(vfs: VirtualFileSystem, filename = 'my-project.zip'): Promise<void> {
  const zip = new JSZip();
  Object.entries(vfs).forEach(([path, content]) => zip.file(path, content));
  const archive = await zip.generateAsync({ type: 'blob' });
  downloadBlob(filename.endsWith('.zip') ? filename : `${filename}.zip`, archive);
}
