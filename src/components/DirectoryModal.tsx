'use client';

// Why: MCP · Skills · Plugins 三合一管理弹窗（Directory 风格）。
// 视觉语言对齐 SettingsDialog（浅色弹窗壳）与 RuntimeSettingsDrawer（section/chip），
// 不复用 MCP/McpMarketplaceModal.tsx 的暗色参考稿。
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Code2,
  Loader2,
  Puzzle,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import {
  BuiltinPlugin,
  McpConfigPayload,
  McpPluginItem,
  McpServerStatus,
  McpServerToolsResponse,
  SkillCapsule,
  deleteSkill,
  getMcpConfig,
  getMcpMarketplace,
  getMcpServerTools,
  getPlugins,
  getSkills,
  installMcp,
  saveMcpConfig,
  toggleMcp,
  togglePlugin,
  toggleSkill,
  uninstallMcp,
  updateSkill,
} from '../lib/api';

type DirectoryTab = 'skills' | 'connectors' | 'plugins';

interface DirectoryModalProps {
  open: boolean;
  onClose: () => void;
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

const SKILL_TYPE_LABEL: Record<SkillCapsule['skill_type'], string> = {
  code_pattern: '代码模式',
  task_flow: '任务流程',
  fix_template: '修复模板',
  instruction: '指令',
};

const INSTALL_POLL_INTERVAL_MS = 2_000;
const INSTALL_POLL_TIMEOUT_MS = 60_000;

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

// Why: JSON 编辑器保存前的本地结构校验，与后端 validate_mcp_config 同规则（命令白名单交由后端 422 兜底）。
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

interface SkillEditForm {
  skill_name: string;
  trigger_condition: string;
  keywordsText: string;
  stepsText: string;
}

export default function DirectoryModal({ open, onClose }: DirectoryModalProps) {
  const [tab, setTab] = useState<DirectoryTab>('connectors');
  const [jsonView, setJsonView] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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

  // ---- Skills ----
  const [skills, setSkills] = useState<SkillCapsule[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<SkillEditForm>({
    skill_name: '',
    trigger_condition: '',
    keywordsText: '',
    stepsText: '',
  });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [skillBusyId, setSkillBusyId] = useState<number | null>(null);

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

  const loadMarketplace = useCallback(async () => {
    setMarketLoading(true);
    setMarketError(null);
    try {
      setPlugins(await getMcpMarketplace());
    } catch (loadError) {
      setMarketError(loadError instanceof Error ? loadError.message : '加载 MCP 市场失败');
    } finally {
      setMarketLoading(false);
    }
  }, []);

  const loadSkills = useCallback(async () => {
    setSkillsLoading(true);
    setSkillsError(null);
    try {
      const res = await getSkills();
      setSkills(res.skills);
    } catch (loadError) {
      setSkillsError(loadError instanceof Error ? loadError.message : '加载 Skills 失败');
    } finally {
      setSkillsLoading(false);
    }
  }, []);

  const loadPlugins = useCallback(async () => {
    setPluginsLoading(true);
    setPluginsError(null);
    try {
      const res = await getPlugins();
      setBuiltinPlugins(res.plugins);
    } catch (loadError) {
      setPluginsError(loadError instanceof Error ? loadError.message : '加载插件失败');
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
    } catch (loadError) {
      setJsonErrors([
        loadError instanceof Error ? loadError.message : '读取 MCP 配置失败',
      ]);
    } finally {
      setJsonLoading(false);
    }
  }, []);

  // 打开时复位视图状态并拉取市场数据；关闭时中断安装轮询。
  useEffect(() => {
    if (!open) {
      pollTokenRef.current += 1;
      return;
    }
    setTab('connectors');
    setJsonView(false);
    setNotice(null);
    setQuery('');
    setInstallTarget(null);
    setInstalling(false);
    setInstallError(null);
    setDetailId(null);
    setEditingId(null);
    void loadMarketplace();
  }, [open, loadMarketplace]);

  useEffect(() => {
    if (open && tab === 'skills' && !jsonView) void loadSkills();
  }, [open, tab, jsonView, loadSkills]);

  useEffect(() => {
    if (open && tab === 'plugins' && !jsonView) void loadPlugins();
  }, [open, tab, jsonView, loadPlugins]);

  useEffect(() => {
    if (open && jsonView) void loadConfig();
  }, [open, jsonView, loadConfig]);

  // 成功提示 4s 自动消散。
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Escape 逐层关闭：安装弹窗 → 详情抽屉 → 主弹窗。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (installTarget && !installing) setInstallTarget(null);
      else if (installTarget) return;
      else if (detailId) setDetailId(null);
      else onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, installTarget, installing, detailId, onClose]);

