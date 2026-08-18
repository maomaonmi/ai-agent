# AI 视频：参考视频生成（R2V）架构计划

## 1. 目标与边界

在现有异步视频任务引擎上新增 `reference_to_video` 模式，首期接入：

- 千问：`wan2.7-r2v`、`wan2.7-r2v-2026-06-12`、`wan2.6-r2v-flash`、`wan2.6-r2v`。
- 智谱：`vidu2-reference` 只进入“多参考图生成视频”，不宣称支持参考视频。官方示例的输入字段是 `image_url[]`，并非 `video_url`。

首期不做计费/积分系统，不在 UI 展示积分；只做成本风险提示、并发限制、幂等提交和失败熔断。

## 2. 官方契约结论

### 2.1 千问 Wan 2.7

- `wan2.7-r2v` 是持续更新的主线版本；`wan2.7-r2v-2026-06-12` 是固定快照。
- 使用 `input.media`，元素类型为 `reference_video`、`reference_image` 或 `first_frame`。
- 参考素材合计 1–5 个；参考视频最多 3 个；首帧最多 1 个。
- 参考视频：MP4/MOV、1–30 秒、单边 240–4096 px、比例 1:8–8:1、最大 100 MB。
- 含参考视频时输出时长为 2–10 秒；仅图片参考时为 2–15 秒。
- 提示词使用 `Video N` / `Image N` 引用素材，图片与视频分别编号。
- 输入只传公开 HTTP/HTTPS URL；输出 URL 24 小时后失效。

### 2.2 千问 Wan 2.6

- 使用 `input.reference_urls`，最多 5 个参考素材，其中视频最多 3 个。
- 提示词使用 `character1`、`character2` 等按数组顺序引用素材。
- 输出时长 2–10 秒。
- `wan2.6-r2v-flash` 支持 `audio=false`；`wan2.6-r2v` 不开放无声模式。
- 使用 `size` 而不是 Wan 2.7 的 `resolution + ratio`。

### 2.3 智谱 Vidu 2

- `vidu2-reference` 是多参考图片生成视频，输入为 `image_url[]`。
- 固定 4 秒、720P；参数包括 `aspect_ratio`、`size`、`movement_amplitude`、`with_audio`。
- 它不能作为 GLM 侧 Video-to-Video 的对等实现。若后续智谱发布支持参考视频的模型，新增能力项，而不是改变现有模型语义。

## 3. 两项关键架构决策

### 3.1 中转存储：私有阿里云 OSS 临时桶

选择：生产和本地开发统一使用私有 OSS 临时桶；不以 Ngrok、Cloudflare Tunnel 或 localhost 作为正式链路。

原因：

- 千问服务与 OSS 在国内网络链路上更稳定；智谱也可读取带签名的标准 HTTPS URL。
- 浏览器通过后端签发的 PUT URL 直传，100 MB 文件不经过 FastAPI 进程，不占用应用服务器内存和带宽。
- Bucket 保持私有；提交供应商前生成 6 小时有效的签名 GET URL。
- 原始和标准化文件设置 24 小时生命周期；任务完成后仍给下载/重试留出时间。
- 通过 `ReferenceAssetStore` 接口隔离厂商，后续可添加 COS、S3/R2、MinIO 适配器。

本地开发没有 OSS 配置时，只开放“已有公网 URL”路径并给出明确提示，不伪造本地可访问 URL。

### 3.2 预处理：后端 FFprobe/FFmpeg 异步工作者

选择：浏览器只做 MIME、文件大小和 `<video>` 元数据预检；权威检测与转码放在后端原生 FFprobe/FFmpeg 工作者。

原因：

- 原生 FFmpeg 的编解码支持和输出一致性优于 FFmpeg.wasm。
- 避免浏览器下载数十 MB WASM、占用大量内存，并规避移动设备崩溃。
- 后端能统一输出 MP4/H.264/AAC、恒定帧率、标准像素格式，减少 HEVC、异常时间基、旋转元数据等供应商兼容问题。
- 预处理异步执行，不阻塞上传和 API 请求；进度写入数据库并通过 SSE/短轮询恢复。

首期沿用现有 SQLite 与 FastAPI lifespan 工作者，使用数据库租约避免重复处理；扩容到多实例时再迁移 Redis 队列。

## 4. 总体架构

