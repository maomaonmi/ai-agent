import { bundleVFS } from './vfsBundler.ts';
import type { VirtualFileSystem } from './vfsBundler.ts';

export const FULLSTACK_DATABASE_UPDATED = 'code-sandbox-database-updated' as const;
export const PROJECT_MANIFEST_PATH = 'project.manifest.json' as const;

export interface ProjectManifest {
  schema_version: 1;
  kind: 'static' | 'fullstack';
  frontend: {
    entry: string;
    asset_roots?: string[];
  };
  backend?: {
    entry?: string;
    source_roots?: string[];
  };
  data?: {
    files?: string[];
  };
  preview?: {
    api_mode?: 'mock';
  };
}

export interface FullstackBundleOptions {
  runId?: string;
}

function parseProjectManifest(source: string): ProjectManifest | null {
  try {
    const candidate = JSON.parse(source) as unknown;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const raw = candidate as Record<string, unknown>;
    const frontend = raw.frontend;
    if (
      raw.schema_version !== 1
      || (raw.kind !== 'static' && raw.kind !== 'fullstack')
      || !frontend
      || typeof frontend !== 'object'
      || Array.isArray(frontend)
      || typeof (frontend as Record<string, unknown>).entry !== 'string'
      || !String((frontend as Record<string, unknown>).entry).trim()
    ) return null;
    const frontendRaw = frontend as Record<string, unknown>;
    const isSafePath = (value: string): boolean => {
      const normalized = value.replaceAll('\\', '/');
      return Boolean(normalized)
        && !normalized.startsWith('/')
        && !normalized.split('/').some((part) => !part || part === '.' || part === '..');
    };
    if (!isSafePath(String(frontendRaw.entry))) return null;
    const isStringArray = (value: unknown): value is string[] =>
      value == null || (Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim()));
    if (!isStringArray(frontendRaw.asset_roots)) return null;
    const assetRoots: string[] = frontendRaw.asset_roots == null ? [] : frontendRaw.asset_roots as string[];
    if (assetRoots.some((path) => !isSafePath(path))) return null;

    const backend = raw.backend;
    if (backend != null && (typeof backend !== 'object' || Array.isArray(backend))) return null;
    const backendRaw = backend as Record<string, unknown> | undefined;
    if (backendRaw && backendRaw.entry != null && typeof backendRaw.entry !== 'string') return null;
    if (backendRaw && !isStringArray(backendRaw.source_roots)) return null;
    const backendRoots: string[] = backendRaw?.source_roots == null ? [] : backendRaw.source_roots as string[];
    if ((backendRaw?.entry != null && !isSafePath(backendRaw.entry as string)) || backendRoots.some((path) => !isSafePath(path))) return null;

    const data = raw.data;
    if (data != null && (typeof data !== 'object' || Array.isArray(data))) return null;
    const dataRaw = data as Record<string, unknown> | undefined;
    if (dataRaw && !isStringArray(dataRaw.files)) return null;
    const dataFiles: string[] = dataRaw?.files == null ? [] : dataRaw.files as string[];
    if (dataFiles.some((path) => !isSafePath(path))) return null;
    const preview = raw.preview;
    if (preview != null && (typeof preview !== 'object' || Array.isArray(preview))) return null;
    if (preview && (preview as Record<string, unknown>).api_mode != null && (preview as Record<string, unknown>).api_mode !== 'mock') return null;

    return {
      schema_version: 1,
      kind: raw.kind as 'static' | 'fullstack',
      frontend: { entry: String(frontendRaw.entry), asset_roots: assetRoots },
      ...(backendRaw ? { backend: { entry: backendRaw.entry as string | undefined, source_roots: backendRoots } } : {}),
      ...(dataRaw ? { data: { files: dataFiles } } : {}),
      preview: { api_mode: 'mock' },
    };
  } catch {
    return null;
  }
}

/** Read the project contract without guessing from display names or file counts. */
export function getProjectManifest(vfs: VirtualFileSystem): ProjectManifest | null {
  const source = vfs[PROJECT_MANIFEST_PATH];
  return typeof source === 'string' ? parseProjectManifest(source) : null;
}

