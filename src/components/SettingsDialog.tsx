'use client';

import { useEffect, useState } from 'react';
import { Check, ChevronDown, Eye, EyeOff, Info, Monitor, Moon, Palette, Settings, Sun, Type, X } from 'lucide-react';
import { getModelSettings, ModelSettings, saveModelSettings } from '../lib/api';

type Theme = 'system' | 'light' | 'dark';
type Font = 'system' | 'inter' | 'serif' | 'mono';

const PRESETS: Record<'deepseek' | 'glm', Pick<ModelSettings, 'base_url' | 'model_id' | 'display_name' | 'input_context' | 'output_context'>> = {
  deepseek: { base_url: 'https://api.deepseek.com', model_id: 'deepseek-chat', display_name: 'DeepSeek Chat', input_context: 64000, output_context: 8000 },
  glm: { base_url: 'https://open.bigmodel.cn/api/paas/v4', model_id: 'glm-5v-turbo', display_name: 'GLM-5V Turbo', input_context: 128000, output_context: 16000 },
};

// Why: 同步 ModelQuickSwitcher 的 GLM 变体列表，让设置界面也能一键切换官方模型 ID，
// 避免用户手敲 model_id 拼错导致后端 is_vision_model 判定失效。
const GLM_MODEL_OPTIONS: Array<{ id: string; label: string; multimodal: boolean }> = [
  { id: 'glm-5', label: 'GLM-5 · 纯文本', multimodal: false },
  { id: 'glm-5.1', label: 'GLM-5.1 · 纯文本', multimodal: false },
  { id: 'glm-5.2', label: 'GLM-5.2 · 纯文本', multimodal: false },
  { id: 'glm-5v-turbo', label: 'GLM-5V Turbo · 视觉', multimodal: true },
];

const DEFAULTS: ModelSettings = {
  provider: 'deepseek', api_format: 'openai_chat_completions', base_url: PRESETS.deepseek.base_url,
  model_id: PRESETS.deepseek.model_id, display_name: PRESETS.deepseek.display_name, api_key: '', model_family: 'default',
  input_context: 64000, output_context: 8000, tool_call_rounds: 200, full_url: false, multimodal: false,
  text_model_id: 'glm-5-turbo', vision_model_id: 'glm-5v-turbo', thinking_enabled: true, temperature: 1, max_tokens: 16000,
};

function applyAppearance(theme: Theme, font: Font) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.font = font;
  localStorage.setItem('appearance-settings', JSON.stringify({ theme, font }));
  // Why: 源码面板/Markdown 渲染器等组件要即时刷新颜色主题，不用等下一次 storage/mutation。
  try { window.dispatchEvent(new CustomEvent('appearance-settings-changed', { detail: { theme, font } })); } catch { /* noop */ }
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className={`relative h-6 w-11 rounded-full transition ${checked ? 'bg-sky-600' : 'bg-slate-300 dark:bg-slate-600'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition ${checked ? 'left-6' : 'left-1'}`} /></button>;
}

