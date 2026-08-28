'use client';

import { useEffect, useState, useRef } from 'react';
import { ArrowLeft, Brain, Check, ChevronDown, Code, Download, Edit3, Eye, EyeOff, ExternalLink, Info, MessageSquare, Monitor, Moon, MoreVertical, Palette, Puzzle, RefreshCw, Replace, Search, Settings, ShieldCheck, Sun, Trash2, Type, X } from 'lucide-react';
import { getMemorySettings, getMemoryTracesMarkdown, getModelCatalog, getModelSettings, MemoryProfile, MemorySettings, ModelSettings, ModelVariant, saveMemorySettings, saveModelSettings, BuiltinPlugin, McpPluginItem, SkillCapsule, HookRecord, getHooks, toggleHook, getMcpMarketplace, getPlugins, getSkills, toggleMcp, togglePlugin, toggleSkill, setSkillStatus, deleteSkill, getSkillContent, updateSkillContent, downloadSkill, getServiceSettings, saveServiceSettings } from '../lib/api';
import MarkdownMessage from './MarkdownMessage';

type Theme = 'system' | 'light' | 'dark';
type Font = 'system' | 'inter' | 'serif' | 'mono';

const PRESETS: Record<'deepseek' | 'glm' | 'qwen' | 'minimax', Pick<ModelSettings, 'base_url' | 'model_id' | 'display_name' | 'input_context' | 'output_context'>> = {
  deepseek: { base_url: 'https://api.deepseek.com', model_id: 'deepseek-v4-flash', display_name: 'DeepSeek V4 Flash', input_context: 1000000, output_context: 384000 },
  glm: { base_url: 'https://open.bigmodel.cn/api/paas/v4', model_id: 'glm-5v-turbo', display_name: 'GLM-5V Turbo', input_context: 128000, output_context: 16000 },
  qwen: { base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model_id: 'qwen3.7-plus', display_name: '千问 Qwen3.7 Plus', input_context: 256000, output_context: 16000 },
  // Why: MiniMax 主链路走 Anthropic Messages 协议，base_url 必须是 /anthropic 端点；
  // OpenAI 兼容端点（/v1）仅由后端 _openai_compat_view 自动切换使用，用户无需感知。
  minimax: { base_url: 'https://api.minimaxi.com/anthropic', model_id: 'MiniMax-M3', display_name: 'MiniMax M3', input_context: 1000000, output_context: 32000 },
};

const PROVIDER_LABELS: Record<ModelSettings['provider'], string> = { deepseek: 'DeepSeek', glm: '智谱 GLM', qwen: '千问 Qwen', minimax: 'MiniMax', custom: '自定义' };

// Why: 同步 ModelQuickSwitcher 的 GLM 变体列表，让设置界面也能一键切换官方模型 ID，
// 避免用户手敲 model_id 拼错导致后端 is_vision_model 判定失效。
const GLM_MODEL_OPTIONS: Array<{ id: string; label: string; multimodal: boolean }> = [
  { id: 'glm-5', label: 'GLM-5', multimodal: false },
  { id: 'glm-5.1', label: 'GLM-5.1', multimodal: false },
  { id: 'glm-5.2', label: 'GLM-5.2', multimodal: false },
  { id: 'glm-5-turbo', label: 'GLM-5 Turbo', multimodal: false },
  { id: 'glm-5v-turbo', label: 'GLM-5V Turbo · 视觉', multimodal: true },
];

// Why: DeepSeek 官方在售模型（v4-flash/pro），旧 deepseek-chat 2026/07/24 弃用。
const DEEPSEEK_MODEL_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash · 性价比' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro · 旗舰' },
];

// Why: DeepSeek 官方 effort 字面 4 档（low/high/xhigh/max），与 GLM 7 档完全隔离。
const DEEPSEEK_EFFORT_OPTIONS = [
  { value: 'low', label: '低' },
  { value: 'high', label: '标准' },
  { value: 'xhigh', label: '加强' },
  { value: 'max', label: '最强' },
] as const;

// Why: 千问选项优先取后端目录接口（单一数据源），此处仅作接口不可用时的兜底。
const QWEN_FALLBACK_OPTIONS: Array<{ id: string; label: string; multimodal: boolean }> = [
  { id: 'qwen3.8-max', label: '千问 Qwen3.8 Max · 旗舰', multimodal: false },
  { id: 'qwen3.7-plus', label: '千问 Qwen3.7 Plus · 均衡', multimodal: false },
  { id: 'qwen3.7-flash', label: '千问 Qwen3.7 Flash · 性价比', multimodal: false },
  { id: 'qwen-vl-max', label: '千问 Qwen-VL Max · 视觉', multimodal: true },
];

// Why: MiniMax 选项同款策略——后端目录为单一数据源，此处仅兜底。
const MINIMAX_FALLBACK_OPTIONS: Array<{ id: string; label: string; multimodal: boolean }> = [
  { id: 'MiniMax-M3', label: 'MiniMax M3 · 旗舰 · 视觉', multimodal: true },
  { id: 'MiniMax-M2.7', label: 'MiniMax M2.7 · 均衡', multimodal: false },
  { id: 'MiniMax-M2.7-highspeed', label: 'MiniMax M2.7 极速', multimodal: false },
  { id: 'MiniMax-M2.5', label: 'MiniMax M2.5 · 性价比', multimodal: false },
  { id: 'MiniMax-M2.5-highspeed', label: 'MiniMax M2.5 极速', multimodal: false },
];

