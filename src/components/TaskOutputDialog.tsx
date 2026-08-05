'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import MarkdownMessage from './MarkdownMessage';

interface TaskOutputDialogProps {
  title: string;
  content: string;
  onClose: () => void;
}

export default function TaskOutputDialog({
  title,
  content,
  onClose,
}: TaskOutputDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-output-dialog-title"
        className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="text-xs font-medium text-sky-700">任务完整产出</p>
            <h2
              id="task-output-dialog-title"
              className="mt-1 truncate text-base font-semibold text-slate-900 sm:text-lg"
            >
              {title}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="关闭任务产出弹窗"
            className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-slate-200 text-xl text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            ×
          </button>
        </header>

        <div className="overflow-y-auto px-4 py-5 sm:px-8 sm:py-6">
          <MarkdownMessage
            className="text-sm leading-7 text-slate-800 sm:text-base"
            content={content}
          />
        </div>
      </section>
    </div>,
    document.body,
  );
}