export default function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [section, setSection] = useState<'model' | 'appearance'>('model');
  const [form, setForm] = useState<ModelSettings>(DEFAULTS);
  const [advanced, setAdvanced] = useState(true);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [theme, setTheme] = useState<Theme>('system');
  const [font, setFont] = useState<Font>('system');

  useEffect(() => {
    if (!open) return;
    getModelSettings().then((data) => setForm({ ...DEFAULTS, ...data, api_key: '' })).catch(() => setMessage('后端未连接，外观设置仍可正常使用'));
    const saved = JSON.parse(localStorage.getItem('appearance-settings') || '{}');
    setTheme(saved.theme || 'system'); setFont(saved.font || 'system');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close);
  }, [open, onClose]);

  if (!open) return null;
  const patch = (next: Partial<ModelSettings>) => setForm((value) => ({ ...value, ...next }));
  const chooseProvider = async (provider: ModelSettings['provider']) => {
    setMessage('');
    try {
      const saved = await getModelSettings(provider);
      setForm({ ...DEFAULTS, ...saved, api_key: '' });
    } catch {
      patch(provider === 'custom' ? { provider, api_key: '', has_api_key: false } : { provider, ...PRESETS[provider], api_key: '', has_api_key: false, model_family: provider, multimodal: provider === 'glm' });
    }
  };
  const save = async () => {
    setSaving(true); setMessage('');
    try { const result = await saveModelSettings(form); setForm((old) => ({ ...old, ...result, api_key: '' })); window.dispatchEvent(new Event('model-settings-changed')); setMessage('配置已保存并立即生效'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '保存失败'); }
    finally { setSaving(false); }
  };

  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <div role="dialog" aria-modal="true" aria-labelledby="settings-title" className="flex h-[min(820px,94vh)] w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
      <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950 sm:block">
        <h2 id="settings-title" className="px-3 pb-5 text-lg font-semibold text-slate-900 dark:text-white">设置</h2>
        {[['model', Settings, '模型与 API'], ['appearance', Palette, '外观与字体']] .map(([id, Icon, label]) => <button key={id as string} type="button" onClick={() => setSection(id as 'model' | 'appearance')} className={`mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${(section === id) ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'}`}><Icon size={18}/>{label as string}</button>)}
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
          <div><h3 className="text-lg font-semibold text-slate-900 dark:text-white">{section === 'model' ? '模型与 API' : '外观与字体'}</h3><p className="text-xs text-slate-500">{section === 'model' ? '配置用于对话和智能体任务的模型服务' : '自定义你的阅读与使用体验'}</p></div>
          <button type="button" aria-label="关闭设置" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={20}/></button>
        </div>
        <div className="flex gap-2 border-b border-slate-200 px-5 py-3 sm:hidden dark:border-slate-700"><button onClick={() => setSection('model')} className="rounded-lg px-3 py-2 text-sm">模型与 API</button><button onClick={() => setSection('appearance')} className="rounded-lg px-3 py-2 text-sm">外观与字体</button></div>
        {section === 'model' ? <div className="space-y-6 p-5 sm:p-7">
          <div><label className="mb-2 block text-sm font-medium text-slate-800 dark:text-slate-200">模型服务商</label><div className="grid grid-cols-3 gap-2">{(['deepseek','glm','custom'] as const).map((id) => <button type="button" key={id} onClick={() => void chooseProvider(id)} className={`rounded-xl border p-3 text-left transition ${form.provider === id ? 'border-sky-500 bg-sky-50 ring-1 ring-sky-500 dark:bg-sky-950/40' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'}`}><span className="block text-sm font-semibold text-slate-900 dark:text-white">{id === 'deepseek' ? 'DeepSeek' : id === 'glm' ? '智谱 GLM' : '自定义'}</span><span className="mt-1 block text-xs text-slate-500">{id === 'custom' ? 'OpenAI 兼容接口' : '官方服务'}{form.provider === id && form.has_api_key ? ' · 密钥已保存' : ''}</span></button>)}</div></div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="API 格式"><Select value={form.api_format}><option value="openai_chat_completions">OpenAI Chat Completions</option></Select></Field>
            <Field label="模型 ID" required hint={form.provider === 'glm' ? '可从下拉框选官方模型，或手动输入' : undefined}>
              {form.provider === 'glm' ? (
                <div className="space-y-2">
                  <Select
                    value={GLM_MODEL_OPTIONS.some((option) => option.id === form.model_id) ? form.model_id : '__custom__'}
                    onChange={(v) => {
                      if (v === '__custom__') return;
                      const option = GLM_MODEL_OPTIONS.find((item) => item.id === v);
                      if (!option) return;
                      // Why: 选 GLM-5V 时同步多模态开关和 vision_model_id；选纯文本模型时自动把 vision_model_id 保留为 glm-5v-turbo 以便普通对话上传图时仍能切到视觉模型。
                      patch({
                        model_id: option.id,
                        display_name: option.label.split(' · ')[0],
                        multimodal: option.multimodal,
                        vision_model_id: option.multimodal ? option.id : (form.vision_model_id || 'glm-5v-turbo'),
                        text_model_id: option.multimodal ? (form.text_model_id || 'glm-5-turbo') : option.id,
                      });
                    }}
                  >
                    {GLM_MODEL_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                    <option value="__custom__">自定义（在下方输入框填写）</option>
                  </Select>
                  {!GLM_MODEL_OPTIONS.some((option) => option.id === form.model_id) && (
                    <Input value={form.model_id} onChange={(v) => patch({ model_id: v })} placeholder="glm-5-turbo" />
                  )}
                </div>
              ) : (
                <Input value={form.model_id} onChange={(v) => patch({ model_id: v })}/>
              )}
            </Field>
          </div>
          <Field label="请求地址" required hint="填写服务端点地址；关闭“完整 URL”时系统会自动补充 /chat/completions。"><div className="flex gap-3"><Input value={form.base_url} placeholder="https://api.example.com/v1" onChange={(v) => patch({ base_url: v })}/><label className="flex shrink-0 items-center gap-2 text-xs text-slate-600 dark:text-slate-300">完整 URL <Toggle label="完整 URL" checked={form.full_url} onChange={(v) => patch({full_url:v})}/></label></div></Field>
          <Field label="API 密钥" required hint={form.has_api_key ? `已保存 ${form.provider === 'glm' ? '智谱 GLM' : form.provider === 'deepseek' ? 'DeepSeek' : '自定义服务'}密钥；留空不会覆盖。` : '此服务商尚未保存密钥。密钥仅保存在本机服务端。'}><div className="relative"><Input type={showKey ? 'text' : 'password'} value={form.api_key || ''} placeholder={form.has_api_key ? '••••••••（密钥已保存）' : '输入 API 密钥'} onChange={(v) => patch({api_key:v})}/><button type="button" aria-label={showKey ? '隐藏密钥' : '显示密钥'} onClick={() => setShowKey(!showKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">{showKey ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></Field>
          <button type="button" onClick={() => setAdvanced(!advanced)} className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200"><ChevronDown size={16} className={`transition ${advanced ? '' : '-rotate-90'}`}/>高级配置</button>
          {advanced && <div className="space-y-5 rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-950/40">
            <div className="grid gap-5 sm:grid-cols-2"><Field label="模型展示名称" hint={`${form.display_name.length}/32`}><Input maxLength={32} value={form.display_name} onChange={(v) => patch({display_name:v})}/></Field><Field label="模型系列"><Select value={form.model_family} onChange={(v) => patch({model_family:v})}><option value="default">默认</option><option value="deepseek">DeepSeek</option><option value="glm">GLM</option><option value="reasoning">推理模型</option></Select></Field></div>
            <div className="grid gap-5 sm:grid-cols-2"><Field label="输入上下文"><NumberInput value={form.input_context} onChange={(v) => patch({input_context:v})}/></Field><Field label="输出上下文"><NumberInput value={form.output_context} onChange={(v) => patch({output_context:v})}/></Field></div>
            {form.provider === 'glm' && <><div className="grid gap-5 sm:grid-cols-2"><Field label="文本模型 ID" hint="无附件时自动使用"><Input value={form.text_model_id} onChange={(v) => patch({text_model_id:v})}/></Field><Field label="多模态模型 ID" hint="包含附件时自动使用"><Input value={form.vision_model_id} onChange={(v) => patch({vision_model_id:v})}/></Field></div><div className="grid gap-5 sm:grid-cols-3"><Field label="最大输出 Tokens"><NumberInput value={form.max_tokens} onChange={(v) => patch({max_tokens:v})}/></Field><Field label="Temperature"><input type="number" min={0} max={2} step={0.1} value={form.temperature} onChange={(e)=>patch({temperature:Number(e.target.value)})} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"/></Field><label className="flex h-11 items-center justify-between self-end rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900">启用深度思考<Toggle label="启用深度思考" checked={form.thinking_enabled} onChange={(v)=>patch({thinking_enabled:v})}/></label></div></>}
            <div className="grid items-end gap-5 sm:grid-cols-2"><Field label="工具调用轮次"><NumberInput value={form.tool_call_rounds} onChange={(v) => patch({tool_call_rounds:v})}/></Field><label className="flex h-11 items-center justify-between rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900">多模态支持<Toggle label="多模态支持" checked={form.multimodal} onChange={(v) => patch({multimodal:v})}/></label></div>
          </div>}
          <div className="sticky bottom-0 -mx-5 flex items-center justify-between border-t border-slate-200 bg-white/95 px-5 py-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 sm:-mx-7 sm:px-7"><span role="status" className="text-sm text-slate-500">{message}</span><button type="button" disabled={saving || !form.base_url || !form.model_id} onClick={save} className="rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">{saving ? '保存中…' : '保存配置'}</button></div>
        </div> : <div className="space-y-8 p-5 sm:p-7">
          <section><div className="mb-4 flex items-center gap-2"><Palette size={18}/><h4 className="font-semibold text-slate-900 dark:text-white">主题色</h4></div><div className="grid grid-cols-3 gap-3">{([['light',Sun,'浅色'],['dark',Moon,'深色'],['system',Monitor,'跟随系统']] as const).map(([id,Icon,label]) => <button key={id} type="button" onClick={() => {setTheme(id); applyAppearance(id,font)}} className={`relative flex flex-col items-center gap-2 rounded-xl border p-5 ${theme === id ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/40' : 'border-slate-200 dark:border-slate-700'}`}><Icon size={24}/><span className="text-sm font-medium">{label}</span>{theme === id && <Check size={15} className="absolute right-2 top-2 text-sky-600"/>}</button>)}</div></section>
          <section><div className="mb-4 flex items-center gap-2"><Type size={18}/><h4 className="font-semibold text-slate-900 dark:text-white">界面字体</h4></div><div className="space-y-2">{([['system','系统默认','适合中文与日常使用'],['inter','Inter','现代、清晰的无衬线字体'],['serif','衬线字体','更适合长文本阅读'],['mono','等宽字体','适合代码与技术内容']] as const).map(([id,label,desc]) => <button key={id} type="button" onClick={() => {setFont(id); applyAppearance(theme,id)}} className={`flex w-full items-center justify-between rounded-xl border p-4 text-left ${font === id ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/40' : 'border-slate-200 dark:border-slate-700'}`}><span><span className="block text-sm font-semibold">{label}</span><span className="text-xs text-slate-500">{desc}</span></span>{font === id && <Check size={18} className="text-sky-600"/>}</button>)}</div></section>
          <div className="flex gap-3 rounded-xl bg-sky-50 p-4 text-sm text-sky-900 dark:bg-sky-950/40 dark:text-sky-200"><Info size={18} className="shrink-0"/>主题和字体选择会即时生效，并自动保存在此浏览器中。</div>
        </div>}
      </main>
    </div>
  </div>;
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) { return <label className="block"><span className="mb-2 flex justify-between text-sm font-medium text-slate-800 dark:text-slate-200"><span>{required && <b className="mr-1 text-rose-500">*</b>}{label}</span>{hint && hint.length < 10 && <span className="font-normal text-slate-400">{hint}</span>}</span>{children}{hint && hint.length >= 10 && <span className="mt-1.5 block text-xs leading-5 text-slate-500">{hint}</span>}</label> }
function Input({ value, onChange, ...props }: { value: string; onChange: (v:string)=>void } & Omit<React.InputHTMLAttributes<HTMLInputElement>,'onChange'>) { return <input {...props} value={value} onChange={(e)=>onChange(e.target.value)} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-white"/> }
function NumberInput({ value, onChange }: { value:number; onChange:(v:number)=>void }) { return <input type="number" min={1} value={value} onChange={(e)=>onChange(Number(e.target.value))} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950"/> }
function Select({ children, value, onChange }: {children:React.ReactNode;value:string;onChange?:(v:string)=>void}) { return <select value={value} onChange={(e)=>onChange?.(e.target.value)} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950">{children}</select> }
