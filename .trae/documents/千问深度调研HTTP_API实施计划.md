# 千问深度调研 HTTP API 接入计划

## 一、技术选型确认

**调用方式**: DashScope HTTP API (非 OpenAI 兼容接口)  
**流式机制**: `X-DashScope-SSE: enable` 请求头  
**数据格式**: `output.message` 对象,包含 `phase`/`content`/`extra` 字段

---

## 二、后端改动清单

### 2.1 新增 HTTP API 调用函数

**位置**: `main.py` 中 `generate_qwen_deep_research_events()` 生成器

**核心逻辑**:
```python
async def generate_qwen_deep_research_events(
    query: str,
    session_id: str | None,
    enable_feedback: bool,
    api_key: str,
) -> AsyncGenerator[str, None]:
    """
    千问深度调研 HTTP API 调用
    两步式流程: 反问确认 → 深入研究
    四阶段流式: ResearchPlanning → WebResearch → KeepAlive → answer
    """
```

**关键实现点**:

1. **HTTP 请求构造**
   - URL: `https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation`
   - Headers: 
     - `Authorization: Bearer {api_key}`
     - `X-DashScope-SSE: enable`
     - `Content-Type: application/json`
   - Body:
     ```python
     {
         "model": "qwen-deep-research",
         "input": {
             "messages": messages  # 两步式对话历史
         },
         "parameters": {
             "enable_feedback": enable_feedback
         }
     }
     ```

2. **SSE 流式解析**
   - 使用 `httpx.AsyncClient` 发起流式请求
   - 逐行读取 `data: {...}` 格式
   - 解析 JSON 提取 `output.message`

3. **阶段映射与事件推送**
   ```python
   PHASE_MAP = {
       "ResearchPlanning": "planning",   # 反问确认
       "WebResearch": "searching",       # 深度搜索
       "KeepAlive": "analyzing",         # 分析整合
       "answer": "writing",              # 撰写报告
   }
   ```

4. **反问确认交互** (当 `enable_feedback=True`)
   - 第一步: 发送用户问题,接收模型反问
   - 推送 `qwen_feedback` 自定义事件通知前端
   - 等待用户回答 (通过新的 SSE 连接或 WebSocket)
   - 第二步: 将 `[用户问题, 模型反问, 用户回答]` 作为 messages 发送

5. **搜索结果提取**
   - 从 `output.message.extra.deep_research.references` 提取来源
   - 推送 `web_docs` 事件到前端

### 2.2 修改 `/deep_research` 端点路由

**位置**: `main.py` L4500+ (需要查找具体位置)

**改动**:
```python
if request.research_engine == "qwen":
    # 千问原生深度调研
    api_key = settings.api_key or os.getenv("DASHSCOPE_API_KEY", "")
    return EventSourceResponse(
        generate_qwen_deep_research_events(
            query=request.query,
            session_id=request.session_id,
            enable_feedback=request.enable_feedback,
            api_key=api_key,
        )
    )
```

### 2.3 扩展请求模型

**位置**: `main.py` 中 `DeepResearchRequest` 类

**新增字段**:
```python
class DeepResearchRequest(BaseModel):
    query: str
    session_id: str | None = None
    research_engine: Literal["firecrawl", "self-built", "qwen"] = "firecrawl"
    enable_feedback: bool = False  # 千问特有: 是否启用反问确认
    # ... 其他字段保持不变
```

---

## 三、前端改动清单

### 3.1 扩展 TypeScript 类型

**位置**: `frontend/ai-agent/src/lib/api.ts`

**改动**:
```typescript
// 扩展研究引擎类型
export type ResearchEngine = 'firecrawl' | 'self-built' | 'qwen';

// 扩展研究选项
export interface ResearchOptions {
  maxDepth: number;
  timeLimit: number;
  maxUrls: number;
  enable_feedback?: boolean;  // 千问特有
}

// 扩展研究进度事件
export interface ResearchProcessEvent {
  stage: 'fanout' | 'fetch' | 'chunk' | 'rerank' | 'reason' | 
         'planning' | 'searching' | 'analyzing' | 'writing' | 'complete';
  status: 'running' | 'done';
  message?: string;
  // ... 其他字段
}
```

