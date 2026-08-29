'use client';

import { useCallback, useState, useEffect, useRef } from 'react';
import {
  Mic,
  Music,
  Video,
  ChevronDown,
  Settings,
  Sparkles,
  Play,
  Pause,
  Download,
  Upload,
  RotateCcw,
  Loader2,
  Volume2,
  VolumeX,
  Sigma,
  Braces,
  AlertCircle,
  AlertTriangle,
  Trash2,
} from 'lucide-react';
import MusicSidebar, { type MusicTab } from './MusicSidebar';
import VoiceLibraryModal from './VoiceLibraryModal';
import { useTtsStream } from '../hooks/useTtsStream';
import type { VoiceModel } from '../voiceCatalog';
import { extractVoiceSynthesisText } from '../voiceSynthesisText';

interface SelectedVoice {
  id: string;
  name: string;
  language: string;
  avatar?: string;
}

interface VoiceSynthesisPageProps {
  activeTab: MusicTab;
  onTabChange: (tab: MusicTab) => void;
  onBack: () => void;
}

export default function VoiceSynthesisPage({ activeTab, onTabChange, onBack }: VoiceSynthesisPageProps) {
  const [text, setText] = useState('');
  const [selectedVoice, setSelectedVoice] = useState<SelectedVoice | null>(null);
  const [selectedVoiceModel, setSelectedVoiceModel] = useState<VoiceModel | null>(null);
  const [showVoiceLibrary, setShowVoiceLibrary] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [pitch, setPitch] = useState(0);
  const [volume, setVolume] = useState(1);
  const [instruction, setInstruction] = useState('');
  const [ssmlEnabled, setSsmlEnabled] = useState(false);
  const [latexEnabled, setLatexEnabled] = useState(false);
  const [tagIdCounter, setTagIdCounter] = useState(0);
  // 预览播放
  const [previewAudio, setPreviewAudio] = useState<HTMLAudioElement | null>(null);
  const [previewPlayingVoiceId, setPreviewPlayingVoiceId] = useState<string | null>(null);
  // 生成历史
  const [rightPanelTab, setRightPanelTab] = useState<'debug' | 'history'>('debug');
  const [synthesisHistory, setSynthesisHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const {
    state: ttsState,
    error: ttsError,
    warnings: ttsWarnings,
    meta: ttsMeta,
    totalBytes,
    droppedChunks,
    audioUrl,
    isPlaying,
    currentTime,
    duration,
    synthesize,
    cancel,
    togglePlay,
    seek,
    setPlaybackSpeed,
    setMuted: ttsSetMuted,
  } = useTtsStream();

  const [playRate, setPlayRate] = useState(1.0);
  const [muted, setMuted] = useState(false);

  // Why：SSML/LaTeX 公式朗读仅 CosyVoice 系列模型支持（与后端 is_cosyvoice_model 判定一致）
  const activeModel = selectedVoiceModel?.model ?? '';
  const isCosyVoice = activeModel.startsWith('cosyvoice');
  const isQwenRealtime = /^qwen3-tts-(?:vc|vd)-realtime-/.test(activeModel);

  const handleSelectVoice = (voice: VoiceModel) => {
    setSelectedVoiceModel(voice);
    setSelectedVoice({
      id: voice.voiceId,
      name: voice.name,
      language: voice.language || '中文 - 普通话',
      avatar: voice.avatar,
    });
  };

  const formatTime = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  // Why：UI 参数与 DashScope 参数语义不同（前端视觉沿用 MiniMax 风格坐标），
  // 提交前必须映射，否则 pitch 默认 0 会被后端 clamp 成 0.5（本应为 1.0）。
  const handleGenerate = useCallback(async () => {
    // 情绪/语气/停顿是编辑器控制元数据，不能作为正文传给 TTS。
    const finalText = extractVoiceSynthesisText(
      document.getElementById('voice-textarea'),
      text,
    );
    
    const trimmed = finalText.trim();
    if (!trimmed || !selectedVoiceModel) return;

    // pitch：UI -1..1 → DashScope 0.5..1.5（中心 0 → 1.0）
    const pitchRate = 1 + pitch * 0.5;
    // volume：UI 0..2 → DashScope 0..100（中心 1 → 50）
    const volumePercent = Math.round(volume * 50);

    try {
      await synthesize(
        {
          voiceId: selectedVoiceModel.voiceId,
          model: selectedVoiceModel.model,
          format: 'mp3',
          speed,
          pitch: pitchRate,
          volume: volumePercent,
          ssml: ssmlEnabled,
          latex: latexEnabled,
          instruction: instruction.trim() || undefined,
        },
        trimmed,
      );
    } catch {
      // 错误已由 hook 写入 ttsError，此处无需二次处理
    }
  }, [text, selectedVoiceModel, speed, pitch, volume, ssmlEnabled, latexEnabled, instruction, synthesize]);

  const cyclePlayRate = () => {
    const rates = [0.5, 1.0, 1.5, 2.0];
    const next = rates[(rates.indexOf(playRate) + 1) % rates.length];
    setPlayRate(next);
    setPlaybackSpeed(next);
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    ttsSetMuted(next);
  };

  // 预览播放选中的音色
  const playSelectedVoicePreview = useCallback(
    async (e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (!selectedVoiceModel) return;

      const voiceId = selectedVoiceModel.voiceId;

      // 如果正在播放这个音色，就暂停
      if (previewPlayingVoiceId === voiceId && previewAudio) {
        previewAudio.pause();
        setPreviewPlayingVoiceId(null);
        return;
      }

      // 停止之前的播放
      if (previewAudio) {
        previewAudio.pause();
        previewAudio.onended = null;
        previewAudio.onerror = null;
      }

      setPreviewPlayingVoiceId(voiceId);

      try {
        const params = new URLSearchParams();
        if (selectedVoiceModel.model) {
          params.append('model', selectedVoiceModel.model);
        }
        const previewUrl = `/api/music/voices/${voiceId}/preview${params.toString() ? `?${params.toString()}` : ''}`;

        const newAudio = new Audio(previewUrl);
        newAudio.onended = () => setPreviewPlayingVoiceId(null);
        newAudio.onerror = (err) => {
          console.error('预览播放失败:', err);
          setPreviewPlayingVoiceId(null);
        };
        newAudio.play().catch((err) => {
          console.error('预览播放失败:', err);
          setPreviewPlayingVoiceId(null);
        });
        setPreviewAudio(newAudio);
      } catch (err) {
        console.error('预览播放失败:', err);
        setPreviewPlayingVoiceId(null);
      }
    },
    [selectedVoiceModel, previewPlayingVoiceId, previewAudio],
  );

  // 获取生成历史
  const fetchSynthesisHistory = useCallback(async () => {
    try {
      setHistoryLoading(true);
      const res = await fetch('/api/music/synthesis-history');
      if (res.ok) {
        const data = await res.json();
        setSynthesisHistory(data);
      }
    } catch (err) {
      console.error('获取生成历史失败:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // 删除生成历史
  const deleteHistoryItem = useCallback(
    async (id: number) => {
      try {
        await fetch(`/api/music/synthesis-history/${id}`, { method: 'DELETE' });
        setSynthesisHistory((prev) => prev.filter((item) => item.id !== id));
      } catch (err) {
        console.error('删除生成历史失败:', err);
      }
    },
    [],
  );

  // 当切换到历史 Tab 时，拉取数据
  useEffect(() => {
    if (rightPanelTab === 'history') {
      fetchSynthesisHistory();
    }
  }, [rightPanelTab, fetchSynthesisHistory]);

  // 当合成完成后，刷新历史
  useEffect(() => {
    if (ttsState === 'completed' && rightPanelTab === 'history') {
      fetchSynthesisHistory();
    }
  }, [ttsState, rightPanelTab, fetchSynthesisHistory]);

  // 格式化时间
  const formatHistoryTime = (timeStr: string) => {
    const date = new Date(timeStr);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // 复用历史项参数
  const reuseHistoryItem = (item: any) => {
    setText(item.text);
    setSpeed(item.speed);
    setPitch((item.pitch - 1) * 2); // 反向映射 DashScope pitch -> UI
    setVolume(item.volume / 50); // 反向映射 DashScope volume -> UI
    setSsmlEnabled(item.ssml);
    setLatexEnabled(item.latex);
    setInstruction(item.instruction || '');
  };

  // 播放历史音频
  const [historyAudio, setHistoryAudio] = useState<HTMLAudioElement | null>(null);
  const [playingHistoryId, setPlayingHistoryId] = useState<number | null>(null);

  const playHistoryAudio = useCallback(
    async (item: any) => {
      if (!item.audio_path) return;

      // 如果正在播放这个项，就暂停
      if (playingHistoryId === item.id && historyAudio) {
        historyAudio.pause();
        setPlayingHistoryId(null);
        return;
      }

      // 停止之前的播放
      if (historyAudio) {
        historyAudio.pause();
        historyAudio.onended = null;
        historyAudio.onerror = null;
      }

      setPlayingHistoryId(item.id);

      try {
        const audioUrl = `/api/music/synthesis-history/${item.id}/audio`;
        const newAudio = new Audio(audioUrl);
        newAudio.onended = () => setPlayingHistoryId(null);
        newAudio.onerror = (err) => {
          console.error('历史音频播放失败:', err);
          setPlayingHistoryId(null);
        };
        newAudio.play().catch((err) => {
          console.error('历史音频播放失败:', err);
          setPlayingHistoryId(null);
        });
        setHistoryAudio(newAudio);
      } catch (err) {
        console.error('历史音频播放失败:', err);
        setPlayingHistoryId(null);
      }
    },
    [playingHistoryId, historyAudio],
  );

  // 停顿和语气词下拉菜单
  const [showPauseMenu, setShowPauseMenu] = useState(false);
  const [showInterjectionMenu, setShowInterjectionMenu] = useState(false);
  const [showEmotionMenu, setShowEmotionMenu] = useState(false);
  const [showStyleMenu, setShowStyleMenu] = useState(false);
  const pauseMenuRef = useRef<HTMLDivElement>(null);
  const interjectionMenuRef = useRef<HTMLDivElement>(null);
  const emotionMenuRef = useRef<HTMLDivElement>(null);
  const styleMenuRef = useRef<HTMLDivElement>(null);

  const pauseOptions = [
    { label: '0.25s', value: '<#0.25#>' },
    { label: '0.5s', value: '<#0.5#>' },
    { label: '1.0s', value: '<#1.0#>' },
    { label: '1.5s', value: '<#1.5#>' },
    { label: '自定义', value: 'custom' },
  ];

  const interjectionOptions = [
    { label: '轻笑', value: '(轻笑)' },
    { label: '笑声', value: '(笑声)' },
    { label: '咳嗽', value: '(咳嗽)' },
    { label: '清嗓子', value: '(清嗓子)' },
    { label: '呻吟', value: '(呻吟)' },
    { label: '正常换气', value: '(正常换气)' },
    { label: '喘气', value: '(喘气)' },
    { label: '吸气', value: '(吸气)' },
  ];

  const emotionOptions = [
    { label: '开心', value: '(开心)', icon: '😊' },
    { label: '生气', value: '(生气)', icon: '😠' },
    { label: '悲伤', value: '(悲伤)', icon: '😢' },
    { label: '害怕', value: '(害怕)', icon: '😨' },
    { label: '温柔', value: '(温柔)', icon: '🥰' },
    { label: '坚定', value: '(坚定)', icon: '💪' },
    { label: '平静', value: '(平静)', icon: '😌' },
    { label: '惊讶', value: '(惊讶)', icon: '😮' },
    { label: '厌恶', value: '(厌恶)', icon: '🤢' },
    { label: '中性', value: '(中性)', icon: '😐' },
  ];

  const styleOptions = [
    { label: '新闻播报', value: '(新闻播报)', icon: '📰' },
    { label: '聊天', value: '(聊天)', icon: '💬' },
    { label: '广播剧', value: '(广播剧)', icon: '🎭' },
    { label: '客服', value: '(客服)', icon: '👩‍💼' },
    { label: '旁白', value: '(旁白)', icon: '🎤' },
    { label: '睡前故事', value: '(睡前故事)', icon: '🌙' },
    { label: '直播带货', value: '(直播带货)', icon: '🛍️' },
    { label: '严肃', value: '(严肃)', icon: '🎯' },
    { label: '兴奋', value: '(兴奋)', icon: '🎉' },
    { label: '温柔', value: '(温柔)', icon: '🌸' },
  ];

  const insertAtCursor = useCallback(
    (textToInsert: string, wrapSelected: boolean = false) => {
      const textarea = document.querySelector('#voice-textarea') as HTMLTextAreaElement;
      if (!textarea) {
        setText((prev) => prev + textToInsert);
        return;
      }

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selectedText = text.substring(start, end);
      const textBefore = text.substring(0, start);
      const textAfter = text.substring(end);

      let newText: string;
      let newCursorPosition: number;

      if (wrapSelected && selectedText) {
        // 如果有选中内容，就包裹起来
        newText = textBefore + textToInsert + selectedText + textToInsert + textAfter;
        newCursorPosition = start + textToInsert.length + selectedText.length + textToInsert.length;
      } else {
        // 普通插入
        newText = textBefore + textToInsert + textAfter;
        newCursorPosition = start + textToInsert.length;
      }

      setText(newText);

      // 把光标移到合适的位置
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(newCursorPosition, newCursorPosition);
      }, 0);
    },
    [text],
  );

  // 更智能的插入函数 - 会自动判断是插入标签还是包裹内容
  const insertTag = useCallback(
    (tag: string, tagType: 'emotion' | 'pause' | 'style' | 'interjection' = 'emotion') => {
      const textarea = document.querySelector('#voice-textarea') as HTMLTextAreaElement;
      if (!textarea) {
        setText((prev) => prev + tag);
        return;
      }

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selectedText = text.substring(start, end);
      const textBefore = text.substring(0, start);
      const textAfter = text.substring(end);

      let newText: string;
      let newCursorPosition: number;

      if (selectedText) {
        // 如果有选中内容，根据标签类型决定如何处理
        if (tagType === 'pause' || tagType === 'interjection') {
          // 停顿和语气词只在前面插入
          newText = textBefore + tag + selectedText + textAfter;
          newCursorPosition = start + tag.length;
        } else {
          // 其他类型则包裹起来
          newText = textBefore + tag + selectedText + tag + textAfter;
          newCursorPosition = start + tag.length + selectedText.length + tag.length;
        }
      } else {
        // 没有选中内容，直接插入
        newText = textBefore + tag + textAfter;
        newCursorPosition = start + tag.length;
      }

      setText(newText);

      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(newCursorPosition, newCursorPosition);
      }, 0);
    },
    [text],
  );

  const handlePauseOption = useCallback(
    (option: { label: string; value: string }) => {
      const textarea = document.getElementById('voice-textarea') as HTMLElement;
      if (!textarea) {
        let textToInsert = option.value;
        if (option.value === 'custom') {
          const customDuration = prompt('请输入停顿时长（秒）：', '0.5');
          if (customDuration) {
            textToInsert = `<#${customDuration}#>`;
          } else {
            setShowPauseMenu(false);
            return;
          }
        }
        setText((prev) => prev + textToInsert);
        setShowPauseMenu(false);
        return;
      }
      
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        
        let textToInsert = option.value;
        if (option.value === 'custom') {
          const customDuration = prompt('请输入停顿时长（秒）：', '0.5');
          if (customDuration) {
            textToInsert = `<#${customDuration}#>`;
          } else {
            setShowPauseMenu(false);
            return;
          }
        }
        
        // 创建文本节点插入
        const textNode = document.createTextNode(textToInsert + ' ');
        range.insertNode(textNode);
        
        // 把光标移到插入位置后面
        range.setStartAfter(textNode);
        range.setEndAfter(textNode);
        selection.removeAllRanges();
        selection.addRange(range);
        
        // 更新文本
        setText(textarea.innerText);
      }
      
      setShowPauseMenu(false);
    },
    [setText],
  );

  const handleInterjectionOption = useCallback(
    (option: { label: string; value: string }) => {
      const textarea = document.getElementById('voice-textarea') as HTMLElement;
      if (!textarea) {
        setText((prev) => prev + option.value);
        setShowInterjectionMenu(false);
        return;
      }
      
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        
        // 创建文本节点插入
        const textNode = document.createTextNode(option.value + ' ');
        range.insertNode(textNode);
        
        // 把光标移到插入位置后面
        range.setStartAfter(textNode);
        range.setEndAfter(textNode);
        selection.removeAllRanges();
        selection.addRange(range);
        
        // 更新文本
        setText(textarea.innerText);
      }
      
      setShowInterjectionMenu(false);
    },
    [setText],
  );

  const handleEmotionOption = useCallback(
    (option: { label: string; value: string; icon: string }) => {
      const textarea = document.getElementById('voice-textarea') as HTMLElement;
      if (!textarea) {
        setText((prev) => prev + option.value);
        return;
      }
      
      // 获取选择范围
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        
        // 创建情绪标签
        const tagId = tagIdCounter;
        setTagIdCounter((prev) => prev + 1);
        
        const tagElement = document.createElement('span');
        tagElement.className = 'emotion-tag inline-flex items-center gap-1 rounded-full bg-violet-100 px-3 py-1 text-sm font-medium text-violet-700 cursor-pointer hover:bg-violet-200 transition mr-1 relative';
        tagElement.dataset.tagId = tagId.toString();
        tagElement.contentEditable = 'false';
        tagElement.innerHTML = `
          <span class="emotion-value" style="display:none">${option.value}</span>
          <span class="emotion-label">${option.label}</span>
          <span class="emotion-close text-violet-400 hover:text-violet-600 text-xs ml-1 cursor-pointer z-10 relative">×</span>
          <div class="emotion-tag-dropdown hidden absolute left-0 top-full mt-2 z-50 min-w-[140px] rounded-2xl border border-violet-200 bg-white p-3 shadow-xl">
            <div class="grid grid-cols-2 gap-2">
              ${emotionOptions.map((opt) => `
                <button class="emotion-option flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-slate-700 hover:bg-violet-50 hover:text-violet-800 transition" data-value="${opt.value}" data-label="${opt.label}">
                  <span class="text-violet-500">${opt.icon}</span>
                  ${opt.label}
                </button>
              `).join('')}
            </div>
            <div class="mt-3 flex items-center justify-between border-t border-slate-200 pt-3">
              <button class="emotion-tag-delete text-xs text-red-500 hover:text-red-700">删除标签</button>
              <button class="emotion-tag-cancel text-xs text-slate-500 hover:text-slate-700">取消</button>
            </div>
          </div>
        `;
        
        // 添加点击事件
        tagElement.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          
          const target = e.target as HTMLElement;
          
          // 点击了删除按钮
          if (target.classList.contains('emotion-close') || target.closest('.emotion-close')) {
            tagElement.remove();
            const textarea = document.getElementById('voice-textarea');
            if (textarea) {
              setText(textarea.innerText);
            }
            return;
          }
          
          // 点击了情绪选项
          if (target.classList.contains('emotion-option') || target.closest('.emotion-option')) {
            const optionBtn = target.classList.contains('emotion-option') 
              ? target 
              : target.closest('.emotion-option') as HTMLElement;
            const newLabel = optionBtn.dataset.label || '';
            const newValue = optionBtn.dataset.value || '';
            
            const labelSpan = tagElement.querySelector('.emotion-label');
            const valueSpan = tagElement.querySelector('.emotion-value');
            if (labelSpan) labelSpan.textContent = newLabel;
            if (valueSpan) valueSpan.textContent = newValue;
            
            // 隐藏下拉框
            const dropdown = tagElement.querySelector('.emotion-tag-dropdown');
            if (dropdown) dropdown.classList.add('hidden');
            
            // 更新文本
            const textarea = document.getElementById('voice-textarea');
            if (textarea) {
              setText(textarea.innerText);
            }
            return;
          }
          
          // 点击了删除标签按钮
          if (target.classList.contains('emotion-tag-delete')) {
            tagElement.remove();
            const textarea = document.getElementById('voice-textarea');
            if (textarea) {
              setText(textarea.innerText);
            }
            return;
          }
          
          // 点击了取消按钮
          if (target.classList.contains('emotion-tag-cancel')) {
            // 隐藏下拉框
            const dropdown = tagElement.querySelector('.emotion-tag-dropdown');
            if (dropdown) dropdown.classList.add('hidden');
            return;
          }
          
          // 点击了标签主体，显示/隐藏下拉框
          const dropdown = tagElement.querySelector('.emotion-tag-dropdown');
          if (dropdown) {
            dropdown.classList.toggle('hidden');
          }
        });
        
        // 点击外部关闭下拉框
        document.addEventListener('click', (e) => {
          const target = e.target as HTMLElement;
          if (!tagElement.contains(target)) {
            const dropdown = tagElement.querySelector('.emotion-tag-dropdown');
            if (dropdown) {
              dropdown.classList.add('hidden');
            }
          }
        });
        
        // 插入标签
        range.insertNode(tagElement);
        
        // 把光标移到标签后面
        range.setStartAfter(tagElement);
        range.setEndAfter(tagElement);
        selection.removeAllRanges();
        selection.addRange(range);
        
        // 更新文本
        setText(textarea.innerText);
      }
      
      setShowEmotionMenu(false);
    },
    [tagIdCounter, setText, emotionOptions],
  );

  const handleStyleOption = useCallback(
    (option: { label: string; value: string; icon: string }) => {
      const textarea = document.getElementById('voice-textarea') as HTMLElement;
      if (!textarea) {
        setText((prev) => prev + option.value);
        setShowStyleMenu(false);
        return;
      }
      
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        
        // 创建文本节点插入
        const textNode = document.createTextNode(option.value + ' ');
        range.insertNode(textNode);
        
        // 把光标移到插入位置后面
        range.setStartAfter(textNode);
        range.setEndAfter(textNode);
        selection.removeAllRanges();
        selection.addRange(range);
        
        // 更新文本
        setText(textarea.innerText);
      }
      
      setShowStyleMenu(false);
    },
    [setText],
  );

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        pauseMenuRef.current &&
        !pauseMenuRef.current.contains(event.target as Node)
      ) {
        setShowPauseMenu(false);
      }
      if (
        interjectionMenuRef.current &&
        !interjectionMenuRef.current.contains(event.target as Node)
      ) {
        setShowInterjectionMenu(false);
      }
      if (
        emotionMenuRef.current &&
        !emotionMenuRef.current.contains(event.target as Node)
      ) {
        setShowEmotionMenu(false);
      }
      if (
        styleMenuRef.current &&
        !styleMenuRef.current.contains(event.target as Node)
      ) {
        setShowStyleMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="flex h-screen w-full bg-white text-slate-800">
      {/* 左侧专属侧边栏 */}
      <MusicSidebar activeTab={activeTab} onTabChange={onTabChange} onBack={onBack} />

      {/* 主内容区 */}
      <div className="flex flex-1 flex-col">
        {/* 顶部导航 */}
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <div className="flex items-center gap-8">
            <span className="text-xl font-bold text-sky-600">MINIMAX</span>
            <nav className="flex items-center gap-1">
              <button className="flex items-center gap-2 rounded-full bg-sky-100 px-4 py-1.5 text-sm font-medium text-sky-700">
                <Mic size={16} aria-hidden="true" />
                语音
              </button>
              <button className="flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100">
                <Music size={16} aria-hidden="true" />
                音乐
              </button>
              <button className="flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100">
                <Video size={16} aria-hidden="true" />
                视频
              </button>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-600">
              <span className="font-semibold text-sky-600">Music 3.0</span>
              创作者内测开启，限时免费活动继续
            </span>
            <button className="rounded-full bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-700">
              开始创作
            </button>
            <div className="flex items-center gap-2">
              <button className="rounded-full p-1 text-slate-500 hover:bg-slate-100">
                <Settings size={18} aria-hidden="true" />
              </button>
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-sm font-medium text-slate-700">
                S
              </div>
            </div>
          </div>
        </header>

        {/* 主工作区 */}
        <main className="flex flex-1 overflow-hidden">
          <div className="flex flex-1 flex-col p-8">
            {/* 标题 + 模型 */}
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-semibold text-slate-900">文字转语音</h1>
                <p className="mt-2 text-sm text-slate-500">
                  在此处开始输入文字，生成您的个性化音频。
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5">
                  <span className="text-xs text-slate-500">模型</span>
                  <button className="flex items-center gap-1 text-sm font-medium text-slate-700 hover:text-slate-900">
                    {activeModel || '请选择音色'}
                    <span className="ml-1 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
                      New
                    </span>
                    <ChevronDown size={12} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>

            {/* 文本输入区 */}
            <div className="mt-6 flex-1 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex h-full flex-col">
                {/* 可编辑区域 */}
                <div
                  id="voice-textarea"
                  contentEditable
                  suppressContentEditableWarning
                  className="h-full w-full resize-none bg-transparent text-sm leading-relaxed text-slate-700 placeholder:text-slate-400 focus:outline-none"
                  placeholder="点击左下角快捷按钮或直接输入预设中的标签，即可在文本中添加语气词、情绪和停顿。"
                  onInput={(e) => {
                    setText(e.currentTarget.innerText);
                  }}
                />
              </div>
            </div>

            {/* 合成状态 / 播放控制器 */}
            {ttsState !== 'idle' && (
              <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
                {ttsState === 'connecting' || ttsState === 'streaming' ? (
                  <div className="flex items-center gap-3">
                    <Loader2 size={16} aria-hidden="true" className="animate-spin text-sky-600" />
                    <span className="text-sm text-slate-600">
                      {ttsState === 'connecting' ? '正在连接合成服务...' : '正在合成语音...'}
                    </span>
                    {totalBytes > 0 && (
                      <span className="text-xs tabular-nums text-slate-400">
                        {formatBytes(totalBytes)}
                      </span>
                    )}
                    <button
                      onClick={cancel}
                      className="ml-auto rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      取消
                    </button>
                  </div>
                ) : ttsState === 'error' ? (
                  <div className="flex items-start gap-2 text-sm text-red-600">
                    <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                    <div>
                      <p>{ttsError ?? '合成失败'}</p>
                      {ttsWarnings.length > 0 && (
                        <ul className="mt-1 list-inside list-disc text-xs text-amber-600">
                          {ttsWarnings.map((w, i) => (
                            <li key={i}>{w}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                ) : ttsState === 'completed' && audioUrl ? (
                  <div className="flex flex-col gap-3">
                    {ttsWarnings.length > 0 && (
                      <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-700">
                        <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
                        <div className="space-y-0.5">
                          {ttsWarnings.map((w, i) => (
                            <p key={i}>{w}</p>
                          ))}
                        </div>
                      </div>
                    )}
                    {droppedChunks > 0 && (
                      <p className="text-xs text-amber-600">
                        检测到 {droppedChunks} 个音频块被丢弃，若播放不完整请重试。
                      </p>
                    )}
                    <div className="flex items-center gap-3">
                      <button
                        onClick={togglePlay}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-500 text-white shadow-sm transition hover:bg-sky-600"
                        aria-label={isPlaying ? '暂停' : '播放'}
                      >
                        {isPlaying ? (
                          <Pause size={16} aria-hidden="true" />
                        ) : (
                          <Play size={16} aria-hidden="true" />
                        )}
                      </button>
                      <span className="w-10 text-right text-xs tabular-nums text-slate-500">
                        {formatTime(currentTime)}
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={duration || 0}
                        step={0.01}
                        value={Math.min(currentTime, duration || 0)}
                        onChange={(e) => seek(parseFloat(e.target.value))}
                        disabled={!duration}
                        className="flex-1"
                      />
                      <span className="w-10 text-xs tabular-nums text-slate-500">
                        {formatTime(duration)}
                      </span>
                      <button
                        onClick={cyclePlayRate}
                        className="w-10 text-xs font-medium text-slate-600 hover:text-slate-900"
                        title="切换倍速"
                      >
                        {playRate.toFixed(1).replace(/\.0$/, '')}x
                      </button>
                      <button
                        onClick={toggleMute}
                        className="p-1 text-slate-500 hover:text-slate-800"
                        title={muted ? '取消静音' : '静音'}
                        aria-label={muted ? '取消静音' : '静音'}
                      >
                        {muted ? (
                          <VolumeX size={16} aria-hidden="true" />
                        ) : (
                          <Volume2 size={16} aria-hidden="true" />
                        )}
                      </button>
                      <a
                        href={audioUrl}
                        download={`tts-${selectedVoiceModel?.name ?? 'audio'}.${ttsMeta?.mimeType === 'audio/wav' || ttsMeta?.mimeType === 'audio/pcm' ? 'wav' : 'mp3'}`}
                        className="p-1 text-slate-500 hover:text-slate-800"
                        title="下载音频"
                      >
                        <Download size={16} aria-hidden="true" />
                      </a>
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            {/* 底部工具栏 */}
            <div className="mt-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button className="flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
                  <Sparkles size={12} aria-hidden="true" />
                  一键润
                </button>

                {/* 停顿按钮 */}
                <div className="relative" ref={pauseMenuRef}>
                  <button
                    onClick={() => {
                      setShowPauseMenu(!showPauseMenu);
                      setShowInterjectionMenu(false);
                      setShowEmotionMenu(false);
                      setShowStyleMenu(false);
                    }}
                    className="flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 transition"
                  >
                    <span className="text-[10px]">&lt;p&gt;</span>
                    停顿
                  </button>
                  {showPauseMenu && (
                    <div className="absolute bottom-full left-0 mb-2 z-50 min-w-[140px] rounded-2xl border border-amber-200 bg-white shadow-xl">
                      <div className="p-3 space-y-2">
                        {pauseOptions.map((option) => (
                          <button
                            key={option.label}
                            onClick={() => handlePauseOption(option)}
                            className="w-full text-left px-4 py-2.5 rounded-xl text-xs font-medium text-slate-700 hover:bg-amber-50 hover:text-amber-800 transition"
                          >
                            <span className="inline-flex items-center gap-2">
                              <span className="text-amber-500">⏱</span>
                              {option.label}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* 语气词按钮 */}
                <div className="relative" ref={interjectionMenuRef}>
                  <button
                    onClick={() => {
                      setShowInterjectionMenu(!showInterjectionMenu);
                      setShowPauseMenu(false);
                      setShowEmotionMenu(false);
                      setShowStyleMenu(false);
                    }}
                    className="flex items-center gap-1.5 rounded-full border border-pink-200 bg-pink-50 px-3 py-1 text-xs font-medium text-pink-700 hover:bg-pink-100 transition"
                  >
                    😊 语气词
                  </button>
                  {showInterjectionMenu && (
                    <div className="absolute bottom-full left-0 mb-2 z-50 min-w-[140px] rounded-2xl border border-pink-200 bg-white shadow-xl">
                      <div className="p-3 space-y-2 max-h-60 overflow-y-auto">
                        {interjectionOptions.map((option) => (
                          <button
                            key={option.label}
                            onClick={() => handleInterjectionOption(option)}
                            className="w-full text-left px-4 py-2.5 rounded-xl text-xs font-medium text-slate-700 hover:bg-pink-50 hover:text-pink-800 transition"
                          >
                            <span className="inline-flex items-center gap-2">
                              {option.value}
                              {option.label}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* 情绪按钮 */}
                <div className="relative" ref={emotionMenuRef}>
                  <button
                    onClick={() => {
                      setShowEmotionMenu(!showEmotionMenu);
                      setShowPauseMenu(false);
                      setShowInterjectionMenu(false);
                      setShowStyleMenu(false);
                    }}
                    className="flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100 transition"
                  >
                    🎭 情绪
                  </button>
                  {showEmotionMenu && (
                    <div className="absolute bottom-full left-0 mb-2 z-50 min-w-[160px] rounded-2xl border border-violet-200 bg-white shadow-xl">
                      <div className="p-3 space-y-2">
                        {emotionOptions.map((option) => (
                          <button
                            key={option.label}
                            onClick={() => handleEmotionOption(option)}
                            className="w-full text-left px-4 py-2.5 rounded-xl text-xs font-medium text-slate-700 hover:bg-violet-50 hover:text-violet-800 transition"
                          >
                            <span className="inline-flex items-center gap-2">
                              <span className="text-violet-500">{option.icon}</span>
                              {option.label}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* 风格按钮 */}
                <div className="relative" ref={styleMenuRef}>
                  <button
                    onClick={() => {
                      setShowStyleMenu(!showStyleMenu);
                      setShowPauseMenu(false);
                      setShowInterjectionMenu(false);
                      setShowEmotionMenu(false);
                    }}
                    className="flex items-center gap-1.5 rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-medium text-cyan-700 hover:bg-cyan-100 transition"
                  >
                    🎤 风格
                  </button>
                  {showStyleMenu && (
                    <div className="absolute bottom-full left-0 mb-2 z-50 min-w-[160px] rounded-2xl border border-cyan-200 bg-white shadow-xl">
                      <div className="p-3 space-y-2">
                        {styleOptions.map((option) => (
                          <button
                            key={option.label}
                            onClick={() => handleStyleOption(option)}
                            className="w-full text-left px-4 py-2.5 rounded-xl text-xs font-medium text-slate-700 hover:bg-cyan-50 hover:text-cyan-800 transition"
                          >
                            <span className="inline-flex items-center gap-2">
                              <span className="text-cyan-500">{option.icon}</span>
                              {option.label}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => setSsmlEnabled((v) => !v)}
                  disabled={!isCosyVoice}
                  title={isCosyVoice ? '启用 SSML 标记语音' : '仅 CosyVoice 系列支持 SSML'}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                    ssmlEnabled
                      ? 'border-sky-200 bg-sky-50 text-sky-700'
                      : isCosyVoice
                        ? 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                        : 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-300'
                  }`}
                >
                  <Braces size={12} aria-hidden="true" />
                  SSML
                </button>
                <button
                  onClick={() => setLatexEnabled((v) => !v)}
                  disabled={!isCosyVoice}
                  title={isCosyVoice ? '启用 LaTeX 公式朗读' : '仅 CosyVoice 系列支持 LaTeX 朗读'}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                    latexEnabled
                      ? 'border-sky-200 bg-sky-50 text-sky-700'
                      : isCosyVoice
                        ? 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                        : 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-300'
                  }`}
                >
                  <Sigma size={12} aria-hidden="true" />
                  LaTeX
                </button>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <span>长文模式</span>
                  <span className="text-slate-400">|</span>
                  <span>0 / 5,000 字</span>
                </div>
                <div className="h-px w-20 bg-slate-200" />
              </div>
            </div>

            {/* 底部控制栏 */}
            <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
              <div className="flex items-center gap-3">
                <button className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-100">
                  <RotateCcw size={12} aria-hidden="true" />
                  语音检测
                </button>
                <span className="text-[11px] text-slate-400">0</span>
                <button className="rounded-full border border-slate-200 bg-white p-1.5 text-slate-400 hover:text-slate-600">
                  <Upload size={14} aria-hidden="true" />
                </button>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-[11px] text-slate-400">
                  声乐消耗：0
                  <span className="mx-1.5">|</span>
                  <span className="text-slate-500">首条渲染免费</span>
                </div>
                <button
                  onClick={handleGenerate}
                  disabled={ttsState === 'connecting' || ttsState === 'streaming'}
                  className="flex items-center gap-2 rounded-full bg-sky-500 px-6 py-2 text-sm font-medium text-white shadow-md shadow-sky-500/20 transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {ttsState === 'connecting' || ttsState === 'streaming' ? (
                    <Loader2 size={16} aria-hidden="true" className="animate-spin" />
                  ) : (
                    <Sparkles size={16} aria-hidden="true" />
                  )}
                  {ttsState === 'connecting' || ttsState === 'streaming'
                    ? '合成中...'
                    : '生成音频'}
                </button>
              </div>
            </div>
          </div>

          {/* 右侧面板 */}
          <aside className="flex w-80 flex-col border-l border-slate-200 bg-white">
            {/* 顶部标签页 */}
            <div className="flex border-b border-slate-200 px-4 pt-3">
              <button
                onClick={() => setRightPanelTab('debug')}
                className={`flex-1 pb-2 text-sm font-medium transition ${
                  rightPanelTab === 'debug'
                    ? 'border-b-2 border-violet-600 text-violet-700'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                调试台
              </button>
              <button
                onClick={() => setRightPanelTab('history')}
                className={`flex-1 pb-2 text-sm font-medium transition ${
                  rightPanelTab === 'history'
                    ? 'border-b-2 border-violet-600 text-violet-700'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                生成历史
              </button>
            </div>

            {/* 调试台内容 */}
            {rightPanelTab === 'debug' && (
              <div className="flex-1 overflow-y-auto p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-800">音色</span>
                  <button
                    onClick={() => setShowVoiceLibrary(true)}
                    className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 transition-colors"
                  >
                    <Sparkles size={12} aria-hidden="true" />
                    音库宝藏
                  </button>
                </div>

                {/* 选中的音色 */}
                <div className="mt-3">
                  {selectedVoice ? (
                    <div className="flex w-full items-center gap-3 rounded-xl border border-sky-400 bg-sky-50 p-2">
                      <button
                        onClick={playSelectedVoicePreview}
                        className="group relative overflow-hidden rounded-lg transition hover:ring-2 hover:ring-sky-400"
                      >
                        <img
                          src={selectedVoice.avatar}
                          alt={selectedVoice.name}
                          className="h-12 w-12 object-cover"
                        />
                        {previewPlayingVoiceId === selectedVoiceModel?.voiceId && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                            <div className="flex gap-0.5">
                              <div className="h-4 w-1 animate-pulse bg-white" />
                              <div className="h-4 w-1 animate-pulse bg-white delay-75" />
                              <div className="h-4 w-1 animate-pulse bg-white delay-150" />
                            </div>
                          </div>
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-slate-800">{selectedVoice.name}</p>
                        <p className="mt-0.5 text-[11px] text-slate-500">{selectedVoice.language}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <button
                          onClick={playSelectedVoicePreview}
                          className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-600 text-white hover:bg-sky-700 transition"
                        >
                          {previewPlayingVoiceId === selectedVoiceModel?.voiceId ? (
                            <Pause size={14} aria-hidden="true" />
                          ) : (
                            <Play size={14} aria-hidden="true" />
                          )}
                        </button>
                        <button
                          onClick={() => setShowVoiceLibrary(true)}
                          className="rounded bg-white px-1.5 py-0.5 text-[9px] text-sky-600 hover:bg-sky-100 transition"
                        >
                          Tag
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowVoiceLibrary(true)}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center"
                    >
                      <Sparkles size={16} className="text-slate-400" />
                      <span className="text-sm text-slate-500">点击选择音色</span>
                    </button>
                  )}
                </div>

                {/* 参数调节 */}
                <div className="mt-6">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-800">音色效果调节</span>
                    <button className="flex items-center gap-1 text-[11px] text-sky-600 hover:text-sky-700">
                      <Sparkles size={11} aria-hidden="true" />
                      试调次数：6/6
                    </button>
                  </div>

                  <div className="mt-4 space-y-5">
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-700">语速</span>
                        <span className="text-xs text-slate-600">{speed.toFixed(1)}</span>
                      </div>
                      <input
                        type="range"
                        min="0.5"
                        max="2"
                        step="0.1"
                        value={speed}
                        onChange={(e) => setSpeed(parseFloat(e.target.value))}
                        disabled={isQwenRealtime}
                        title={isQwenRealtime ? 'Qwen realtime 音色不支持语速调节' : undefined}
                        className="mt-2 w-full disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-700">声调</span>
                        <span className="text-xs text-slate-600">{pitch.toFixed(1)}</span>
                      </div>
                      <input
                        type="range"
                        min="-1"
                        max="1"
                        step="0.1"
                        value={pitch}
                        onChange={(e) => setPitch(parseFloat(e.target.value))}
                        disabled={isQwenRealtime}
                        title={isQwenRealtime ? 'Qwen realtime 音色不支持声调调节' : undefined}
                        className="mt-2 w-full disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-700">音量</span>
                        <span className="text-xs text-slate-600">{volume.toFixed(1)}</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.1"
                        value={volume}
                        onChange={(e) => setVolume(parseFloat(e.target.value))}
                        disabled={isQwenRealtime}
                        title={isQwenRealtime ? 'Qwen realtime 音色不支持音量调节' : undefined}
                        className="mt-2 w-full disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    </div>
                  </div>

                  {/* Instruction 风格控制 */}
                  <div className="mt-6 border-t border-slate-200 pt-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-800">风格与情绪控制</span>
                      <span className={`text-[10px] ${instruction.length > 40 ? 'text-amber-600' : 'text-slate-500'}`}>
                        {instruction.length}/100
                      </span>
                    </div>

                    {isQwenRealtime && (
                      <p className="mt-2 rounded-lg bg-amber-50 p-2 text-[10px] leading-relaxed text-amber-700">
                        当前克隆音色使用 Qwen realtime 模型，仅支持纯文本合成；语速、声调、音量和指令不会传给上游。
                      </p>
                    )}

                    {/* 预设快捷选项 */}
                    <div className="mt-3 space-y-3">
                      {/* 情绪预设 */}
                      <div>
                        <span className="text-[11px] text-slate-500">情绪</span>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {[
                            '开心',
                            '生气',
                            '悲伤',
                            '害怕',
                            '温柔',
                            '坚定',
                            '平静',
                            '惊讶',
                          ].map((emotion) => (
                            <button
                              key={emotion}
                              disabled={isQwenRealtime}
                              onClick={() => {
                                setInstruction((prev) =>
                                  prev ? `${prev} ${emotion}地` : `请${emotion}地说`,
                                );
                              }}
                              className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-200 transition"
                            >
                              {emotion}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* 说话风格 */}
                      <div>
                        <span className="text-[11px] text-slate-500">风格</span>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {[
                            '新闻播报',
                            '聊天',
                            '广播剧',
                            '客服',
                            '旁白',
                            '睡前故事',
                            '直播带货',
                          ].map((style) => (
                            <button
                              key={style}
                              disabled={isQwenRealtime}
                              onClick={() => {
                                setInstruction((prev) =>
                                  prev ? `${prev} 用${style}的方式` : `请用${style}的方式`,
                                );
                              }}
                              className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-200 transition"
                            >
                              {style}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* 方言 */}
                      <div>
                        <span className="text-[11px] text-slate-500">方言</span>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {[
                            '粤语',
                            '河南话',
                            '四川话',
                            '东北话',
                            '台湾腔',
                          ].map((dialect) => (
                            <button
                              key={dialect}
                              disabled={isQwenRealtime}
                              onClick={() => {
                                setInstruction((prev) =>
                                  prev ? `${prev} 用${dialect}` : `请用${dialect}`,
                                );
                              }}
                              className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-200 transition"
                            >
                              {dialect}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* 自由输入框 */}
                    <div className="mt-4">
                      <textarea
                        value={instruction}
                        onChange={(e) => setInstruction(e.target.value)}
                        placeholder="例如：请开心地用新闻播报的方式..."
                        maxLength={100}
                        disabled={isQwenRealtime}
                        className="h-20 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      <button
                        onClick={() => setInstruction('')}
                        disabled={isQwenRealtime}
                        className="mt-2 text-[10px] text-slate-500 hover:text-slate-700 transition disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        清空
                      </button>
                    </div>

                    {/* 提示 */}
                    <div className="mt-3 rounded-lg bg-slate-50 p-2">
                      <p className="text-[10px] text-slate-600">
                        💡 提示：精确的语速/声调/音量使用上方滑块，风格/情绪/方言在这里设置
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 生成历史内容 */}
            {rightPanelTab === 'history' && (
              <div className="flex-1 overflow-y-auto p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-800">生成历史</span>
                  <button
                    onClick={fetchSynthesisHistory}
                    className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 transition-colors"
                  >
                    <RotateCcw size={12} aria-hidden="true" />
                    刷新
                  </button>
                </div>

                <div className="mt-4 space-y-3">
                  {historyLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 size={20} className="animate-spin text-slate-400" aria-hidden="true" />
                    </div>
                  ) : synthesisHistory.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <div className="text-4xl mb-2">🎵</div>
                      <p className="text-sm text-slate-500">暂无生成历史</p>
                    </div>
                  ) : (
                    synthesisHistory.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-slate-300 transition"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <p className="truncate text-xs font-medium text-slate-800">
                              {item.voice_name || item.voice_id}
                            </p>
                            <p className="truncate text-[11px] text-slate-500">
                              {item.model} · {formatHistoryTime(item.created_at)}
                            </p>
                          </div>
                          <button
                            onClick={() => deleteHistoryItem(item.id)}
                            className="ml-2 rounded-full p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 transition"
                          >
                            <Trash2 size={14} aria-hidden="true" />
                          </button>
                        </div>
                        <p className="mt-2 line-clamp-3 text-[11px] text-slate-600">
                          {item.text}
                        </p>
                        {item.instruction && (
                          <p className="mt-1 line-clamp-2 text-[10px] text-slate-500">
                            🎭 {item.instruction}
                          </p>
                        )}
                        <div className="mt-2 flex items-center gap-2">
                          {item.audio_path && (
                            <button
                              onClick={() => playHistoryAudio(item)}
                              className={`flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium transition ${
                                playingHistoryId === item.id
                                  ? 'bg-green-50 text-green-600 hover:bg-green-100'
                                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                              }`}
                            >
                              {playingHistoryId === item.id ? (
                                <Pause size={10} aria-hidden="true" />
                              ) : (
                                <Play size={10} aria-hidden="true" />
                              )}
                              {playingHistoryId === item.id ? '暂停' : '播放'}
                            </button>
                          )}
                          <button
                            onClick={() => reuseHistoryItem(item)}
                            className="flex items-center gap-1 rounded-full bg-sky-50 px-2 py-1 text-[10px] font-medium text-sky-600 hover:bg-sky-100 transition"
                          >
                            <Sparkles size={10} aria-hidden="true" />
                            复用
                          </button>
                          <span className="text-[10px] text-slate-400">
                            {item.speed.toFixed(1)}x · {item.volume}%
                            {item.ssml && ' · SSML'}
                            {item.latex && ' · LaTeX'}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* 底部 */}
            <div className="border-t border-slate-200 p-4">
              <button className="flex w-full items-center justify-center gap-2 rounded-xl border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-700 hover:bg-sky-100">
                <Sparkles size={16} aria-hidden="true" />
                会员订阅
              </button>
              <div className="mt-4 flex items-center justify-center gap-6 text-[10px] text-slate-400">
                <span>相关免责</span>
                <span>API</span>
                <span>用户协议</span>
              </div>
              <div className="mt-2 flex items-center justify-center gap-3 text-[10px] text-slate-500">
                <span>隐私政策</span>
                <span>©MinMax 2024</span>
              </div>
            </div>
          </aside>
        </main>

        {/* 左下角图标 */}
        <div className="absolute bottom-4 left-64">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/80 shadow-lg">
            <div className="h-6 w-6 rounded-full bg-slate-200">
              {/* 占位图标 */}
            </div>
          </div>
        </div>
      </div>

      {/* Voice Library Modal */}
      <VoiceLibraryModal
        isOpen={showVoiceLibrary}
        onClose={() => setShowVoiceLibrary(false)}
        onSelectVoice={handleSelectVoice}
      />
    </div>
  );
}
