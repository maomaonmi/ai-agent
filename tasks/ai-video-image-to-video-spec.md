# Spec: AI 视频图生视频阶段

## Objective

在现有 AI 视频异步任务引擎中增加图生视频，支持：

- 单首帧：`wan2.7-i2v`、`wan2.6-i2v-flash`、`wan2.6-i2v`、`viduq1-image`。
- 首尾帧：`wan2.7-i2v`、`wan2.2-kf2v-flash`、`viduq1-start-end`。
- 保持现有任务持久化、后台轮询、SSE、历史记录和本地视频转存链路不变。

`viduq1-text` 作为智谱 Vidu Q1 文生视频入口一并加入模型矩阵，但不出现在图生视频模型筛选中。

## Contract

统一客户端请求继续使用 `POST /api/video/create_task`，新增字段：

```json
{
  "mode": "image_to_video",
  "model": "wan2.7-i2v",
  "prompt": "镜头缓慢推进",
  "first_frame_url": "https://example.com/first.png",
  "last_frame_url": null,
  "negative_prompt": "模糊",
  "audio_url": "https://example.com/voice.mp3",
  "resolution": "1080P",
  "duration": 5,
  "prompt_extend": true,
  "watermark": false,
  "seed": 42
}
```

`mode` 可选 `text_to_video`、`image_to_video`、`start_end_video`。旧客户端省略时默认 `text_to_video`，保持向后兼容。

## Provider Mapping

| 模型 | 模式 | 上游契约 |
|---|---|---|
| `wan2.7-i2v` | 首帧 | `input.media=[{type:first_frame,url}, {type:driving_audio,url}?]` |
| `wan2.7-i2v` | 首尾帧 | `input.media=[{type:first_frame,url},{type:last_frame,url},{type:driving_audio,url}?]` |
| `wan2.6-i2v(-flash)` | 首帧 | `input.img_url`，可选 `input.audio_url` |
| `wan2.2-kf2v-flash` | 首尾帧 | 独立端点；`input.first_frame_url`、`input.last_frame_url` |
| `viduq1-image` | 首帧 | `image_url` 字符串 |
| `viduq1-start-end` | 首尾帧 | `image_url` 两元素有序数组 |

## Validation

- 图生模式必须有首帧；首尾帧模式还必须有尾帧。
- 媒体 URL 只接受公网 HTTP/HTTPS；拒绝 localhost、私网与保留 IP。
- `wan2.7-i2v`：prompt 必填且最多 5000 字；negative prompt 最多 500 字；720P/1080P；2–15 秒。
- `wan2.6-i2v(-flash)`：prompt 最多 1500 字；720P/1080P；2–15 秒。
- `wan2.2-kf2v-flash`：prompt 可空、最多 800 字；480P/720P/1080P；固定 5 秒。
- Vidu Q1：固定 5 秒、1080P；首尾帧数组顺序不可交换。
- 音频输入只允许支持该能力的首帧/wan2.7 首尾帧模型，且必须是公网 URL。

## UI

- AI 视频生成区增加“文生视频 / 首帧图生视频 / 首尾帧过渡”模式切换。
- 根据模式过滤模型；切换模型时自动校正分辨率与时长。
- 图生模式显示首帧 URL，首尾帧模式额外显示尾帧 URL；支持 URL、文件上传生成应用素材 URL、粘贴素材 URL三种输入方式。
- 显示负向提示词、seed、水印、提示词扩写和受支持的音频输入。
- 历史记录和任务详情显示模式及帧素材缩略图。

## Testing

- Pydantic 模式/模型/字段组合验证。
- Qwen 与 Zhipu 请求体和端点精确契约测试。
- API 创建、持久化、历史序列化回归测试。
- 前端 TypeScript、目标 ESLint、工作区契约测试和浏览器检查。

## Boundaries

- Always: 不记录 API Key；保留旧文生视频请求兼容；结果 URL 继续及时转存。
- Ask first: 发起真实计费生成任务。
- Never: 将本地文件路径直接发送给 HTTP 厂商接口；为了新模式复制任务引擎。

## Sources

- https://platform.qianwenai.com/docs/developer-guides/video-generation/image-to-video
- https://platform.qianwenai.com/docs/api-reference/video-generation/wan27-image-to-video/create-task
- https://platform.qianwenai.com/docs/developer-guides/video-generation/image-to-video-first-last
- https://platform.qianwenai.com/docs/api-reference/video-generation/wan-image-to-video-first-last-frames/create-task
- https://docs.bigmodel.cn/cn/guide/models/video-generation/viduq1

## Success Criteria

- 每个受支持模型只生成其官方契约允许的载荷与端点。
- 两种图生模式均可创建、恢复、轮询、SSE 更新、历史回放和播放下载。
- 旧文生视频测试全部保持通过。