  // ---- Connectors 操作 ----

  const handleToggle = async (plugin: McpPluginItem) => {
    if (busyId) return;
    setBusyId(plugin.id);
    try {
      await toggleMcp(plugin.id);
      await loadMarketplace();
    } catch (toggleError) {
      setMarketError(toggleError instanceof Error ? toggleError.message : '启停失败');
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
    } catch (uninstallError) {
      setMarketError(uninstallError instanceof Error ? uninstallError.message : '卸载失败');
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
    // 后端 required 缺省视为必填，前端对齐同一规则。
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
      // Why: 安装只是写入配置 + 拉起进程，npx 首次拉包可达数十秒，
      // 轮询至 ready/error 给用户确定性的“装好了/失败了”反馈。
      const deadline = Date.now() + INSTALL_POLL_TIMEOUT_MS;
      let settled: McpPluginItem | null = null;
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, INSTALL_POLL_INTERVAL_MS));
        if (pollTokenRef.current !== token) return; // 弹窗已关闭/重新发起
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
          // 单次轮询失败不致命，继续直到超时。
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
    } catch (installErr) {
      setInstallError(installErr instanceof Error ? installErr.message : '安装失败');
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
    } catch (detailErr) {
      setDetailError(detailErr instanceof Error ? detailErr.message : '加载工具清单失败');
    } finally {
      setDetailLoading(false);
    }
  };

  // ---- Skills 操作 ----

  const startEdit = (skill: SkillCapsule) => {
    setEditingId(skill.skill_id);
    setEditForm({
      skill_name: skill.skill_name,
      trigger_condition: skill.trigger_condition,
      keywordsText: skill.trigger_keywords.join(', '),
      stepsText: skill.standard_steps.join('\n'),
    });
    setEditError(null);
  };

  const handleSaveSkill = async () => {
    if (editingId === null || editSaving) return;
    if (!editForm.skill_name.trim()) {
      setEditError('名称不能为空');
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      await updateSkill(editingId, {
        skill_name: editForm.skill_name.trim(),
        trigger_condition: editForm.trigger_condition.trim(),
        trigger_keywords: editForm.keywordsText
          .split(/[,，]/)
          .map((item) => item.trim())
          .filter(Boolean),
        standard_steps: editForm.stepsText
          .split('\n')
          .map((item) => item.trim())
          .filter(Boolean),
      });
      setEditingId(null);
      await loadSkills();
      setNotice('Skill 已保存');
    } catch (saveError) {
      setEditError(saveError instanceof Error ? saveError.message : '保存失败');
    } finally {
      setEditSaving(false);
    }
  };

  const handleToggleSkill = async (skill: SkillCapsule) => {
    if (skillBusyId !== null) return;
    setSkillBusyId(skill.skill_id);
    try {
      await toggleSkill(skill.skill_id, !skill.enabled);
      setSkills((previous) =>
        previous.map((item) =>
          item.skill_id === skill.skill_id ? { ...item, enabled: !skill.enabled } : item,
        ),
      );
    } catch (toggleError) {
      setSkillsError(toggleError instanceof Error ? toggleError.message : '启停失败');
    } finally {
      setSkillBusyId(null);
    }
  };

  const handleDeleteSkill = async (skill: SkillCapsule) => {
    if (!window.confirm(`确定删除「${skill.skill_name}」？删除后不再参与匹配。`)) return;
    setSkillBusyId(skill.skill_id);
    try {
      await deleteSkill(skill.skill_id);
      await loadSkills();
      setNotice(`已删除 ${skill.skill_name}`);
    } catch (deleteError) {
      setSkillsError(deleteError instanceof Error ? deleteError.message : '删除失败');
    } finally {
      setSkillBusyId(null);
    }
  };

  // ---- Plugins 操作 ----

  const handleTogglePlugin = async (plugin: BuiltinPlugin) => {
    if (pluginBusyId) return;
    setPluginBusyId(plugin.id);
    try {
      await togglePlugin(plugin.id, !plugin.enabled);
      setBuiltinPlugins((previous) =>
        previous.map((item) =>
          item.id === plugin.id ? { ...item, enabled: !plugin.enabled } : item,
        ),
      );
    } catch (toggleError) {
      setPluginsError(toggleError instanceof Error ? toggleError.message : '启停失败');
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
    } catch (saveError) {
      setJsonErrors([saveError instanceof Error ? saveError.message : '保存失败']);
    } finally {
      setJsonSaving(false);
    }
  };

  if (!open) return null;

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
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-sm"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="directory-title"
        className="relative flex h-[min(760px,92vh)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        {/* Header */}
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Puzzle size={18} className="text-slate-700" />
            <h2 id="directory-title" className="text-base font-semibold text-slate-900">
              MCP · Skills · Plugins
            </h2>
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
          >
            <X size={18} />
          </button>
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
            ) : tab === 'connectors' ? (
              <div className="flex h-full flex-col">
                {/* 搜索工具栏 */}
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
            ) : tab === 'skills' ? (
              <div className="flex h-full flex-col">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
                  <span className="text-xs text-slate-500">
                    自动沉淀的经验胶囊，停用后不再参与匹配注入
                  </span>
                  <button
                    type="button"
                    aria-label="刷新 Skills"
                    title="刷新"
                    onClick={() => void loadSkills()}
                    disabled={skillsLoading}
                    className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <RefreshCw size={14} className={skillsLoading ? 'animate-spin' : ''} />
                  </button>
                </div>
                {skillsError && (
                  <div className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-xs text-rose-700">
                    {skillsError}
                  </div>
                )}
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {skillsLoading && skills.length === 0 ? (
                    <div className="py-16 text-center text-xs text-slate-400">加载中…</div>
                  ) : skills.length === 0 ? (
                    <div className="m-4 rounded-lg border border-dashed border-slate-300 px-4 py-16 text-center text-xs leading-6 text-slate-400">
                      暂无沉淀的 Skill。
                      <br />
                      同一类任务连续成功 2 次后会自动沉淀。
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-[11px] text-slate-400">
                          <th className="px-4 py-2 font-medium">名称</th>
                          <th className="w-20 px-2 py-2 font-medium">类型</th>
                          <th className="px-2 py-2 font-medium">触发条件</th>
                          <th className="w-16 px-2 py-2 font-medium">启用</th>
                          <th className="w-28 px-4 py-2 font-medium">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {skills.map((skill) => (
                          <SkillRow
                            key={skill.skill_id}
                            skill={skill}
                            editing={editingId === skill.skill_id}
                            busy={skillBusyId === skill.skill_id}
                            editForm={editForm}
                            editSaving={editSaving}
                            editError={editError}
                            onEditFormChange={setEditForm}
                            onStartEdit={() => startEdit(skill)}
                            onCancelEdit={() => setEditingId(null)}
                            onSaveEdit={() => void handleSaveSkill()}
                            onToggle={() => void handleToggleSkill(skill)}
                            onDelete={() => void handleDeleteSkill(skill)}
                          />
                        ))}
                      </tbody>
                    </table>
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

        {/* 详情抽屉（模态内右侧面板） */}
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
      </div>

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
    </div>
  );
}

// Skills 页签行（含行内编辑抽屉表单）。
function SkillRow({
  skill,
  editing,
  busy,
  editForm,
  editSaving,
  editError,
  onEditFormChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onToggle,
  onDelete,
}: {
  skill: SkillCapsule;
  editing: boolean;
  busy: boolean;
  editForm: SkillEditForm;
  editSaving: boolean;
  editError: string | null;
  onEditFormChange: (form: SkillEditForm) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <tr className="border-b border-slate-100 align-middle hover:bg-slate-50">
        <td className="px-4 py-2.5">
          <div className="max-w-44 truncate font-semibold text-slate-800" title={skill.skill_name}>
            {skill.skill_name}
          </div>
          <div className="mt-0.5 text-[10px] text-slate-400">
            成功 {skill.success_count} · 失败 {skill.failure_count}
          </div>
        </td>
        <td className="px-2 py-2.5">
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
            {SKILL_TYPE_LABEL[skill.skill_type] ?? skill.skill_type}
          </span>
        </td>
        <td className="max-w-0 px-2 py-2.5">
          <div className="truncate text-slate-600" title={skill.trigger_condition}>
            {skill.trigger_condition || '—'}
          </div>
        </td>
        <td className="px-2 py-2.5">
          <Switch
            checked={skill.enabled}
            disabled={busy}
            label={`${skill.enabled ? '停用' : '启用'} ${skill.skill_name}`}
            onChange={onToggle}
          />
        </td>
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={onStartEdit}
              className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              编辑
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onDelete}
              className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-40"
            >
              删除
            </button>
          </div>
        </td>
      </tr>
      {editing && (
        <tr className="border-b border-slate-200 bg-slate-50">
          <td colSpan={5} className="px-4 py-3">
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor={`skill-name-${skill.skill_id}`}
                    className="mb-1 block text-[11px] font-medium text-slate-600"
                  >
                    名称
                  </label>
                  <input
                    id={`skill-name-${skill.skill_id}`}
                    type="text"
                    value={editForm.skill_name}
                    onChange={(event) =>
                      onEditFormChange({ ...editForm, skill_name: event.target.value })
                    }
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:border-slate-500"
                  />
                </div>
                <div>
                  <label
                    htmlFor={`skill-keywords-${skill.skill_id}`}
                    className="mb-1 block text-[11px] font-medium text-slate-600"
                  >
                    触发关键词（逗号分隔）
                  </label>
                  <input
                    id={`skill-keywords-${skill.skill_id}`}
                    type="text"
                    value={editForm.keywordsText}
                    onChange={(event) =>
                      onEditFormChange({ ...editForm, keywordsText: event.target.value })
                    }
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:border-slate-500"
                  />
                </div>
              </div>
              <div>
                <label
                  htmlFor={`skill-condition-${skill.skill_id}`}
                  className="mb-1 block text-[11px] font-medium text-slate-600"
                >
                  触发条件
                </label>
                <textarea
                  id={`skill-condition-${skill.skill_id}`}
                  rows={2}
                  value={editForm.trigger_condition}
                  onChange={(event) =>
                    onEditFormChange({ ...editForm, trigger_condition: event.target.value })
                  }
                  className="w-full resize-y rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:border-slate-500"
                />
              </div>
              <div>
                <label
                  htmlFor={`skill-steps-${skill.skill_id}`}
                  className="mb-1 block text-[11px] font-medium text-slate-600"
                >
                  标准步骤（每行一条）
                </label>
                <textarea
                  id={`skill-steps-${skill.skill_id}`}
                  rows={4}
                  value={editForm.stepsText}
                  onChange={(event) =>
                    onEditFormChange({ ...editForm, stepsText: event.target.value })
                  }
                  className="w-full resize-y rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs outline-none focus:border-slate-500"
                />
              </div>
              {editError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] text-rose-700">
                  {editError}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  disabled={editSaving}
                  onClick={onCancelEdit}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={editSaving}
                  onClick={onSaveEdit}
                  className="rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {editSaving ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