```text
[浏览器选择视频]
    │ 轻量预检：大小/MIME/时长元数据
    ▼
POST /api/video/reference-assets
    │ 返回 asset_id + OSS 预签名 PUT URL
    ▼
[浏览器直传私有 OSS raw/]
    │
    ▼
POST /api/video/reference-assets/{id}/complete
    │
    ▼
[SQLite: UPLOADED → PROBING → TRANSCODING → READY/REJECTED]
    │                         ▲
    └──── [FFprobe/FFmpeg Worker] ────┘
                              │ 标准化文件写入 normalized/
                              ▼
[用户提交 R2V 任务，仅传 asset_id]
    │
    ▼
[后端生成 6h 签名 GET URL + 厂商 Payload 转换]
    │
    ├── Wan 2.7: input.media[] + Video N/Image N
    └── Wan 2.6: input.reference_urls[] + characterN
    │
    ▼
[现有异步 Task ID / 数据库 / 5s 轮询 / SSE]
    │
    ▼
[SUCCEEDED → 下载并转存供应商 24h 输出 URL]
```

## 5. 资产状态机

```text
CREATED
  → UPLOADING
  → UPLOADED
  → PROBING
  → READY               （原文件已满足模型规格）
  → TRANSCODING → READY （需要标准化）
  → REJECTED             （超限、损坏、无视频流等）
  → EXPIRED / DELETED
```

只有 `READY` 资产可创建视频任务。重复调用 `complete` 必须幂等；相同内容 SHA-256 可复用已有标准化资产。

## 6. 数据模型

### 6.1 `video_reference_assets`

- `id`, `session_id`, `source_type` (`upload` / `public_url`)
- `raw_storage_key`, `normalized_storage_key`
- `original_filename`, `mime_type`, `size_bytes`, `sha256`
- `duration_ms`, `width`, `height`, `fps`, `video_codec`, `audio_codec`, `has_audio`
- `status`, `progress`, `error_code`, `error_message`
- `lease_owner`, `lease_expires_at`
- `created_at`, `updated_at`, `expires_at`

### 6.2 `video_task_references`

- `task_id`, `asset_id`, `position`
- `media_kind` (`reference_video` / `reference_image` / `first_frame`)
- `purpose` (`subject` / `style` / `motion` / `scene`)
- `provider_alias`（例如 `Video 1`、`character1`）

`purpose` 是产品层语义，用于生成提示词模板与提示用户，不伪装成供应商不存在的权重参数。

## 7. API 契约

### 7.1 创建上传资产

`POST /api/video/reference-assets`

请求：

```json
{
  "filename": "dance.mov",
  "contentType": "video/quicktime",
  "sizeBytes": 48392011,
  "sha256": "optional-client-hash"
}
```

响应：

```json
{
  "assetId": "asset_xxx",
  "status": "CREATED",
  "upload": {
    "method": "PUT",
    "url": "https://...signed...",
    "headers": {"Content-Type": "video/quicktime"},
    "expiresAt": "..."
  }
}
```

### 7.2 完成上传并启动预处理

`POST /api/video/reference-assets/{assetId}/complete`

- 校验 OSS 对象大小、ETag/哈希后转为 `UPLOADED`。
- 重复调用返回当前状态，不重复排队。

### 7.3 查询/删除资产

- `GET /api/video/reference-assets/{assetId}`
- `DELETE /api/video/reference-assets/{assetId}`

查询响应包含探测元数据、预处理进度和结构化错误。

### 7.4 创建视频任务（扩展现有接口）

沿用 `POST /api/video/create_task`，新增可选字段而不破坏现有模式：

```json
{
  "mode": "reference_to_video",
  "model": "wan2.7-r2v",
  "prompt": "Video 1 ...",
  "references": [
    {"assetId": "asset_xxx", "mediaKind": "reference_video", "purpose": "motion"}
  ],
  "duration": 5,
  "resolution": "720P",
  "ratio": "16:9",
  "audio": true,
  "shotType": "multi",
  "promptExtend": true,
  "watermark": false,
  "clientRequestId": "uuid"
}
```

边界错误统一返回：

```json
{"error":{"code":"ASSET_NOT_READY","message":"参考视频仍在预处理中","details":{"assetId":"asset_xxx"}}}
```

## 8. 厂商 Payload 标准化

### 8.1 Wan 2.7

- 资产解析成 `input.media[]`。
- 根据类型分别生成 `Video N` / `Image N` 别名并展示在 UI。
- `purpose` 只用于提示词模板：主体复刻、风格参考、动作参考、场景参考。
- 参数使用 `resolution`、`ratio`、`duration`、`prompt_extend`、`watermark`、`seed`。

### 8.2 Wan 2.6

- 资产 URL 按顺序写入 `input.reference_urls[]`。
- 生成 `character1...characterN` 别名。
- 参数使用 `size`、`duration`、`audio`、`shot_type`、`watermark`。
- 非 Flash 模型拒绝 `audio=false`。

### 8.3 Vidu 2 Reference

- 仅接受参考图片资产，写入 `image_url[]`。
- 固定 4 秒、720P；不出现在“参考视频”模型选择器中。
- 作为“多参考图”能力单独接入，避免错误的能力对齐。

## 9. 预检与转码策略

