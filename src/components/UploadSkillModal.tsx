'use client';

// Why: Skill 上传解析弹窗（计划书 §3.3）。
// 仅接受 .md 文件，前端解析 YAML frontmatter（扁平键值）→ 预填 CreateSkillModal。
import { useCallback, useRef, useState } from 'react';
import { Upload, Loader2, X } from 'lucide-react';

interface UploadSkillModalProps {
  onClose: () => void;
  onParsed: (parsed: {
    skill_name: string;
    description: string;
    instructions: string;
  }) => void;
}

interface ParseResult {
  skill_name: string;
  description: string;
  instructions: string;
}

interface ParseError {
  message: string;
}

// Why: 扁平 YAML frontmatter 解析——只取 name/description 两键，不支持嵌套。
// SKILL.md 规范只需扁平键值，引入完整 YAML 解析器成本过高。
function parseSkillMarkdown(text: string): ParseResult | ParseError {
  const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    return { message: '未找到 YAML frontmatter（文件需以 --- 开头和结尾）' };
  }

  const frontmatter = fmMatch[1];
  const body = text.slice(fmMatch[0].length).trim();

  // 扁平键值解析
  const kv: Record<string, string> = {};
  for (const line of frontmatter.split('\n')) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) {
      kv[m[1]!] = m[2]!.replace(/^["']|["']$/g, '').trim();
    }
  }

  const name = kv['name'];
  if (!name) {
    return { message: 'frontmatter 中缺少 name 字段' };
  }

  const description = kv['description'] ?? '';
  const instructions = body || '';

  if (!instructions) {
    return { message: '正文为空，缺少 instructions 内容' };
  }

  return { skill_name: name, description, instructions };
}

export default function UploadSkillModal({
  onClose,
  onParsed,
}: UploadSkillModalProps) {
  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.name.endsWith('.md') && file.type !== 'text/markdown') {
        setError('仅接受 .md 文件');
        return;
      }

      setParsing(true);
      setError(null);

      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result ?? '');
        const result = parseSkillMarkdown(text);
        setParsing(false);

        if ('message' in result) {
          setError(result.message);
        } else {
          onParsed(result);
        }
      };
      reader.onerror = () => {
        setParsing(false);
        setError('文件读取失败');
      };
      reader.readAsText(file);
    },
    [onParsed],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragOver(false);
      const file = event.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !parsing) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-skill-title"
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h3
            id="upload-skill-title"
            className="text-sm font-semibold text-slate-900"
          >
            Upload a skill
          </h3>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            disabled={parsing}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <p className="mt-1 text-xs text-slate-500">
          拖入或选择 SKILL.md 文件，解析后自动填入创建表单
        </p>

        {/* 拖拽区 */}
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => !parsing && fileInputRef.current?.click()}
          className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed py-12 transition ${
            dragOver
              ? 'border-slate-500 bg-slate-50'
              : 'border-slate-200 hover:border-slate-300'
          } ${parsing ? 'pointer-events-none opacity-60' : ''}`}
        >
          {parsing ? (
            <Loader2 size={32} className="animate-spin text-slate-400" />
          ) : (
            <>
              <Upload size={32} className="text-slate-400" />
              <span className="mt-2 text-xs text-slate-500">
                点击选择或拖入 .md 文件
              </span>
            </>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".md,text/markdown"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) handleFile(file);
            event.target.value = '';
          }}
        />

        {error && (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            disabled={parsing}
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
