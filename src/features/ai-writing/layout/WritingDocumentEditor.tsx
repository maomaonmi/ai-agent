'use client';

import { Bold, Heading2, Italic, List, Redo2, Underline as UnderlineIcon, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import type { WritingSection } from '../writingDocumentTypes';

type Props = { title: string; sections: WritingSection[]; onSectionsChange?: (sections: WritingSection[]) => void };

function sectionDocument(title: string, sections: WritingSection[]) {
  return `<h1>${escapeHtml(title || '未命名论文')}</h1>${sections.map((section) => `${section.level === 1 ? '<h2>' : '<h3>'}${escapeHtml(section.title)}${section.level === 1 ? '</h2>' : '</h3>'}<p>${escapeHtml(section.content || '在这里继续编辑本章节内容。').replace(/\n/g, '<br />')}</p>`).join('')}`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

function readSections(html: string, original: WritingSection[]) {
  const root = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').body.firstElementChild;
  if (!root) return original;
  const next = original.map((section) => ({ ...section }));
  let active: WritingSection | undefined;
  root.querySelectorAll('h2,h3,p').forEach((node) => {
    if (node.tagName === 'H2' || node.tagName === 'H3') {
      const title = node.textContent?.trim() || '未命名章节';
      active = next.find((section) => section.title === title) ?? next.find((section) => section.level === (node.tagName === 'H2' ? 1 : 2));
      if (active) { active.title = title; active.level = node.tagName === 'H2' ? 1 : 2; }
    } else if (active) {
      active.content = (node.textContent || '').trim();
      active.status = active.content ? 'complete' : active.status;
    }
  });
  return next;
}

export default function WritingDocumentEditor({ title, sections, onSectionsChange }: Props) {
  const initialContent = useMemo(() => sectionDocument(title, sections), [title, sections]);
  const sectionsRef = useRef(sections);
  const internalUpdateRef = useRef(false);
  sectionsRef.current = sections;
  const editor = useEditor({ immediatelyRender: false, extensions: [StarterKit, Underline], content: initialContent, editorProps: { attributes: { class: 'writing-editor-content' } }, onUpdate: ({ editor: current }) => { internalUpdateRef.current = true; onSectionsChange?.(readSections(current.getHTML(), sectionsRef.current)); } });

  useEffect(() => {
    if (!editor) return;
    if (internalUpdateRef.current) {
      internalUpdateRef.current = false;
      return;
    }
    if (editor.getHTML() !== initialContent) editor.commands.setContent(initialContent, { emitUpdate: false });
  }, [editor, initialContent]);

  if (!editor) return <div className="h-96 animate-pulse bg-slate-50" aria-busy="true" />;

  return <div className="writing-page-canvas min-h-[980px] bg-white px-16 py-14 text-slate-900">
    <div className="writing-editor-toolbar sticky top-0 z-10 mb-8 flex flex-wrap items-center gap-1 border-b border-slate-200 bg-white/95 pb-3" role="toolbar" aria-label="文档编辑工具栏">
      <button type="button" aria-label="撤销" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} className="rounded-md p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-30"><Undo2 size={17} /></button>
      <button type="button" aria-label="重做" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} className="rounded-md p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-30"><Redo2 size={17} /></button>
      <span className="mx-2 h-5 w-px bg-slate-200" />
      <button type="button" aria-label="标题" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={`rounded-md p-2 ${editor.isActive('heading', { level: 2 }) ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><Heading2 size={17} /></button>
      <button type="button" aria-label="粗体" onClick={() => editor.chain().focus().toggleBold().run()} className={`rounded-md p-2 ${editor.isActive('bold') ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><Bold size={17} /></button>
      <button type="button" aria-label="斜体" onClick={() => editor.chain().focus().toggleItalic().run()} className={`rounded-md p-2 ${editor.isActive('italic') ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><Italic size={17} /></button>
      <button type="button" aria-label="下划线" onClick={() => editor.chain().focus().toggleUnderline().run()} className={`rounded-md p-2 ${editor.isActive('underline') ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><UnderlineIcon size={17} /></button>
      <button type="button" aria-label="项目列表" onClick={() => editor.chain().focus().toggleBulletList().run()} className={`rounded-md p-2 ${editor.isActive('bulletList') ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><List size={17} /></button>
      <span className="ml-auto text-xs text-slate-400">自动保存</span>
    </div>
    <EditorContent editor={editor} />
  </div>;
}