const DEFAULTS: ModelSettings = {
  provider: 'deepseek', api_format: 'openai_chat_completions', base_url: PRESETS.deepseek.base_url,
  model_id: PRESETS.deepseek.model_id, display_name: PRESETS.deepseek.display_name, api_key: '', model_family: 'default',
  input_context: 1000000, output_context: 384000, tool_call_rounds: 200, full_url: false, multimodal: false,
  text_model_id: 'glm-5-turbo', vision_model_id: 'glm-5v-turbo', thinking_enabled: true, reasoning_effort: 'high', temperature: 1, max_tokens: 16000,
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

function HookSettingsPanel({ hooks, onToggle, onOpenCenter }: { hooks: HookRecord[]; onToggle: (hook: HookRecord) => Promise<void>; onOpenCenter?: () => void }) {
  return <div className="space-y-6 p-5 sm:p-7">
    <section className="rounded-xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950/30"><div className="flex items-center gap-2"><ShieldCheck size={18} className="text-sky-600" /><h4 className="font-semibold text-slate-900 dark:text-white">HOOK 运行策略</h4></div><p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">本地单用户模式下，HOOK 默认启用并以内置处理器运行。事件只保留安全摘要和最近 100 次运行记录。</p><div className="mt-4 flex items-center justify-between rounded-lg bg-white/70 p-3 dark:bg-slate-900/60"><span className="text-sm font-medium">允许 HOOK 阻断请求</span><Toggle checked={hooks.some((hook) => hook.policy === 'block' && hook.enabled)} onChange={() => undefined} label="允许 HOOK 阻断请求" /></div></section>
    <section><div className="mb-3 flex items-center justify-between"><h4 className="font-semibold text-slate-900 dark:text-white">内置 HOOK</h4><button type="button" onClick={onOpenCenter} className="text-xs font-medium text-sky-600 hover:underline">打开管理中心</button></div><div className="space-y-2">{hooks.map((hook) => <div key={hook.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 dark:border-slate-700"><div><p className="text-sm font-medium">{hook.name}</p><p className="text-xs text-slate-500">{hook.lifecycle} · {hook.policy}</p></div><Toggle checked={hook.enabled} onChange={() => void onToggle(hook)} label={`${hook.name} 开关`} /></div>)}</div>{hooks.length === 0 && <p className="text-sm text-slate-500">正在加载 HOOK…</p>}</section>
  </div>;
}

type DirectorySubTab = 'skills' | 'connectors' | 'plugins';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  initialSection?: string | null;
  initialSubTab?: string | null;
  onOpenDirectory?: (tab?: DirectorySubTab) => void;
  onOpenHooks?: () => void;
  onInsertToChat?: (text: string) => void;
}

export default function SettingsDialog({ open, onClose, initialSection, initialSubTab, onOpenDirectory, onOpenHooks, onInsertToChat }: SettingsDialogProps) {
  const [section, setSection] = useState<'model' | 'services' | 'appearance' | 'memory' | 'directory' | 'hooks'>('model');
  const [form, setForm] = useState<ModelSettings>(DEFAULTS);
  const [advanced, setAdvanced] = useState(true);
  const [showKey, setShowKey] = useState(false);
  const [showVideoKey, setShowVideoKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [theme, setTheme] = useState<Theme>('system');
  const [font, setFont] = useState<Font>('system');
  const [qwenOptions, setQwenOptions] = useState(QWEN_FALLBACK_OPTIONS);
  const [minimaxOptions, setMinimaxOptions] = useState(MINIMAX_FALLBACK_OPTIONS);

  // ---- 全局联网服务 Key：搜索提供商选择 + Tavily / Firecrawl / Reranker / Suno ----
  // Why: 与 LLM API Key 不同，这两个是全局搜索/重排服务，不随 provider 切换。
  // GET 只返回 has_* 状态（脱敏），所以用户编辑时要么清空重填，要么我们不显示旧值（只显示"已保存 xxx 位"占位）。
  const [searchProvider, setSearchProvider] = useState<'tavily' | 'firecrawl'>('firecrawl');
  const [tavilyKey, setTavilyKey] = useState('');
  const [firecrawlKey, setFirecrawlKey] = useState('');
  const [rerankKey, setRerankKey] = useState('');
  const [sunoKey, setSunoKey] = useState('');
  const [sunoCallbackUrl, setSunoCallbackUrl] = useState('');
  const [svcHasTavily, setSvcHasTavily] = useState(false);
  const [svcHasFirecrawl, setSvcHasFirecrawl] = useState(false);
  const [svcHasRerank, setSvcHasRerank] = useState(false);
  const [svcHasSuno, setSvcHasSuno] = useState(false);
  const [svcHasSunoCallback, setSvcHasSunoCallback] = useState(false);
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyUrl, setProxyUrl] = useState('');
  const [svcHasProxy, setSvcHasProxy] = useState(false);
  const [proxyHost, setProxyHost] = useState('');
  // Firecrawl 高级参数
  const [fcEnableHighlights, setFcEnableHighlights] = useState(true);
  const [fcScrapeTopN, setFcScrapeTopN] = useState<number>(3);
  const [fcMdMaxChars, setFcMdMaxChars] = useState<number>(2000);
  // 深度调研引擎
  const [deepResearchEngine, setDeepResearchEngine] = useState<'firecrawl' | 'native'>('firecrawl');
  const [showTavilyKey, setShowTavilyKey] = useState(false);
  const [showFirecrawlKey, setShowFirecrawlKey] = useState(false);
  const [showRerankKey, setShowRerankKey] = useState(false);
  const [showSunoKey, setShowSunoKey] = useState(false);
  const [svcSaving, setSvcSaving] = useState(false);
  const [svcMessage, setSvcMessage] = useState('');

  // ---- 模型记忆模块状态 ----
  const [memForm, setMemForm] = useState<MemorySettings | null>(null);
  const [memMode, setMemMode] = useState<'global' | 'code'>('global');
  const [memSaving, setMemSaving] = useState(false);
  const [memMessage, setMemMessage] = useState('');
  const [memTrace, setMemTrace] = useState('');
  const [memTraceLoading, setMemTraceLoading] = useState(false);
  const [memLoaded, setMemLoaded] = useState(false);

  // ---- Directory 模块状态（计划书 §5）----
  const [dirSubTab, setDirSubTab] = useState<DirectorySubTab>('skills');
  const [dirSkills, setDirSkills] = useState<SkillCapsule[]>([]);
  const [dirMcps, setDirMcps] = useState<McpPluginItem[]>([]);
  const [dirPlugins, setDirPlugins] = useState<BuiltinPlugin[]>([]);
  const [dirSkillsLoaded, setDirSkillsLoaded] = useState(false);
  const [dirMcpsLoaded, setDirMcpsLoaded] = useState(false);
  const [dirPluginsLoaded, setDirPluginsLoaded] = useState(false);
  const [hookSettings, setHookSettings] = useState<HookRecord[]>([]);
  const [hookSettingsLoaded, setHookSettingsLoaded] = useState(false);
  const [dirBusyId, setDirBusyId] = useState<string | number | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<SkillCapsule | null>(null);
  const [skillContent, setSkillContent] = useState('');
  const [skillOriginalContent, setSkillOriginalContent] = useState('');
  const [skillContentLoading, setSkillContentLoading] = useState(false);
  const [skillSaving, setSkillSaving] = useState(false);
  const [skillIsDirty, setSkillIsDirty] = useState(false);
  const [skillViewMode, setSkillViewMode] = useState<'preview' | 'source'>('preview');
  const [skillShowMenu, setSkillShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    getModelSettings().then((data) => setForm({ ...DEFAULTS, ...data, api_key: '' })).catch(() => setMessage('后端未连接，外观设置仍可正常使用'));
    getServiceSettings()
      .then((svc) => {
        setSearchProvider(svc.search_provider || 'firecrawl');
        setSvcHasTavily(svc.has_tavily_key);
        setSvcHasFirecrawl(svc.has_firecrawl_key);
        setSvcHasRerank(svc.has_rerank_key);
        setSvcHasSuno(Boolean(svc.has_suno_key));
        setSvcHasSunoCallback(Boolean(svc.has_suno_callback));
        setSunoCallbackUrl(svc.suno_callback_base_url || '');
        setProxyEnabled(Boolean(svc.proxy_enabled));
        setSvcHasProxy(Boolean(svc.has_proxy));
        setProxyHost(svc.proxy_host || '');
        setProxyUrl('');
        // Firecrawl 高级参数：GET 回显，首次加载直接回填
        setFcEnableHighlights(typeof svc.firecrawl_enable_highlights === 'boolean' ? svc.firecrawl_enable_highlights : true);
        setFcScrapeTopN(
          typeof svc.firecrawl_scrape_top_n === 'number'
            ? Math.max(0, Math.min(5, svc.firecrawl_scrape_top_n))
            : 3
        );
        setFcMdMaxChars(
          typeof svc.firecrawl_markdown_max_chars === 'number'
            ? Math.max(800, Math.min(4000, svc.firecrawl_markdown_max_chars))
            : 2000
        );
        setDeepResearchEngine(svc.deep_research_engine === 'native' ? 'native' : 'firecrawl');
        setTavilyKey(''); setFirecrawlKey(''); setRerankKey(''); setSunoKey(''); setSvcMessage('');
      })
      .catch(() => setSvcMessage('后端未连接，联网服务设置暂不可用'));
    getModelCatalog()
      .then((catalog) => {
        const qwen = (catalog.qwen || []) as ModelVariant[];
        if (qwen.length) setQwenOptions(qwen.map((v) => ({ id: v.model_id, label: v.label, multimodal: v.supports_vision })));
        const minimax = (catalog.minimax || []) as ModelVariant[];
        if (minimax.length) setMinimaxOptions(minimax.map((v) => ({ id: v.model_id, label: v.label, multimodal: v.supports_vision })));
      })
      .catch(() => { /* 保留兜底选项 */ });
    const saved = JSON.parse(localStorage.getItem('appearance-settings') || '{}');
    setTheme(saved.theme || 'system'); setFont(saved.font || 'system');
    // 打开时懒加载记忆设置（仅一次）
    if (!memLoaded) {
      getMemorySettings()
        .then((data) => { setMemForm(data); setMemLoaded(true); refreshMemoryTrace(); })
        .catch(() => setMemMessage('后端未连接，无法加载模型记忆配置'));
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close);
  }, [open, onClose]);

  // Why: 市场页齿轮深链——外部传入 initialSection/initialSubTab 时自动定位（计划书 §5）。
  useEffect(() => {
    if (!open || !initialSection) return;
    if (initialSection === 'directory') {
      setSection('directory');
      if (initialSubTab === 'skills' || initialSubTab === 'connectors' || initialSubTab === 'plugins') {
        setDirSubTab(initialSubTab);
      }
    }
  }, [open, initialSection, initialSubTab]);

  // Why: Directory 数据懒加载——切到 directory section 时按需拉取三个列表。
  useEffect(() => {
    if (!open || section !== 'directory') return;
    if (dirSubTab === 'skills' && !dirSkillsLoaded) {
      getSkills().then((res) => { setDirSkills(res.skills); setDirSkillsLoaded(true); }).catch(() => {});
    }
    if (dirSubTab === 'connectors' && !dirMcpsLoaded) {
      getMcpMarketplace().then((data) => { setDirMcps(data); setDirMcpsLoaded(true); }).catch(() => {});
    }
    if (dirSubTab === 'plugins' && !dirPluginsLoaded) {
      getPlugins().then((res) => { setDirPlugins(res.plugins); setDirPluginsLoaded(true); }).catch(() => {});
    }
  }, [open, section, dirSubTab, dirSkillsLoaded, dirMcpsLoaded, dirPluginsLoaded]);

  useEffect(() => {
    if (!open || section !== 'hooks' || hookSettingsLoaded) return;
    getHooks().then((res) => { setHookSettings(res.hooks); setHookSettingsLoaded(true); }).catch(() => {});
  }, [open, section, hookSettingsLoaded]);

  // Why: 监听市场页删除Skill事件，同步刷新设置页列表
  useEffect(() => {
    if (!open) return;
    const handleSkillDeleted = () => {
      if (dirSubTab === 'skills') {
        getSkills().then((res) => setDirSkills(res.skills)).catch(() => {});
      }
    };
    window.addEventListener('skill-deleted', handleSkillDeleted);
    return () => window.removeEventListener('skill-deleted', handleSkillDeleted);
  }, [open, dirSubTab]);

  // Why: 选中Skill时加载Markdown内容
  useEffect(() => {
    if (!selectedSkill) return;
    setSkillContentLoading(true);
    setSkillIsDirty(false);
    setSkillViewMode('preview');
    getSkillContent(selectedSkill.skill_id)
      .then((data) => {
        setSkillContent(data.content_md);
        setSkillOriginalContent(data.content_md);
      })
      .catch((err) => console.error('Failed to load skill content:', err))
      .finally(() => setSkillContentLoading(false));
  }, [selectedSkill?.skill_id]);

  // Why: 点击三点菜单外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setSkillShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Why: 切换到源码模式时自动聚焦textarea
  useEffect(() => {
    if (skillViewMode === 'source' && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [skillViewMode]);

  const handleSkillContentChange = (newContent: string) => {
    setSkillContent(newContent);
    setSkillIsDirty(newContent !== skillOriginalContent);
  };

  const handleSkillSave = async () => {
    if (!skillIsDirty || !selectedSkill) return;
    setSkillSaving(true);
    try {
      await updateSkillContent(selectedSkill.skill_id, skillContent);
      setSkillOriginalContent(skillContent);
      setSkillIsDirty(false);
      getSkills().then((res) => setDirSkills(res.skills)).catch(() => {});
    } catch (err) {
      console.error('Failed to save skill:', err);
    } finally {
      setSkillSaving(false);
    }
  };

  const handleSkillRevert = () => {
    setSkillContent(skillOriginalContent);
    setSkillIsDirty(false);
  };

  const handleSkillDelete = async () => {
    if (!selectedSkill || !confirm(`确定要卸载 "${selectedSkill.skill_name}" 吗？此操作不可撤销。`)) return;
    try {
      await deleteSkill(selectedSkill.skill_id);
      window.dispatchEvent(new CustomEvent('skill-deleted', { detail: selectedSkill.skill_id }));
      setDirSkills((prev) => prev.filter((s) => s.skill_id !== selectedSkill.skill_id));
      setSelectedSkill(null);
    } catch (err) {
      console.error('Failed to delete skill:', err);
    }
  };

  const handleSkillDownload = () => {
    if (!selectedSkill) return;
    downloadSkill(selectedSkill.skill_id).catch((err) => console.error('Failed to download skill:', err));
  };

  const handleSkillTryInChat = () => {
    if (!selectedSkill || !onInsertToChat) return;
    onInsertToChat(`/${selectedSkill.skill_name}`);
    onClose();
  };

  const handleSkillEditWithClaude = () => {
    if (!selectedSkill || !onInsertToChat) return;
    onInsertToChat(`/${selectedSkill.skill_name}\nHelp me edit the "${selectedSkill.skill_name}" skill using skill-creator.`);
    onClose();
  };

  const handleSkillReplace = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      setSkillContent(text);
      setSkillIsDirty(text !== skillOriginalContent);
    };
    input.click();
  };

  if (!open) return null;
  const patch = (next: Partial<ModelSettings>) => setForm((value) => ({ ...value, ...next }));
  const chooseProvider = async (provider: ModelSettings['provider']) => {
    setMessage('');
    try {
      const saved = await getModelSettings(provider);
      setForm({ ...DEFAULTS, ...saved, api_key: '' });
    } catch {
      // Why: MiniMax 预设默认模型为 M3（支持视觉），multimodal 初始为 true；M2.x 系列不支持视觉，切模型时由下拉选项的 multimodal 字段覆盖。
      patch(provider === 'custom' ? { provider, api_key: '', has_api_key: false } : { provider, ...PRESETS[provider], api_key: '', has_api_key: false, model_family: provider, multimodal: provider === 'glm' || (provider === 'minimax' && MINIMAX_FALLBACK_OPTIONS[0]?.multimodal === true) });
    }
  };
  const save = async () => {
    setSaving(true); setMessage('');
    try { const result = await saveModelSettings(form); setForm((old) => ({ ...old, ...result, api_key: '' })); window.dispatchEvent(new Event('model-settings-changed')); setMessage('配置已保存并立即生效'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '保存失败'); }
    finally { setSaving(false); }
  };
  // Why: 服务 Key 的保存/清空语义（对应后端 dict merge 逻辑）：
  //   - tavilyKey 为空 → 不传该字段 → 保留 store 原值
  //   - tavilyKey 非空 → 传非空串 → 覆盖为新值
  //   - 点"清空"按钮 → 传 '' → 显式卸载（后端回退环境变量，若环境变量也空则彻底不可用）
  // 消除 GET 脱敏导致的"空串是保留还是清空"二义性。
  const saveServices = async (opts?: { clearTavily?: boolean; clearFirecrawl?: boolean; clearRerank?: boolean; clearSuno?: boolean; clearSunoCallback?: boolean; clearProxy?: boolean }) => {
    setSvcSaving(true); setSvcMessage('');
    try {
      const payload: Parameters<typeof saveServiceSettings>[0] = {};
      // search_provider：用户切换下拉即带值；为了避免"没碰 dropdown 也强制覆盖"，
      // 与当前缓存的 svcHas* 相同值也要传（保证用户操作的确定性），但不强制传默认值。
      payload.search_provider = searchProvider;
      // Firecrawl 高级参数：每次保存都携带显式值（和下拉一样的确定性语义），
      // 避免用户改了开关但没带值，导致服务端误以为保留原值。
      payload.firecrawl_enable_highlights = Boolean(fcEnableHighlights);
      payload.firecrawl_scrape_top_n = Math.max(0, Math.min(5, Number(fcScrapeTopN) || 0));
      payload.firecrawl_markdown_max_chars = Math.max(800, Math.min(4000, Number(fcMdMaxChars) || 2000));
      payload.deep_research_engine = deepResearchEngine === 'native' ? 'native' : 'firecrawl';
      payload.proxy_enabled = proxyEnabled;
      if (opts?.clearProxy) {
        payload.clear_proxy = true;
      } else if (proxyUrl.trim()) {
        payload.proxy_url = proxyUrl.trim();
      }
      if (opts?.clearTavily) {
        payload.clearTavily = true;
      } else if (tavilyKey.trim()) {
        payload.tavily_api_key = tavilyKey.trim();
      }
      if (opts?.clearFirecrawl) {
        payload.clearFirecrawl = true;
      } else if (firecrawlKey.trim()) {
        payload.firecrawl_api_key = firecrawlKey.trim();
      }
      if (opts?.clearRerank) {
        payload.clearRerank = true;
      } else if (rerankKey.trim()) {
        payload.rerank_api_key = rerankKey.trim();
      }
      if (opts?.clearSuno) {
        payload.clearSuno = true;
      } else if (sunoKey.trim()) {
        payload.suno_api_key = sunoKey.trim();
      }
      if (opts?.clearSunoCallback) {
        payload.clearSunoCallback = true;
      } else if (sunoCallbackUrl.trim()) {
        payload.suno_callback_base_url = sunoCallbackUrl.trim();
      }
      const result = await saveServiceSettings(payload);
      setSearchProvider(result.search_provider || 'firecrawl');
      setSvcHasTavily(result.has_tavily_key);
      setSvcHasFirecrawl(result.has_firecrawl_key);
      setSvcHasRerank(result.has_rerank_key);
      setSvcHasSuno(Boolean(result.has_suno_key));
      setSvcHasSunoCallback(Boolean(result.has_suno_callback));
      setProxyEnabled(Boolean(result.proxy_enabled));
      setSvcHasProxy(Boolean(result.has_proxy));
      setProxyHost(result.proxy_host || '');
      setProxyUrl('');
      // 刷新 Firecrawl 高级参数（服务端 validator 做了 clamp）
      setFcEnableHighlights(
        typeof result.firecrawl_enable_highlights === 'boolean' ? result.firecrawl_enable_highlights : Boolean(fcEnableHighlights)
      );
      setFcScrapeTopN(
        typeof result.firecrawl_scrape_top_n === 'number'
          ? result.firecrawl_scrape_top_n
          : Math.max(0, Math.min(5, Number(fcScrapeTopN) || 0))
      );
      setFcMdMaxChars(
        typeof result.firecrawl_markdown_max_chars === 'number'
          ? result.firecrawl_markdown_max_chars
          : Math.max(800, Math.min(4000, Number(fcMdMaxChars) || 2000))
      );
      setDeepResearchEngine(result.deep_research_engine === 'native' ? 'native' : 'firecrawl');
      setTavilyKey(''); setFirecrawlKey(''); setRerankKey(''); setSunoKey(''); setSunoCallbackUrl('');
      setSvcMessage('配置已保存并立即生效，无需重启后端');
    } catch (error) {
      setSvcMessage(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSvcSaving(false);
    }
  };

  // ---- 模型记忆模块交互 ----
  const refreshMemoryTrace = (mode: 'global' | 'code' = memMode) => {
    setMemTraceLoading(true);
    getMemoryTracesMarkdown(mode)
      .then(setMemTrace)
      .catch(() => setMemTrace('（无法读取记忆痕迹，请检查后端连接）'))
      .finally(() => setMemTraceLoading(false));
  };
  const patchMemProfile = (next: Partial<MemoryProfile>) => {
    if (!memForm) return;
    const key = memMode === 'global' ? 'global_memory' : 'code_memory';
    setMemForm({ ...memForm, [key]: { ...memForm[key], ...next } });
  };
  const saveMemory = async () => {
    if (!memForm) return;
    setMemSaving(true); setMemMessage('');
    try { const result = await saveMemorySettings(memForm); setMemForm(result); setMemMessage('记忆配置已保存并实时生效'); refreshMemoryTrace(); }
    catch (error) { setMemMessage(error instanceof Error ? error.message : '保存失败'); }
    finally { setMemSaving(false); }
  };
  const memProfile: MemoryProfile | undefined = memForm ? (memMode === 'global' ? memForm.global_memory : memForm.code_memory) : undefined;

  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <div role="dialog" aria-modal="true" aria-labelledby="settings-title" className="flex h-[min(820px,94vh)] w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
      <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950 sm:block">
        <h2 id="settings-title" className="px-3 pb-5 text-lg font-semibold text-slate-900 dark:text-white">设置</h2>
        {[['model', Settings, '模型与 API'], ['services', Search, '联网服务'], ['memory', Brain, '模型记忆'], ['directory', Puzzle, 'MCP · Skills · Plugins'], ['appearance', Palette, '外观与字体']] .map(([id, Icon, label]) => <button key={id as string} type="button" onClick={() => setSection(id as 'model' | 'services' | 'memory' | 'appearance' | 'directory')} className={`mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${(section === id) ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'}`}><Icon size={18}/>{label as string}</button>)}
        <button type="button" onClick={() => setSection('hooks')} className={`mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${section === 'hooks' ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'}`}><ShieldCheck size={18}/>HOOK</button>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
          <div><h3 className="text-lg font-semibold text-slate-900 dark:text-white">{section === 'model' ? '模型与 API' : section === 'services' ? '联网服务' : section === 'memory' ? '模型记忆' : section === 'directory' ? 'MCP · Skills · Plugins' : '外观与字体'}</h3><p className="text-xs text-slate-500">{section === 'model' ? '配置用于对话和智能体任务的模型服务' : section === 'services' ? '配置 Tavily 搜索与语义重排 Key，保存后立即生效' : section === 'memory' ? '调节四层记忆的摘要/窗口/清理阈值，并预览记忆痕迹' : section === 'directory' ? '管理已安装的 MCP / Skills / Plugins' : '自定义你的阅读与使用体验'}</p></div>
          <button type="button" aria-label="关闭设置" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={20}/></button>
        </div>
        <div className="flex gap-2 border-b border-slate-200 px-5 py-3 sm:hidden dark:border-slate-700"><button onClick={() => setSection('model')} className="rounded-lg px-3 py-2 text-sm">模型</button><button onClick={() => setSection('services')} className="rounded-lg px-3 py-2 text-sm">联网</button><button onClick={() => setSection('memory')} className="rounded-lg px-3 py-2 text-sm">记忆</button><button onClick={() => setSection('directory')} className="rounded-lg px-3 py-2 text-sm">MCP·Skills</button><button onClick={() => setSection('appearance')} className="rounded-lg px-3 py-2 text-sm">外观</button></div>
        {section === 'model' ? <div className="space-y-6 p-5 sm:p-7">
          <div><label className="mb-2 block text-sm font-medium text-slate-800 dark:text-slate-200">模型服务商</label><div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{(['deepseek','glm','qwen','minimax','custom'] as const).map((id) => <button type="button" key={id} onClick={() => void chooseProvider(id)} className={`rounded-xl border p-3 text-left transition ${form.provider === id ? 'border-sky-500 bg-sky-50 ring-1 ring-sky-500 dark:bg-sky-950/40' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'}`}><span className="block text-sm font-semibold text-slate-900 dark:text-white">{PROVIDER_LABELS[id]}</span><span className="mt-1 block text-xs text-slate-500">{id === 'custom' ? 'OpenAI 兼容接口' : '官方服务'}{form.provider === id && form.has_api_key ? ' · 密钥已保存' : ''}</span></button>)}</div></div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="API 格式"><Select value={form.api_format}><option value="openai_chat_completions">OpenAI Chat Completions</option></Select></Field>
            <Field label="模型 ID" required hint={form.provider === 'deepseek' || form.provider === 'glm' || form.provider === 'qwen' || form.provider === 'minimax' ? '可从下拉框选官方模型，或手动输入' : undefined}>
              {form.provider === 'deepseek' ? (
                <div className="space-y-2">
                  <Select
                    value={DEEPSEEK_MODEL_OPTIONS.some((option) => option.id === form.model_id) ? form.model_id : '__custom__'}
                    onChange={(v) => {
                      if (v === '__custom__') return;
                      const option = DEEPSEEK_MODEL_OPTIONS.find((item) => item.id === v);
                      if (!option) return;
                      // Why: DeepSeek 模型均不支持视觉，multimodal 固定 false；切模型时同步展示名。
                      patch({
                        model_id: option.id,
                        display_name: option.label,
                        multimodal: false,
                      });
                    }}
                  >
                    {DEEPSEEK_MODEL_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                    <option value="__custom__">自定义（在下方输入框填写）</option>
                  </Select>
                  {!DEEPSEEK_MODEL_OPTIONS.some((option) => option.id === form.model_id) && (
                    <Input value={form.model_id} onChange={(v) => patch({ model_id: v })} placeholder="deepseek-v4-flash" />
                  )}
                </div>
              ) : form.provider === 'glm' ? (
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
                        display_name: option.label,
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
              ) : form.provider === 'qwen' ? (
                <div className="space-y-2">
                  <Select
                    value={qwenOptions.some((option) => option.id === form.model_id) ? form.model_id : '__custom__'}
                    onChange={(v) => {
                      if (v === '__custom__') return;
                      const option = qwenOptions.find((item) => item.id === v);
                      if (!option) return;
                      // Why: 千问无 vision_model_id 自动切换机制，视觉能力由当前模型本身决定；
                      // 切模型时同步多模态标记与默认思考预算。
                      patch({
                        model_id: option.id,
                        display_name: option.label,
                        multimodal: option.multimodal,
                        thinking_budget: form.thinking_budget ?? 8000,
                      });
                    }}
                  >
                    {qwenOptions.map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                    <option value="__custom__">自定义（在下方输入框填写）</option>
                  </Select>
                  {!qwenOptions.some((option) => option.id === form.model_id) && (
                    <Input value={form.model_id} onChange={(v) => patch({ model_id: v })} placeholder="qwen3.7-plus" />
                  )}
                </div>
              ) : form.provider === 'minimax' ? (
                <div className="space-y-2">
                  <Select
                    value={minimaxOptions.some((option) => option.id === form.model_id) ? form.model_id : '__custom__'}
                    onChange={(v) => {
                      if (v === '__custom__') return;
                      const option = minimaxOptions.find((item) => item.id === v);
                      if (!option) return;
                      // Why: MiniMax 无 vision_model_id 自动切换机制，视觉能力由所选模型本身决定（仅 M3 支持视觉）；
                      // 切模型时同步多模态标记与默认思考预算。
                      patch({
                        model_id: option.id,
                        display_name: option.label,
                        multimodal: option.multimodal,
                        thinking_budget: form.thinking_budget ?? 8000,
                      });
                    }}
                  >
                    {minimaxOptions.map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                    <option value="__custom__">自定义（在下方输入框填写）</option>
                  </Select>
                  {!minimaxOptions.some((option) => option.id === form.model_id) && (
                    <Input value={form.model_id} onChange={(v) => patch({ model_id: v })} placeholder="MiniMax-M3" />
                  )}
                </div>
              ) : (
                <Input value={form.model_id} onChange={(v) => patch({ model_id: v })}/>
              )}
            </Field>
          </div>
          <Field label="请求地址" required hint="填写服务端点地址；关闭“完整 URL”时系统会自动补充 /chat/completions。"><div className="flex gap-3"><Input value={form.base_url} placeholder="https://api.example.com/v1" onChange={(v) => patch({ base_url: v })}/><label className="flex shrink-0 items-center gap-2 text-xs text-slate-600 dark:text-slate-300">完整 URL <Toggle label="完整 URL" checked={form.full_url} onChange={(v) => patch({full_url:v})}/></label></div></Field>
          <Field label={form.provider === 'minimax' ? 'API 密钥（视频 H3）' : 'API 密钥'} required hint={form.provider === 'minimax' ? (form.has_api_key ? '已保存普通 Key（sk-api-）；留空不覆盖。仅用于视频 H3 生成。' : '普通 Key（sk-api-，H3 视频专用）；文本/搜索/PPT 用下方套餐 Key。') : (form.has_api_key ? `已保存 ${PROVIDER_LABELS[form.provider]}密钥；留空不会覆盖。` : '此服务商尚未保存密钥。密钥仅保存在本机服务端。')}><div className="relative"><Input type={showKey ? 'text' : 'password'} value={form.api_key || ''} placeholder={form.has_api_key ? '••••••••（密钥已保存）' : '输入 API 密钥'} onChange={(v) => patch({api_key:v})}/><button type="button" aria-label={showKey ? '隐藏密钥' : '显示密钥'} onClick={() => setShowKey(!showKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">{showKey ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></Field>
          {form.provider === 'minimax' && (
            <Field label="MiniMax 套餐 Key（tokenplan）" hint={form.has_minimax_video_key ? '已保存套餐 Key（sk-cp-）；留空不覆盖。用于文本/搜索/PPT 与图像生成。' : '套餐 Key（sk-cp- 前缀，tokenplan）用于文本/搜索/PPT 与图像生成；视频 H3 用上方普通 Key（sk-api-）。'}>
              <div className="relative">
                <Input type={showVideoKey ? 'text' : 'password'} value={form.minimax_video_api_key || ''} placeholder={form.has_minimax_video_key ? '••••••••（套餐 Key 已保存）' : '输入套餐 Key（sk-cp-）'} onChange={(v) => patch({minimax_video_api_key:v})}/>
                <button type="button" aria-label={showVideoKey ? '隐藏密钥' : '显示密钥'} onClick={() => setShowVideoKey(!showVideoKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">{showVideoKey ? <EyeOff size={17}/> : <Eye size={17}/>}</button>
              </div>
            </Field>
          )}
          <button type="button" onClick={() => setAdvanced(!advanced)} className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200"><ChevronDown size={16} className={`transition ${advanced ? '' : '-rotate-90'}`}/>高级配置</button>
          {advanced && <div className="space-y-5 rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-950/40">
            <div className="grid gap-5 sm:grid-cols-2"><Field label="模型展示名称" hint={`${form.display_name.length}/32`}><Input maxLength={32} value={form.display_name} onChange={(v) => patch({display_name:v})}/></Field><Field label="模型系列"><Select value={form.model_family} onChange={(v) => patch({model_family:v})}><option value="default">默认</option><option value="deepseek">DeepSeek</option><option value="glm">GLM</option><option value="reasoning">推理模型</option></Select></Field></div>
            <div className="grid gap-5 sm:grid-cols-2"><Field label="输入上下文"><NumberInput value={form.input_context} onChange={(v) => patch({input_context:v})}/></Field><Field label="输出上下文"><NumberInput value={form.output_context} onChange={(v) => patch({output_context:v})}/></Field></div>
            {form.provider === 'deepseek' && <><div className="grid gap-5 sm:grid-cols-3"><Field label="最大输出 Tokens"><NumberInput value={form.max_tokens} onChange={(v) => patch({max_tokens:v})}/></Field><Field label="Temperature" hint="思考启用时不生效"><input type="number" min={0} max={2} step={0.1} value={form.temperature} onChange={(e)=>patch({temperature:Number(e.target.value)})} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"/></Field><Field label="思考强度" hint="仅 DeepSeek 生效"><Select value={form.reasoning_effort} onChange={(v) => patch({ reasoning_effort: v })}>{DEEPSEEK_EFFORT_OPTIONS.map((item) => (<option key={item.value} value={item.value}>{item.label}</option>))}</Select></Field></div><div className="grid gap-5 sm:grid-cols-3"><label className="flex h-11 items-center justify-between self-end rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900">启用深度思考<Toggle label="启用深度思考" checked={form.thinking_enabled} onChange={(v)=>patch({thinking_enabled:v})}/></label></div></>}
            {form.provider === 'glm' && <><div className="grid gap-5 sm:grid-cols-2"><Field label="文本模型 ID" hint="无附件时自动使用"><Input value={form.text_model_id} onChange={(v) => patch({text_model_id:v})}/></Field><Field label="多模态模型 ID" hint="包含附件时自动使用"><Input value={form.vision_model_id} onChange={(v) => patch({vision_model_id:v})}/></Field></div><div className="grid gap-5 sm:grid-cols-3"><Field label="最大输出 Tokens"><NumberInput value={form.max_tokens} onChange={(v) => patch({max_tokens:v})}/></Field><Field label="Temperature"><input type="number" min={0} max={2} step={0.1} value={form.temperature} onChange={(e)=>patch({temperature:Number(e.target.value)})} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"/></Field><Field label="推理强度" hint="仅 GLM 生效"><Select value={form.reasoning_effort} onChange={(v) => patch({ reasoning_effort: v })}>{['max','xhigh','high','medium','low','minimal','none'].map((effort) => (<option key={effort} value={effort}>{effort}</option>))}</Select></Field></div><div className="grid gap-5 sm:grid-cols-3"><label className="flex h-11 items-center justify-between self-end rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900">启用深度思考<Toggle label="启用深度思考" checked={form.thinking_enabled} onChange={(v)=>patch({thinking_enabled:v})}/></label></div></>}
            {form.provider === 'qwen' && <><div className="grid gap-5 sm:grid-cols-3"><Field label="最大输出 Tokens"><NumberInput value={form.max_tokens} onChange={(v) => patch({max_tokens:v})}/></Field><Field label="Temperature"><input type="number" min={0} max={2} step={0.1} value={form.temperature} onChange={(e)=>patch({temperature:Number(e.target.value)})} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"/></Field><Field label="思考预算 Tokens" hint="仅千问生效；必须小于最大输出"><NumberInput value={form.thinking_budget ?? 8000} onChange={(v) => patch({thinking_budget:v})}/></Field></div><div className="grid gap-5 sm:grid-cols-3"><label className="flex h-11 items-center justify-between self-end rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900">启用深度思考<Toggle label="启用深度思考" checked={form.thinking_enabled} onChange={(v)=>patch({thinking_enabled:v})}/></label></div></>}
            {form.provider === 'minimax' && <><div className="grid gap-5 sm:grid-cols-3"><Field label="最大输出 Tokens"><NumberInput value={form.max_tokens} onChange={(v) => patch({max_tokens:v})}/></Field><Field label="Temperature" hint="思考启用时不生效"><input type="number" min={0} max={2} step={0.1} value={form.temperature} onChange={(e)=>patch({temperature:Number(e.target.value)})} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"/></Field><Field label="思考预算 Tokens" hint="Anthropic budget_tokens；下限 1024 且必须小于最大输出"><NumberInput value={form.thinking_budget ?? 8000} onChange={(v) => patch({thinking_budget:v})}/></Field></div><div className="grid gap-5 sm:grid-cols-3"><label className="flex h-11 items-center justify-between self-end rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900">启用深度思考<Toggle label="启用深度思考" checked={form.thinking_enabled} onChange={(v)=>patch({thinking_enabled:v})}/></label></div></>}
            <div className="grid items-end gap-5 sm:grid-cols-2"><Field label="工具调用轮次"><NumberInput value={form.tool_call_rounds} onChange={(v) => patch({tool_call_rounds:v})}/></Field><label className="flex h-11 items-center justify-between rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900">多模态支持<Toggle label="多模态支持" checked={form.multimodal} onChange={(v) => patch({multimodal:v})}/></label></div>
          </div>}
          <div className="sticky bottom-0 -mx-5 flex items-center justify-between border-t border-slate-200 bg-white/95 px-5 py-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 sm:-mx-7 sm:px-7"><span role="status" className="text-sm text-slate-500">{message}</span><button type="button" disabled={saving || !form.base_url || !form.model_id} onClick={save} className="rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">{saving ? '保存中…' : '保存配置'}</button></div>
        </div> : section === 'services' ? <div className="space-y-6 p-5 sm:p-7">
          <div className="flex items-start gap-3 rounded-xl bg-sky-50 p-4 text-sm text-sky-900 dark:bg-sky-950/40 dark:text-sky-200"><Info size={18} className="mt-0.5 shrink-0"/><div className="space-y-1"><p className="font-medium">字段语义说明</p><ul className="list-disc space-y-0.5 pl-4 text-[13px]"><li>输入框留空 → <b>保留当前已保存值</b>（后端 GET 脱敏，前端不回显明文）</li><li>填入新 Key → <b>覆盖旧值</b>（立即热更新搜索 / Reranker 客户端）</li><li>点击「清除已保存」→ <b>显式清空</b>，后续回退到环境变量（若仍无则功能降级）</li><li>GLM / 千问 <b>自带原生联网搜索</b>，不需要下方搜索服务 Key；下方服务供 DeepSeek 联网模式使用</li></ul></div></div>

          <section className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-950/40">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">应用网络代理</h4>
                <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">VPN 开启时建议填写本机 HTTP 代理，例如 http://127.0.0.1:7897。保存后对标准对话、视觉、视频和搜索请求立即生效。</p>
              </div>
              <Toggle checked={proxyEnabled} onChange={setProxyEnabled} label="启用应用网络代理" />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <Field label="代理地址" hint={svcHasProxy ? `已保存（${proxyHost || '地址已隐藏'}）；留空 = 保留当前地址` : '支持 HTTP/HTTPS；也可直接填写 127.0.0.1:7897'}>
                  <input
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={proxyUrl}
                    onChange={(e) => setProxyUrl(e.target.value)}
                    placeholder={svcHasProxy ? `🔒 已保存（${proxyHost || '地址已隐藏'}；留空 = 不修改）` : 'http://127.0.0.1:7897'}
                    className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </Field>
              </div>
              <button
                type="button"
                onClick={() => saveServices({ clearProxy: true })}
                disabled={svcSaving || !svcHasProxy}
                className="h-11 rounded-lg border border-rose-200 px-3 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-40 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/30"
              >清除已保存</button>
            </div>
          </section>

          <Field label="DeepSeek 联网搜索服务提供商" required hint="Tavily 需绑支付，额度用完可切 Firecrawl（免费档 500 credits/月，无需绑卡）">
            <div className="grid grid-cols-2 gap-3">
              {([
                ['firecrawl', 'Firecrawl（推荐 · 免费档无需绑卡）', 'https://www.firecrawl.dev'],
                ['tavily', 'Tavily（老牌，有额度限制）', 'https://tavily.com'],
              ] as const).map(([id, label, link]) => <button
                type="button"
                key={id}
                onClick={() => setSearchProvider(id)}
                className={`group flex flex-col gap-1 rounded-xl border p-4 text-left transition ${searchProvider === id ? 'border-sky-500 bg-sky-50 ring-1 ring-sky-500 dark:bg-sky-950/40' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'}`}
              >
                <span className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">{label}</span>
                  {searchProvider === id && <Check size={16} className="text-sky-600"/>}
                </span>
                <a
                  href={link}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-sky-700 dark:text-slate-400 dark:hover:text-sky-300"
                >{id === 'firecrawl' ? '注册获取 Key' : '官网'}<ExternalLink size={11}/></a>
              </button>)}
            </div>
          </Field>

          {searchProvider === 'tavily' ? (
            <Field label="Tavily API Key" required hint={svcHasTavily ? '已保存；留空则不修改。缺失时 DeepSeek 联网模式面板将提示「未配置」' : '未配置时 DeepSeek 联网模式不可用'}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <input
                    type={showTavilyKey ? 'text' : 'password'}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={svcHasTavily ? '🔒 已保存（留空 = 不修改；如需替换请重新输入）' : 'tvly-xxxxxxxxxxxxxxxx'}
                    value={tavilyKey}
                    onChange={(e) => setTavilyKey(e.target.value)}
                    className="h-11 w-full rounded-lg border border-slate-300 bg-white pr-11 pl-3 text-sm tracking-wider dark:border-slate-700 dark:bg-slate-950"
                  />
                  <button
                    type="button"
                    aria-label={showTavilyKey ? '隐藏 Tavily Key' : '显示 Tavily Key'}
                    onClick={() => setShowTavilyKey((v) => !v)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    {showTavilyKey ? <EyeOff size={16}/> : <Eye size={16}/>}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${svcHasTavily ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>{svcHasTavily ? '已配置' : '未配置'}</span>
                  <button
                    type="button"
                    onClick={() => saveServices({ clearTavily: true })}
                    disabled={svcSaving || !svcHasTavily}
                    className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-40 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/30"
                  >清除已保存</button>
                </div>
              </div>
            </Field>
          ) : (
            <Field label="Firecrawl API Key" required hint={svcHasFirecrawl ? '已保存；留空则不修改。免费档 500 credits/月（=500 次搜索），无需绑支付方式' : '未配置时 DeepSeek 联网模式不可用；注册后在 https://www.firecrawl.dev 获取 Key'}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <input
                    type={showFirecrawlKey ? 'text' : 'password'}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={svcHasFirecrawl ? '🔒 已保存（留空 = 不修改；如需替换请重新输入）' : 'fc-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'}
                    value={firecrawlKey}
                    onChange={(e) => setFirecrawlKey(e.target.value)}
                    className="h-11 w-full rounded-lg border border-slate-300 bg-white pr-11 pl-3 text-sm tracking-wider dark:border-slate-700 dark:bg-slate-950"
                  />
                  <button
                    type="button"
                    aria-label={showFirecrawlKey ? '隐藏 Firecrawl Key' : '显示 Firecrawl Key'}
                    onClick={() => setShowFirecrawlKey((v) => !v)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    {showFirecrawlKey ? <EyeOff size={16}/> : <Eye size={16}/>}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${svcHasFirecrawl ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>{svcHasFirecrawl ? '已配置' : '未配置'}</span>
                  <button
                    type="button"
                    onClick={() => saveServices({ clearFirecrawl: true })}
                    disabled={svcSaving || !svcHasFirecrawl}
                    className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-40 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/30"
                  >清除已保存</button>
                </div>
              </div>
            </Field>
          )}

          <Field label="Suno API Key（音乐生成）" required hint={svcHasSuno ? '已保存；留空则不修改。Suno 音乐生成请求只会由后端发出' : '在 sunoapi.org 获取 Key；未配置时音乐生成页会提示配置服务'}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <input
                  type={showSunoKey ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={svcHasSuno ? '🔒 已保存（留空 = 不修改；如需替换请重新输入）' : 'suno-xxxxxxxxxxxxxxxx'}
                  value={sunoKey}
                  onChange={(e) => setSunoKey(e.target.value)}
                  className="h-11 w-full rounded-lg border border-slate-300 bg-white pr-11 pl-3 text-sm tracking-wider dark:border-slate-700 dark:bg-slate-950"
                />
                <button
                  type="button"
                  aria-label={showSunoKey ? '隐藏 Suno Key' : '显示 Suno Key'}
                  onClick={() => setShowSunoKey((v) => !v)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  {showSunoKey ? <EyeOff size={16}/> : <Eye size={16}/>}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${svcHasSuno ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>{svcHasSuno ? '已配置' : '未配置'}</span>
                <button
                  type="button"
                  onClick={() => saveServices({ clearSuno: true })}
                  disabled={svcSaving || !svcHasSuno}
                  className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-40 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/30"
                >清除已保存</button>
              </div>
            </div>
          </Field>

          <Field label="Suno 回调地址（可选）" hint={svcHasSunoCallback ? '已配置；留空则不修改。只填写公网 HTTPS 基地址，例如 https://xxxx.trycloudflare.com' : '留空时使用后台轮询；配置后 Suno 会把进度推送到 /api/suno/callback'}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://xxxx.trycloudflare.com"
                value={sunoCallbackUrl}
                onChange={(e) => setSunoCallbackUrl(e.target.value)}
                className="h-11 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${svcHasSunoCallback ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>{svcHasSunoCallback ? '已配置' : '未配置（可选）'}</span>
                <button
                  type="button"
                  onClick={() => saveServices({ clearSunoCallback: true })}
                  disabled={svcSaving || !svcHasSunoCallback}
                  className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-40 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/30"
                >清除已保存</button>
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-500">Cloudflare Quick Tunnel 需要保持终端运行；地址变化后请在这里更新。回调失败不会阻塞轮询。</p>
          </Field>

          <Field label="SiliconFlow Reranker API Key（可选 · 搜索结果重排）" hint={svcHasRerank ? '已保存；留空则不修改。缺失时联网搜索保留原始排序' : '可选；提供后会按相关性对搜索结果进行语义重排'}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <input
                  type={showRerankKey ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={svcHasRerank ? '🔒 已保存（留空 = 不修改）' : 'sk-xxxxxxxxxxxxxxxxxxxxxxx'}
                  value={rerankKey}
                  onChange={(e) => setRerankKey(e.target.value)}
                  className="h-11 w-full rounded-lg border border-slate-300 bg-white pr-11 pl-3 text-sm tracking-wider dark:border-slate-700 dark:bg-slate-950"
                />
                <button
                  type="button"
                  aria-label={showRerankKey ? '隐藏 Reranker Key' : '显示 Reranker Key'}
                  onClick={() => setShowRerankKey((v) => !v)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  {showRerankKey ? <EyeOff size={16}/> : <Eye size={16}/>}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${svcHasRerank ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>{svcHasRerank ? '已配置' : '未配置（可选）'}</span>
                <button
                  type="button"
                  onClick={() => saveServices({ clearRerank: true })}
                  disabled={svcSaving || !svcHasRerank}
                  className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-40 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/30"
                >清除已保存</button>
              </div>
            </div>
          </Field>

          {/* Firecrawl 高级参数 */}
          <div className="space-y-5 rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-950/40">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Firecrawl 高级参数</h4>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${searchProvider === 'firecrawl' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}>
                {searchProvider === 'firecrawl' ? '当前生效' : '切到 Firecrawl 时生效'}
              </span>
            </div>
            <p className="text-xs text-slate-500">免费档 500 credits/月：Search ≈ 1 credit/次；Scrape = 1 credit/页；Research 任务按深度 ≈ 10~50 credits/次。</p>

            <Field label="查询命中高亮（Search Highlights）" hint="开启后每条结果附带命中上下文片段 + 分数，前端联网面板可读性显著提升。约 0 credit。">
              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                <div>
                  <div className="text-sm font-medium text-slate-800 dark:text-slate-100">启用高亮片段</div>
                  <div className="text-xs text-slate-500">maxNumHighlights=5，charsBefore=40 / charsAfter=80</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={fcEnableHighlights}
                  onClick={() => setFcEnableHighlights((v) => !v)}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${fcEnableHighlights ? 'bg-sky-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                >
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${fcEnableHighlights ? 'translate-x-5' : 'translate-x-0.5'}`}/>
                </button>
              </div>
            </Field>

            <Field label={`抓取前 N 条结果全文（/v1/scrape）：当前 = ${fcScrapeTopN} 条`} hint="对搜索结果前 N 条 URL 额外调 /v1/scrape 拿整页 Markdown 替换摘要，显著提升 LLM 理解度。0=关闭。每页 = 1 credit。">
              <div className="flex items-center gap-4 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                <input
                  type="range"
                  min={0}
                  max={5}
                  step={1}
                  value={fcScrapeTopN}
                  onChange={(e) => setFcScrapeTopN(Math.max(0, Math.min(5, Number(e.target.value) || 0)))}
                  className="w-full accent-sky-600"
                />
                <div className="grid w-[132px] grid-cols-6 gap-1">
                  {[0,1,2,3,4,5].map((v) => (
                    <button key={v} type="button" aria-label={`scrapeTopN=${v}`} onClick={() => setFcScrapeTopN(v)} className={`h-6 w-5 rounded text-xs font-semibold transition ${v === fcScrapeTopN ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'}`}>{v}</button>
                  ))}
                </div>
              </div>
            </Field>

            <Field label={`抓取页 Markdown 截断字符数：${fcMdMaxChars}`} hint="800 ~ 4000。调大 = 每页塞更多上下文给 Reranker/LLM，更占 token；调小 = 更省 token，可能丢失细节。">
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={800}
                  max={4000}
                  step={100}
                  value={fcMdMaxChars}
                  onChange={(e) => setFcMdMaxChars(Math.max(800, Math.min(4000, Number(e.target.value) || 2000)))}
                  className="w-full accent-sky-600"
                />
                <NumberInput value={fcMdMaxChars} onChange={(v) => setFcMdMaxChars(Math.max(800, Math.min(4000, Number(v) || 2000)))} />
              </div>
            </Field>
          </div>

          {/* 深度调研模式引擎 */}
          <Field label="深度调研模式默认引擎" required hint="Firecrawl Research（/v1/research）是官方异步 Job 端到端报告；自研链路保留作为无 Key / 故障兜底，无需 Key 自动降级。">
            <div className="grid grid-cols-2 gap-3">
              {([
                ['firecrawl', 'Firecrawl Deep Research（推荐）', '端到端异步 Job；产出质量高；免费档配额内每日可跑数轮'],
                ['native', '自研 day32 + day33（兜底）', '子查询裂变→抓取→BGE Reranker→本地 DeepSeek-R1 推理；需要 Tavily/Firecrawl Key + LLM Key'],
              ] as const).map(([id, title, desc]) => <button
                type="button"
                key={id}
                onClick={() => setDeepResearchEngine(id)}
                className={`group flex flex-col gap-1 rounded-xl border p-4 text-left transition ${deepResearchEngine === id ? 'border-sky-500 bg-sky-50 ring-1 ring-sky-500 dark:bg-sky-950/40' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'}`}
              >
                <span className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">{title}</span>
                  {deepResearchEngine === id && <Check size={16} className="text-sky-600"/>}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">{desc}</span>
              </button>)}
            </div>
          </Field>

          <div className="sticky bottom-0 -mx-5 flex items-center justify-between border-t border-slate-200 bg-white/95 px-5 py-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 sm:-mx-7 sm:px-7">
            <span role="status" className="text-sm text-slate-500">{svcMessage}</span>
            <button
              type="button"
              onClick={() => saveServices()}
              disabled={svcSaving}
              className="rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
            >{svcSaving ? '保存中…' : '保存并立即生效'}</button>
          </div>
        </div> : section === 'memory' ? <div className="space-y-6 p-5 sm:p-7">
          {/* 模式切换：全局记忆（聊天）/ code 模式记忆（代码）两套独立画像 */}
          <div><label className="mb-2 block text-sm font-medium text-slate-800 dark:text-slate-200">记忆模式</label><div className="grid grid-cols-2 gap-2">{([['global','全局记忆','聊天/调研/多智能体等非代码模式共用'],['code','Code 模式记忆','代码任务专属，含 VFS 快照']] as const).map(([id, label, desc]) => <button type="button" key={id} onClick={() => setMemMode(id)} className={`rounded-xl border p-3 text-left transition ${memMode === id ? 'border-sky-500 bg-sky-50 ring-1 ring-sky-500 dark:bg-sky-950/40' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'}`}><span className="block text-sm font-semibold text-slate-900 dark:text-white">{label}</span><span className="mt-1 block text-xs text-slate-500">{desc}</span></button>)}</div></div>
          <div className="flex items-center gap-3 rounded-xl bg-sky-50 p-4 text-sm text-sky-900 dark:bg-sky-950/40 dark:text-sky-200"><Info size={18} className="shrink-0"/>两套画像完全独立，字段一致、默认不同。修改后保存即实时生效。</div>
          {memProfile && <div className="grid gap-5 sm:grid-cols-2">
            <Field label="摘要触发轮数" hint="未摘要轮数达到即压缩"><NumberInput value={memProfile.summary_turn_threshold} onChange={(v) => patchMemProfile({ summary_turn_threshold: v })}/></Field>
            <Field label="摘要触发 Token" hint="未摘要内容估算超量即压缩"><NumberInput value={memProfile.summary_token_threshold} onChange={(v) => patchMemProfile({ summary_token_threshold: v })}/></Field>
            <Field label="滑动窗口 K" hint="L4 保留的最近轮/条数"><NumberInput value={memProfile.window_k} onChange={(v) => patchMemProfile({ window_k: v })}/></Field>
            <Field label="事件保留条数" hint="账本每会话保留量"><NumberInput value={memProfile.event_keep} onChange={(v) => patchMemProfile({ event_keep: v })}/></Field>
            <Field label="摘要保留条数" hint="摘要每会话保留量"><NumberInput value={memProfile.summary_keep} onChange={(v) => patchMemProfile({ summary_keep: v })}/></Field>
            <Field label="压缩保留原文" hint="摘要压缩区间保留最近原文条数"><NumberInput value={memProfile.keep_recent_events} onChange={(v) => patchMemProfile({ keep_recent_events: v })}/></Field>
            <Field label="降级截断字符" hint="LLM 压缩失败时的截断长度"><NumberInput value={memProfile.fallback_chars} onChange={(v) => patchMemProfile({ fallback_chars: v })}/></Field>
            <Field label="扫描上限" hint="摘要素材最大扫描事件数"><NumberInput value={memProfile.scan_limit} onChange={(v) => patchMemProfile({ scan_limit: v })}/></Field>
            <Field label="档案卡保留天数" hint="失效档案卡到期清理"><NumberInput value={memProfile.profile_inactive_ttl_days} onChange={(v) => patchMemProfile({ profile_inactive_ttl_days: v })}/></Field>
          </div>}
          {/* 共享的 Token 预算与 VFS 节流参数 */}
          <div className="space-y-5 rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-950/40">
            <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">上下文 Token 预算与快照节流（两套共用）</h4>
            {memForm && <div className="grid gap-5 sm:grid-cols-2">
              <Field label="档案卡预算 (token)"><NumberInput value={memForm.profile_token_budget} onChange={(v) => setMemForm({ ...memForm, profile_token_budget: v })}/></Field>
              <Field label="摘要预算 (token)"><NumberInput value={memForm.summary_token_budget} onChange={(v) => setMemForm({ ...memForm, summary_token_budget: v })}/></Field>
              <Field label="窗口预算 (token)"><NumberInput value={memForm.window_token_budget} onChange={(v) => setMemForm({ ...memForm, window_token_budget: v })}/></Field>
              <Field label="快照最小间隔 (秒)" hint="自动快照节流"><input type="number" min={0} step={0.5} value={memForm.vfs_min_save_interval} onChange={(e) => setMemForm({ ...memForm, vfs_min_save_interval: Number(e.target.value) })} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"/></Field>
              <Field label="快照保留数量"><NumberInput value={memForm.vfs_max_keep} onChange={(v) => setMemForm({ ...memForm, vfs_max_keep: v })}/></Field>
            </div>}
          </div>
          {/* 记忆痕迹 .md 预览 */}
          <div>
            <div className="mb-2 flex items-center justify-between"><h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">记忆痕迹预览（.md）</h4><button type="button" onClick={() => refreshMemoryTrace()} disabled={memTraceLoading} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300">{memTraceLoading ? '加载中…' : '刷新'}</button></div>
            <div className="max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950">
              {memTrace ? <MarkdownMessage content={memTrace}/> : <p className="text-sm text-slate-400">点击刷新加载记忆痕迹，或将鼠标悬停查看实时内容。</p>}
            </div>
          </div>
          <div className="sticky bottom-0 -mx-5 flex items-center justify-between border-t border-slate-200 bg-white/95 px-5 py-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 sm:-mx-7 sm:px-7"><span role="status" className="text-sm text-slate-500">{memMessage}</span><button type="button" disabled={memSaving || !memForm} onClick={saveMemory} className="rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">{memSaving ? '保存中…' : '保存记忆配置'}</button></div>
        </div> : section === 'appearance' ? <div className="space-y-8 p-5 sm:p-7">
          <section><div className="mb-4 flex items-center gap-2"><Palette size={18}/><h4 className="font-semibold text-slate-900 dark:text-white">主题色</h4></div><div className="grid grid-cols-3 gap-3">{([['light',Sun,'浅色'],['dark',Moon,'深色'],['system',Monitor,'跟随系统']] as const).map(([id,Icon,label]) => <button key={id} type="button" onClick={() => {setTheme(id); applyAppearance(id,font)}} className={`relative flex flex-col items-center gap-2 rounded-xl border p-5 ${theme === id ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/40' : 'border-slate-200 dark:border-slate-700'}`}><Icon size={24}/><span className="text-sm font-medium">{label}</span>{theme === id && <Check size={15} className="absolute right-2 top-2 text-sky-600"/>}</button>)}</div></section>
          <section><div className="mb-4 flex items-center gap-2"><Type size={18}/><h4 className="font-semibold text-slate-900 dark:text-white">界面字体</h4></div><div className="space-y-2">{([['system','系统默认','适合中文与日常使用'],['inter','Inter','现代、清晰的无衬线字体'],['serif','衬线字体','更适合长文本阅读'],['mono','等宽字体','适合代码与技术内容']] as const).map(([id,label,desc]) => <button key={id} type="button" onClick={() => {setFont(id); applyAppearance(theme,id)}} className={`flex w-full items-center justify-between rounded-xl border p-4 text-left ${font === id ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/40' : 'border-slate-200 dark:border-slate-700'}`}><span><span className="block text-sm font-semibold">{label}</span><span className="text-xs text-slate-500">{desc}</span></span>{font === id && <Check size={18} className="text-sky-600"/>}</button>)}</div></section>
          <div className="flex gap-3 rounded-xl bg-sky-50 p-4 text-sm text-sky-900 dark:bg-sky-950/40 dark:text-sky-200"><Info size={18} className="shrink-0"/>主题和字体选择会即时生效，并自动保存在此浏览器中。</div>
        </div> : section === 'hooks' ? <HookSettingsPanel hooks={hookSettings} onToggle={async (hook) => { const updated = await toggleHook(hook.id, !hook.enabled); setHookSettings((current) => current.map((item) => item.id === updated.id ? updated : item)); }} onOpenCenter={onOpenHooks} /> : section === 'directory' ? <div className="space-y-4 p-5 sm:p-7">
          {/* 子页签切换 */}
          <div className="flex gap-2 border-b border-slate-200 pb-3 dark:border-slate-700">
            {(['skills', 'connectors', 'plugins'] as const).map((st) => (
              <button key={st} type="button" onClick={() => setDirSubTab(st)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${dirSubTab === st ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
                {st === 'skills' ? 'Skills' : st === 'connectors' ? 'MCP' : 'Plugins'}
              </button>
            ))}
            <button type="button" onClick={() => onOpenDirectory?.(dirSubTab)} className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
              <ExternalLink size={13} /> Browse 市场
            </button>
          </div>

          {/* Skills 列表/详情 */}
          {dirSubTab === 'skills' && !selectedSkill && (
            <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-400 dark:border-slate-700 dark:bg-slate-950">
                  <th className="px-4 py-2 font-medium">名称</th>
                  <th className="w-24 px-2 py-2 font-medium">来源</th>
                  <th className="w-20 px-2 py-2 font-medium">状态</th>
                  <th className="w-28 px-4 py-2 font-medium">操作</th>
                </tr></thead>
                <tbody>
                  {dirSkills.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-xs text-slate-400">暂无 Skill</td></tr>
                  ) : dirSkills.map((skill) => {
                    const busy = dirBusyId === skill.skill_id;
                    return (
                      <tr 
                        key={skill.skill_id} 
                        className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
                        onClick={() => setSelectedSkill(skill)}
                      >
                        <td className="px-4 py-2.5">
                          <div className="truncate font-medium text-slate-800 dark:text-slate-200">{skill.skill_name}</div>
                          {skill.skill_type !== 'instruction' && (
                            <div className="mt-0.5 text-[10px] text-slate-400">成功 {skill.success_count} · 失败 {skill.failure_count}</div>
                          )}
                        </td>
                        <td className="px-2 py-2.5 text-xs text-slate-500">{skill.author || '—'}</td>
                        <td className="px-2 py-2.5">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] ${skill.status === 'published' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                            {skill.status === 'published' ? '已上架' : '待确认'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1.5">
                            {skill.status === 'pending' && (
                              <button type="button" disabled={busy} onClick={async () => { setDirBusyId(skill.skill_id); try { await setSkillStatus(skill.skill_id, 'published'); setDirSkills((prev) => prev.map((s) => s.skill_id === skill.skill_id ? { ...s, status: 'published' } : s)); } catch { /* noop */ } finally { setDirBusyId(null); } }} className="rounded border border-emerald-200 px-2 py-0.5 text-[11px] text-emerald-700 hover:bg-emerald-50 disabled:opacity-40">上架</button>
                            )}
                            {skill.status === 'published' && (
                              <button type="button" disabled={busy} onClick={async () => { setDirBusyId(skill.skill_id); try { await setSkillStatus(skill.skill_id, 'pending'); setDirSkills((prev) => prev.map((s) => s.skill_id === skill.skill_id ? { ...s, status: 'pending' } : s)); } catch { /* noop */ } finally { setDirBusyId(null); } }} className="rounded border border-amber-200 px-2 py-0.5 text-[11px] text-amber-700 hover:bg-amber-50 disabled:opacity-40">下架</button>
                            )}
                            <button type="button" disabled={busy} onClick={async () => { if (!window.confirm(`删除「${skill.skill_name}」？`)) return; setDirBusyId(skill.skill_id); try { await deleteSkill(skill.skill_id); setDirSkills((prev) => prev.filter((s) => s.skill_id !== skill.skill_id)); window.dispatchEvent(new CustomEvent('skill-deleted', { detail: skill.skill_id })); } catch { /* noop */ } finally { setDirBusyId(null); } }} className="rounded border border-rose-200 px-2 py-0.5 text-[11px] text-rose-600 hover:bg-rose-50 disabled:opacity-40">删除</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Skill 详情面板（内联在设置页中） */}
          {dirSubTab === 'skills' && selectedSkill && (
            <div className="flex flex-col h-[calc(100vh-320px)] min-h-[500px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-4 py-3 bg-slate-50 dark:bg-slate-800/50">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setSelectedSkill(null)}
                    className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                    title="返回列表"
                  >
                    <ArrowLeft size={18} />
                  </button>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-semibold text-slate-900 dark:text-white truncate">
                        {selectedSkill.skill_name}
                      </h2>
                      <span className="px-2 py-0.5 text-xs rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
                        {selectedSkill.skill_type === 'instruction' ? 'instruction' : selectedSkill.skill_type}
                      </span>
                      {skillIsDirty && (
                        <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                          未保存
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">by {selectedSkill.author || 'You'}</p>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  {/* 启用开关 */}
                  <button
                    type="button"
                    onClick={async () => {
                      setDirBusyId(selectedSkill.skill_id);
                      try {
                        const result = await toggleSkill(selectedSkill.skill_id, !selectedSkill.enabled);
                        const updated = { ...selectedSkill, enabled: result.enabled };
                        setSelectedSkill(updated);
                        setDirSkills((prev) => prev.map((s) => s.skill_id === selectedSkill.skill_id ? updated : s));
                      } catch { /* noop */ } finally { setDirBusyId(null); }
                    }}
                    className={`relative h-6 w-11 rounded-full transition ${selectedSkill.enabled ? 'bg-sky-600' : 'bg-slate-300 dark:bg-slate-600'} ${dirBusyId === selectedSkill.skill_id ? 'opacity-40' : ''}`}
                    disabled={dirBusyId === selectedSkill.skill_id}
                  >
                    <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition ${selectedSkill.enabled ? 'left-6' : 'left-1'}`} />
                  </button>

                  {/* 视图模式切换 */}
                  <div className="flex items-center bg-slate-200 dark:bg-slate-700 rounded-lg p-0.5 mx-1">
                    <button
                      onClick={() => setSkillViewMode('preview')}
                      className={`p-1.5 rounded-md transition-colors ${
                        skillViewMode === 'preview'
                          ? 'bg-white dark:bg-slate-600 text-purple-600 dark:text-purple-400 shadow-sm'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                      }`}
                      title="预览模式"
                    >
                      <Eye size={16} />
                    </button>
                    <button
                      onClick={() => setSkillViewMode('source')}
                      className={`p-1.5 rounded-md transition-colors ${
                        skillViewMode === 'source'
                          ? 'bg-white dark:bg-slate-600 text-purple-600 dark:text-purple-400 shadow-sm'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                      }`}
                      title="源码编辑"
                    >
                      <Code size={16} />
                    </button>
                  </div>

                  {/* 三点菜单 */}
                  <div className="relative" ref={menuRef}>
                    <button
                      onClick={() => setSkillShowMenu(!skillShowMenu)}
                      className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                    >
                      <MoreVertical size={18} />
                    </button>

                    {skillShowMenu && (
                      <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 py-1 z-10">
                        <button
                          onClick={() => {
                            setSkillShowMenu(false);
                            handleSkillTryInChat();
                          }}
                          className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                          <MessageSquare size={16} />
                          Try in chat
                        </button>
                        <button
                          onClick={() => {
                            setSkillShowMenu(false);
                            setSkillViewMode('source');
                          }}
                          className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                          <Edit3 size={16} />
                          Edit
                        </button>
                        <button
                          onClick={() => {
                            setSkillShowMenu(false);
                            handleSkillEditWithClaude();
                          }}
                          className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                          <MessageSquare size={16} />
                          Edit with Claude
                        </button>
                        <button
                          onClick={() => {
                            setSkillShowMenu(false);
                            handleSkillReplace();
                          }}
                          className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                          <Replace size={16} />
                          Replace
                        </button>
                        <button
                          onClick={() => {
                            setSkillShowMenu(false);
                            handleSkillDownload();
                          }}
                          className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                          <Download size={16} />
                          Download
                        </button>
                        {skillIsDirty && (
                          <button
                            onClick={() => {
                              setSkillShowMenu(false);
                              handleSkillRevert();
                            }}
                            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                          >
                            <RefreshCw size={16} />
                            Revert changes
                          </button>
                        )}
                        <div className="border-t border-slate-200 dark:border-slate-700 my-1" />
                        <button
                          onClick={() => {
                            setSkillShowMenu(false);
                            handleSkillDelete();
                          }}
                          className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                        >
                          <Trash2 size={16} />
                          Uninstall
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 描述 */}
              {selectedSkill.description && (
                <div className="px-6 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30">
                  <p className="text-sm text-slate-600 dark:text-slate-400">{selectedSkill.description}</p>
                </div>
              )}

              {/* 内容区域 */}
              <div className="flex-1 overflow-hidden bg-white dark:bg-slate-900">
                {skillContentLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
                  </div>
                ) : skillViewMode === 'preview' ? (
                  <div className="h-full overflow-y-auto p-6">
                    <div className="max-w-4xl mx-auto prose dark:prose-invert prose-sm prose-headings:font-semibold prose-p:leading-relaxed">
                      <MarkdownMessage content={skillContent} />
                    </div>
                  </div>
                ) : (
                  <textarea
                    ref={textareaRef}
                    value={skillContent}
                    onChange={(e) => handleSkillContentChange(e.target.value)}
                    className="w-full h-full p-6 font-mono text-sm bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 resize-none outline-none border-none"
                    spellCheck={false}
                    placeholder="编写 Skill Markdown 内容..."
                  />
                )}
              </div>

              {/* 底部栏（源码模式显示保存按钮） */}
              {skillViewMode === 'source' && (
                <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-700 px-4 py-3 bg-slate-50 dark:bg-slate-800/50">
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {skillContent.length} 字符
                  </div>
                  <div className="flex items-center gap-2">
                    {skillIsDirty && (
                      <button
                        onClick={handleSkillRevert}
                        className="px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
                      >
                        还原
                      </button>
                    )}
                    <button
                      onClick={handleSkillSave}
                      disabled={!skillIsDirty || skillSaving}
                      className="px-4 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
                    >
                      {skillSaving ? (
                        <>
                          <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white"></div>
                          保存中...
                        </>
                      ) : (
                        '保存'
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* MCP 列表 */}
          {dirSubTab === 'connectors' && (
            <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-400 dark:border-slate-700 dark:bg-slate-950">
                  <th className="px-4 py-2 font-medium">名称</th>
                  <th className="w-24 px-2 py-2 font-medium">状态</th>
                  <th className="w-16 px-2 py-2 font-medium">工具</th>
                  <th className="w-20 px-4 py-2 font-medium">开关</th>
                </tr></thead>
                <tbody>
                  {dirMcps.filter((m) => m.is_installed).length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-xs text-slate-400">暂无已安装的 MCP</td></tr>
                  ) : dirMcps.filter((m) => m.is_installed).map((mcp) => {
                    const busy = dirBusyId === mcp.id;
                    return (
                      <tr key={mcp.id} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="px-4 py-2.5">
                          <span className="mr-1">{mcp.icon}</span>
                          <span className="font-medium text-slate-800 dark:text-slate-200">{mcp.name}</span>
                        </td>
                        <td className="px-2 py-2.5">
                          <span className={`inline-block h-2 w-2 rounded-full ${mcp.runtime?.status === 'ready' ? 'bg-emerald-500' : mcp.runtime?.status === 'error' ? 'bg-rose-500' : 'bg-slate-300'}`} />
                          <span className="ml-1.5 text-[10px] text-slate-500">{mcp.runtime?.status ?? '—'}</span>
                        </td>
                        <td className="px-2 py-2.5 text-xs text-slate-500">{mcp.runtime?.tool_count ?? 0}</td>
                        <td className="px-4 py-2.5">
                          <button type="button" disabled={busy} onClick={async () => { setDirBusyId(mcp.id); try { await toggleMcp(mcp.id); const list = await getMcpMarketplace(); setDirMcps(list); } catch { /* noop */ } finally { setDirBusyId(null); } }} className={`relative h-5 w-9 rounded-full transition ${mcp.is_enabled ? 'bg-sky-600' : 'bg-slate-300 dark:bg-slate-600'} disabled:opacity-40`}>
                            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${mcp.is_enabled ? 'left-5' : 'left-0.5'}`} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Plugins 列表 */}
          {dirSubTab === 'plugins' && (
            <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-400 dark:border-slate-700 dark:bg-slate-950">
                  <th className="px-4 py-2 font-medium">名称</th>
                  <th className="px-2 py-2 font-medium">描述</th>
                  <th className="w-20 px-4 py-2 font-medium">开关</th>
                </tr></thead>
                <tbody>
                  {dirPlugins.length === 0 ? (
                    <tr><td colSpan={3} className="px-4 py-8 text-center text-xs text-slate-400">暂无插件</td></tr>
                  ) : dirPlugins.map((plugin) => {
                    const busy = dirBusyId === plugin.id;
                    return (
                      <tr key={plugin.id} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="px-4 py-2.5">
                          <span className="mr-1">{plugin.icon}</span>
                          <span className="font-medium text-slate-800 dark:text-slate-200">{plugin.name}</span>
                        </td>
                        <td className="max-w-0 px-2 py-2.5">
                          <div className="truncate text-xs text-slate-500">{plugin.description}</div>
                        </td>
                        <td className="px-4 py-2.5">
                          <button type="button" disabled={busy} onClick={async () => { setDirBusyId(plugin.id); try { await togglePlugin(plugin.id, !plugin.enabled); setDirPlugins((prev) => prev.map((p) => p.id === plugin.id ? { ...p, enabled: !plugin.enabled } : p)); } catch { /* noop */ } finally { setDirBusyId(null); } }} className={`relative h-5 w-9 rounded-full transition ${plugin.enabled ? 'bg-sky-600' : 'bg-slate-300 dark:bg-slate-600'} disabled:opacity-40`}>
                            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${plugin.enabled ? 'left-5' : 'left-0.5'}`} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div> : null}
      </main>
    </div>
  </div>;
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) { return <label className="block"><span className="mb-2 flex justify-between text-sm font-medium text-slate-800 dark:text-slate-200"><span>{required && <b className="mr-1 text-rose-500">*</b>}{label}</span>{hint && hint.length < 10 && <span className="font-normal text-slate-400">{hint}</span>}</span>{children}{hint && hint.length >= 10 && <span className="mt-1.5 block text-xs leading-5 text-slate-500">{hint}</span>}</label> }
function Input({ value, onChange, ...props }: { value: string; onChange: (v:string)=>void } & Omit<React.InputHTMLAttributes<HTMLInputElement>,'onChange'>) { return <input {...props} value={value} onChange={(e)=>onChange(e.target.value)} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-white"/> }
function NumberInput({ value, onChange }: { value:number; onChange:(v:number)=>void }) { return <input type="number" min={1} value={value} onChange={(e)=>onChange(Number(e.target.value))} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950"/> }
function Select({ children, value, onChange }: {children:React.ReactNode;value:string;onChange?:(v:string)=>void}) { return <select value={value} onChange={(e)=>onChange?.(e.target.value)} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950">{children}</select> }
