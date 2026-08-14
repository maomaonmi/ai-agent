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

export default function ChatNodeNavigator({ nodes, isSidebarOpen = false }: ChatNodeNavigatorProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [tooltipTop, setTooltipTop] = useState(0);

  useEffect(() => {
    if (nodes.length === 0) return;
    let animationFrame = 0;
    const updateActiveNode = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => setActiveIndex(getClosestNode(nodes)));
    };
    updateActiveNode();
    window.addEventListener('scroll', updateActiveNode, { passive: true, capture: true });
    window.addEventListener('resize', updateActiveNode);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('scroll', updateActiveNode, true);
      window.removeEventListener('resize', updateActiveNode);
    };
  }, [nodes]);

  if (nodes.length === 0) return null;

  const jumpToNode = (node: ChatNode, index: number) => {
    setActiveIndex(index);
    document.getElementById(node.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const showTooltip = (index: number, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    // Anchor the preview center to the marker center; clamp only near viewport edges.
    setTooltipTop(Math.max(96, Math.min(window.innerHeight - 96, rect.top + rect.height / 2)));
    setHoveredIndex(index);
  };

  const hoveredNode = hoveredIndex === null ? null : nodes[hoveredIndex];
  const hoveredPreview = hoveredNode?.preview.replace(/\s+/g, ' ').trim() ?? '';

  return (
    <nav
      aria-label="当前会话节点"
      className={`fixed top-[14vh] z-40 hidden h-[72vh] w-14 transition-[right] duration-300 md:block ${
        isSidebarOpen ? 'right-3 lg:right-[25rem]' : 'right-3'
      }`}
    >
      <div className="relative h-full w-full">
        <div aria-hidden="true" className="absolute bottom-2 right-3 top-2 w-px bg-slate-300" />
        <ol className="relative h-full w-full">
          {nodes.map((node, index) => {
            const isActive = index === activeIndex;
            const position = ((index + 0.5) / nodes.length) * 100;
            return (
              <li
                key={node.id}
                className="absolute right-0 flex h-6 -translate-y-1/2 items-center justify-end"
                style={{ top: `${position}%` }}
              >
                <button
                  type="button"
                  aria-current={isActive ? 'location' : undefined}
                  aria-label={`Jump to chat node ${index + 1}`}
                  onClick={() => jumpToNode(node, index)}
                  onMouseEnter={(event) => showTooltip(index, event.currentTarget)}
                  onFocus={(event) => showTooltip(index, event.currentTarget)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  onBlur={() => setHoveredIndex(null)}
                  className={`relative z-10 rounded-l-full border-y-2 border-l-2 border-r-0 border-white transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 ${
                    isActive
                      ? 'h-5 w-7 bg-blue-500 shadow-sm'
                      : 'h-3 w-3 bg-slate-400 hover:h-4 hover:w-6 hover:bg-slate-600'
                  }`}
                />
              </li>
            );
          })}
        </ol>
      </div>

      {hoveredNode && hoveredIndex !== null && (
        <div
          role="tooltip"
          onMouseEnter={() => setHoveredIndex(hoveredIndex)}
          onMouseLeave={() => setHoveredIndex(null)}
          className="pointer-events-auto fixed right-16 w-[30rem] max-w-[calc(100vw-6rem)] rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left text-sm text-slate-800 shadow-2xl shadow-slate-900/15"
          style={{
            top: tooltipTop,
            transform: 'translateY(-50%)',
          }}
        >
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-slate-500">
            <span className="h-2 w-2 rounded-full bg-blue-500" />
            <span>聊天节点 {hoveredIndex + 1}</span>
          </div>
          <p className="line-clamp-5 leading-5 text-slate-700">
            {hoveredPreview || '空白消息'}
          </p>
        </div>
      )}
    </nav>
  );
}