### 3.2 适配进度面板

**位置**: `frontend/ai-agent/src/components/ResearchProgressPanel.tsx`

**改动**:
```typescript
// 新增千问四阶段配置
const QWEN_STAGE_CONFIG = {
  planning: {
    icon: '🤔',
    label: '反问确认',
    desc: '模型提出澄清问题帮助聚焦方向',
    color: 'blue',
  },
  searching: {
    icon: '🔍',
    label: '深度搜索',
    desc: '多轮联网搜索收集资料',
    color: 'green',
  },
  analyzing: {
    icon: '📊',
    label: '分析整合',
    desc: '分析搜索结果并提取关键信息',
    color: 'orange',
  },
  writing: {
    icon: '📝',
    label: '撰写报告',
    desc: '生成结构化深度研究报告',
    color: 'purple',
  },
  complete: {
    icon: '✅',
    label: '研究完成',
    desc: '深度研究报告已生成',
    color: 'green',
  },
} as const;

const QWEN_STAGE_ORDER = ['planning', 'searching', 'analyzing', 'writing', 'complete'] as const;

// 在组件中根据 stage 自动路由
const isQwenStage = QWEN_STAGE_ORDER.includes(progress.stage as any);
const stageConfig = isQwenStage 
  ? QWEN_STAGE_CONFIG[progress.stage as keyof typeof QWEN_STAGE_CONFIG]
  : STAGE_CONFIG[progress.stage as keyof typeof STAGE_CONFIG];
```

### 3.3 实现反问确认交互

**位置**: `frontend/ai-agent/src/components/ChatInterface.tsx`

**改动**:

1. **新增状态**
```typescript
const [qwenFeedbackPending, setQwenFeedbackPending] = useState(false);
const [qwenFeedbackQuestion, setQwenFeedbackQuestion] = useState('');
```

2. **处理 `qwen_feedback` 事件**
```typescript
if (parsed.type === 'qwen_feedback') {
  setQwenFeedbackPending(true);
  setQwenFeedbackQuestion(parsed.data.question);
  // 暂停 SSE 解析,等待用户输入
  return;
}
```

3. **渲染反问确认 UI**
```typescript
{qwenFeedbackPending && (
  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 my-4">
    <p className="text-sm text-blue-900 mb-2">{qwenFeedbackQuestion}</p>
    <input
      type="text"
      placeholder="请输入您的回答..."
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.currentTarget.value) {
          // 提交用户回答,继续研究流程
          submitQwenFeedback(e.currentTarget.value);
          setQwenFeedbackPending(false);
        }
      }}
      className="w-full px-3 py-2 border border-blue-300 rounded"
    />
  </div>
)}
```

4. **提交反问回答**
```typescript
const submitQwenFeedback = async (answer: string) => {
  // 发送新的请求,携带用户回答
  await sendDeepResearch({
    query: originalQuery,
    researchEngine: 'qwen',
    enable_feedback: true,
    feedback_answer: answer,  // 新增字段
  });
};
```

### 3.4 更新 API 调用

**位置**: `frontend/ai-agent/src/lib/api.ts` 中 `sendDeepResearch()`

**改动**:
```typescript
export async function sendDeepResearch(options: ResearchOptions & {
  enable_feedback?: boolean;
  feedback_answer?: string;
}) {
  const response = await fetch(`${API_BASE_URL}/deep_research`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: options.query,
      research_engine: options.researchEngine,
      enable_feedback: options.enable_feedback,
      feedback_answer: options.feedback_answer,
      // ... 其他参数
    }),
  });
  // ... SSE 处理逻辑
}
```

---

## 四、实施顺序

### Phase 1: 后端基础链路 (优先级 P0)
1. 实现 `generate_qwen_deep_research_events()` HTTP API 调用
2. 实现 SSE 解析和阶段映射
3. 修改 `/deep_research` 端点路由
4. 测试: 关闭反问确认,直接走研究流程

