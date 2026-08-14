'use client';

// Why: MCP · Skills · Plugins 三合一全屏市场页面（计划书 §1 D1）。
// 从 DirectoryModal 弹窗重构为 SPA 内全屏视图，保留 connectors/plugins 逻辑，
// Skills 页签改为 catalog 驱动的卡片网格 + 搜索/筛选/排序 + Add 下拉。
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Code2,
  Upload,
  Loader2,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  X,
} from 'lucide-react';
import {
  BuiltinPlugin,
  McpConfigPayload,
  McpPluginItem,
  McpServerStatus,
  McpServerToolsResponse,
  SkillCatalogItem,
  getMcpConfig,
  getMcpMarketplace,
  getMcpServerTools,
  getPlugins,
  getSkillCatalog,
  installMcp,
  installSkillFromCatalog,
  saveMcpConfig,
  toggleMcp,
  togglePlugin,
  uninstallMcp,
} from '../lib/api';
import { randomSkillPrompt } from '../lib/skillPromptPool';
import CreateSkillModal from './CreateSkillModal';
import UploadSkillModal from './UploadSkillModal';

type DirectoryTab = 'skills' | 'connectors' | 'plugins';

interface DirectoryPageProps {
  initialTab?: DirectoryTab;
  onBack: () => void;
  onOpenSettings: (section: 'directory', subTab?: DirectoryTab) => void;
  onCreateWithAgent: (prompt: string) => void;
}

const TAB_ITEMS: Array<{ id: DirectoryTab; label: string }> = [
  { id: 'skills', label: 'Skills' },
  { id: 'connectors', label: 'Connectors' },
  { id: 'plugins', label: 'Plugins' },
];

const RUNTIME_STATUS_LABEL: Record<McpServerStatus, string> = {
  ready: '运行中',
  pending: '启动中',
  error: '异常',
  stopped: '已停止',
};

const SKILL_CATEGORIES = [
  'all',
  'artifacts',
  'design',
  'writing',
  'productivity',
  'meta',
  'devtools',
] as const;

type SortKey = 'downloads' | 'name' | 'updated';

const INSTALL_POLL_INTERVAL_MS = 2_000;
const INSTALL_POLL_TIMEOUT_MS = 60_000;

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function StatusDot({ status }: { status: McpServerStatus }) {
  const color =
    status === 'ready'
      ? 'bg-emerald-500'
      : status === 'pending'
        ? 'bg-amber-400 animate-pulse'
        : status === 'error'
          ? 'bg-rose-500'
          : 'bg-slate-300';
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-slate-500">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {RUNTIME_STATUS_LABEL[status]}
    </span>
  );
}

function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? 'bg-slate-900' : 'bg-slate-300'
      }`}
    >
      <span
        className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition ${
          checked ? 'left-6' : 'left-1'
        }`}
      />
    </button>
  );
}

