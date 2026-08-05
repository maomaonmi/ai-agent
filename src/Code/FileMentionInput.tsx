
import React, { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { FileCode, X, Sparkles, RefreshCw, FileText } from 'lucide-react';

interface FileMentionInputProps {
  vfs: Record<string, string>;
  onSend: (instruction: string, mentionedFiles: string[]) => void;
  isModifying: boolean;
}

export const FileMentionInput: React.FC<FileMentionInputProps> = ({
  vfs,
  onSend,
  isModifying
}) => {
  const [text, setText] = useState<string>('');
  const [mentionedFiles, setMentionedFiles] = useState<string[]>([]);
  
  // @ 补全弹窗状态
  const [showDropdown, setShowDropdown] = useState<boolean>(false);
  const [filterText, setFilterText] = useState<string>('');
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [cursorPos, setCursorPos] = useState<number>(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 获取所有可被 @ 的文件清单
  const allFiles = Object.keys(vfs);
  const filteredFiles = allFiles.filter(
    f => f.toLowerCase().includes(filterText.toLowerCase()) && !mentionedFiles.includes(f)
  );

  // 1. 监听文本框输入，检测 @ 符号
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const pos = e.target.selectionStart;
    setText(val);
    setCursorPos(pos);

    // 提取光标前最近的一个 @ 符号后面的字符串
    const lastAtIdx = val.lastIndexOf('@', pos - 1);
    if (lastAtIdx !== -1) {
      const queryAfterAt = val.slice(lastAtIdx + 1, pos);
      // 如果 @ 和光标之间没有空格或换行，触发下拉
      if (!/\s/.test(queryAfterAt)) {
        setFilterText(queryAfterAt);
        setShowDropdown(true);
        setSelectedIndex(0);
        return;
      }
    }
    setShowDropdown(false);
  };

  // 2. 选择文件并转化为 Badge
  const selectFile = (filePath: string) => {
    if (!mentionedFiles.includes(filePath)) {
      setMentionedFiles([...mentionedFiles, filePath]);
    }
    
    // 移除文本框里的 @xxx 字符
    const lastAtIdx = text.lastIndexOf('@', cursorPos - 1);
    if (lastAtIdx !== -1) {
      const newText = text.slice(0, lastAtIdx) + text.slice(cursorPos);
      setText(newText);
    }

    setShowDropdown(false);
    textareaRef.current?.focus();
  };

  // 3. 键盘方向键与 Enter 快捷选择
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showDropdown && filteredFiles.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredFiles.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredFiles.length) % filteredFiles.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectFile(filteredFiles[selectedIndex]);
        return;
      }
      if (e.key === 'Escape') {
        setShowDropdown(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey && !showDropdown) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // 4. 移除指定文件 Badge
  const removeMentionedFile = (filePath: string) => {
    setMentionedFiles(mentionedFiles.filter(f => f !== filePath));
  };

  // 5. 提交改动
  const handleSubmit = () => {
    if (!text.trim() || isModifying) return;
    onSend(text, mentionedFiles);
    setText('');
    setMentionedFiles([]);
    setShowDropdown(false);
  };

  return (
    <div className="relative p-3 bg-slate-900 border-t border-slate-800 space-y-2">
      
      {/* 被选中的 @file 徽章展示区 */}
      {mentionedFiles.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap animate-fade-in">
          <span className="text-[11px] text-slate-500 font-medium">修改范围:</span>
          {mentionedFiles.map(filePath => (
            <div 
              key={filePath}
              className="flex items-center gap-1 px-2 py-0.5 bg-emerald-950/60 border border-emerald-500/40 rounded-md text-xs font-mono text-emerald-300"
            >
              <FileCode className="w-3 h-3 text-emerald-400" />
              <span>{filePath}</span>
              <button 
                onClick={() => removeMentionedFile(filePath)}
                className="hover:text-emerald-100 p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 相对定位区：放置输入框与 @file 浮层 */}
      <div className="relative">
        
        {/* @ 悬浮补全菜单 */}
        {showDropdown && filteredFiles.length > 0 && (
          <div className="absolute bottom-full left-0 mb-2 w-72 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden z-50 animate-in fade-in slide-in-from-bottom-2">
            <div className="p-2 border-b border-slate-800 text-[11px] text-slate-400 font-semibold flex items-center justify-between">
              <span>选择聚焦文件 (提示: 键盘 ⬆️ ⬇️ 选择)</span>
              <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded">@file</span>
            </div>
            <div className="max-h-48 overflow-y-auto p-1 space-y-0.5">
              {filteredFiles.map((file, idx) => (
                <div
                  key={file}
                  onClick={() => selectFile(file)}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-mono cursor-pointer transition ${
                    idx === selectedIndex 
                      ? 'bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30' 
                      : 'text-slate-300 hover:bg-slate-800/80'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5 text-slate-400" />
                  <span className="truncate">{file}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 文本输入框 */}
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            rows={2}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            placeholder="输入增量修改需求... (提示: 敲击 '@' 可指定精准修改的文件)"
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition resize-none font-sans"
          />

          <button
            onClick={handleSubmit}
            disabled={isModifying || !text.trim()}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-medium transition shadow-lg shadow-emerald-950/30"
          >
            {isModifying ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Sparkles className="w-4 h-4" /> 应用修改
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
};