### 浏览器快速拦截

- 文件最大 100 MB；只作为快速反馈，后端再次校验。
- MIME 初筛 MP4/MOV；不信任扩展名。
- 读取时长、宽高，显示预计是否需要转码。

### 后端权威预检

- `ffprobe` 必须检测到视频流；拒绝损坏文件、纯音频、零时长。
- Wan 2.7：1–30 秒、240–4096 px、比例 1:8–8:1、≤100 MB。
- 多参考视频总数不超过 3，所有素材合计不超过 5。
- Wan 2.6 未在当前 API 参考页披露完整物理文件限制，适配器使用保守标准化配置，并保留供应商错误原文映射；不得把推测写成硬规格。

### 标准化输出

- 容器：MP4；视频：H.264；像素格式：`yuv420p`；音频：AAC。
- 保留符合要求的画幅，不自动裁切主体。
- 超过时长时不静默截断：UI 让用户选择裁剪区间，再生成标准化版本。
- 转码命令必须设置执行超时、CPU/内存并发限制和临时目录配额。

## 10. UI 方案

- 在现有双层模式切换中新增“参考视频”。
- 上传区支持最多 3 个视频，同时允许补充参考图片/首帧；总素材最多 5 个。
- 每个素材卡显示上传、探测、转码进度，READY 后显示时长、分辨率、编码和音频状态。
- 每个素材选择参考目的：主体、动作、风格、场景。
- UI 明确说明：参考目的用于提示词引导，不是供应商保证的精确权重控制。
- 自动生成供应商别名提示：Wan 2.7 显示 `Video 1`，Wan 2.6 显示 `character1`。
- 所有资产未 READY、超出数量限制或缺少提示词时禁止提交。
- 生成按钮不显示积分；提交前显示“输入视频与输出视频均可能按秒计费”的确认提示。

## 11. 超长任务与恢复

- 沿用数据库持久化 Task ID、SSE 推送和短轮询；R2V 默认轮询间隔 5 秒。
- SSE 断开后前端自动回退轮询，重新打开工作台从数据库恢复任务。
- 供应商输出 URL 成功后立即下载到本地/对象存储，避免 24 小时后失效。
- 创建请求网络超时且无法确认是否已创建远端任务时进入 `SUBMISSION_UNKNOWN`，禁止盲目重复付费提交。

## 12. 成本与熔断护栏

- `clientRequestId` 幂等；同一前端动作只创建一个本地任务。
- 每用户/会话限制在途 R2V 任务数量；默认 1，可配置。
- 供应商 4xx 不自动重试；429/5xx 仅在确认未创建远端任务时最多重试 2 次并带抖动退避。
- 任务失败不循环重新提交；错误归类为资产错误、参数错误、额度/限流、供应商内部错误。
- 记录输入视频计费时长、输出时长、模型、重试次数和供应商 request ID，便于审计。

## 13. 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| 签名 URL 在供应商拉取前过期 | 高 | 任务提交时重新签名 6 小时 URL；资产生命周期 24 小时 |
| 大文件压垮 FastAPI | 高 | 浏览器直传 OSS，后端不代理文件流 |
| HEVC/MOV 等兼容失败 | 高 | FFprobe 检测，必要时转为 MP4/H.264/AAC |
| 重复提交导致重复扣费 | 高 | 本地幂等键、`SUBMISSION_UNKNOWN`、禁止盲重试 |
| 将 Vidu 2 误当视频参考 | 高 | 能力矩阵和 UI 严格区分视频参考与多参考图 |
| 多实例重复预处理 | 中 | 数据库租约；扩容后迁移 Redis 队列 |
| 临时素材泄露 | 高 | 私有桶、短期签名、24 小时生命周期、日志不记录完整签名 URL |
| 转码资源耗尽 | 高 | 工作者并发上限、超时、临时目录配额、单文件 100 MB 上限 |

## 14. 实施阶段

1. 资产存储与预处理基础设施。
2. Wan 2.7 单参考视频最小闭环。
3. Wan 2.6 适配与多素材别名。
4. UI、多参考目的、恢复与成本护栏。
5. 单独接入 Vidu 2 多参考图能力。

每个阶段完成后先做契约测试和沙箱任务，付费供应商冒烟测试必须手动触发，禁止测试套件自动调用真实模型。

## 15. 官方资料

- 千问参考视频指南：https://platform.qianwenai.com/docs/developer-guides/video-generation/reference-video
- Wan 2.7 API：https://platform.qianwenai.com/docs/api-reference/video-generation/wan27-reference-to-video/create-task
- Wan 2.6 API：https://platform.qianwenai.com/docs/api-reference/video-generation/wan-reference-to-video/create-task
- 智谱 Vidu 2：https://docs.bigmodel.cn/cn/guide/models/video-generation/vidu2

