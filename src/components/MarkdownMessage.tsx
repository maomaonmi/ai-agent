import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

type MarkdownMessageProps = {
  content: string;
  className?: string;
  density?: 'normal' | 'compact';
};

function normalizeMathDelimiters(content: string) {
  return content
    .replace(/\\\[([\s\S]*?)\\\]/g, '$$$$\n$1\n$$$$')
    .replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$');
}

export default function MarkdownMessage({ content, className = '', density = 'normal' }: MarkdownMessageProps) {
  const compact = density === 'compact';
  return (
    <div className={`markdown-message whitespace-pre-wrap ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          p: ({ children }) => <p className={compact ? 'mb-2 leading-6 last:mb-0' : 'mb-3 last:mb-0'}>{children}</p>,
          ul: ({ children }) => <ul className={compact ? 'mb-2 list-disc space-y-0.5 pl-5 last:mb-0' : 'mb-3 list-disc space-y-1 pl-5 last:mb-0'}>{children}</ul>,
          ol: ({ children }) => <ol className={compact ? 'mb-2 list-decimal space-y-0.5 pl-5 last:mb-0' : 'mb-3 list-decimal space-y-1 pl-5 last:mb-0'}>{children}</ol>,
          h1: ({ children }) => <h1 className={compact ? 'mb-2 text-xl font-bold leading-7' : 'mb-3 text-xl font-bold'}>{children}</h1>,
          h2: ({ children }) => <h2 className={compact ? 'mb-2 text-lg font-bold leading-7' : 'mb-3 text-lg font-bold'}>{children}</h2>,
          h3: ({ children }) => <h3 className={compact ? 'mb-1.5 font-semibold leading-6' : 'mb-2 font-semibold'}>{children}</h3>,
          table: ({ children }) => (
            <div className="mb-4 w-full overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[560px] border-collapse text-left text-sm">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-slate-100 text-slate-700">{children}</thead>
          ),
          tbody: ({ children }) => (
            <tbody className="divide-y divide-slate-200 bg-white">{children}</tbody>
          ),
          th: ({ children }) => (
            <th className="border-r border-slate-200 px-3 py-2 font-semibold last:border-r-0">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className={`border-r border-slate-100 px-3 py-2 align-top ${compact ? 'leading-5' : 'leading-6'} last:border-r-0`}>
              {children}
            </td>
          ),
          tr: ({ children }) => (
            <tr className="transition-colors hover:bg-slate-50">{children}</tr>
          ),
        }}
      >
        {normalizeMathDelimiters(content)}
      </ReactMarkdown>
    </div>
  );
}
