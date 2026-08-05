import './globals.css';
import 'katex/dist/katex.min.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '全能型智能助手',
  description: '支持标准对话 / 深度思考 / 联网搜索 / 深度调研',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{__html: `(function(){try{var a=JSON.parse(localStorage.getItem('appearance-settings')||'{}');var t=a.theme||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.dataset.theme=t;document.documentElement.dataset.font=a.font||'system'}catch(e){}})()`}} /></head>
      <body>{children}</body>
    </html>
  );
}
