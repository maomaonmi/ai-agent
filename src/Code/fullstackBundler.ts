import { bundleVFS, VirtualFileSystem } from './vfsBundler';

export const FULLSTACK_DATABASE_UPDATED = 'code-sandbox-database-updated' as const;

export interface FullstackBundleOptions {
  runId?: string;
}

export function isFullstackVFS(vfs: VirtualFileSystem): boolean {
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
    if (!routeAllowed) return response({ error: 'Route not declared by backend/server.py' }, 404);
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

/** Bundles frontend files and injects an isolated in-memory REST server. */
export function bundleFullstackVFS(
  vfs: VirtualFileSystem,
  options: FullstackBundleOptions = {},
): string {
  const frontendVfs: VirtualFileSystem = {
    'index.html': vfs['frontend/index.html'] || vfs['index.html'] || '',
    'styles.css': vfs['frontend/styles.css'] || vfs['styles.css'] || '',
    'app.js': vfs['frontend/app.js'] || vfs['app.js'] || vfs['main.js'] || '',
  };
  const html = bundleVFS(frontendVfs, { injectInspector: false });
  return injectIntoHead(
    html,
    buildMockRestBridge(
      vfs['backend/database.json'] || '{}',
      vfs['backend/server.py'] || '',
      options.runId || 'fullstack-preview',
    ),
  );
}