export function isManifestProjectVFS(vfs: VirtualFileSystem): boolean {
  return getProjectManifest(vfs) !== null;
}

export function isFullstackVFS(vfs: VirtualFileSystem): boolean {
  const manifest = getProjectManifest(vfs);
  if (manifest?.kind === 'fullstack') {
    const frontendEntry = manifest.frontend.entry;
    const backendEntry = manifest.backend?.entry;
    const backendRoots = manifest.backend?.source_roots ?? [];
    const hasBackendSource = Object.keys(vfs).some((path) =>
      (backendEntry === path || backendRoots.some((root) => path.startsWith(`${root}/`)))
    );
    return Boolean(vfs[frontendEntry] && (backendEntry ? vfs[backendEntry] : hasBackendSource));
  }
  // Legacy projects remain previewable while they are migrated in place.
  return 'frontend/index.html' in vfs && 'backend/database.json' in vfs;
}

export function parseProjectCode(code: string): VirtualFileSystem | null {
  if (!code.trim().startsWith('{')) return null;
  try {
    const candidate = JSON.parse(code) as unknown;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const entries = Object.entries(candidate as Record<string, unknown>);
    // Why: 空对象 `{}` 必须返回空 VFS（而不是 null）。否则调用方会 fallback 到 splitHtmlToVFS，
    // 把字符串 "{}" 当成单文件 HTML 内容，造出 `{index.html: "{}"}`，用户右侧看到 index.html = "{}"。
    if (entries.some(([, content]) => typeof content !== 'string')) return null;
    return Object.fromEntries(entries) as VirtualFileSystem;
  } catch {
    return null;
  }
}

export function serializeProjectVFS(vfs: VirtualFileSystem): string {
  return JSON.stringify(vfs, null, 2);
}

