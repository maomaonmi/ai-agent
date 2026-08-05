interface CodeSandboxProps {
  code: string
}

/**
 * 整个"实时预览"功能的核心就在这一个组件里。
 *
 * 原理：iframe 的 srcdoc 属性接收一段完整 HTML 字符串，
 * 浏览器会把它当成独立网页解析渲染 —— 和访问一个真实网址效果一样。
 * 每次 code 变化，React 重新渲染，srcdoc 被赋新值，iframe 自动刷新内容。
 *
 * sandbox="allow-scripts" 允许生成的代码执行 JS，
 * 但禁止它访问父页面 DOM、发起跳转等，是安全隔离的关键。
 */
export function CodeSandbox({ code }: CodeSandboxProps) {
  return (
    <iframe
      title="code-preview-sandbox"
      srcDoc={code}
      sandbox="allow-scripts"
      style={{
        width: '100%',
        height: '100%',
        border: 'none',
        background: '#ffffff',
      }}
    />
  )
}
