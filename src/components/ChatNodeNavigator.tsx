'use client';

import { useEffect, useState } from 'react';

export interface ChatNode {
  id: string;
  preview: string;
}

interface ChatNodeNavigatorProps {
  nodes: ChatNode[];
  isSidebarOpen?: boolean;
}

function getClosestNode(nodes: ChatNode[]) {
  const readingLine = window.innerHeight * 0.35;
  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;

  nodes.forEach((node, index) => {
    const element = document.getElementById(node.id);
    if (!element) return;
    const distance = Math.abs(element.getBoundingClientRect().top - readingLine);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });

  return closestIndex;
}

export default function ChatNodeNavigator({
  nodes,
  isSidebarOpen = false,
}: ChatNodeNavigatorProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (nodes.length === 0) return;

    let animationFrame = 0;
    const updateActiveNode = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        setActiveIndex(getClosestNode(nodes));
      });
    };

    updateActiveNode();
    window.addEventListener('scroll', updateActiveNode, { passive: true });
    window.addEventListener('resize', updateActiveNode);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('scroll', updateActiveNode);
      window.removeEventListener('resize', updateActiveNode);
    };
  }, [nodes]);

  if (nodes.length === 0) return null;

  const jumpToNode = (node: ChatNode, index: number) => {
    setActiveIndex(index);
    document.getElementById(node.id)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  };

  return (
    <nav
      aria-label="当前会话节点"
      className={`fixed top-1/2 z-30 hidden max-h-[55vh] -translate-y-1/2 transition-[right] duration-300 md:block ${
        isSidebarOpen ? 'right-3 lg:right-[25rem]' : 'right-3'
      }`}
    >
      <ol className="relative flex max-h-[55vh] flex-col gap-3 overflow-y-auto border-l-2 border-slate-300 py-2 pl-0.5 pr-2">
        {nodes.map((node, index) => {
          const isActive = index === activeIndex;
          const preview = node.preview.replace(/\s+/g, ' ').trim();

          return (
            <li key={node.id} className="group relative flex items-center">
              <button
                type="button"
                aria-current={isActive ? 'location' : undefined}
                aria-label={`跳转到第 ${index + 1} 个聊天节点：${preview}`}
                onClick={() => jumpToNode(node, index)}
                className={`-ml-2 block rounded-full border-2 border-slate-50 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                  isActive
                    ? 'h-5 w-3 bg-blue-500'
                    : 'h-4 w-2.5 bg-slate-400 hover:h-5 hover:bg-slate-600'
                }`}
              />

              <div
                role="tooltip"
                className="pointer-events-none absolute right-5 top-1/2 w-64 -translate-y-1/2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
              >
                <p className="mb-1 text-xs font-semibold text-slate-500">
                  对话节点 {index + 1}
                </p>
                <p className="line-clamp-3 leading-5">
                  {preview || '空白消息'}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
