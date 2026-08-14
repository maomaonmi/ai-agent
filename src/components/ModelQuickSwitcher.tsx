'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, LoaderCircle } from 'lucide-react';
import { getModelCatalog, getModelSettings, ModelSettings, ModelVariant, saveModelSettings } from '../lib/api';

type Provider = ModelSettings['provider'];

// Why: 目录以后端 /api/settings/model-catalog 为单一数据源；此处仅作接口不可用时的兜底，
// 保证旧后端也能渲染 GLM/DeepSeek 列表（与历史行为一致）。
const FALLBACK_CATALOG: Record<string, ModelVariant[]> = {
  deepseek: [
    { value: 'deepseek:deepseek-v4-flash', label: 'DeepSeek V4 Flash · 性价比', model_id: 'deepseek-v4-flash', supports_vision: false, thinking_control: 'deepseek', input_context: 1000000, output_context: 384000 },
    { value: 'deepseek:deepseek-v4-pro', label: 'DeepSeek V4 Pro · 旗舰', model_id: 'deepseek-v4-pro', supports_vision: false, thinking_control: 'deepseek', input_context: 1000000, output_context: 384000 },
  ],
  glm: [
    { value: 'glm:glm-5', label: 'GLM-5', model_id: 'glm-5', supports_vision: false, thinking_control: 'glm', input_context: 128000, output_context: 16000 },
    { value: 'glm:glm-5.1', label: 'GLM-5.1', model_id: 'glm-5.1', supports_vision: false, thinking_control: 'glm', input_context: 128000, output_context: 16000 },
    { value: 'glm:glm-5.2', label: 'GLM-5.2', model_id: 'glm-5.2', supports_vision: false, thinking_control: 'glm', input_context: 128000, output_context: 16000 },
    { value: 'glm:glm-5-turbo', label: 'GLM-5 Turbo', model_id: 'glm-5-turbo', supports_vision: false, thinking_control: 'glm', input_context: 128000, output_context: 16000 },
    { value: 'glm:glm-5v-turbo', label: 'GLM-5V Turbo · 视觉', model_id: 'glm-5v-turbo', supports_vision: true, thinking_control: 'glm', input_context: 128000, output_context: 16000 },
  ],
  qwen: [
    { value: 'qwen:qwen3.8-max', label: '千问 Qwen3.8 Max · 旗舰', model_id: 'qwen3.8-max', supports_vision: false, thinking_control: 'qwen_budget', input_context: 256000, output_context: 32000 },
    { value: 'qwen:qwen3.7-plus', label: '千问 Qwen3.7 Plus · 均衡', model_id: 'qwen3.7-plus', supports_vision: false, thinking_control: 'qwen_budget', input_context: 256000, output_context: 16000 },
    { value: 'qwen:qwen3.7-flash', label: '千问 Qwen3.7 Flash · 性价比', model_id: 'qwen3.7-flash', supports_vision: false, thinking_control: 'qwen_budget', input_context: 256000, output_context: 16000 },
    { value: 'qwen:qwen-vl-max', label: '千问 Qwen-VL Max · 视觉', model_id: 'qwen-vl-max', supports_vision: true, thinking_control: 'none', input_context: 128000, output_context: 8000 },
  ],
};

const REASONING_EFFORTS = ['max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none'] as const;
// Why: 千问思考协议是 token 预算制（thinking_budget），用三档语义化档位降低理解成本。
const THINKING_BUDGETS = [
  { value: 2000, label: '思考 · 轻' },
  { value: 8000, label: '思考 · 标准' },
  { value: 16000, label: '思考 · 深' },
] as const;
// Why: DeepSeek 官方 effort 字面 4 档（low/high/xhigh/max），与 GLM 7 档、千问 3 档完全隔离。
// 关闭思考通过 thinking_enabled=false 控制，不混入 effort 选择器。
const DEEPSEEK_EFFORTS = [
  { value: 'low', label: '低' },
  { value: 'high', label: '标准' },
  { value: 'xhigh', label: '加强' },
  { value: 'max', label: '最强' },
] as const;

