'use client';

// Why: Skill 手动创建表单（计划书 §3.2）。
// 三字段：name / description / instructions → POST /api/memory/skills
// 支持预填（上传解析后自动填入）。
import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { createSkill } from '../lib/api';

interface CreateSkillModalProps {
  initial: {
    skill_name: string;
    description: string;
    instructions: string;
  } | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function CreateSkillModal({
  initial,
  onClose,
  onSuccess,
}: CreateSkillModalProps) {
  const [skillName, setSkillName] = useState(initial?.skill_name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [instructions, setInstructions] = useState(initial?.instructions ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (saving) return;

    // 前端校验
    const name = skillName.trim();
    if (!name) {
      setError('Skill name 不能为空');
      return;
    }
    if (name.length > 64) {
      setError('Skill name 不能超过 64 个字符');
      return;
    }
    if (!description.trim()) {
      setError('Description 不能为空');
      return;
    }
    const lines = instructions
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      setError('Instructions 至少需要一行步骤');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createSkill({
        skill_name: name,
        description: description.trim(),
        instructions,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-skill-title"
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h3
            id="create-skill-title"
            className="text-sm font-semibold text-slate-900"
          >
            {initial ? '确认创建 Skill' : 'Write skill instruction'}
          </h3>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            disabled={saving}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <label
              htmlFor="skill-name-input"
              className="mb-1 block text-xs font-medium text-slate-700"
            >
              Skill name
            </label>
            <input
              id="skill-name-input"
              type="text"
              value={skillName}
              onChange={(event) => setSkillName(event.target.value)}
              disabled={saving}
              placeholder="/my-skill"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-slate-500 disabled:opacity-60"
            />
          </div>

          <div>
            <label
              htmlFor="skill-desc-input"
              className="mb-1 block text-xs font-medium text-slate-700"
            >
              Description
            </label>
            <input
              id="skill-desc-input"
              type="text"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={saving}
              placeholder="一句话描述触发条件和使用场景"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-slate-500 disabled:opacity-60"
            />
          </div>

          <div>
            <label
              htmlFor="skill-instructions-input"
              className="mb-1 block text-xs font-medium text-slate-700"
            >
              Instructions
              <span className="ml-1 text-[10px] font-normal text-slate-400">
                （每行一条标准步骤）
              </span>
            </label>
            <textarea
              id="skill-instructions-input"
              rows={8}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              disabled={saving}
              placeholder={'1. 第一步…\n2. 第二步…\n3. 第三步…'}
              className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-slate-500 disabled:opacity-60"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSubmit()}
            className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {saving && <Loader2 size={13} className="animate-spin" />}
            {saving ? '创建中…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
