# DeepSeek V4 升级与思考模式接入计划书

> 状态:待用户确认 | 创建时间:2026-08-09 | 涉及文件:9 个

## 一、目标

1. 将 DeepSeek 接入从已弃用的 `deepseek-chat`(2026/07/24 弃用)升级到官方在售的 `deepseek-v4-flash` + `deepseek-v4-pro`
2. 接入官方思考模式协议,与现有 GLM/千问 完全隔离,互不串协议
3. 修复能力判断双数据源架构缺陷,统一走 MODEL_CATALOG 查表
4. 前端设置面板和输入框快速切换器同步补全 DeepSeek 多变体下拉 + 四档思考强度调节

## 二、官方协议关键点(已核对)

来源:https://api-docs.deepseek.com/zh-cn/guides/thinking_mode

| 项 | 协议 |
|---|---|
| 思考开关 | `extra_body={"thinking": {"type": "enabled/disabled"}}` |
| 思考强度 | `reasoning_effort` 作为**顶层参数**(不放 extra_body) |
| effort 字面值 | `low/medium/high/xhigh/max`,但 `low/medium→high`,`xhigh→max`,实际只有 high 和 max 两档有效 |
| 默认状态 | 思考默认 `enabled`,普通请求默认 effort=high |
| 不可用参数 | 思考模式启用时 `temperature/top_p/presence_penalty/frequency_penalty` **不报错但不生效** |
| reasoning_content 处理 | 工具调用轮次中 `reasoning_content` **必须回传**,否则 400 |
| Vision | 官方未发布多模态 API,`supports_vision` 保持 `False` |

## 三、四档思考强度定义(已根据官方映射表核对)

DeepSeek 官方 effort 字面值共 **4 档**:`low/high/xhigh/max`(无 medium)。不同模型映射不同:

| 请求传入 effort | deepseek-v4-flash 实际映射 | deepseek-v4-pro 实际映射 |
|---|---|---|
| `low` | `low` | `high` |
| `high` | `high` | `high` |
| `xhigh` | `high` | `max` |
| `max` | `max` | `max` |

**四档定义**(对齐官方字面值):

| 档位 | reasoning_effort | thinking.type | 说明 |
|---|---|---|---|
| 低 | `low` | `enabled` | 轻量思考(v4-flash 实际 low,v4-pro 映射 high) |
| 标准 | `high` | `enabled` | 默认档,日常使用 |
| 加强 | `xhigh` | `enabled` | 复杂推理(v4-flash 映射 high,v4-pro 映射 max) |
| 最强 | `max` | `enabled` | 极限推理,Agent 类请求 |

**关闭思考**:通过 `thinking_enabled=false` 开关控制,后端走 `thinking.type=disabled`,不传 `reasoning_effort`。

> Why:采用官方字面 4 档值,让用户精确感知协议能力;关闭通过独立开关控制,不混入 effort 选择器,与 GLM/千问的"启用深度思考"开关语义对齐。

## 四、执行阶段(按依赖顺序)

### 阶段 ④ 能力判断查表化(基础工程,必须先做)

**文件**:`model_settings.py`

