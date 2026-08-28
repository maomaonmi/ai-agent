'use client';

import React, { useState } from 'react';
import { Check, Loader2, Play, RotateCcw, Sparkles, X } from 'lucide-react';
import { type MusicTab } from './MusicSidebar';

interface VoiceDesignPageProps {
  activeTab: MusicTab;
  onTabChange: (tab: MusicTab) => void;
  onBack: () => void;
}

interface GeneratedVoice {
  voice_id: string;
  target_model: string;
  preview_audio: {
    data: string;
    sample_rate: number;
    response_format: string;
  };
  status?: string;
}

const VOICE_PRESETS = [
  { name: '年迈智者', avatar: 'https://images.unsplash.com/photo-1537368910025-700350fe46c7?w=80&h=80&fit=crop&crop=face', previewText: '孩子，人生的路很长，别急着赶路，先听听自己内心的声音。' },
  { name: '激情解说', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=80&h=80&fit=crop&crop=face', previewText: '欢迎来到今天的现场，让我们一起见证这场激动人心的比赛！' },
  { name: '悬疑故事家', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=80&h=80&fit=crop&crop=face', previewText: '夜深了，古屋里只有他一个人，门外传来若有若无的脚步声。' },
  { name: '摇篮曲女声', avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=80&h=80&fit=crop&crop=face', previewText: '晚安，愿你在温柔的月光里入睡，做一个甜甜的好梦。' },
  { name: '严厉女教师', avatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=80&h=80&fit=crop&crop=face', previewText: '请认真听讲，只有脚踏实地地积累，才能真正掌握知识。' },
];

export default function VoiceDesignPage({}: VoiceDesignPageProps) {
  const [prompt, setPrompt] = useState('');
  const [previewText, setPreviewText] = useState(VOICE_PRESETS[2].previewText);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedVoices, setGeneratedVoices] = useState<GeneratedVoice[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [showRegistration, setShowRegistration] = useState(false);
  const [registration, setRegistration] = useState({ name: '', gender: '', language: 'zh', description: '' });
  const [error, setError] = useState<string | null>(null);
  const [remainingSlots, setRemainingSlots] = useState(5);

  const handlePresetClick = (presetName: string) => {
    const preset = VOICE_PRESETS.find((item) => item.name === presetName);
    setPrompt(`请用${presetName}的语气说话，声音低沉而有磁性，语速适中较慢。`);
    if (preset) setPreviewText(preset.previewText);
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    
    setIsGenerating(true);
    setError(null);
    try {
      const response = await fetch('/api/music/voice-design/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          previewText,
          targetModel: 'qwen-audio-3.0-tts-plus',
          prefix: 'design',
          language: 'zh',
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.detail || '音色设计失败，请稍后重试');
      }
      const voices = (body?.voices || []) as GeneratedVoice[];
      if (voices.length !== 3) throw new Error('音色服务未返回完整的 3 个候选音色');
      setGeneratedVoices(voices);
      setSelectedVoiceId(voices[2].voice_id);
      // One click creates three provider candidates and consumes three previews.
      setRemainingSlots(prev => Math.max(0, prev - 3));
    } catch (error) {
      const message = error instanceof Error ? error.message : '音色设计失败，请稍后重试';
      setError(message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePlay = (voice: GeneratedVoice) => {
    if (!voice.preview_audio.data) return;
    const binary = atob(voice.preview_audio.data);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const blob = new Blob([bytes], { type: `audio/${voice.preview_audio.response_format}` });
    const url = URL.createObjectURL(blob);
    const player = new Audio(url);
    player.onended = () => URL.revokeObjectURL(url);
    player.onerror = () => URL.revokeObjectURL(url);
    void player.play();
  };

  const openRegistration = () => {
    const selected = generatedVoices.find((voice) => voice.voice_id === selectedVoiceId);
    if (!selected) return;
    setRegistration({ name: '', gender: '', language: 'zh', description: prompt });
    setShowRegistration(true);
  };

  const handleRegistration = async () => {
    if (!selectedVoiceId || !registration.name.trim() || !registration.description.trim()) return;
    setIsGenerating(true);
    setError(null);
    try {
      const response = await fetch(`/api/music/my-voices/${encodeURIComponent(selectedVoiceId)}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...registration, gender: registration.gender || null }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.detail || '音色登记失败，请稍后重试');
      setShowRegistration(false);
      setGeneratedVoices((prev) => prev.filter((voice) => voice.voice_id !== selectedVoiceId));
      setSelectedVoiceId(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : '音色登记失败，请稍后重试');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-8 py-10">
      {/* 页面标题 */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">音色设计</h1>
        <p className="text-slate-500 dark:text-slate-400">使用文字描述设计属于你的全新音色</p>
      </div>

      {/* 提示词输入区 */}
      <div className="mb-8">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          提示词
        </label>
        <div className="relative">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={500}
            placeholder="例：讲述悬疑故事的播音员，声音低沉富有磁性，语速时快时慢，营造紧张神秘的氛围。"
            className="w-full h-48 px-4 py-4 border border-slate-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-violet-500 dark:bg-neutral-800 dark:border-neutral-700 dark:text-white"
          />
          {/* 预设按钮 */}
          <div className="absolute bottom-4 left-4 flex gap-2">
            {VOICE_PRESETS.map((preset) => (
              <button
                key={preset.name}
                onClick={() => handlePresetClick(preset.name)}
                className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-full text-sm text-slate-700 dark:bg-neutral-700 dark:hover:bg-neutral-600 dark:text-slate-300 transition-colors"
              >
                <img src={preset.avatar} alt={preset.name} className="w-6 h-6 rounded-full" />
                <span>{preset.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 试听文本 */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            试听文本
          </label>
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            <RotateCcw size={14} />
            <span>自动生成</span>
          </button>
        </div>
        <textarea
          value={previewText}
          onChange={(e) => setPreviewText(e.target.value)}
          maxLength={200}
          minLength={15}
          placeholder="输入一段试听文本..."
          className="w-full h-24 px-4 py-3 border border-slate-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-violet-500 dark:bg-neutral-800 dark:border-neutral-700 dark:text-white"
        />
        <div className="flex items-center justify-between mt-2 text-xs text-slate-400">
          <span>{previewText.length} / 200 字符（至少 15）</span>
          <span>剩余音色预览: {remainingSlots}</span>
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}

      {/* 生成按钮 */}
      <div className="flex items-center justify-end gap-4">
        <div className="text-sm text-slate-500 dark:text-slate-400">
          剩余音色档位: <span className="font-semibold text-violet-600 dark:text-violet-400">2/3</span>
        </div>
        <button
          onClick={handleGenerate}
          disabled={isGenerating || !prompt.trim() || remainingSlots < 3}
          className="flex items-center gap-2 px-8 py-3 bg-gradient-to-r from-violet-500 to-indigo-500 text-white rounded-full font-medium hover:from-violet-600 hover:to-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-violet-500/30"
        >
          {isGenerating ? (
            <>
              <Sparkles size={18} className="animate-spin" />
              <span>生成中...</span>
            </>
          ) : (
            <>
              <Sparkles size={18} />
              <span>{remainingSlots < 3 ? '预览次数不足' : '生成 3 个音色'}</span>
            </>
          )}
        </button>
      </div>

      {/* 生成结果 */}
      {generatedVoices.length > 0 && (
        <div className="mt-12">
          <h2 className="text-lg font-medium text-slate-700 dark:text-slate-300 mb-4">
            生成音色结果
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {generatedVoices.map((voice, index) => {
              const selected = voice.voice_id === selectedVoiceId;
              return (
                <button
                  key={voice.voice_id}
                  type="button"
                  onClick={() => setSelectedVoiceId(voice.voice_id)}
                  className={`flex items-center gap-3 rounded-xl p-4 text-left transition-colors ${selected ? 'bg-slate-100 ring-1 ring-violet-300 dark:bg-neutral-800' : 'bg-slate-50 hover:bg-slate-100 dark:bg-neutral-800/70 dark:hover:bg-neutral-800'}`}
                >
                  <span
                    onClick={(event) => { event.stopPropagation(); handlePlay(voice); }}
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                    aria-label={`试听音色 ${index + 1}`}
                  >
                    <Play size={20} fill="currentColor" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-slate-900 dark:text-white">音色 {index + 1}</span>
                    <span className="block truncate text-xs text-slate-400">{voice.voice_id}</span>
                  </span>
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full border ${selected ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900' : 'border-slate-400 text-transparent'}`}>
                    <Check size={14} />
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={openRegistration}
              disabled={!selectedVoiceId || isGenerating}
              className="rounded-full bg-violet-500 px-8 py-3 font-medium text-white shadow-lg shadow-violet-500/20 transition-colors hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              确认选择
            </button>
          </div>
        </div>
      )}

      {showRegistration && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-labelledby="voice-registration-title">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-8 shadow-2xl dark:bg-neutral-900">
            <div className="mb-7 flex items-center justify-between">
              <h2 id="voice-registration-title" className="text-2xl font-semibold text-slate-900 dark:text-white">音色登记</h2>
              <button type="button" onClick={() => setShowRegistration(false)} className="rounded-full p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-neutral-800" aria-label="关闭">
                <X size={22} />
              </button>
            </div>
            <div className="space-y-5">
              <label className="block">
                <span className="mb-2 block font-medium text-slate-700 dark:text-slate-300">音色名称</span>
                <input value={registration.name} onChange={(event) => setRegistration((prev) => ({ ...prev, name: event.target.value }))} placeholder="请输入音色名称" maxLength={64} className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-violet-500 dark:border-neutral-700 dark:bg-neutral-800" />
              </label>
              <div>
                <span className="mb-2 block font-medium text-slate-700 dark:text-slate-300">标签</span>
                <div className="grid grid-cols-2 gap-3">
                  <select value={registration.gender} onChange={(event) => setRegistration((prev) => ({ ...prev, gender: event.target.value }))} className="rounded-xl border border-slate-200 px-4 py-3 text-slate-600 outline-none focus:ring-2 focus:ring-violet-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-slate-300">
                    <option value="">请选择性别</option>
                    <option value="男">男</option>
                    <option value="女">女</option>
                    <option value="中性">中性</option>
                  </select>
                  <select value={registration.language} onChange={(event) => setRegistration((prev) => ({ ...prev, language: event.target.value }))} className="rounded-xl border border-slate-200 px-4 py-3 text-slate-600 outline-none focus:ring-2 focus:ring-violet-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-slate-300">
                    <option value="zh">中文</option>
                    <option value="en">英文</option>
                  </select>
                </div>
              </div>
              <label className="block">
                <span className="mb-2 block font-medium text-slate-700 dark:text-slate-300">音色描述</span>
                <textarea value={registration.description} onChange={(event) => setRegistration((prev) => ({ ...prev, description: event.target.value }))} maxLength={500} rows={4} className="w-full resize-none rounded-xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-violet-500 dark:border-neutral-700 dark:bg-neutral-800" />
              </label>
            </div>
            <div className="mt-8 flex justify-end gap-3">
              <button type="button" onClick={() => setShowRegistration(false)} className="rounded-full bg-slate-100 px-7 py-3 font-medium text-slate-600 hover:bg-slate-200 dark:bg-neutral-800 dark:text-slate-300">返回</button>
              <button type="button" onClick={handleRegistration} disabled={!registration.name.trim() || !registration.description.trim() || isGenerating} className="flex items-center gap-2 rounded-full bg-violet-500 px-7 py-3 font-medium text-white hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-50">
                {isGenerating && <Loader2 size={16} className="animate-spin" />}
                保存音色
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