export default function ModelQuickSwitcher({ disabled = false, compact = false }: { disabled?: boolean; compact?: boolean }) {
  const [active, setActive] = useState<Provider>('deepseek');
  const [profiles, setProfiles] = useState<Partial<Record<Provider, ModelSettings>>>({});
  const [catalog, setCatalog] = useState<Record<string, ModelVariant[]>>(FALLBACK_CATALOG);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [current, deepseek, glm, qwen, custom] = await Promise.all([
        getModelSettings(), getModelSettings('deepseek'), getModelSettings('glm'), getModelSettings('qwen'), getModelSettings('custom'),
      ]);
      setActive(current.provider);
      setProfiles({ deepseek, glm, qwen, custom });
      setError('');
    } catch { setError('模型配置不可用'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void refresh();
    getModelCatalog().then((data) => setCatalog((prev) => ({ ...prev, ...data }))).catch(() => { /* 保留兜底目录 */ });
    window.addEventListener('model-settings-changed', refresh);
    return () => window.removeEventListener('model-settings-changed', refresh);
  }, [refresh]);

  const variantsOf = useCallback(
    (provider: 'deepseek' | 'glm' | 'qwen') => catalog[provider]?.length ? catalog[provider] : FALLBACK_CATALOG[provider],
    [catalog],
  );

  // Why: 当前激活的变体由 profile.model_id 反推，保证刷新页面后下拉框仍能定位到正确项。
  const currentValue = useMemo(() => {
    if (active !== 'glm' && active !== 'qwen' && active !== 'deepseek') return active;
    const profile = profiles[active];
    return variantsOf(active).find((variant) => variant.model_id === profile?.model_id)?.value ?? `${active}:${profile?.model_id || ''}`;
  }, [active, profiles, variantsOf]);

  const activeVariant = useMemo(() => {
    if (active !== 'glm' && active !== 'qwen' && active !== 'deepseek') return undefined;
    return variantsOf(active).find((variant) => variant.model_id === profiles[active]?.model_id);
  }, [active, profiles, variantsOf]);

  const change = async (rawValue: string) => {
    setLoading(true); setError('');
    try {
      let payload: ModelSettings;
      if (rawValue.startsWith('deepseek:') || rawValue.startsWith('glm:') || rawValue.startsWith('qwen:')) {
        const provider = rawValue.startsWith('deepseek:') ? 'deepseek' : rawValue.startsWith('glm:') ? 'glm' : 'qwen';
        const variant = variantsOf(provider).find((item) => item.value === rawValue);
        if (!variant) { setError('未知的模型变体'); setLoading(false); return; }
        const profile = profiles[provider];
        if (!profile?.has_api_key) {
          const label = provider === 'glm' ? ' GLM ' : provider === 'qwen' ? '千问' : 'DeepSeek';
          setError(`请先在设置中保存${label}的 API 密钥`); setLoading(false); return;
        }
        payload = {
          ...profile,
          model_id: variant.model_id,
          display_name: variant.label,
          multimodal: variant.supports_vision,
          input_context: variant.input_context,
          output_context: variant.output_context,
          // Why: GLM 视觉模型同时承担 model_id 和 vision_model_id；纯文本模型保留 vision_model_id 以便普通对话自动切换。千问/DeepSeek 无此机制。
          ...(provider === 'glm' ? {
            vision_model_id: variant.supports_vision ? variant.model_id : (profile.vision_model_id || 'glm-5v-turbo'),
            text_model_id: variant.supports_vision ? (profile.text_model_id || 'glm-5-turbo') : variant.model_id,
          } : provider === 'qwen' ? {
            // 千问切模型时保持既有思考预算；首次使用时给默认标准档。
            thinking_budget: profile.thinking_budget ?? 8000,
          } : {
            // DeepSeek 切模型时保持既有思考强度；首次使用时给默认标准档 high。
            thinking_budget: null,
          }),
        };
      } else {
        const provider = rawValue as Provider;
        const profile = profiles[provider];
        if (!profile?.has_api_key) { setError('请先在设置中保存该服务商的 API 密钥'); setLoading(false); return; }
        payload = profile;
      }
      const saved = await saveModelSettings(payload);
      setActive(saved.provider);
      window.dispatchEvent(new Event('model-settings-changed'));
    } catch { setError('模型切换失败'); setLoading(false); }
  };

  const changeDeepSeekEffort = async (effort: string) => {
    const profile = profiles.deepseek;
    if (!profile) return;
    setLoading(true); setError('');
    try {
      // Why: DeepSeek 四档 effort（low/high/xhigh/max）通过 reasoning_effort 传递；
      // 关闭思考由 thinking_enabled 开关控制，不在本选择器内。
      const saved = await saveModelSettings({ ...profile, reasoning_effort: effort, thinking_enabled: true });
      setProfiles((prev) => ({ ...prev, deepseek: saved }));
      window.dispatchEvent(new Event('model-settings-changed'));
    } catch { setError('DeepSeek 思考强度保存失败'); }
    finally { setLoading(false); }
  };

  const changeReasoningEffort = async (effort: string) => {
    const profile = profiles.glm;
    if (!profile) return;
    setLoading(true); setError('');
    try {
      const saved = await saveModelSettings({ ...profile, reasoning_effort: effort });
      setProfiles((prev) => ({ ...prev, glm: saved }));
      window.dispatchEvent(new Event('model-settings-changed'));
    } catch { setError('推理强度保存失败'); }
    finally { setLoading(false); }
  };

  const changeThinkingBudget = async (budget: number) => {
    const profile = profiles.qwen;
    if (!profile) return;
    setLoading(true); setError('');
    try {
      const saved = await saveModelSettings({ ...profile, thinking_budget: budget });
      setProfiles((prev) => ({ ...prev, qwen: saved }));
      window.dispatchEvent(new Event('model-settings-changed'));
    } catch { setError('思考预算保存失败'); }
    finally { setLoading(false); }
  };

  const selectClass = `bg-transparent font-medium outline-none disabled:opacity-60 ${compact ? 'max-w-32' : 'max-w-48'}`;
  const labelClass = 'inline-flex min-w-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200';

  return <div className={`flex items-center gap-2 ${compact ? '' : 'min-w-0'}`}>
    <label className={labelClass}>
      {loading ? <LoaderCircle size={14} className="animate-spin"/> : <Bot size={14} className="text-sky-600"/>}
      <span className="sr-only">当前模型</span>
      <select aria-label="当前模型" value={currentValue} disabled={disabled || loading} onChange={(e) => void change(e.target.value)} className={selectClass}>
        <optgroup label="DeepSeek">
          {variantsOf('deepseek').map((variant) => (
            <option key={variant.value} value={variant.value} disabled={!profiles.deepseek?.has_api_key}>{variant.label}</option>
          ))}
        </optgroup>
        <optgroup label="GLM">
          {variantsOf('glm').map((variant) => (
            <option key={variant.value} value={variant.value} disabled={!profiles.glm?.has_api_key}>{variant.label}</option>
          ))}
        </optgroup>
        <optgroup label="千问 Qwen">
          {variantsOf('qwen').map((variant) => (
            <option key={variant.value} value={variant.value} disabled={!profiles.qwen?.has_api_key}>{variant.label}</option>
          ))}
        </optgroup>
        {profiles.custom?.has_api_key && <option value="custom">{profiles.custom.display_name || profiles.custom.model_id}</option>}
      </select>
    </label>
    {active === 'deepseek' && activeVariant?.thinking_control === 'deepseek' && (
      <label className={labelClass}>
        <span className="sr-only">思考强度</span>
        <select
          aria-label="思考强度"
          value={profiles.deepseek?.reasoning_effort || 'high'}
          disabled={disabled || loading}
          onChange={(e) => void changeDeepSeekEffort(e.target.value)}
          className={`bg-transparent font-medium outline-none disabled:opacity-60 ${compact ? 'max-w-24' : 'max-w-32'}`}
        >
          {DEEPSEEK_EFFORTS.map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </select>
      </label>
    )}
    {active === 'glm' && (
      <label className={labelClass}>
        <span className="sr-only">推理强度</span>
        <select
          aria-label="推理强度"
          value={profiles.glm?.reasoning_effort || 'high'}
          disabled={disabled || loading}
          onChange={(e) => void changeReasoningEffort(e.target.value)}
          className={`bg-transparent font-medium outline-none disabled:opacity-60 ${compact ? 'max-w-24' : 'max-w-32'}`}
        >
          {REASONING_EFFORTS.map((effort) => (
            <option key={effort} value={effort}>{effort}</option>
          ))}
        </select>
      </label>
    )}
    {active === 'qwen' && activeVariant?.thinking_control === 'qwen_budget' && (
      <label className={labelClass}>
        <span className="sr-only">思考预算</span>
        <select
          aria-label="思考预算"
          value={String(profiles.qwen?.thinking_budget ?? 8000)}
          disabled={disabled || loading}
          onChange={(e) => void changeThinkingBudget(Number(e.target.value))}
          className={`bg-transparent font-medium outline-none disabled:opacity-60 ${compact ? 'max-w-24' : 'max-w-32'}`}
        >
          {THINKING_BUDGETS.map((item) => (
            <option key={item.value} value={String(item.value)}>{item.label}</option>
          ))}
        </select>
      </label>
    )}
    {error && <span role="status" className="max-w-48 truncate text-[11px] text-rose-600" title={error}>{error}</span>}
  </div>;
}