**当前问题**:[capabilities_for_model()](file:///d:/AI-Agent学习计划/AI-Agent%20study/model_settings.py#L46-L54) 用 `"glm" in name` / `"qwen" in name` 字符串嗅探,MODEL_CATALOG 里的 `supports_vision`/`thinking_control` 字段完全未被该函数读取,导致前端展示和后端运行时是两套不同步数据源。

**改造方案**:

```python
# model_settings.py 新增 thinking_control 字面类型
ThinkingControl = Literal["none", "glm", "qwen_budget", "deepseek"]

def capabilities_for_model(model_id: str) -> ProviderCapabilities:
    """按 model_id 在 MODEL_CATALOG 中反查能力;未命中走保守默认。
    
    Why: 收口字符串嗅探,新供应商只需在 MODEL_CATALOG 加条目即可,
    运行时能力判断与前端展示共用同一数据源。
    """
    name = (model_id or "").lower()
    for provider_variants in MODEL_CATALOG.values():
        for variant in provider_variants:
            if variant["model_id"].lower() == name:
                return ProviderCapabilities(
                    supports_json_format=variant.get("supports_json_format", True),
                    thinking_control=variant.get("thinking_control", "none"),
                    supports_vision=variant.get("supports_vision", False),
                )
    # 兜底:未知模型走保守默认(与历史行为一致)
    return ProviderCapabilities(True, "none", False)
```

**新增字段**:`MODEL_CATALOG` 每个变体补充 `supports_json_format: bool` 字段(GLM 全 False,千问/DeepSeek 全 True,与现有运行时行为一致)。

**影响面**:[App.py:453](file:///d:/AI-Agent学习计划/AI-Agent%20study/App.py#L453)、[App.py:4490](file:///d:/AI-Agent学习计划/AI-Agent%20study/App.py#L4490)、[App.py:5565](file:///d:/AI-Agent学习计划/AI-Agent%20study/App.py#L5565) 三个调用点行为不变,但数据源从字符串嗅探变成查表。

---

### 阶段 ① 模型 ID 升级 + 上下文长度更新

**文件**:`model_settings.py`、`data/model_settings.json`、前端 `SettingsDialog.tsx`、`ModelQuickSwitcher.tsx`

**MODEL_CATALOG 改造**([model_settings.py:81-84](file:///d:/AI-Agent学习计划/AI-Agent%20study/model_settings.py#L81-L84)):

```python
"deepseek": [
    {"value": "deepseek:deepseek-v4-flash", "label": "DeepSeek V4 Flash · 性价比",
     "model_id": "deepseek-v4-flash", "supports_vision": False, "supports_json_format": True,
     "thinking_control": "deepseek", "input_context": 1_000_000, "output_context": 384_000},
    {"value": "deepseek:deepseek-v4-pro", "label": "DeepSeek V4 Pro · 旗舰",
     "model_id": "deepseek-v4-pro", "supports_vision": False, "supports_json_format": True,
     "thinking_control": "deepseek", "input_context": 1_000_000, "output_context": 384_000},
],
```

**ModelSettings 默认值更新**([model_settings.py:88-109](file:///d:/AI-Agent学习计划/AI-Agent%20study/model_settings.py#L88-L109)):
- `model_id` 默认 `"deepseek-v4-flash"`
- `display_name` 默认 `"DeepSeek V4 Flash"`
- `input_context` 默认 `1_000_000`
- `output_context` 默认 `384_000`

**持久化 profile 升级**([data/model_settings.json:25-44](file:///d:/AI-Agent学习计划/AI-Agent%20study/data/model_settings.json#L25-L44)):
- `model_id`: `deepseek-chat` → `deepseek-v4-flash`
- `display_name`: `DeepSeek Chat` → `DeepSeek V4 Flash`
- `input_context`: `64000` → `1000000`
- `output_context`: `8000` → `384000`

**前端 PRESETS**([SettingsDialog.tsx:12](file:///d:/AI-Agent学习计划/AI-Agent%20study/frontend/ai-agent/src/components/SettingsDialog.tsx#L12)) 同步更新。

**前端 FALLBACK_CATALOG**([ModelQuickSwitcher.tsx:11-25](file:///d:/AI-Agent学习计划/AI-Agent%20study/frontend/ai-agent/src/components/ModelQuickSwitcher.tsx#L11-L25)) 补充 deepseek 键。

**前端 thinking_control 类型**([api.ts:39](file:///d:/AI-Agent学习计划/AI-Agent%20study/frontend/ai-agent/src/lib/api.ts#L39)):`'budget' | 'effort' | 'none'` → `'budget' | 'effort' | 'none' | 'deepseek'`

---

### 阶段 ② 思考模式传参实现(核心)

**文件**:`App.py`

**新增 `thinking_control == "deepseek"` 分支**,与 GLM/Qwen 完全隔离:

[App.py:453-481 stream_json_completion](file:///d:/AI-Agent学习计划/AI-Agent%20study/App.py#L453-L481) 改造:

```python
if caps.thinking_control == "glm":
    # ... 现有 GLM 逻辑保持不变
elif caps.thinking_control == "qwen_budget":
    # ... 现有千问逻辑保持不变
elif caps.thinking_control == "deepseek":
    # DeepSeek 协议:thinking 走 extra_body,reasoning_effort 走顶层
    # Why: 与 GLM 关键差异——reasoning_effort 是顶层参数,不是 extra_body.thinking.reasoning_effort
    thinking_type = thinking  # "enabled" / "disabled"
    create_kwargs["extra_body"] = {"thinking": {"type": thinking_type}}
    if thinking_type == "enabled":
        create_kwargs["reasoning_effort"] = reasoning_effort
        # Why: 官方文档明确思考模式启用时 temperature/top_p 不报错但不生效,
        # 显式移除避免误导调试;非思考模式保留 temperature 让用户可调
        create_kwargs.pop("temperature", None)
```

[App.py:4489-4507 stream_tool_loop](file:///d:/AI-Agent学习计划/AI-Agent%20study/App.py#L4489-L4507) 同步增加 deepseek 分支:

```python
elif tool_caps.thinking_control == "deepseek":
    tool_extra_body = {"thinking": {"type": "enabled"}}
    # 工具循环固定用 high 档(与 GLM 用 medium 对齐,避免过度思考拖慢工具调用)
    # 注意:reasoning_effort 是顶层参数,需在 create_kwargs 里设
    # 此处先标记,循环内注入
```

工具循环内 `create_kwargs` 构造时,deepseek 分支需额外注入 `reasoning_effort="high"` 顶层参数。

**reasoning_content 回传处理**(关键,DeepSeek 思考模式 + Tool Calls 必须回传):

[App.py:4511-4520](file:///d:/AI-Agent学习计划/AI-Agent%20study/App.py#L4511-L4520) 工具调用结果 append 时,deepseek 分支必须保留 `reasoning_content`:

```python
if tool_calls:
    assistant_msg = {
        "role": "assistant",
        "content": msg.content or "",
        "tool_calls": [...],
    }
    # Why: DeepSeek 思考模式下,工具调用轮次的 reasoning_content 在后续所有请求中
    # 必须完整回传,否则 API 返回 400(官方文档明确要求)
    if tool_caps.thinking_control == "deepseek":
        assistant_msg["reasoning_content"] = getattr(msg, "reasoning_content", "") or ""
    messages.append(assistant_msg)
```

---

### 阶段 ③ reasoning_effort 白名单收紧

**文件**:`model_settings.py`

[当前白名单](file:///d:/AI-Agent学习计划/AI-Agent%20study/model_settings.py#L111-L118) 含 `minimal`,官方 DeepSeek 不支持。

**方案**:保留 `minimal`(GLM 可能用),但新增 DeepSeek 专用校验逻辑:

```python
@field_validator("reasoning_effort")
@classmethod
def validate_reasoning_effort(cls, value: str, info) -> str:
    value = (value or "high").strip().lower()
    provider = info.data.get("provider")
    if provider == "deepseek":
        # DeepSeek 协议字面支持 low/medium/high/xhigh/max,但 low/medium 映射 high
        allowed = {"low", "medium", "high", "xhigh", "max"}
        if value not in allowed:
            raise ValueError(f"DeepSeek reasoning_effort 必须是 {', '.join(sorted(allowed))} 之一")
    else:
        allowed = {"max", "xhigh", "high", "medium", "low", "minimal", "none"}
        if value not in allowed:
            raise ValueError(f"reasoning_effort 必须是 {', '.join(sorted(allowed))} 之一")
    return value
```

---

### 阶段 ⑤ 前端 UI 补全

**文件**:`SettingsDialog.tsx`、`ModelQuickSwitcher.tsx`

#### 5.1 SettingsDialog 模型 ID 下拉补全

[SettingsDialog.tsx:384-386](file:///d:/AI-Agent学习计划/AI-Agent%20study/frontend/ai-agent/src/components/SettingsDialog.tsx#L384-L386) 当前 DeepSeek 走纯 Input,改为多变体下拉:

```tsx
// 新增 DEEPSEEK_MODEL_OPTIONS 常量(对齐 GLM_MODEL_OPTIONS 模式)
const DEEPSEEK_MODEL_OPTIONS = [
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash · 性价比' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro · 旗舰' },
];

// JSX 中 deepseek 分支改为下拉 + 自定义输入(对齐 qwen 的渲染模式)
```

#### 5.2 SettingsDialog 高级配置 DeepSeek 思考控件

[SettingsDialog.tsx:395-396](file:///d:/AI-Agent学习计划/AI-Agent%20study/frontend/ai-agent/src/components/SettingsDialog.tsx#L395-L396) 新增 deepseek 分支:

```tsx
{form.provider === 'deepseek' && (
  <>
    <div className="grid gap-5 sm:grid-cols-3">
      <Field label="最大输出 Tokens">
        <NumberInput value={form.max_tokens} onChange={(v) => patch({max_tokens:v})}/>
      </Field>
      <Field label="思考强度" hint="仅 DeepSeek 生效;思考启用时 Temperature 不生效">
        <Select value={form.reasoning_effort} onChange={(v) => patch({reasoning_effort: v})}>
          <option value="high">标准</option>
          <option value="xhigh">加强</option>
          <option value="max">最强</option>
        </Select>
      </Field>
    </div>
    <div className="grid gap-5 sm:grid-cols-3">
      <label className="flex h-11 items-center justify-between self-end rounded-lg border ...">
        启用深度思考
        <Toggle label="启用深度思考" checked={form.thinking_enabled} onChange={(v)=>patch({thinking_enabled:v})}/>
      </label>
    </div>
  </>
)}
```

> 注意:DeepSeek 思考强度档位用语义化中文标签(标准/加强/最强),不展示 `low/medium`(因映射到 high,展示会误导)。`thinking_enabled=false` 时后端走 `thinking.type=disabled`,不传 reasoning_effort。

#### 5.3 ModelQuickSwitcher DeepSeek 多变体 + 思考强度

[ModelQuickSwitcher.tsx:148](file:///d:/AI-Agent学习计划/AI-Agent%20study/frontend/ai-agent/src/components/ModelQuickSwitcher.tsx#L148) 当前 DeepSeek 是单 option,改为 optgroup 多变体:

```tsx
<optgroup label="DeepSeek">
  {variantsOf('deepseek').map((variant) => (
    <option key={variant.value} value={variant.value} disabled={!profiles.deepseek?.has_api_key}>
      {variant.label}
    </option>
  ))}
</optgroup>
```

`variantsOf` 函数扩展支持 `'deepseek' | 'glm' | 'qwen'`。

新增 DeepSeek 思考强度快速切换器(对齐 GLM 的 reasoning_effort 选择器模式):

```tsx
// 新增 DEEPSEEK_EFFORTS 常量(四档语义化)
const DEEPSEEK_EFFORTS = [
  { value: 'disabled', label: '关闭' },
  { value: 'high', label: '标准' },
  { value: 'xhigh', label: '加强' },
  { value: 'max', label: '最强' },
] as const;

{active === 'deepseek' && (
  <label className={labelClass}>
    <span className="sr-only">思考强度</span>
    <select
      aria-label="思考强度"
      value={profiles.deepseek?.thinking_enabled === false ? 'disabled' : (profiles.deepseek?.reasoning_effort || 'high')}
      disabled={disabled || loading}
      onChange={(e) => void changeDeepSeekEffort(e.target.value)}
      className={selectClass}
    >
      {DEEPSEEK_EFFORTS.map((item) => (
        <option key={item.value} value={item.value}>{item.label}</option>
      ))}
    </select>
  </label>
)}
```

新增 `changeDeepSeekEffort` 函数处理"关闭"档位(同时设 `thinking_enabled=false` + `reasoning_effort='high'`)和"开启"档位(`thinking_enabled=true` + `reasoning_effort=<value>`)。

---

### 阶段 ⑥ 测试契约更新

**文件**:`tests/test_qwen_provider.py`

[test_deepseek_keeps_json_format_without_extra_body](file:///d:/AI-Agent学习计划/AI-Agent%20study/tests/test_qwen_provider.py#L130-L133) 当前断言 DeepSeek 不带 extra_body,升级后需**反转**:

```python
def test_deepseek_v4_sends_thinking_extra_body(self):
    """DeepSeek V4 升级后必须发送 thinking extra_body + 顶层 reasoning_effort。"""
    captured = self._capture("deepseek-v4-flash", thinking="enabled", reasoning_effort="high")
    self.assertIn("extra_body", captured)
    self.assertEqual(captured["extra_body"], {"thinking": {"type": "enabled"}})
    self.assertEqual(captured["reasoning_effort"], "high")
    # 思考模式启用时 temperature 必须移除
    self.assertNotIn("temperature", captured)

def test_deepseek_v4_disabled_thinking_no_effort(self):
    """思考关闭时不传 reasoning_effort。"""
    captured = self._capture("deepseek-v4-flash", thinking="disabled")
    self.assertEqual(captured["extra_body"], {"thinking": {"type": "disabled"}})
    self.assertNotIn("reasoning_effort", captured)
```

新增 `test_capabilities_for_model_uses_catalog` 验证查表逻辑。

新增 `test_deepseek_tool_loop_returns_reasoning_content` 验证工具循环中 reasoning_content 被回传。

---

## 五、不做的事

| 项 | 原因 |
|---|---|
| API key 硬编码 | UI 填入机制本身正确,本地工具明文存 JSON 是行业惯例 |
| 命名误导 DEEPSEEK_API_KEY | 变量名虽误导但不影响功能,改了要动很多调用点,收益小 |
| Anthropic 格式接入 | 当前 OpenAI 格式已满足需求 |
| Vision 支持 | 官方未发布多模态 API |
| main.py 全局变量重命名 | 收益小风险大,留作后续单独迭代 |

## 六、风险与回滚

| 风险 | 缓解 |
|---|---|
| 查表逻辑未命中未知模型导致能力判断回退 | 兜底分支保持历史行为 `ProviderCapabilities(True, "none", False)`,且现有 GLM/Qwen 模型 ID 都在 catalog 中有匹配 |
| DeepSeek 思考模式 + 工具调用 reasoning_content 回传逻辑遗漏 | 新增专门测试用例覆盖;首次切换到 DeepSeek 工具调用时人工验证一轮 |
| 已有用户持久化 profile 还是 deepseek-chat | ModelSettingsStore.load 已有兜底逻辑,但需确认旧 profile 升级路径——**建议新增一次性迁移代码**,检测到 `deepseek-chat` 自动改为 `deepseek-v4-flash` |
| 前端 ModelQuickSwitcher variantsOf 扩展支持 deepseek 后,change 函数需同步处理 deepseek: 前缀 | 在 change 函数增加 `rawValue.startsWith('deepseek:')` 分支,逻辑对齐 glm/qwen |

## 七、验证清单

- [ ] `pytest tests/test_model_settings.py tests/test_qwen_provider.py` 全绿
- [ ] 后端启动后 `GET /api/settings/model-catalog` 返回 deepseek 两个变体
- [ ] 前端 ModelQuickSwitcher 下拉显示 DeepSeek optgroup 含两个变体
- [ ] 切换到 deepseek-v4-flash 后,输入框右侧出现"思考强度"四档选择器
- [ ] SettingsDialog 中 DeepSeek 模型 ID 变为下拉,高级配置出现思考强度选择器
- [ ] DeepSeek 标准对话走思考模式时,SSE 流中能看到 reasoning_content
- [ ] DeepSeek 工具调用(MCP/内置工具)不报 400
- [ ] GLM 和千问模型功能完全不受影响(回归测试)

## 八、文件清单总览

| 文件 | 修改类型 | 阶段 |
|---|---|---|
| `model_settings.py` | 重构 capabilities_for_model + 升级 MODEL_CATALOG + 收紧校验 | ④①③ |
| `App.py` | 新增 deepseek 思考分支 + reasoning_content 回传 | ② |
| `data/model_settings.json` | profile 升级 + 一次性迁移逻辑 | ① |
| `frontend/ai-agent/src/components/SettingsDialog.tsx` | PRESETS 升级 + DeepSeek 下拉 + 思考控件 | ①⑤ |
| `frontend/ai-agent/src/components/ModelQuickSwitcher.tsx` | FALLBACK_CATALOG + DeepSeek optgroup + 思考强度选择器 | ①⑤ |
| `frontend/ai-agent/src/lib/api.ts` | thinking_control 类型扩展 | ① |
| `tests/test_qwen_provider.py` | 测试契约反转 + 新增测试 | ⑥ |

---

**请确认以下决策点后开始实施:**

1. **四档思考强度定义**:关闭/标准/加强/最强(disabled/high/xhigh/max)是否 OK?
2. **持久化 profile 迁移**:检测到旧 `deepseek-chat` 自动改为 `deepseek-v4-flash` 是否 OK?还是手动改 JSON?
3. **执行顺序**:④ → ① → ② → ③ → ⑤ → ⑥ 是否 OK?
