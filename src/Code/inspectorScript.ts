export const SANDBOX_DOM_SELECTED = 'code-sandbox-dom-selected' as const;
export const SANDBOX_CONSOLE_EVENT = 'code-sandbox-console' as const;
export const SANDBOX_SET_INSPECT_MODE = 'code-sandbox-set-inspect-mode' as const;

export function buildInspectorScript(runId: string): string {
  const safeRunId = JSON.stringify(runId);
  return `<script>
(function () {
  var runId = ${safeRunId};
  var inspectMode = false;
  var overlay = null;
  var originalCursor = '';
  var maxText = 4000;
  var post = function (type, payload) {
    window.parent.postMessage(Object.assign({ type: type, runId: runId }, payload), '*');
  };
  var stringify = function (value) {
    if (typeof value === 'string') return value.slice(0, 1000);
    if (value instanceof Error) {
      return (value.name + ': ' + value.message + (value.stack ? '\\n' + value.stack : '')).slice(0, 1000);
    }
    try { return JSON.stringify(value).slice(0, 1000); } catch (_) { return String(value).slice(0, 1000); }
  };
  ['log', 'info', 'warn', 'error'].forEach(function (level) {
    var original = console[level];
    console[level] = function () {
      var args = Array.prototype.slice.call(arguments).map(stringify).slice(0, 10);
      post('${SANDBOX_CONSOLE_EVENT}', { level: level, args: args });
      return original.apply(console, arguments);
    };
  });
  window.addEventListener('error', function (event) {
    post('${SANDBOX_CONSOLE_EVENT}', {
      level: 'error',
      args: [('Runtime Error: ' + String(event.message || 'Unknown error')).slice(0, 1000)]
    });
  });
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (event.source !== window.parent || !data || data.type !== '${SANDBOX_SET_INSPECT_MODE}' || data.runId !== runId) return;
    inspectMode = Boolean(data.enabled);
    if (inspectMode) {
      originalCursor = document.body.style.cursor;
      document.body.style.cursor = 'crosshair';
    } else {
      document.body.style.cursor = originalCursor;
      if (overlay) overlay.style.display = 'none';
    }
  });
  var ensureOverlay = function () {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #2563eb;background:rgba(37,99,235,.12);z-index:2147483647;transition:all .04s ease;';
    document.body.appendChild(overlay);
    return overlay;
  };
  var escapeCss = function (value) {
    if (window.CSS && window.CSS.escape) return window.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
  };
  var selectorFor = function (element) {
    var tag = element.tagName.toLowerCase();
    if (element.id) return tag + '#' + escapeCss(element.id);
    var classes = typeof element.className === 'string'
      ? element.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2)
      : [];
    var candidate = tag + classes.map(function (className) { return '.' + escapeCss(className); }).join('');
    try {
      if (document.querySelectorAll(candidate).length === 1) return candidate;
    } catch (_) {}
    var path = [];
    var current = element;
    while (current && current !== document.body && path.length < 5) {
      var currentTag = current.tagName.toLowerCase();
      if (current.id) {
        path.unshift(currentTag + '#' + escapeCss(current.id));
        break;
      }
      var siblings = current.parentElement
        ? Array.prototype.filter.call(current.parentElement.children, function (child) {
            return child.tagName === current.tagName;
          })
        : [];
      var segment = currentTag;
      if (siblings.length > 1) segment += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
      path.unshift(segment);
      candidate = path.join(' > ');
      try {
        if (document.querySelectorAll(candidate).length === 1) return candidate;
      } catch (_) {}
      current = current.parentElement;
    }
    return path.join(' > ') || tag;
  };
  document.addEventListener('mousemove', function (event) {
    if (!inspectMode) return;
    var target = event.target;
    if (!(target instanceof Element) || target === document.body || target === document.documentElement || target === overlay) return;
    var rect = target.getBoundingClientRect();
    var nextOverlay = ensureOverlay();
    nextOverlay.style.display = 'block';
    nextOverlay.style.top = rect.top + 'px';
    nextOverlay.style.left = rect.left + 'px';
    nextOverlay.style.width = rect.width + 'px';
    nextOverlay.style.height = rect.height + 'px';
  }, true);
  document.addEventListener('click', function (event) {
    if (!inspectMode) return;
    var target = event.target;
    if (!(target instanceof Element) || target === overlay) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    post('${SANDBOX_DOM_SELECTED}', {
      selector: selectorFor(target).slice(0, 500),
      tagName: target.tagName.toLowerCase(),
      className: typeof target.className === 'string' ? target.className.slice(0, 500) : '',
      id: (target.id || '').slice(0, 200),
      outerHTML: target.outerHTML.slice(0, maxText)
    });
    inspectMode = false;
    document.body.style.cursor = originalCursor;
    if (overlay) overlay.style.display = 'none';
  }, true);
})();
</script>`;
}