function safeDatabaseLiteral(source: string): string {
  let database: unknown;
  try {
    database = JSON.parse(source || '{}');
  } catch {
    database = {};
  }
  if (!database || typeof database !== 'object' || Array.isArray(database)) database = {};
  return JSON.stringify(database)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function extractDeclaredRoutes(serverSource: string): Array<{ method: string; path: string }> {
  const routes: Array<{ method: string; path: string }> = [];
  const pattern = /@app\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/gi;
  for (const match of serverSource.matchAll(pattern)) {
    routes.push({ method: match[1].toUpperCase(), path: match[2] });
  }
  return routes;
}

function buildMockRestBridge(databaseSource: string, serverSource: string, runId: string): string {
  const database = safeDatabaseLiteral(databaseSource);
  const declaredRoutes = JSON.stringify(extractDeclaredRoutes(serverSource)).replace(/</g, '\\u003c');
  const safeRunId = JSON.stringify(runId);
  return `<script>
(function () {
  'use strict';
  var runId = ${safeRunId};
  var database = ${database};
  var declaredRoutes = ${declaredRoutes};
  var nativeFetch = window.fetch.bind(window);
  var NativeXHR = window.XMLHttpRequest;
  var jsonHeaders = { 'Content-Type': 'application/json' };
  var clone = function (value) { return JSON.parse(JSON.stringify(value)); };
  var response = function (body, status) {
    return new Response(JSON.stringify(body), { status: status, headers: jsonHeaders });
  };
  var parseRoute = function (input) {
    try {
      var rawUrl = typeof input === 'string' ? input : input.url;
      var isRelativeApiUrl = /^\\/?api\\//.test(rawUrl);
      if (!isRelativeApiUrl) return null;
      // about:srcdoc is not a valid URL base. Parse the explicitly allowed
      // relative API path directly instead of calling new URL(rawUrl, location.href).
      var pathname = rawUrl.split(/[?#]/, 1)[0];
      if (pathname.charAt(0) !== '/') pathname = '/' + pathname;
      var match = /^\\/api\\/([A-Za-z0-9_-]+)(?:\\/([A-Za-z0-9_-]+))?\\/?$/.exec(pathname);
      return match ? { resource: match[1], id: match[2] || null, pathname: pathname } : null;
    } catch (_) { return null; }
  };
  var notify = function () {
    window.parent.postMessage({
      type: '${FULLSTACK_DATABASE_UPDATED}',
      runId: runId,
      database: clone(database)
    }, '*');
  };
  var readBody = async function (options) {
    if (!options || options.body == null || options.body === '') return {};
    if (typeof options.body !== 'string') throw new Error('Mock API only accepts JSON string bodies');
    var parsed = JSON.parse(options.body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON body must be an object');
    return parsed;
  };
  var handle = async function (input, options) {
    var route = parseRoute(input);
    if (!route) return null;
    var method = String((options && options.method) || (input && input.method) || 'GET').toUpperCase();
    var routeAllowed = declaredRoutes.length === 0 || declaredRoutes.some(function (item) {
      if (item.method !== method) return false;
      var routePattern = '^' + item.path.replace(/\\{[^/]+\\}/g, '[^/]+') + '/?$';
      return new RegExp(routePattern).test(route.pathname);
    });
    if (!routeAllowed) return response({ error: 'Route not declared by manifest-declared backend source' }, 404);
    var rows = database[route.resource];
    if (!Array.isArray(rows)) return response({ error: 'Resource not found' }, 404);
    var index = route.id == null ? -1 : rows.findIndex(function (item) { return String(item.id) === route.id; });
    if (method === 'GET') {
      if (route.id == null) return response(clone(rows), 200);
      return index >= 0 ? response(clone(rows[index]), 200) : response({ error: 'Record not found' }, 404);
    }
    var body;
    try { body = await readBody(options || {}); }
    catch (_) { return response({ error: 'Invalid JSON body' }, 400); }
    if (method === 'POST' && route.id == null) {
      var nextId = rows.reduce(function (max, item) { return Math.max(max, Number(item.id) || 0); }, 0) + 1;
      var created = Object.assign({}, body, { id: body.id == null ? nextId : body.id });
      rows.push(created); notify(); return response(clone(created), 201);
    }
    if ((method === 'PUT' || method === 'PATCH') && route.id != null) {
      if (index < 0) return response({ error: 'Record not found' }, 404);
      var updated = method === 'PATCH'
        ? Object.assign({}, rows[index], body, { id: rows[index].id })
        : Object.assign({}, body, { id: rows[index].id });
      rows[index] = updated; notify(); return response(clone(updated), 200);
    }
    if (method === 'DELETE' && route.id != null) {
      if (index < 0) return response({ error: 'Record not found' }, 404);
      var removed = rows.splice(index, 1)[0]; notify(); return response(clone(removed), 200);
    }
    return response({ error: 'Method not allowed' }, 405);
  };
  window.fetch = async function (input, options) {
    var mocked = await handle(input, options || {});
    return mocked || nativeFetch(input, options);
  };
  function MockXMLHttpRequest() {
    this.readyState = 0; this.status = 0; this.responseText = ''; this.response = '';
    this.responseType = ''; this.onreadystatechange = null; this.onload = null; this.onerror = null;
    this._headers = {}; this._native = null; this._url = ''; this._method = 'GET';
  }
  MockXMLHttpRequest.prototype.open = function (method, url, async) {
    if (!parseRoute(url)) {
      this._native = new NativeXHR();
      this._native.open(method, url, async !== false);
      return;
    }
    this._method = method; this._url = url; this.readyState = 1;
    if (this.onreadystatechange) this.onreadystatechange();
  };
  MockXMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this._native) this._native.setRequestHeader(name, value); else this._headers[name] = value;
  };
  MockXMLHttpRequest.prototype.send = function (body) {
    var self = this;
    if (self._native) {
      self._native.onreadystatechange = function () {
        self.readyState = self._native.readyState; self.status = self._native.status;
        self.responseText = self._native.responseText; self.response = self._native.response;
        if (self.onreadystatechange) self.onreadystatechange();
        if (self.readyState === 4 && self.onload) self.onload();
      };
      self._native.send(body); return;
    }
    window.fetch(self._url, { method: self._method, headers: self._headers, body: body })
      .then(async function (result) {
        self.status = result.status; self.responseText = await result.text();
        self.response = self.responseType === 'json' ? JSON.parse(self.responseText) : self.responseText;
        self.readyState = 4;
        if (self.onreadystatechange) self.onreadystatechange(); if (self.onload) self.onload();
      })
      .catch(function () { self.readyState = 4; if (self.onerror) self.onerror(); });
  };
  MockXMLHttpRequest.prototype.abort = function () { if (this._native) this._native.abort(); };
  window.XMLHttpRequest = MockXMLHttpRequest;
})();
</script>`;
}

function injectIntoHead(html: string, content: string): string {
  const head = /<head(?:\s[^>]*)?>/i;
  if (head.test(html)) return html.replace(head, (tag) => `${tag}\n${content}`);
  return `${content}\n${html}`;
}

function buildManifestFrontendVFS(
  vfs: VirtualFileSystem,
  manifest: ProjectManifest,
): VirtualFileSystem {
  const entry = manifest.frontend.entry;
  const entryDirectory = entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/')) : '';
  const backendRoots = manifest.backend?.source_roots ?? [];
  const backendEntry = manifest.backend?.entry;
  const dataFiles = new Set(manifest.data?.files ?? []);
  const isBackendPath = (path: string) =>
    path === backendEntry || backendRoots.some((root) => path.startsWith(`${root}/`));
  const toEntryRelativePath = (path: string): string => {
    const from = entryDirectory ? entryDirectory.split('/') : [];
    const target = path.split('/');
    while (from.length > 0 && target.length > 0 && from[0] === target[0]) {
      from.shift(); target.shift();
    }
    return [...from.map(() => '..'), ...target].join('/') || path.split('/').pop() || path;
  };

  const frontendVfs: VirtualFileSystem = { 'index.html': vfs[entry] || '' };
  for (const [path, content] of Object.entries(vfs)) {
    if (path === PROJECT_MANIFEST_PATH || path === entry || dataFiles.has(path) || isBackendPath(path)) continue;
    frontendVfs[toEntryRelativePath(path)] = content;
  }
  return frontendVfs;
}

/** Bundles frontend files and injects an isolated in-memory REST server. */
export function bundleFullstackVFS(
  vfs: VirtualFileSystem,
  options: FullstackBundleOptions = {},
): string {
  const manifest = getProjectManifest(vfs);
  if (!manifest || manifest.kind !== 'fullstack') {
    if (manifest?.kind === 'static') {
      return bundleVFS(buildManifestFrontendVFS(vfs, manifest), { injectInspector: false });
    }
    const legacyFrontendVfs: VirtualFileSystem = {
      'index.html': vfs['frontend/index.html'] || vfs['index.html'] || '',
      'styles.css': vfs['frontend/styles.css'] || vfs['styles.css'] || '',
      'app.js': vfs['frontend/app.js'] || vfs['app.js'] || vfs['main.js'] || '',
    };
    const html = bundleVFS(legacyFrontendVfs, { injectInspector: false });
    return injectIntoHead(
      html,
      buildMockRestBridge(
        vfs['backend/database.json'] || '{}',
        vfs['backend/server.py'] || '',
        options.runId || 'fullstack-preview',
      ),
    );
  }

  const entry = manifest.frontend.entry;
  const backendRoots = manifest.backend?.source_roots ?? [];
  const backendEntry = manifest.backend?.entry;
  const dataFiles = new Set(manifest.data?.files ?? []);
  const isBackendPath = (path: string) =>
    path === backendEntry || backendRoots.some((root) => path.startsWith(`${root}/`));
  const frontendVfs = buildManifestFrontendVFS(vfs, manifest);
  const backendPaths = Object.keys(vfs).filter((path) => isBackendPath(path));
  const backendSource = backendPaths.map((path) => vfs[path]).join('\n\n');
  const database: Record<string, unknown> = {};
  for (const dataPath of manifest.data?.files ?? []) {
    try {
      const parsed = JSON.parse(vfs[dataPath] || '{}') as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        Object.assign(database, parsed);
      }
    } catch {
      // Backend validation reports malformed declared data before preview.
    }
  }
  const databaseSource = JSON.stringify(database);
  const html = bundleVFS(frontendVfs, { injectInspector: false });
  return injectIntoHead(
    html,
    buildMockRestBridge(
      databaseSource,
      backendSource,
      options.runId || 'fullstack-preview',
    ),
  );
}
