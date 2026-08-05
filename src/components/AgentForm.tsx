'use client';

import { AgentDraft, AgentTool } from '../lib/api';

const TOOLS: Array<{ id: AgentTool; icon: string; label: string; description: string }> = [
  { id: 'read', icon: '👁️', label: '阅读', description: '读取和检索文件（暂未授权执行）' },
  { id: 'edit', icon: '✏️', label: '编辑', description: '修改文件（暂未授权执行）' },
  { id: 'terminal', icon: '⌨️', label: '终端', description: '运行命令（暂未授权执行）' },
  { id: 'web_search', icon: '🌐', label: '联网搜索', description: '规划执行时可使用 Tavily' },
];

interface AgentFormProps {
  value: AgentDraft;
  highlighted: boolean;
  saving: boolean;
  onChange: (value: AgentDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export default function AgentForm({
  value,
  highlighted,
  saving,
  onChange,
  onSubmit,
  onCancel,
}: AgentFormProps) {
  const fieldClass = `w-full rounded-lg border bg-slate-950 px-3 py-2 text-sm text-slate-100
    placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-2
    focus:ring-emerald-500/20 transition-all ${
      highlighted
        ? 'border-emerald-400 bg-emerald-950/30 ring-2 ring-emerald-400/50'
        : 'border-slate-700'
    }`;

  const update = <K extends keyof AgentDraft>(key: K, next: AgentDraft[K]) => {
    onChange({ ...value, [key]: next });
  };

  const toggleTool = (tool: AgentTool) => {
    update(
      'tools',
      value.tools.includes(tool)
        ? value.tools.filter((item) => item !== tool)
        : [...value.tools, tool],
    );
  };

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-xs font-medium text-slate-300">
          名称 <span className="text-emerald-400">*</span>
          <input
            required
            maxLength={80}
            value={value.name}
            onChange={(event) => update('name', event.target.value)}
            placeholder="例如：🐍 Python 测试专家"
            className={`${fieldClass} mt-1.5`}
          />
        </label>
        <label className="block text-xs font-medium text-slate-300">
          英文标识 <span className="text-emerald-400">*</span>
          <input
            required
            pattern="[a-z][a-z0-9]*(?:-[a-z0-9]+)*"
            maxLength={64}
            value={value.id}
            onChange={(event) => update('id', event.target.value)}
            placeholder="pytest-expert"
            className={`${fieldClass} mt-1.5 font-mono`}
          />
        </label>
      </div>

      <label className="block text-xs font-medium text-slate-300">
        功能简介 <span className="text-emerald-400">*</span>
        <input
          required
          minLength={5}
          maxLength={500}
          value={value.description}
          onChange={(event) => update('description', event.target.value)}
          placeholder="一句话说明这个智能体能完成什么"
          className={`${fieldClass} mt-1.5`}
        />
      </label>

      <label className="block text-xs font-medium text-slate-300">
        系统提示词 <span className="text-emerald-400">*</span>
        <textarea
          required
          minLength={20}
          maxLength={4000}
          rows={6}
          value={value.system_prompt}
          onChange={(event) => update('system_prompt', event.target.value)}
          placeholder="描述角色、边界、工作流程和输出要求"
          className={`${fieldClass} mt-1.5 resize-y`}
        />
      </label>

      <section className="rounded-xl border border-slate-700 bg-slate-950/60 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium text-slate-200">允许 Planner 调用</h3>
            <p className="mt-1 text-xs text-slate-500">关闭后仍保存，但不会出现在任务分发菜单中。</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={value.is_callable}
            onClick={() => update('is_callable', !value.is_callable)}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              value.is_callable ? 'bg-emerald-500' : 'bg-slate-700'
            }`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              value.is_callable ? 'translate-x-5' : 'translate-x-0.5'
            }`} />
          </button>
        </div>

        <label className="mt-4 block border-t border-slate-800 pt-4 text-xs font-medium text-slate-300">
          何时调用 <span className="text-emerald-400">*</span>
          <textarea
            required
            minLength={10}
            maxLength={500}
            rows={3}
            value={value.when_to_use}
            onChange={(event) => update('when_to_use', event.target.value)}
            placeholder="描述 Planner 应该在什么场景选择它"
            className={`${fieldClass} mt-1.5 resize-y`}
          />
        </label>
      </section>

      <fieldset>
        <legend className="mb-2 text-xs font-medium text-slate-300">工具能力声明</legend>
        <div className="overflow-hidden rounded-xl border border-slate-700">
          {TOOLS.map((tool) => {
            const checked = value.tools.includes(tool.id);
            return (
              <label
                key={tool.id}
                className="flex cursor-pointer items-center gap-3 border-b border-slate-800 bg-slate-950/60 px-3 py-3 last:border-b-0 hover:bg-slate-900"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleTool(tool.id)}
                  className="h-4 w-4 accent-emerald-500"
                />
                <span aria-hidden="true">{tool.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium text-slate-200">{tool.label}</span>
                  <span className="block text-[11px] text-slate-500">{tool.description}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-800 bg-slate-900 py-4">
        <button type="button" onClick={onCancel} className="rounded-lg bg-slate-800 px-4 py-2 text-xs text-slate-300 hover:bg-slate-700">
          取消
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-emerald-600 px-5 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存并生效'}
        </button>
      </div>
    </form>
  );
}