function validateMcpConfigText(text: string): {
  payload: McpConfigPayload | null;
  errors: string[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (parseError) {
    return {
      payload: null,
      errors: [
        `JSON 语法错误：${parseError instanceof Error ? parseError.message : '无法解析'}`,
      ],
    };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { payload: null, errors: ['顶层必须是 JSON 对象'] };
  }
  const servers = (parsed as Record<string, unknown>).mcpServers;
  if (typeof servers !== 'object' || servers === null || Array.isArray(servers)) {
    return { payload: null, errors: ['缺少 mcpServers 对象'] };
  }
  const errors: string[] = [];
  for (const [sid, cfg] of Object.entries(servers as Record<string, unknown>)) {
    if (typeof cfg !== 'object' || cfg === null || Array.isArray(cfg)) {
      errors.push(`${sid}：配置必须是对象`);
      continue;
    }
    const serverCfg = cfg as Record<string, unknown>;
    if (typeof serverCfg.command !== 'string' || !serverCfg.command.trim()) {
      errors.push(`${sid}：command 缺失或非字符串`);
    }
    if (
      serverCfg.args !== undefined &&
      (!Array.isArray(serverCfg.args) ||
        !serverCfg.args.every((arg) => typeof arg === 'string'))
    ) {
      errors.push(`${sid}：args 必须是字符串数组`);
    }
    if (
      serverCfg.env !== undefined &&
      (typeof serverCfg.env !== 'object' ||
        serverCfg.env === null ||
        Array.isArray(serverCfg.env) ||
        !Object.entries(serverCfg.env as Record<string, unknown>).every(
          ([key, value]) => typeof key === 'string' && typeof value === 'string',
        ))
    ) {
      errors.push(`${sid}：env 必须是字符串键值对对象`);
    }
    if (serverCfg.enabled !== undefined && typeof serverCfg.enabled !== 'boolean') {
      errors.push(`${sid}：enabled 必须是布尔值`);
    }
  }
  if (errors.length > 0) return { payload: null, errors };
  return { payload: parsed as McpConfigPayload, errors: [] };
}

export default function DirectoryPage({
  initialTab = 'connectors',
  onBack,
  onOpenSettings,
  onCreateWithAgent,
}: DirectoryPageProps) {
  const [tab, setTab] = useState<DirectoryTab>(initialTab);
  const [jsonView, setJsonView] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // ---- Add 下拉 ----
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  // 上传解析后预填 CreateSkillModal 的初始值
  const [createModalInitial, setCreateModalInitial] = useState<{
    skill_name: string;
    description: string;
    instructions: string;
  } | null>(null);

  // ---- Skill Catalog ----
  const [catalog, setCatalog] = useState<SkillCatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [skillQuery, setSkillQuery] = useState('');
  const [skillCategory, setSkillCategory] = useState<string>('all');
  const [skillSort, setSkillSort] = useState<SortKey>('downloads');
  const [installingCatalogId, setInstallingCatalogId] = useState<string | null>(null);

  // ---- Connectors（MCP 市场）----
  const [plugins, setPlugins] = useState<McpPluginItem[]>([]);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // ---- 安装凭证弹窗 ----
  const [installTarget, setInstallTarget] = useState<McpPluginItem | null>(null);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [envErrors, setEnvErrors] = useState<Record<string, string>>({});
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const pollTokenRef = useRef(0);

  // ---- 详情抽屉 ----
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<McpServerToolsResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // ---- Plugins ----
  const [builtinPlugins, setBuiltinPlugins] = useState<BuiltinPlugin[]>([]);
  const [pluginsLoading, setPluginsLoading] = useState(false);
  const [pluginsError, setPluginsError] = useState<string | null>(null);
  const [pluginBusyId, setPluginBusyId] = useState<string | null>(null);

  // ---- JSON 编辑器 ----
  const [jsonText, setJsonText] = useState('');
  const [jsonLoading, setJsonLoading] = useState(false);
  const [jsonSaving, setJsonSaving] = useState(false);
  const [jsonErrors, setJsonErrors] = useState<string[]>([]);
  const [jsonNotice, setJsonNotice] = useState<string | null>(null);

  // ---- 数据加载 ----
  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const res = await getSkillCatalog();
      setCatalog(res.skills);
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : '加载 Skill 目录失败');
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  const loadMarketplace = useCallback(async () => {
    setMarketLoading(true);
    setMarketError(null);
    try {
      setPlugins(await getMcpMarketplace());
    } catch (err) {
      setMarketError(err instanceof Error ? err.message : '加载 MCP 市场失败');
    } finally {
      setMarketLoading(false);
    }
  }, []);

  const loadPlugins = useCallback(async () => {
    setPluginsLoading(true);
    setPluginsError(null);
    try {
      const res = await getPlugins();
      setBuiltinPlugins(res.plugins);
    } catch (err) {
      setPluginsError(err instanceof Error ? err.message : '加载插件失败');
    } finally {
      setPluginsLoading(false);
    }
  }, []);

  const loadConfig = useCallback(async () => {
    setJsonLoading(true);
    setJsonErrors([]);
    setJsonNotice(null);
    try {
      const config = await getMcpConfig();
      setJsonText(JSON.stringify(config, null, 2));
    } catch (err) {
      setJsonErrors([err instanceof Error ? err.message : '读取 MCP 配置失败']);
    } finally {
      setJsonLoading(false);
    }
  }, []);

  // ---- 初始加载 ----
  useEffect(() => {
    setTab(initialTab);
    void loadMarketplace();
  }, [initialTab, loadMarketplace]);

  useEffect(() => {
    if (tab === 'skills' && !jsonView) {
      void loadCatalog();
    }
  }, [tab, jsonView, loadCatalog]);

  useEffect(() => {
    if (tab === 'plugins' && !jsonView) void loadPlugins();
  }, [tab, jsonView, loadPlugins]);

  useEffect(() => {
    if (jsonView) void loadConfig();
  }, [jsonView, loadConfig]);

  // notice 自动消散
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Add 下拉外部点击关闭
  useEffect(() => {
    if (!addMenuOpen) return;
    const onClick = () => setAddMenuOpen(false);
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, [addMenuOpen]);

  // ---- Skill Catalog 操作 ----
  const handleInstallCatalog = async (item: SkillCatalogItem) => {
    if (installingCatalogId) return;
    setInstallingCatalogId(item.catalog_id);
    try {
      const result = await installSkillFromCatalog(item.catalog_id);
      setNotice(result.existing ? `「${item.name}」已安装过` : `已安装 ${item.name}`);
      await loadCatalog();
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : '安装失败');
    } finally {
      setInstallingCatalogId(null);
    }
  };

  // ---- Connectors 操作 ----
  const handleToggle = async (plugin: McpPluginItem) => {
    if (busyId) return;
    setBusyId(plugin.id);
    try {
      await toggleMcp(plugin.id);
      await loadMarketplace();
    } catch (err) {
      setMarketError(err instanceof Error ? err.message : '启停失败');
    } finally {
      setBusyId(null);
    }
  };

  const handleUninstall = async (plugin: McpPluginItem) => {
    if (busyId) return;
    if (!window.confirm(`确定卸载「${plugin.name}」？将停止进程并删除其配置。`)) return;
    setBusyId(plugin.id);
    try {
      await uninstallMcp(plugin.id);
      await loadMarketplace();
      setNotice(`已卸载 ${plugin.name}`);
    } catch (err) {
      setMarketError(err instanceof Error ? err.message : '卸载失败');
    } finally {
      setBusyId(null);
    }
  };

  const openInstall = (plugin: McpPluginItem) => {
    setInstallTarget(plugin);
    setEnvValues({});
    setEnvErrors({});
    setInstallError(null);
  };

  const handleConfirmInstall = async () => {
    if (!installTarget || installing) return;
    const errors: Record<string, string> = {};
    for (const field of installTarget.env_schema) {
      if (field.required !== false && !(envValues[field.key] ?? '').trim()) {
        errors[field.key] = '必填项';
      }
    }
    setEnvErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setInstalling(true);
    setInstallError(null);
    const token = ++pollTokenRef.current;
    try {
      await installMcp(installTarget.id, envValues);
      const deadline = Date.now() + INSTALL_POLL_TIMEOUT_MS;
      let settled: McpPluginItem | null = null;
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, INSTALL_POLL_INTERVAL_MS));
        if (pollTokenRef.current !== token) return;
        try {
          const list = await getMcpMarketplace();
          setPlugins(list);
          const target = list.find((item) => item.id === installTarget.id) ?? null;
          const status = target?.runtime?.status;
          if (status === 'ready' || status === 'error') {
            settled = target;
            break;
          }
        } catch {
          // 单次轮询失败不致命
        }
      }
      if (settled?.runtime?.status === 'ready') {
        setInstallTarget(null);
        setNotice(`${installTarget.name} 已安装并启动（${settled.runtime.tool_count} 个工具）`);
      } else if (settled?.runtime?.status === 'error') {
        setInstallError(`启动失败：${settled.runtime.last_error ?? '请查看详情中的错误日志'}`);
      } else {
        setInstallError('等待启动超时（60 秒）。进程可能仍在拉取依赖，稍后可点击查看状态。');
        void loadMarketplace();
      }
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : '安装失败');
    } finally {
      setInstalling(false);
    }
  };

  const openDetail = async (plugin: McpPluginItem) => {
    setDetailId(plugin.id);
    setDetail(null);
    setDetailLoading(true);
    setDetailError(null);
    try {
      setDetail(await getMcpServerTools(plugin.id));
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : '加载工具清单失败');
    } finally {
      setDetailLoading(false);
    }
  };

  // ---- Plugins 操作 ----
  const handleTogglePlugin = async (plugin: BuiltinPlugin) => {
    if (pluginBusyId) return;
    setPluginBusyId(plugin.id);
    try {
      await togglePlugin(plugin.id, !plugin.enabled);
      setBuiltinPlugins((prev) =>
        prev.map((item) =>
          item.id === plugin.id ? { ...item, enabled: !plugin.enabled } : item,
        ),
      );
    } catch (err) {
      setPluginsError(err instanceof Error ? err.message : '启停失败');
    } finally {
      setPluginBusyId(null);
    }
  };

  // ---- JSON 编辑器操作 ----
  const handleSaveConfig = async () => {
    if (jsonSaving) return;
    const { payload, errors } = validateMcpConfigText(jsonText);
    setJsonErrors(errors);
    setJsonNotice(null);
    if (!payload) return;
    setJsonSaving(true);
    try {
      const result = await saveMcpConfig(payload);
      setJsonNotice(`已保存并热生效（${result.servers.length} 个 server）`);
      void loadMarketplace();
    } catch (err) {
      setJsonErrors([err instanceof Error ? err.message : '保存失败']);
    } finally {
      setJsonSaving(false);
    }
  };

  // ---- Add 下拉操作 ----
  const handleCreateWithAgent = () => {
    setAddMenuOpen(false);
    const prompt = randomSkillPrompt();
    onCreateWithAgent(prompt);
  };

  const handleWriteSkill = () => {
    setAddMenuOpen(false);
    setCreateModalInitial(null);
    setShowCreateModal(true);
  };

  const handleUploadSkill = () => {
    setAddMenuOpen(false);
    setShowUploadModal(true);
  };

  const handleUploadParsed = (parsed: {
    skill_name: string;
    description: string;
    instructions: string;
  }) => {
    setShowUploadModal(false);
    setCreateModalInitial(parsed);
    setShowCreateModal(true);
  };

  const handleCreateSkillSuccess = () => {
    setShowCreateModal(false);
    setCreateModalInitial(null);
    void loadCatalog();
  };

  // ---- 派生数据 ----
  const normalizedSkillQuery = skillQuery.trim().toLowerCase();
  const filteredCatalog = catalog
    .filter((item) => {
      if (skillCategory !== 'all' && item.category !== skillCategory) return false;
      if (normalizedSkillQuery) {
        const haystack = `${item.name} ${item.description} ${item.author}`.toLowerCase();
        if (!haystack.includes(normalizedSkillQuery)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (skillSort === 'downloads') return b.downloads - a.downloads;
      if (skillSort === 'name') return a.name.localeCompare(b.name);
      return b.updated_at.localeCompare(a.updated_at);
    });

  const normalizedQuery = query.trim().toLowerCase();
  const filteredPlugins = normalizedQuery
    ? plugins.filter((plugin) =>
        [plugin.name, plugin.description, plugin.category]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : plugins;

  return (
    <div className="flex h-full flex-col bg-white">
      {/* 顶栏 */}
      <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="返回聊天"
            onClick={onBack}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-2">
            <Puzzle size={18} className="text-slate-700" />
            <h2 className="text-base font-semibold text-slate-900">
              MCP · Skills · Plugins
            </h2>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Add 下拉（仅 Skills 页签显示） */}
          {tab === 'skills' && !jsonView && (
            <div className="relative">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setAddMenuOpen((v) => !v);
                }}
                className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
              >
                <Plus size={14} />
                Add
                <ChevronDown size={12} />
              </button>
              {addMenuOpen && (
                <div
                  className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={handleCreateWithAgent}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                  >
                    <Sparkles size={15} className="text-violet-500" />
                    <div>
                      <div className="font-medium">Create with agent</div>
                      <div className="text-[10px] text-slate-400">让 AI 帮你写一个</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={handleWriteSkill}
                    className="flex w-full items-center gap-2.5 border-t border-slate-100 px-3 py-2.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                  >
                    <Puzzle size={15} className="text-blue-500" />
                    <div>
                      <div className="font-medium">Write skill instruction</div>
                      <div className="text-[10px] text-slate-400">手动添加</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={handleUploadSkill}
                    className="flex w-full items-center gap-2.5 border-t border-slate-100 px-3 py-2.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                  >
                    <Upload size={15} className="text-emerald-500" />
                    <div>
                      <div className="font-medium">Upload a skill</div>
                      <div className="text-[10px] text-slate-400">拖入或选择 .md 文件</div>
                    </div>
                  </button>
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            aria-label="打开设置"
            title="设置"
            onClick={() => onOpenSettings('directory', tab)}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
          >
            <SettingsIcon size={18} />
          </button>
        </div>
      </header>

      {notice && (
        <div className="border-b border-emerald-100 bg-emerald-50 px-5 py-2 text-xs text-emerald-700">
          {notice}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* 左侧竖排页签 */}
        <aside className="flex w-32 shrink-0 flex-col border-r border-slate-200 bg-slate-50 p-3 sm:w-40">
          <nav className="space-y-1" aria-label="Directory 页签">
            {TAB_ITEMS.map((item) => {
              const active = !jsonView && tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setTab(item.id);
                    setJsonView(false);
                  }}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                    active
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
          <button
            type="button"
            aria-pressed={jsonView}
            title="直接编辑 MCP 配置 JSON"
            onClick={() => setJsonView((value) => !value)}
            className={`mt-auto flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium transition ${
              jsonView ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            <Code2 size={15} />
            JSON 配置
          </button>
        </aside>

        {/* 右侧内容区 */}
        <main className="min-w-0 flex-1 overflow-hidden">
          {jsonView ? (
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
                <div className="min-w-0">
                  <span className="text-xs font-semibold text-slate-700">
                    installed_mcps.json
                  </span>
                  <span className="ml-2 hidden text-[11px] text-slate-400 sm:inline">
                    直接编辑 MCP 配置（env 已脱敏，掩码字段保存时保留原值），保存后热生效
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void loadConfig()}
                    disabled={jsonLoading || jsonSaving}
                    className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    重新加载
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveConfig()}
                    disabled={jsonLoading || jsonSaving}
                    className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {jsonSaving ? '保存中…' : '保存'}
                  </button>
                </div>
              </div>
              {jsonErrors.length > 0 && (
                <div className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-xs text-rose-700">
                  {jsonErrors.map((message) => (
                    <div key={message}>{message}</div>
                  ))}
                </div>
              )}
              {jsonNotice && (
                <div className="border-b border-emerald-100 bg-emerald-50 px-4 py-2 text-xs text-emerald-700">
                  {jsonNotice}
                </div>
              )}
              <textarea
                aria-label="MCP 配置 JSON 编辑器"
                spellCheck={false}
                value={jsonText}
                onChange={(event) => setJsonText(event.target.value)}
                disabled={jsonLoading}
                placeholder={jsonLoading ? '加载中…' : '{ "mcpServers": {} }'}
                className="min-h-0 flex-1 resize-none bg-slate-950 p-4 font-mono text-xs leading-5 text-slate-100 outline-none disabled:opacity-60"
              />
            </div>
          ) : tab === 'skills' ? (
            <div className="flex h-full flex-col">
              {/* 搜索/筛选/排序工具栏 */}
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2.5">
                <div className="relative min-w-[180px] flex-1">
                  <Search
                    size={14}
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    type="search"
                    aria-label="搜索 Skill"
                    placeholder="搜索名称 / 描述…"
                    value={skillQuery}
                    onChange={(event) => setSkillQuery(event.target.value)}
                    className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-3 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-slate-400"
                  />
                </div>
                <select
                  aria-label="筛选分类"
                  value={skillCategory}
                  onChange={(event) => setSkillCategory(event.target.value)}
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-slate-400"
                >
                  {SKILL_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat === 'all' ? '全部分类' : cat}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="排序方式"
                  value={skillSort}
                  onChange={(event) => setSkillSort(event.target.value as SortKey)}
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-slate-400"
                >
                  <option value="downloads">下载量 ↓</option>
                  <option value="name">名称 A-Z</option>
                  <option value="updated">最近更新</option>
                </select>
                <span className="shrink-0 text-[11px] text-slate-400">
                  {filteredCatalog.length} / {catalog.length}
                </span>
                <button
                  type="button"
                  aria-label="刷新 Skill 目录"
                  title="刷新"
                  onClick={() => {
                    void loadCatalog();
                  }}
                  disabled={catalogLoading}
                  className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                >
                  <RefreshCw size={14} className={catalogLoading ? 'animate-spin' : ''} />
                </button>
              </div>

              {catalogError && (
                <div className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-xs text-rose-700">
                  {catalogError}
                </div>
              )}

              {/* Skill 目录卡片网格 */}
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {catalogLoading && catalog.length === 0 ? (
                  <div className="py-16 text-center text-xs text-slate-400">加载中…</div>
                ) : filteredCatalog.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 px-4 py-16 text-center text-xs text-slate-400">
                    {normalizedSkillQuery ? '没有匹配的 Skill' : '目录为空'}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {filteredCatalog.map((item) => (
                      <div
                        key={item.catalog_id}
                        className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-slate-900">
                              {item.name}
                            </div>
                            <div className="mt-0.5 flex items-center gap-1.5">
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                                {item.category}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                {item.author}
                              </span>
                            </div>
                          </div>
                          <span className="shrink-0 text-[10px] text-slate-400">
                            ↓ {formatDownloads(item.downloads)}
                          </span>
                        </div>
                        <p className="mt-2 line-clamp-2 min-h-8 text-xs leading-4 text-slate-500">
                          {item.description}
                        </p>
                        <div className="mt-auto flex items-center justify-end border-t border-slate-100 pt-3">
                          {item.is_installed ? (
                            <button
                              type="button"
                              disabled
                              className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700"
                            >
                              ✓ 已安装
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={installingCatalogId === item.catalog_id}
                              onClick={() => void handleInstallCatalog(item)}
                              className="flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                            >
                              {installingCatalogId === item.catalog_id && (
                                <Loader2 size={12} className="animate-spin" />
                              )}
                              安装
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : tab === 'connectors' ? (
            <div className="flex h-full flex-col">
              <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5">
                <div className="relative min-w-0 flex-1">
                  <Search
                    size={14}
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    type="search"
                    aria-label="搜索插件"
                    placeholder="搜索名称 / 描述 / 分类…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-3 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-slate-400"
                  />
                </div>
                <span className="shrink-0 text-[11px] text-slate-400">
                  {filteredPlugins.length} / {plugins.length}
                </span>
                <button
                  type="button"
                  aria-label="刷新市场列表"
                  title="刷新"
                  onClick={() => void loadMarketplace()}
                  disabled={marketLoading}
                  className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                >
                  <RefreshCw size={14} className={marketLoading ? 'animate-spin' : ''} />
                </button>
              </div>

              {marketError && (
                <div className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-xs text-rose-700">
                  {marketError}
                </div>
              )}

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {marketLoading && plugins.length === 0 ? (
                  <div className="py-16 text-center text-xs text-slate-400">加载中…</div>
                ) : filteredPlugins.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 px-4 py-16 text-center text-xs text-slate-400">
                    {normalizedQuery ? '没有匹配的插件' : '市场目录为空'}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {filteredPlugins.map((plugin) => {
                      const busy = busyId === plugin.id;
                      return (
                        <div
                          key={plugin.id}
                          className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <span aria-hidden className="text-2xl">
                                {plugin.icon}
                              </span>
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-slate-900">
                                  {plugin.name}
                                </div>
                                <span className="mt-0.5 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                                  {plugin.category}
                                </span>
                              </div>
                            </div>
                            {plugin.is_installed && plugin.runtime && (
                              <StatusDot status={plugin.runtime.status} />
                            )}
                          </div>
                          <p className="mt-2 line-clamp-2 min-h-8 text-xs leading-4 text-slate-500">
                            {plugin.description}
                          </p>
                          {plugin.runtime?.status === 'error' && plugin.runtime.last_error && (
                            <p
                              className="mt-1 truncate text-[11px] text-rose-600"
                              title={plugin.runtime.last_error}
                            >
                              {plugin.runtime.last_error}
                            </p>
                          )}
                          <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-3">
                            {plugin.is_installed ? (
                              <>
                                <Switch
                                  checked={plugin.is_enabled}
                                  disabled={busy}
                                  label={`${plugin.is_enabled ? '停用' : '启用'} ${plugin.name}`}
                                  onChange={() => void handleToggle(plugin)}
                                />
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    disabled={busy || !plugin.is_enabled}
                                    onClick={() => void openDetail(plugin)}
                                    className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                                  >
                                    详情
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void handleUninstall(plugin)}
                                    className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                                  >
                                    {busy ? '处理中…' : '卸载'}
                                  </button>
                                </div>
                              </>
                            ) : (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => openInstall(plugin)}
                                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                              >
                                安装
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
                <span className="text-xs text-slate-500">
                  内置辅助插件（非 MCP 协议），停用后其工具不再注入 Agent
                </span>
                <button
                  type="button"
                  aria-label="刷新插件"
                  title="刷新"
                  onClick={() => void loadPlugins()}
                  disabled={pluginsLoading}
                  className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                >
                  <RefreshCw size={14} className={pluginsLoading ? 'animate-spin' : ''} />
                </button>
              </div>
              {pluginsError && (
                <div className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-xs text-rose-700">
                  {pluginsError}
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {pluginsLoading && builtinPlugins.length === 0 ? (
                  <div className="py-16 text-center text-xs text-slate-400">加载中…</div>
                ) : builtinPlugins.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 px-4 py-16 text-center text-xs text-slate-400">
                    暂无内置插件
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {builtinPlugins.map((plugin) => (
                      <li
                        key={plugin.id}
                        className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"
                      >
                        <span aria-hidden className="text-xl">
                          {plugin.icon}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-slate-900">
                              {plugin.name}
                            </span>
                            {plugin.modes.map((pluginMode) => (
                              <span
                                key={pluginMode}
                                className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500"
                              >
                                {pluginMode}
                              </span>
                            ))}
                          </div>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {plugin.description}
                          </p>
                        </div>
                        <Switch
                          checked={plugin.enabled}
                          disabled={pluginBusyId === plugin.id}
                          label={`${plugin.enabled ? '停用' : '启用'} ${plugin.name}`}
                          onChange={() => void handleTogglePlugin(plugin)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* 详情抽屉 */}
      {detailId && (
        <div
          className="absolute inset-0 z-20 flex justify-end bg-slate-950/30"
          onMouseDown={(event) => event.target === event.currentTarget && setDetailId(null)}
        >
          <div className="flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-xl">
            <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-900">
                插件详情 · {plugins.find((item) => item.id === detailId)?.name ?? detailId}
              </h3>
              <button
                type="button"
                aria-label="关闭详情"
                onClick={() => setDetailId(null)}
                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <X size={16} />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {detailLoading ? (
                <div className="py-16 text-center text-xs text-slate-400">加载中…</div>
              ) : detailError ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {detailError}
                </div>
              ) : detail ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    <StatusDot status={detail.status} />
                    <span>
                      工具 {detail.tool_count} 个 · 重启 {detail.restart_count} 次
                    </span>
                  </div>
                  {detail.last_error && (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                      {detail.last_error}
                    </div>
                  )}
                  <section>
                    <h4 className="mb-2 text-xs font-semibold text-slate-800">工具清单</h4>
                    {detail.tools.length === 0 ? (
                      <p className="text-xs text-slate-400">暂无工具</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {detail.tools.map((tool) => (
                          <li
                            key={tool.name}
                            className="rounded-lg border border-slate-200 px-3 py-2"
                          >
                            <div className="font-mono text-[11px] font-semibold text-slate-800">
                              {tool.name}
                            </div>
                            {tool.description && (
                              <p className="mt-0.5 text-[11px] leading-4 text-slate-500">
                                {tool.description}
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                  {detail.stderr_tail.length > 0 && (
                    <section>
                      <h4 className="mb-2 text-xs font-semibold text-slate-800">
                        最近错误输出（stderr）
                      </h4>
                      <pre className="max-h-48 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-4 text-slate-100">
                        {detail.stderr_tail.join('\n')}
                      </pre>
                    </section>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* 安装凭证弹窗 */}
      {installTarget && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/45 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !installing) setInstallTarget(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-title"
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
          >
            <h3
              id="install-title"
              className="flex items-center gap-2 text-sm font-semibold text-slate-900"
            >
              <span aria-hidden className="text-xl">
                {installTarget.icon}
              </span>
              配置 {installTarget.name} 凭证
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              {installTarget.env_schema.length > 0
                ? '安装前请填写所需凭证，凭证仅保存在本地配置文件中。'
                : '该插件无需凭证，可直接安装。'}
            </p>

            <div className="mt-4 space-y-3">
              {installTarget.env_schema.map((field) => (
                <div key={field.key}>
                  <label
                    htmlFor={`env-${field.key}`}
                    className="mb-1 block text-xs font-medium text-slate-700"
                  >
                    {field.label}
                    {field.required !== false && (
                      <span className="ml-0.5 text-rose-500">*</span>
                    )}
                  </label>
                  <input
                    id={`env-${field.key}`}
                    type={field.type === 'password' ? 'password' : 'text'}
                    autoComplete="off"
                    placeholder={field.description}
                    value={envValues[field.key] ?? ''}
                    disabled={installing}
                    onChange={(event) =>
                      setEnvValues((previous) => ({
                        ...previous,
                        [field.key]: event.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-slate-500 disabled:opacity-60"
                  />
                  {envErrors[field.key] && (
                    <p className="mt-1 text-[11px] text-rose-600">{envErrors[field.key]}</p>
                  )}
                </div>
              ))}
            </div>

            {installError && (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {installError}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={installing}
                onClick={() => setInstallTarget(null)}
                className="rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                disabled={installing}
                onClick={() => void handleConfirmInstall()}
                className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {installing && <Loader2 size={13} className="animate-spin" />}
                {installing ? '安装并启动中…' : '确认安装'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CreateSkillModal */}
      {showCreateModal && (
        <CreateSkillModal
          initial={createModalInitial}
          onClose={() => {
            setShowCreateModal(false);
            setCreateModalInitial(null);
          }}
          onSuccess={handleCreateSkillSuccess}
        />
      )}

      {/* UploadSkillModal */}
      {showUploadModal && (
        <UploadSkillModal
          onClose={() => setShowUploadModal(false)}
          onParsed={handleUploadParsed}
        />
      )}
    </div>
  );
}
