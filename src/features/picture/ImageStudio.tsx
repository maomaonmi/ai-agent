import React, { useState } from 'react';
import { 
  Palette, Sparkles, Download, Eye, Maximize2, RefreshCw, 
  Layers, Sliders, Image as ImageIcon, Check, Copy 
} from 'lucide-react';

interface GeneratedImage {
  url: string;
  index: number;
}

const MODEL_OPTIONS = [
  { id: 'qwen-image-3.0-pro', name: '千问 3.0 Pro', badge: '复杂版面/小字精准', desc: '最高 2K，适合排版、摄影级细节' },
  { id: 'wan2.7-image-pro', name: '万相 2.7 Pro', badge: '4K 超清/角色一致', desc: '最高 4096×4096，控色与多图一致性' },
  { id: 'z-image-turbo', name: 'Z-Image Turbo', badge: '10倍极速/低成本', desc: '秒级出图，写实人像与商品图' },
  { id: 'cogview-4', name: '智谱 CogView-4', badge: '汉字排版专家', desc: '精准生成招牌、书法、中文海报' },
  { id: 'glm-image', name: '智谱 GLM-Image', badge: '通用平衡', desc: '官方写实与动漫综合生图' }
];

const RATIO_OPTIONS = [
  { label: '1:1 正方形', value: '1024*1024' },
  { label: '16:9 横屏海报', value: '1280*720' },
  { label: '9:16 竖屏手机', value: '720*1280' },
  { label: '4:3 经典画幅', value: '1024*768' },
  { label: '2K 极限超清', value: '2048*2048' }
];

export const ImageStudio: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('blurry, low quality, deformed, watermark');
  const [selectedModel, setSelectedModel] = useState('qwen-image-3.0-pro');
  const [selectedSize, setSelectedSize] = useState('1024*1024');
  const [imageCount, setImageCount] = useState(1);
  
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [styleTags, setStyleTags] = useState<string[]>([]);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  // 1. 触发【视觉导演 Agent】一键润色与模型推荐
  const handleEnhancePrompt = async () => {
    if (!prompt.trim()) return;
    setIsEnhancing(true);
    try {
      const res = await fetch('http://localhost:8000/api/image/enhance_prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_prompt: prompt })
      });
      const data = await res.json();
      setPrompt(data.enhanced_prompt);
      if (data.negative_prompt) setNegativePrompt(data.negative_prompt);
      if (data.recommended_model) setSelectedModel(data.recommended_model);
      if (data.suggested_size) setSelectedSize(data.suggested_size);
      if (data.style_tags) setStyleTags(data.style_tags);
    } catch (e) {
      alert('导演润色失败');
    } finally {
      setIsEnhancing(false);
    }
  };

  // 2. 触发核心多厂商生图
  const handleGenerateImages = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    try {
      const res = await fetch('http://localhost:8000/api/image/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          prompt,
          negative_prompt: negativePrompt,
          size: selectedSize,
          n: imageCount
        })
      });
      const data = await res.json();
      setGeneratedImages(data.images || []);
    } catch (e) {
      alert('生成图片失败，请检查 API 额度与配置');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans">
      
      {/* 左侧控制参数面板 */}
      <div className="w-96 bg-slate-900 border-r border-slate-800 p-5 flex flex-col justify-between overflow-y-auto">
        <div className="space-y-5">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
            <Palette className="w-5 h-5 text-emerald-400" />
            <h2 className="font-semibold text-base">AI 多模态视觉画廊</h2>
          </div>

          {/* 模型选型选择器 */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">生成模型与引擎</label>
            <div className="space-y-1.5">
              {MODEL_OPTIONS.map(m => (
                <div
                  key={m.id}
                  onClick={() => setSelectedModel(m.id)}
                  className={`p-2.5 rounded-xl border cursor-pointer transition ${
                    selectedModel === m.id 
                      ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300' 
                      : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700 text-slate-400'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-slate-200">{m.name}</span>
                    <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded text-emerald-400 font-mono">{m.badge}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">{m.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* 比例尺寸 */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">画幅比例与分辨率</label>
            <div className="grid grid-cols-2 gap-1.5">
              {RATIO_OPTIONS.map(r => (
                <button
                  key={r.value}
                  onClick={() => setSelectedSize(r.value)}
                  className={`px-2.5 py-2 rounded-lg text-xs font-medium border text-left transition ${
                    selectedSize === r.value 
                      ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 font-semibold' 
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800/60'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* 提示词输入区 + 导演润色按钮 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-slate-300">画面描述 Prompt</label>
              <button
                onClick={handleEnhancePrompt}
                disabled={isEnhancing || !prompt.trim()}
                className="flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 disabled:opacity-50 transition"
              >
                <Sparkles className={`w-3.5 h-3.5 ${isEnhancing ? 'animate-spin' : ''}`} />
                {isEnhancing ? '导演润色中...' : '✨ 视觉导演润色'}
              </button>
            </div>
            <textarea
              rows={4}
              placeholder="例如：赛博朋克风中国龙在未来城市上空盘旋，带有霓虹书法招牌'未来科技'..."
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        {/* 生成按钮 */}
        <button
          onClick={handleGenerateImages}
          disabled={isGenerating || !prompt.trim()}
          className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium py-3 rounded-xl text-sm transition shadow-lg shadow-emerald-950 mt-4"
        >
          {isGenerating ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              正在渲染画作...
            </>
          ) : (
            <>
              <Palette className="w-4 h-4" />
              立即生成作品
            </>
          )}
        </button>
      </div>

      {/* 右侧画廊展示区 */}
      <div className="flex-1 p-6 overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold text-sm text-slate-300">生成的画作画廊</h3>
          <span className="text-xs text-slate-500">{generatedImages.length} 张可用图像</span>
        </div>

        {generatedImages.length === 0 ? (
          <div className="h-[500px] border border-dashed border-slate-800 rounded-2xl flex flex-col items-center justify-center text-slate-600 gap-2">
            <ImageIcon className="w-10 h-10 stroke-1" />
            <p className="text-xs">在左侧输入需求并点击生成，作品将在此呈现...</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {generatedImages.map((img) => (
              <div key={img.index} className="group relative rounded-2xl overflow-hidden border border-slate-800 bg-slate-900 shadow-xl">
                <img src={img.url} alt="Generated" className="w-full h-auto object-cover" />
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                  <button
                    onClick={() => setPreviewImageUrl(img.url)}
                    className="p-2.5 bg-slate-800/80 hover:bg-slate-700 text-white rounded-xl backdrop-blur transition"
                  >
                    <Maximize2 className="w-4 h-4" />
                  </button>
                  <a
                    href={img.url}
                    target="_blank"
                    download={`image_${img.index}.png`}
                    className="p-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl transition"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 全屏放大查看 Lightbox */}
      {previewImageUrl && (
        <div 
          onClick={() => setPreviewImageUrl(null)}
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-6 cursor-zoom-out"
        >
          <img src={previewImageUrl} alt="Full Preview" className="max-w-full max-h-full rounded-xl shadow-2xl" />
        </div>
      )}

    </div>
  );
};