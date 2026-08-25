'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Bot, ChevronDown, LoaderCircle } from 'lucide-react';
import { getImageModels, getModelCatalog, getModelSettings, getVideoModels, ImageModelCapability, ModelSettings, ModelVariant, saveModelSettings, VideoModelCapability } from '../lib/api';
import { chooseVideoParameterPlacement, type VideoParameterPlacement } from '../features/omni/videoParamPlacement';

export interface VideoComposerParams {
  ratio: string;
  duration: number;
  resolution: string;
  audio: boolean;
}

function VideoOrImageModelControl({
  isImage,
  options,
  value,
  onChange,
  disabled,
  loading,
  compact,
  videoParams,
  onVideoParamsChange,
}: {
  isImage: boolean;
  options: Array<ImageModelCapability | VideoModelCapability>;
  value: string;
  onChange?: (model: string) => void;
  disabled: boolean;
  loading: boolean;
  compact: boolean;
  videoParams?: VideoComposerParams;
  onVideoParamsChange?: (params: VideoComposerParams) => void;
}) {
  const selectedVideoModel = !isImage
    ? options.find((item) => item.id === value) as VideoModelCapability | undefined ?? options[0] as VideoModelCapability | undefined
    : undefined;
  const ratios = selectedVideoModel?.ratios?.length ? selectedVideoModel.ratios : ['9:16', '3:4', '1:1', '4:3', '16:9'];
  const resolutions = selectedVideoModel?.resolutions?.length ? selectedVideoModel.resolutions : ['720P', '1080P'];
  const durations = selectedVideoModel?.durations?.length ? selectedVideoModel.durations : [5, 10, 15];
  const params = videoParams ?? { ratio: '16:9', duration: 6, resolution: '768P', audio: true };
  const settingsRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [placement, setPlacement] = useState<VideoParameterPlacement>('down');
  const updateParams = (next: Partial<VideoComposerParams>) => onVideoParamsChange?.({ ...params, ...next });
  useLayoutEffect(() => {
    if (!settingsOpen || !settingsRef.current) return;
    const rect = settingsRef.current.getBoundingClientRect();
    setPlacement(chooseVideoParameterPlacement(rect.top, rect.bottom, window.innerHeight));
  }, [settingsOpen]);
  useEffect(() => {
    if (!settingsOpen) return;
    const update = () => {
      if (!settingsRef.current) return;
      const rect = settingsRef.current.getBoundingClientRect();
      setPlacement(chooseVideoParameterPlacement(rect.top, rect.bottom, window.innerHeight));
    };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [settingsOpen]);
  const labelClass = 'relative inline-flex min-w-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 shadow-sm';
  const selectClass = `appearance-none bg-transparent pr-4 font-medium outline-none disabled:opacity-60 ${compact ? 'max-w-32' : 'max-w-48'}`;
  return <div className={`flex items-center gap-2 ${compact ? '' : 'min-w-0'}`}>
    <label className={labelClass}>
      {loading ? <LoaderCircle size={14} className="animate-spin"/> : <Bot size={14} className="text-cyan-600"/>}
      <span className="sr-only">{isImage ? '图片模型' : '视频模型'}</span>
      <select aria-label={isImage ? '图片模型' : '视频模型'} value={value} disabled={disabled || loading} onChange={(event) => onChange?.(event.target.value)} className={selectClass}>
        <option value="">{isImage ? '图片 · 自动推荐' : '视频 · 自动推荐'}</option>
        {options.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
      </select>
      <ChevronDown size={13} aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
    </label>
    {!isImage && <div ref={settingsRef} className="relative shrink-0">
      <button type="button" aria-label="视频参数" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((open) => !open)} className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50">
        {params.resolution}-{params.duration}s <ChevronDown size={13} />
      </button>
      {settingsOpen && <div className={`absolute right-0 z-[90] w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-[0_18px_45px_rgba(15,23,42,0.16)] ${placement === 'up' ? 'bottom-full mb-3' : 'top-full mt-3'}`}>
        <VideoParameterGroup label="清晰度"><div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">{resolutions.map((item) => <button key={item} type="button" onClick={() => updateParams({ resolution: item })} className={`rounded-lg px-3 py-2 text-sm ${params.resolution === item ? 'bg-white font-medium shadow-sm' : 'text-slate-500'}`}>{item}</button>)}</div></VideoParameterGroup>
        <VideoParameterGroup label="比例"><div className="grid grid-cols-5 gap-1">{ratios.map((item) => <button key={item} type="button" onClick={() => updateParams({ ratio: item })} className={`rounded-lg px-1 py-2 text-xs ${params.ratio === item ? 'bg-indigo-50 text-indigo-600' : 'text-slate-500'}`}>{item}</button>)}</div></VideoParameterGroup>
        <VideoParameterGroup label="视频时长"><div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">{durations.map((item) => <button key={item} type="button" onClick={() => updateParams({ duration: item })} className={`rounded-lg px-2 py-2 text-sm ${params.duration === item ? 'bg-white font-medium shadow-sm' : 'text-slate-500'}`}>{item}秒</button>)}</div></VideoParameterGroup>
        <VideoParameterGroup label="智能配音"><div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1"><button type="button" onClick={() => updateParams({ audio: false })} className={`rounded-lg px-3 py-2 text-sm ${!params.audio ? 'bg-white font-medium shadow-sm' : 'text-slate-500'}`}>关</button><button type="button" disabled={!selectedVideoModel?.supports_audio} onClick={() => updateParams({ audio: true })} className={`rounded-lg px-3 py-2 text-sm ${params.audio ? 'bg-white font-medium shadow-sm' : 'text-slate-500'} disabled:opacity-40`}>开</button></div></VideoParameterGroup>
      </div>}
    </div>}
  </div>;
}

function VideoParameterGroup({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-2 py-2"><p className="text-sm font-medium text-slate-700">{label}</p>{children}</div>;
}

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
  minimax: [
    { value: 'minimax:MiniMax-M3', label: 'MiniMax M3 · 旗舰', model_id: 'MiniMax-M3', supports_vision: true, thinking_control: 'minimax', input_context: 1000000, output_context: 32000 },
    { value: 'minimax:MiniMax-M2.7', label: 'MiniMax M2.7 · 均衡', model_id: 'MiniMax-M2.7', supports_vision: false, thinking_control: 'minimax', input_context: 204800, output_context: 32000 },
    { value: 'minimax:MiniMax-M2.7-highspeed', label: 'MiniMax M2.7 极速', model_id: 'MiniMax-M2.7-highspeed', supports_vision: false, thinking_control: 'minimax', input_context: 204800, output_context: 32000 },
    { value: 'minimax:MiniMax-M2.5', label: 'MiniMax M2.5 · 性价比', model_id: 'MiniMax-M2.5', supports_vision: false, thinking_control: 'minimax', input_context: 204800, output_context: 32000 },
    { value: 'minimax:MiniMax-M2.5-highspeed', label: 'MiniMax M2.5 极速', model_id: 'MiniMax-M2.5-highspeed', supports_vision: false, thinking_control: 'minimax', input_context: 204800, output_context: 32000 },
  ],
};

const REASONING_EFFORTS = ['max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none'] as const;
// Why: 千问思考协议是 token 预算制（thinking_budget），用三档语义化档位降低理解成本。
const THINKING_BUDGETS = [
  { value: 2000, label: '思考 · 轻' },
  { value: 8000, label: '思考 · 标准' },
  { value: 16000, label: '思考 · 深' },
] as const;
// Why: MiniMax 思考协议同为预算制（Anthropic budget_tokens，下限 1024 且必须小于 max_tokens）；
// 档位与 chat.py 默认 4096 对齐，重思考场景放宽到 16K（后端 build_thinking_payload 双侧 clamp 兜底）。
const MINIMAX_THINKING_BUDGETS = [
  { value: 2048, label: '思考 · 轻' },
  { value: 4096, label: '思考 · 标准' },
  { value: 16384, label: '思考 · 深' },
] as const;
// Why: DeepSeek 官方 effort 字面 4 档（low/high/xhigh/max），与 GLM 7 档、千问 3 档完全隔离。
// 关闭思考通过 thinking_enabled=false 控制，不混入 effort 选择器。
const DEEPSEEK_EFFORTS = [
  { value: 'low', label: '低' },
  { value: 'high', label: '标准' },
  { value: 'xhigh', label: '加强' },
  { value: 'max', label: '最强' },
] as const;

type ComposerCapability = 'omni' | 'ppt' | 'music' | 'writing' | 'image' | 'video' | 'research';

const FALLBACK_IMAGE_MODELS: ImageModelCapability[] = [
  { id: 'qwen-image-3.0-pro', name: '千问 3.0 Pro', provider: 'qianwen', description: '', max_outputs: 6, max_width: 2048, max_height: 2048, supports_negative_prompt: true, enabled: true },
  { id: 'wan2.7-image-pro', name: '万相 2.7 Pro', provider: 'qianwen', description: '', max_outputs: 4, max_width: 4096, max_height: 4096, supports_negative_prompt: true, enabled: true },
  { id: 'glm-image', name: '智谱 GLM-Image', provider: 'zhipu', description: '', max_outputs: 4, max_width: 2048, max_height: 2048, supports_negative_prompt: false, enabled: true },
  { id: 'image-01', name: 'MiniMax image-01', provider: 'minimax', description: '', max_outputs: 4, max_width: 2048, max_height: 2048, supports_negative_prompt: false, enabled: true },
];

const FALLBACK_VIDEO_MODELS: VideoModelCapability[] = [
  { id: 'wan2.7-t2v', name: 'Wan 2.7', provider: 'qianwen', description: '', modes: ['text_to_video'], future_modes: [], ratios: ['16:9', '9:16', '1:1'], resolutions: ['720P'], duration_min: 2, duration_max: 10, durations: [5], supports_audio: false, supports_audio_input: false, enabled: true },
  { id: 'wan2.6-t2v', name: 'Wan 2.6', provider: 'qianwen', description: '', modes: ['text_to_video'], future_modes: [], ratios: ['16:9', '9:16', '1:1'], resolutions: ['720P'], duration_min: 2, duration_max: 10, durations: [5], supports_audio: false, supports_audio_input: false, enabled: true },
];

interface ModelQuickSwitcherProps {
  disabled?: boolean;
  compact?: boolean;
  preferredCapability?: ComposerCapability;
  imageModel?: string;
  videoModel?: string;
  onImageModelChange?: (model: string) => void;
  onVideoModelChange?: (model: string) => void;
  videoMode?: 'text_to_video' | 'multi_image_to_video';
  videoParams?: VideoComposerParams;
  onVideoParamsChange?: (params: VideoComposerParams) => void;
}

export default function ModelQuickSwitcher({ disabled = false, compact = false, preferredCapability, imageModel = '', videoModel = '', onImageModelChange, onVideoModelChange, videoMode = 'text_to_video', videoParams, onVideoParamsChange }: ModelQuickSwitcherProps) {
  const [active, setActive] = useState<Provider>('deepseek');
  const [profiles, setProfiles] = useState<Partial<Record<Provider, ModelSettings>>>({});
  const [catalog, setCatalog] = useState<Record<string, ModelVariant[]>>(FALLBACK_CATALOG);
  const [imageModels, setImageModels] = useState<ImageModelCapability[]>(FALLBACK_IMAGE_MODELS);
  const [videoModels, setVideoModels] = useState<VideoModelCapability[]>(FALLBACK_VIDEO_MODELS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [current, deepseek, glm, qwen, minimax, custom] = await Promise.all([
        getModelSettings(), getModelSettings('deepseek'), getModelSettings('glm'), getModelSettings('qwen'), getModelSettings('minimax'), getModelSettings('custom'),
      ]);
      setActive(current.provider);
      setProfiles({ deepseek, glm, qwen, minimax, custom });
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

  useEffect(() => {
    if (preferredCapability === 'image') {
      void getImageModels().then((items) => setImageModels(items.length ? items : FALLBACK_IMAGE_MODELS)).catch(() => setImageModels(FALLBACK_IMAGE_MODELS));
    }
    if (preferredCapability === 'video') {
      void getVideoModels().then((items) => {
        const all = items.length ? items : FALLBACK_VIDEO_MODELS;
        const next = all.filter((item) => item.modes.includes(videoMode));
        setVideoModels(next);
        if ((!videoModel || !all.some((item) => item.id === videoModel && item.modes.includes(videoMode))) && next[0]) onVideoModelChange?.(next[0].id);
      }).catch(() => {
        const next = FALLBACK_VIDEO_MODELS.filter((item) => item.modes.includes(videoMode));
        setVideoModels(next);
        if ((!videoModel || !next.some((item) => item.id === videoModel)) && next[0]) onVideoModelChange?.(next[0].id);
      });
    }
  }, [onVideoModelChange, preferredCapability, videoMode, videoModel]);

  const variantsOf = useCallback(
    (provider: 'deepseek' | 'glm' | 'qwen' | 'minimax') => catalog[provider]?.length ? catalog[provider] : FALLBACK_CATALOG[provider],
    [catalog],
  );

  // Why: 当前激活的变体由 profile.model_id 反推，保证刷新页面后下拉框仍能定位到正确项。
  const currentValue = useMemo(() => {
    if (active !== 'glm' && active !== 'qwen' && active !== 'deepseek' && active !== 'minimax') return active;
    const profile = profiles[active];
    return variantsOf(active).find((variant) => variant.model_id === profile?.model_id)?.value ?? `${active}:${profile?.model_id || ''}`;
  }, [active, profiles, variantsOf]);

  const activeVariant = useMemo(() => {
    if (active !== 'glm' && active !== 'qwen' && active !== 'deepseek' && active !== 'minimax') return undefined;
    return variantsOf(active).find((variant) => variant.model_id === profiles[active]?.model_id);
  }, [active, profiles, variantsOf]);

  const change = async (rawValue: string) => {
    setLoading(true); setError('');
    try {
      let payload: ModelSettings;
      if (rawValue.startsWith('deepseek:') || rawValue.startsWith('glm:') || rawValue.startsWith('qwen:') || rawValue.startsWith('minimax:')) {
        const provider = rawValue.startsWith('deepseek:') ? 'deepseek' : rawValue.startsWith('glm:') ? 'glm' : rawValue.startsWith('minimax:') ? 'minimax' : 'qwen';
        const variant = variantsOf(provider).find((item) => item.value === rawValue);
        if (!variant) { setError('未知的模型变体'); setLoading(false); return; }
        const profile = profiles[provider];
        if (!profile?.has_api_key) {
          const label = provider === 'glm' ? ' GLM ' : provider === 'qwen' ? '千问' : provider === 'minimax' ? 'MiniMax' : 'DeepSeek';
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
          } : provider === 'minimax' ? {
            // Why: MiniMax 思考协议同为 token 预算制（budget_tokens，下限 1024）；
            // 切模型保持既有预算，首次使用给标准档 4096（chat.py 默认值对齐）。
            thinking_budget: profile.thinking_budget ?? 4096,
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

  const changeMinimaxThinkingBudget = async (budget: number) => {
    const profile = profiles.minimax;
    if (!profile) return;
    setLoading(true); setError('');
    try {
      const saved = await saveModelSettings({ ...profile, thinking_budget: budget });
      setProfiles((prev) => ({ ...prev, minimax: saved }));
      window.dispatchEvent(new Event('model-settings-changed'));
    } catch { setError('思考预算保存失败'); }
    finally { setLoading(false); }
  };

  const selectClass = `appearance-none bg-transparent pr-4 font-medium outline-none disabled:opacity-60 ${compact ? 'max-w-32' : 'max-w-48'}`;
  const labelClass = 'relative inline-flex min-w-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200';

  if (preferredCapability === 'image' || preferredCapability === 'video') {
    return <VideoOrImageModelControl
      isImage={preferredCapability === 'image'}
      options={preferredCapability === 'image' ? imageModels.filter((model) => model.enabled) : videoModels.filter((model) => model.enabled && model.modes.includes(videoMode))}
      value={preferredCapability === 'image' ? imageModel : videoModel}
      onChange={preferredCapability === 'image' ? onImageModelChange : onVideoModelChange}
      disabled={disabled}
      loading={loading}
      compact={compact}
      videoParams={videoParams}
      onVideoParamsChange={onVideoParamsChange}
    />;
  }

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
        <optgroup label="MiniMax">
          {variantsOf('minimax').map((variant) => (
            <option key={variant.value} value={variant.value} disabled={!profiles.minimax?.has_api_key}>{variant.label}</option>
          ))}
        </optgroup>
        {profiles.custom?.has_api_key && <option value="custom">{profiles.custom.display_name || profiles.custom.model_id}</option>}
      </select>
      <ChevronDown size={13} aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
    </label>
    {active === 'deepseek' && activeVariant?.thinking_control === 'deepseek' && (
      <label className={labelClass}>
        <span className="sr-only">思考强度</span>
        <select
          aria-label="思考强度"
          value={profiles.deepseek?.reasoning_effort || 'high'}
          disabled={disabled || loading}
          onChange={(e) => void changeDeepSeekEffort(e.target.value)}
          className={`appearance-none bg-transparent pr-4 font-medium outline-none disabled:opacity-60 ${compact ? 'max-w-24' : 'max-w-32'}`}
        >
          {DEEPSEEK_EFFORTS.map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </select>
        <ChevronDown size={13} aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
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
          className={`appearance-none bg-transparent pr-4 font-medium outline-none disabled:opacity-60 ${compact ? 'max-w-24' : 'max-w-32'}`}
        >
          {REASONING_EFFORTS.map((effort) => (
            <option key={effort} value={effort}>{effort}</option>
          ))}
        </select>
        <ChevronDown size={13} aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
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
          className={`appearance-none bg-transparent pr-4 font-medium outline-none disabled:opacity-60 ${compact ? 'max-w-24' : 'max-w-32'}`}
        >
          {THINKING_BUDGETS.map((item) => (
            <option key={item.value} value={String(item.value)}>{item.label}</option>
          ))}
        </select>
        <ChevronDown size={13} aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
      </label>
    )}
    {active === 'minimax' && activeVariant?.thinking_control === 'minimax' && (
      <label className={labelClass}>
        <span className="sr-only">思考预算</span>
        <select
          aria-label="思考预算"
          value={String(profiles.minimax?.thinking_budget ?? 4096)}
          disabled={disabled || loading}
          onChange={(e) => void changeMinimaxThinkingBudget(Number(e.target.value))}
          className={`appearance-none bg-transparent pr-4 font-medium outline-none disabled:opacity-60 ${compact ? 'max-w-24' : 'max-w-32'}`}
        >
          {MINIMAX_THINKING_BUDGETS.map((item) => (
            <option key={item.value} value={String(item.value)}>{item.label}</option>
          ))}
        </select>
        <ChevronDown size={13} aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
      </label>
    )}
    {error && <span role="status" className="max-w-48 truncate text-[11px] text-rose-600" title={error}>{error}</span>}
  </div>;
}
