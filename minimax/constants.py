"""MiniMax 接入包常量（协议端点 / 模型 ID / 官方限制）。"""

# ---- 端点 ----
# Why: Anthropic 兼容端点是主链路——M3 thinking 块 / Interleaved Thinking /
# 服务端 web_search 的唯一路径；OpenAI 兼容端点仅供 LangGraph 多智能体与 Code 链路复用。
ANTHROPIC_BASE_URL = "https://api.minimaxi.com/anthropic"
OPENAI_COMPAT_BASE_URL = "https://api.minimaxi.com/v1"

# 专项生成端点（图像/视频，不在兼容协议内）
IMAGE_API_URL = "https://api.minimaxi.com/v1/image_generation"
VIDEO_API_BASE = "https://api.minimaxi.com/v2"

# ---- 文本模型 ID（与 model_settings.MODEL_CATALOG 保持一致）----
MODEL_M3 = "MiniMax-M3"
MODEL_M2_7 = "MiniMax-M2.7"
MODEL_M2_7_HIGHSPEED = "MiniMax-M2.7-highspeed"
MODEL_M2_5 = "MiniMax-M2.5"
MODEL_M2_5_HIGHSPEED = "MiniMax-M2.5-highspeed"

# ---- 专项模型 ID ----
IMAGE_MODEL_ID = "image-01"
VIDEO_MODEL_ID = "Hailuo2.3"
VIDEO_MODEL_ID_HAILUO = "Hailuo2.3"
VIDEO_MODEL_ID_H3 = "MiniMax-H3"

# ---- 服务端工具（仅 Anthropic Messages API，Beta）----
# Why: web_search_20250305 是版本化类型标识（沿用 Anthropic 命名约定），声明时以此为准。
WEB_SEARCH_TOOL = {"type": "web_search_20250305", "name": "web_search"}

# ---- Anthropic 协议头 ----
ANTHROPIC_VERSION = "2023-06-01"

# ---- 默认超时（秒）----
# Why: 服务端 web_search 单次请求耗时显著长于普通对话，客户端超时必须放宽。
DEFAULT_TIMEOUT = 180.0

# ---- 主动缓存 ----
# Why: 单请求最多 4 个 cache_control 断点（官方限制），本包策略最多用 2 个（system 尾块 + tools 尾项）。
MAX_CACHE_BREAKPOINTS = 4

# ---- H3 视频生成官方输入限制（创建前本地校验用）----
H3_MAX_REFERENCE_IMAGES = 9
H3_MAX_REFERENCE_VIDEOS = 3
H3_MAX_REFERENCE_AUDIOS = 3
H3_MAX_MIXED_FILES = 12
H3_MAX_FRAME_IMAGES = 2          # 首尾帧入口：0/1/2 张
H3_MIN_DURATION = 4              # 秒，整数
H3_MAX_DURATION = 15
H3_MAX_PROMPT_CHARS = 7000
H3_MAX_VIDEO_MB = 50
H3_MAX_IMAGE_MB = 30
H3_MAX_AUDIO_MB = 15
H3_MIN_MEDIA_EDGE = 256          # 宽高范围 [256, 5760]
H3_MAX_MEDIA_EDGE = 5760
