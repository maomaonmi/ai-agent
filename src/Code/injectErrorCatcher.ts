/**
 * 在模型生成的代码写入 iframe.srcdoc 之前，往里面插入一段监听脚本。
 *
 * 这段脚本做两件事：
 * 1. 用 window.onerror 捕获运行时报错（比如访问 undefined 的属性）
 * 2. 用 unhandledrejection 捕获没有 catch 的 Promise 异常
 *
 * 捕获到之后，通过 window.parent.postMessage 把错误信息传给父页面 ——
 * 因为 iframe 和父页面是两个独立的 JS 上下文，postMessage 是它们之间
 * 唯一安全的通信方式（sandbox 属性限制了 iframe 访问父页面 DOM）。
 */
export function injectErrorCatcher(html: string): string {
  const script = `
<script>
(function () {
  function report(payload) {
    window.parent.postMessage(
      Object.assign({ type: 'sandbox-error' }, payload),
      '*'
    );
  }

  window.onerror = function (message, _source, lineno) {
    report({ message: String(message), lineno: lineno });
    return true; // 返回 true 阻止浏览器默认的报错弹窗/控制台刷屏
  };

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    report({
      message: 'Unhandled Promise rejection: ' + (reason && reason.message ? reason.message : reason),
    });
  });
})();
</script>`

  // 优先插在 </body> 之前，保证监听脚本在页面主体内容之后执行
  if (html.includes('</body>')) {
    return html.replace('</body>', `${script}\n</body>`)
  }

  // 兜底：如果模型输出的代码漏写了 </body>（偶尔会发生），直接追加到末尾
  return html + script
}
