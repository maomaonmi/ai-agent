'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, LoaderCircle } from 'lucide-react';
import { getModelSettings, ModelSettings, saveModelSettings } from '../lib/api';

type Provider = ModelSettings['provider'];

// Why: GLM 同一 provider 下要支持 5/5.1/5.2/5V-Turbo 四个变体，
// 用 `glm:<model_id>` 作为复合值在同一个下拉框里编码，避免引入二级菜单。
const GLM_VARIANTS = [
  { value: 'glm:glm-5-turbo', label: 'GLM-5 Turbo', modelId: 'glm-5-turbo', multimodal: false },
  { value: 'glm:glm-5.1-turbo', label: 'GLM-5.1 Turbo', modelId: 'glm-5.1-turbo', multimodal: false },
  { value: 'glm:glm-5.2-turbo', label: 'GLM-5.2 Turbo', modelId: 'glm-5.2-turbo', multimodal: false },
  { value: 'glm:glm-5v-turbo', label: 'GLM-5V Turbo · 视觉', modelId: 'glm-5v-turbo', multimodal: true },
] as const;

export default function ModelQuickSwitcher({ disabled = false, compact = false }: { disabled?: boolean; compact?: boolean }) {
  const [active, setActive] = useState<Provider>('deepseek');
  const [profiles, setProfiles] = useState<Partial<Record<Provider, ModelSettings>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [current, deepseek, glm, custom] = await Promise.all([
        getModelSettings(), getModelSettings('deepseek'), getModelSettings('glm'), getModelSettings('custom'),
      ]);
      setActive(current.provider);
      setProfiles({ deepseek, glm, custom });
      setError('');
    } catch { setError('模型配置不可用'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void refresh();
    window.addEventListener('model-settings-changed', refresh);
    return () => window.removeEventListener('model-settings-changed', refresh);
  }, [refresh]);

  // Why: 当前激活的 GLM 变体由 profiles.glm.model_id 反推，保证刷新页面后下拉框仍能定位到正确项。
  const currentValue = useMemo(() => {
    if (active !== 'glm') return active;
    const glmProfile = profiles.glm;
    return GLM_VARIANTS.find((variant) => variant.modelId === glmProfile?.model_id)?.value ?? 'glm:glm-5-turbo';
  }, [active, profiles.glm]);

  const change = async (rawValue: string) => {
    setLoading(true); setError('');
    try {
      let payload: ModelSettings;
      if (rawValue.startsWith('glm:')) {
        const variant = GLM_VARIANTS.find((item) => item.value === rawValue);
        if (!variant) { setError('未知的 GLM 变体'); setLoading(false); return; }
        const profile = profiles.glm;
        if (!profile?.has_api_key) { setError('请先在设置中保存 GLM 的 API 密钥'); setLoading(false); return; }
        // Why: 视觉模型同时承担 model_id 和 vision_model_id；纯文本模型保留 vision_model_id 以便普通对话自动切换到视觉模型。
        payload = {
          ...profile,
          model_id: variant.modelId,
          multimodal: variant.multimodal,
          vision_model_id: variant.multimodal ? variant.modelId : (profile.vision_model_id || 'glm-5v-turbo'),
          text_model_id: variant.multimodal ? (profile.text_model_id || 'glm-5-turbo') : variant.modelId,
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

  return <div className={`flex items-center gap-2 ${compact ? '' : 'min-w-0'}`}>
    <label className="inline-flex min-w-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
      {loading ? <LoaderCircle size={14} className="animate-spin"/> : <Bot size={14} className="text-sky-600"/>}
      <span className="sr-only">当前模型</span>
      <select aria-label="当前模型" value={currentValue} disabled={disabled || loading} onChange={(e) => void change(e.target.value)} className={`bg-transparent font-medium outline-none disabled:opacity-60 ${compact ? 'max-w-32' : 'max-w-48'}`}>
        <option value="deepseek" disabled={!profiles.deepseek?.has_api_key}>{profiles.deepseek?.display_name || 'DeepSeek'}</option>
        <optgroup label="GLM">
          {GLM_VARIANTS.map((variant) => (
            <option key={variant.value} value={variant.value} disabled={!profiles.glm?.has_api_key}>{variant.label}</option>
          ))}
        </optgroup>
        {profiles.custom?.has_api_key && <option value="custom">{profiles.custom.display_name || profiles.custom.model_id}</option>}
      </select>
    </label>
    {error && <span role="status" className="max-w-48 truncate text-[11px] text-rose-600" title={error}>{error}</span>}
  </div>;
}
