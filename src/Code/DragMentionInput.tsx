import React, { useState, useRef, DragEvent } from 'react';
import { Folder, FileCode, X, Sparkles, RefreshCw, Layers } from 'lucide-react';

interface DragMentionInputProps {
  vfsPaths: string[]; // 所有文件与文件夹路径清单
  onSend: (instruction: string, mentionedPaths: string[]) => void;
  isModifying: boolean;
}

export const DragMentionInput: React.FC<DragMentionInputProps> = ({
  vfsPaths,
  onSend,
  isModifying,
}) => {
  const [text, setText] = useState<string>('');
  const [mentionedPaths, setMentionedPaths] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  // @ 补全下拉逻辑
  const [showDropdown, setShowDropdown] = useState<boolean>(false);
  const [filterText, setFilterText] = useState<string>('');
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  const filteredPaths = vfsPaths.filter(
    (p) => p.toLowerCase().includes(filterText.toLowerCase()) && !mentionedPaths.includes(p)
  );

  // 【核心 2】：拖拽目标释放处理 (Drop Handler)
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);

    const path = e.dataTransfer.getData('text/plain');
    if (path && !mentionedPaths.includes(path)) {
      setMentionedPaths([...mentionedPaths, path]);
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const pos = e.target.selectionStart;
    setText(val);

    const lastAt = val.lastIndexOf('@', pos - 1);
    if (lastAt !== -1) {
      const query = val.slice(lastAt + 1, pos);
      if (!/\s/.test(query)) {
        setFilterText(query);
        setShowDropdown(true);
        setSelectedIndex(0);
        return;
      }
    }
    setShowDropdown(false);
  };

  const selectPath = (path: string) => {
    if (!mentionedPaths.includes(path)) {
      setMentionedPaths([...mentionedPaths, path]);
    }
    setShowDropdown(false);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      className={`relative p-3 bg-slate-900 border-t transition-colors space-y-2 ${
        isDragOver ? 'border-emerald-500 bg-emerald-950/20 ring-2 ring-emerald-500/40' : 'border-slate-800'
      }`}
    >
      {/* 拖拽悬浮提示 */}
      {isDragOver && (
        <div className="absolute inset-0 bg-emerald-950/80 backdrop-blur-sm z-50 flex items-center justify-center text-emerald-300 font-semibold text-xs gap-2 border-2 border-dashed border-emerald-400 rounded-xl">
          <Layers className="w-5 h-5 animate-bounce" />
          松开鼠标，将路径放入聚焦上下文
        </div>
      )}

      {/* 已挂载的 文件/文件夹 Badge 徽章 */}
      {mentionedPaths.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-slate-500 font-medium">聚焦范围:</span>
          {mentionedPaths.map((p) => {
            const isFolder = p.endsWith('/') || !p.includes('.');
            return (
              <div
                key={p}
                className="flex items-center gap-1 px-2 py-0.5 bg-emerald-950/60 border border-emerald-500/40 rounded-md text-xs font-mono text-emerald-300"
              >
                {isFolder ? <Folder className="w-3 h-3 text-amber-400" /> : <FileCode className="w-3 h-3 text-emerald-400" />}
                <span>{p}</span>
                <button
                  onClick={() => setMentionedPaths(mentionedPaths.filter((x) => x !== p))}
                  className="hover:text-emerald-100 p-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* @ 补全与 Textarea */}
      <div className="relative">
        {showDropdown && filteredPaths.length > 0 && (
          <div className="absolute bottom-full left-0 mb-2 w-80 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden z-50">
            <div className="p-2 border-b border-slate-800 text-[11px] text-slate-400 font-semibold">
              支持提及文件或文件夹 (@file / @folder)
            </div>
            <div className="max-h-48 overflow-y-auto p-1 space-y-0.5 font-mono text-xs">
              {filteredPaths.map((p, idx) => {
                const isFolder = p.endsWith('/') || !p.includes('.');
                return (
                  <div
                    key={p}
                    onClick={() => selectPath(p)}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer ${
                      idx === selectedIndex ? 'bg-emerald-500/20 text-emerald-300 font-semibold' : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {isFolder ? <Folder className="w-3.5 h-3.5 text-amber-400" /> : <FileCode className="w-3.5 h-3.5 text-slate-400" />}
                    <span className="truncate">{p}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            rows={2}
            value={text}
            onChange={handleTextChange}
            placeholder="输入修改需求... (可直接从左侧文件树拖拽文件或文件夹到这里！)"
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
          />
          <button
            onClick={() => { onSend(text, mentionedPaths); setText(''); setMentionedPaths([]); }}
            disabled={isModifying || !text.trim()}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-medium"
          >
            {isModifying ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            应用修改
          </button>
        </div>
      </div>
    </div>
  );
};