### Phase 2: 前端进度面板适配 (优先级 P0)
1. 扩展 TypeScript 类型定义
2. 实现千问四阶段配置
3. 测试: 验证进度面板正确显示四阶段

### Phase 3: 反问确认交互 (优先级 P1)
1. 后端实现两步式调用逻辑
2. 前端实现反问 UI 和状态管理
3. 测试: 开启反问确认,验证两步式流程

### Phase 4: 搜索结果提取 (优先级 P1)
1. 解析 `output.message.extra.deep_research.references`
2. 推送 `web_docs` 事件
3. 测试: 验证搜索结果面板显示来源信息

---

## 五、关键技术点

### 5.1 SSE 解析注意事项

**问题**: HTTP API 返回的 SSE 格式与 OpenAI 不同  
**解决**: 
- 使用 `httpx.AsyncClient.stream()` 逐行读取
- 跳过 `event:` 和 `:` 开头的行
- 仅解析 `data: {...}` 行

### 5.2 反问确认的状态管理

**问题**: SSE 是单向流,无法暂停等待用户输入  
**解决**: 
- 方案 A (推荐): 分两次请求
  - 第一次: `enable_feedback=true`,接收反问后关闭连接
  - 用户输入后,第二次: 携带 `feedback_answer`,继续研究
- 方案 B: WebSocket 双向通信 (复杂度高,不推荐)

### 5.3 阶段映射的准确性

**问题**: 千问 API 的 `phase` 字段与自研链路阶段名称不同  
**解决**: 
- 建立明确的映射表 `PHASE_MAP`
- 前端根据 `stage` 自动路由到对应配置

### 5.4 错误处理

**问题**: HTTP API 可能返回 4xx/5xx 错误  
**解决**: 
- 检查 `status_code` 字段
- 推送 `error` 事件到前端
- 记录详细日志便于排查

---

## 六、测试验证清单

### 后端测试
- [ ] HTTP API 调用成功,返回 SSE 流
- [ ] SSE 解析正确,提取 `phase`/`content`/`extra`
- [ ] 阶段映射准确,推送对应 `research_process` 事件
- [ ] 反问确认流程: 两步式调用正常
- [ ] 搜索结果提取: `references` 字段解析正确

### 前端测试
- [ ] 进度面板显示千问四阶段
- [ ] 阶段切换动画流畅
- [ ] 反问确认 UI 正确渲染
- [ ] 用户输入后继续研究流程
- [ ] 搜索结果面板显示来源信息

### 集成测试
- [ ] 选择"千问原生研究"引擎,关闭反问,直接研究
- [ ] 选择"千问原生研究"引擎,开启反问,两步式流程
- [ ] 对比 Firecrawl/自研引擎,验证进度面板切换
- [ ] 刷新页面后进度面板恢复

---

## 七、风险与应对

### 风险 1: HTTP API 响应格式变化
**应对**: 
- 添加详细的日志记录原始响应
- 使用 try-except 包裹 JSON 解析
- 推送 `error` 事件而非崩溃

### 风险 2: 反问确认交互复杂
**应对**: 
- 先实现关闭反问的直连模式
- 反问模式作为 P1 需求后续迭代

### 风险 3: 搜索结果字段缺失
**应对**: 
- 检查 `extra.deep_research` 是否存在
- 缺失时推送空数组,前端显示"无来源信息"

---

## 八、交付物

1. **后端代码**: `main.py` 中千问深度调研完整实现
2. **前端代码**: 进度面板适配 + 反问确认 UI
3. **测试报告**: 各场景测试通过截图
4. **文档更新**: 用户手册中千问深度调研使用说明

---

## 九、后续优化方向

1. **MCP 工具集成**: 利用 `research_tools` 参数接入外部 MCP Server
2. **图片输入支持**: 解析 `input.messages.content` 数组格式
3. **输出格式控制**: 支持 `model_summary_report` 摘要模式
4. **Token 用量统计**: 从 `usage` 字段提取并展示
