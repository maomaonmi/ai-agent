'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Play, Music2, Download,
  Pause, 
  Heart, 
  Check, 
  MoreHorizontal, 
  Search, 
  Filter,
  Sparkles,
  ArrowRight,
  Loader2,
  Volume2,
  VolumeX,
  RotateCcw,
  X,
  Copy,
  Pencil,
  Trash2,
  Share2,
  User,
} from 'lucide-react';
import MusicSidebar, { type MusicTab } from './MusicSidebar';
import { isMiniMaxVoice, normalizeCustomVoices, normalizeVoices, type VoiceApiModel, type VoiceModel } from '../voiceCatalog';

interface VoiceLibraryPageProps {
  activeTab: MusicTab;
  onTabChange: (tab: MusicTab) => void;
  onBack: () => void;
}

const TAB_OPTIONS = ['音乐库', '我的音色', '收藏音色', '音乐生成', '音轨分离'] as const;
type TabOption = typeof TAB_OPTIONS[number];

interface MusicClipAsset {
  id: string;
  title?: string;
  audio_url?: string | null;
  image_url?: string | null;
  duration?: number | null;
  status?: string;
}

interface MusicGenerationTask {
  id: string;
  status: string;
  created_at?: number;
  clips: MusicClipAsset[];
}

interface SeparationStemAsset {
  key: string;
  label: string;
  url: string | null;
  assetId?: string | null;
}

interface SeparationTaskAsset {
  id: string;
  originalName: string;
  type: string;
  status: string;
  progress: number;
  createdAt: number;
  stems: SeparationStemAsset[];
  error?: { message?: string } | null;
}

// 模型选项（包含CosyVoice多版本）
const MODEL_OPTIONS = [
  { value: 'all', label: '全部模型' },
  { value: 'plus', label: 'Plus 旗舰' },
  { value: 'flash', label: 'Flash 精品' },
  { value: 'cosyvoice-v1', label: 'CV1 基础' },
  { value: 'cosyvoice-v2', label: 'CV2' },
  { value: 'cosyvoice-v3-plus', label: 'CV3 Plus' },
  { value: 'cosyvoice-v3-flash', label: 'CV3 Flash' },
  { value: 'minimax', label: 'MiniMax' },
] as const;

type ModelOption = typeof MODEL_OPTIONS[number]['value'];

// 年龄段选项（固定）
const AGE_OPTIONS = ['儿童', '青年', '中年', '老年'];

// 筛选选项接口类型
interface FilterOptions {
  scenarios: string[];
  traits: string[];
  genders: string[];
  age_ranges: { label: string; min: number; max: number }[];
}

export default function VoiceLibraryPage({ activeTab, onTabChange, onBack }: VoiceLibraryPageProps) {
  const [activeSubTab, setActiveSubTab] = useState<TabOption>('音乐库');
  const [voices, setVoices] = useState<VoiceModel[]>([]);
  const [myVoices, setMyVoices] = useState<VoiceModel[]>([]);
  const [myVoicesLoading, setMyVoicesLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<string>('');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  
  // 筛选状态
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelOption>('all');
  const [selectedScenario, setSelectedScenario] = useState<string>('');
  const [selectedTrait, setSelectedTrait] = useState<string>('');
  const [selectedGender, setSelectedGender] = useState<string>('全部');
  const [selectedAge, setSelectedAge] = useState<string>('');
  
  // 动态筛选选项（从API获取）
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    scenarios: [],
    traits: [],
    genders: [],
    age_ranges: [
      { label: '儿童', min: 0, max: 12 },
      { label: '青年', min: 13, max: 30 },
      { label: '中年', min: 31, max: 50 },
      { label: '老年', min: 51, max: 100 },
    ],
  });
  
  // 播放控制器状态
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isActuallyPlaying, setIsActuallyPlaying] = useState(false); // 独立的播放状态
  const [musicTasks, setMusicTasks] = useState<MusicGenerationTask[]>([]);
  const [separationTasks, setSeparationTasks] = useState<SeparationTaskAsset[]>([]);
  const [separationFilter, setSeparationFilter] = useState<'vocals' | 'instrumental'>('vocals');
  const [assetLoading, setAssetLoading] = useState(false);

  // 获取筛选选项（组件加载时）
  useEffect(() => {
    const fetchFilterOptions = async () => {
      try {
        const response = await fetch('/api/music/voices/filter-options');
        if (response.ok) {
          const options = await response.json() as FilterOptions;
          setFilterOptions(options);
          console.log('✅ 筛选选项已加载:', options.scenarios.length, '场景,', options.traits.length, '特质');
        }
      } catch (err) {
        console.warn('⚠️ 加载筛选选项失败，使用默认值:', err);
      }
    };
    
    fetchFilterOptions();
  }, []);

  // Fetch voices from API（带筛选参数）
  const fetchVoices = useCallback(async () => {
    try {
      setLoading(true);
      
      // 构建查询参数
      const params = new URLSearchParams();
      if (selectedModel && selectedModel !== 'all') params.append('model', selectedModel);
      if (selectedScenario) params.append('scenario', selectedScenario);
      if (selectedTrait) params.append('trait', selectedTrait);
      if (selectedGender && selectedGender !== '全部') params.append('gender', selectedGender);
      if (selectedAge) {
        const ageRange = filterOptions.age_ranges.find(r => r.label === selectedAge);
        if (ageRange) {
          params.append('age_min', ageRange.min.toString());
          params.append('age_max', ageRange.max.toString());
        }
      }
      if (searchQuery) params.append('search', searchQuery);
      
      const url = `/api/music/voices${params.toString() ? `?${params.toString()}` : ''}`;
      console.log('📡 请求音色列表:', url);
      
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch voices');
      const data = normalizeVoices(await response.json() as VoiceApiModel[]);
      setVoices(data);
      if (data.length > 0) {
        setSelectedVoice(data.find((v: VoiceModel) => v.isHot)?.voiceId || data[0].voiceId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load voices');
    } finally {
      setLoading(false);
    }
  }, [selectedModel, selectedScenario, selectedTrait, selectedGender, selectedAge, searchQuery, filterOptions]);

  const fetchMyVoices = useCallback(async () => {
    try {
      setMyVoicesLoading(true);
      const response = await fetch('/api/music/my-voices');
      if (!response.ok) throw new Error('Failed to fetch custom voices');
      setMyVoices(normalizeCustomVoices(await response.json() as VoiceApiModel[]));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load custom voices');
    } finally {
      setMyVoicesLoading(false);
    }
  }, []);

  const fetchMusicAssets = useCallback(async () => {
    setAssetLoading(true);
    try {
      const [musicResponse, separationResponse] = await Promise.all([
        fetch('/api/suno/tasks?pageSize=100'),
        fetch('/api/suno/vocal-separations?pageSize=100'),
      ]);
      if (musicResponse.ok) {
        const body = await musicResponse.json() as { tasks?: MusicGenerationTask[] };
        setMusicTasks((body.tasks || []).filter(task => task.status === 'SUCCESS' && task.clips?.length));
      }
      if (separationResponse.ok) {
        const body = await separationResponse.json() as { tasks?: SeparationTaskAsset[] };
        setSeparationTasks(body.tasks || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载音乐资产失败');
    } finally {
      setAssetLoading(false);
    }
  }, []);

  // 初始加载 + 筛选条件变化时重新请求
  useEffect(() => {
    fetchVoices();

    return () => {
      if (audio) {
        audio.pause();
        audio.src = '';
      }
    };
  }, [fetchVoices]);

  useEffect(() => {
    fetchMyVoices();
  }, [fetchMyVoices]);

  useEffect(() => {
    fetchMusicAssets();
  }, [fetchMusicAssets]);

  // Filter voices - 后端已处理筛选，前端直接使用（保留作为展示层）
  const filteredVoices = useMemo(() => {
    // 后端已经根据参数返回了过滤后的数据，这里直接返回
    // 如果需要额外的客户端实时搜索（防抖），可以在这里添加
    return voices;
  }, [voices]);

  const visibleVoices = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const matchesSearch = (voice: VoiceModel) => !query
      || voice.name.toLowerCase().includes(query)
      || voice.description.toLowerCase().includes(query)
      || voice.voiceId.toLowerCase().includes(query);
    if (activeSubTab === '我的音色') return myVoices.filter(matchesSearch);
    if (activeSubTab === '收藏音色') {
      const builtIns = voices.filter((voice) => favorites.includes(voice.voiceId)).filter(matchesSearch);
      return [...builtIns, ...myVoices.filter((voice) => voice.isFavorite).filter(matchesSearch)];
    }
    return filteredVoices;
  }, [activeSubTab, favorites, filteredVoices, myVoices, searchQuery, voices]);

  const toggleFavorite = async (voice: VoiceModel) => {
    const nextFavorite = !(voice.isCustom ? voice.isFavorite : favorites.includes(voice.voiceId));
    if (voice.isCustom) {
      try {
        const response = await fetch(`/api/music/my-voices/${encodeURIComponent(voice.voiceId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_favorite: nextFavorite }),
        });
        if (!response.ok) throw new Error('收藏状态更新失败');
        const updated = normalizeCustomVoices([await response.json() as VoiceApiModel])[0];
        setMyVoices((prev) => prev.map((item) => item.voiceId === updated.voiceId ? updated : item));
      } catch (err) {
        setError(err instanceof Error ? err.message : '收藏状态更新失败');
      }
      return;
    }
    setFavorites(prev => 
      prev.includes(voice.voiceId) ? prev.filter(fid => fid !== voice.voiceId) : [...prev, voice.voiceId]
    );
  };

  const updateCustomVoice = async (voiceId: string, patch: { name?: string; description?: string }) => {
    const response = await fetch(`/api/music/my-voices/${encodeURIComponent(voiceId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!response.ok) throw new Error('音色更新失败');
    const updated = normalizeCustomVoices([await response.json() as VoiceApiModel])[0];
    setMyVoices((prev) => prev.map((item) => item.voiceId === updated.voiceId ? updated : item));
  };

  const deleteCustomVoice = async (voiceId: string) => {
    if (!window.confirm('确定删除这个自定义音色吗？云端音色也会一并删除。')) return;
    try {
      const response = await fetch(`/api/music/my-voices/${encodeURIComponent(voiceId)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('音色删除失败');
      setMyVoices((prev) => prev.filter((voice) => voice.voiceId !== voiceId));
      if (playingVoice === voiceId) {
        audio?.pause();
        setPlayingVoice(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '音色删除失败');
    }
  };

  const editCustomVoice = async (voice: VoiceModel) => {
    const name = window.prompt('音色名称', voice.name);
    if (name === null || !name.trim() || name.trim() === voice.name) return;
    try {
      await updateCustomVoice(voice.voiceId, { name: name.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : '音色更新失败');
    }
  };

  const copyVoiceId = async (voiceId: string) => {
    try {
      await navigator.clipboard.writeText(voiceId);
    } catch {
      setError('复制 Voice ID 失败');
    }
  };

  const shareVoice = async (voice: VoiceModel) => {
    try {
      if (navigator.share) await navigator.share({ title: voice.name, text: voice.description });
      else await copyVoiceId(voice.voiceId);
    } catch {
      // Ignore cancellation from the native share sheet.
    }
  };

  // 重置所有筛选
  const resetFilters = () => {
    setSelectedModel('all');
    setSelectedScenario('');
    setSelectedTrait('');
    setSelectedGender('全部');
    setSelectedAge('');
  };

  // 检查是否有激活的筛选条件
  const hasActiveFilters = selectedModel !== 'all' || 
                          selectedScenario || 
                          selectedTrait || 
                          selectedGender !== '全部' || 
                          selectedAge;

  const playVoicePreview = useCallback(async (voice: VoiceModel) => {
    // 如果点击的是当前正在播放的音色，则暂停
    if (playingVoice === voice.voiceId) {
      if (audio) {
        audio.pause();
        setIsActuallyPlaying(false);
      }
      return;
    }

    try {
      // 先停止之前的播放
      if (audio) {
        audio.pause();
        audio.onended = null;
        audio.onerror = null;
        audio.ontimeupdate = null;
        audio.onloadedmetadata = null;
      }

      // 设置新的播放状态
      setPlayingVoice(voice.voiceId);
      setIsActuallyPlaying(false);
      setCurrentTime(0);
      setDuration(0);

      // 根据音色类型生成预览文本
      const previewText = voice.tags.includes('英文')
        ? "Hello, this is a preview of my voice."
        : "你好，这是我的音色预览。";

      // 自定义音色优先播放创建时保存的试听音频，避免审核期间调用正式 TTS。
      const response = voice.isCustom && voice.previewAudio
        ? await fetch(voice.previewAudio)
        : await fetch('/api/music/synthesize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: previewText,
              voiceId: voice.voiceId,
              model: voice.model,
              format: 'mp3',
              speed: 1.0,
            }),
          });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Synthesis failed' }));
        throw new Error(errorData.detail || `HTTP ${response.status}`);
      }

      const blob = await response.blob();
      
      // 验证 blob 是否有效
      if (blob.size === 0) {
        throw new Error('Empty audio received');
      }

      const url = URL.createObjectURL(blob);
      const newAudio = new Audio(url);

      // 设置音频属性
      newAudio.preload = 'auto';
      newAudio.playbackRate = playbackSpeed;
      newAudio.muted = isMuted;

      // 绑定事件监听器
      let hasStarted = false;

      newAudio.onloadedmetadata = () => {
        setDuration(newAudio.duration);
      };

      newAudio.oncanplay = async () => {
        try {
          // 尝试播放（处理自动播放策略限制）
          const playPromise = newAudio.play();
          if (playPromise !== undefined) {
            await playPromise;
            setIsActuallyPlaying(true);
            hasStarted = true;
          }
        } catch (playError) {
          console.warn('Auto-play prevented or failed:', playError);
          setIsActuallyPlaying(false);
          // 不清除 playingVoice，让用户可以手动点击播放
        }
      };

      newAudio.ontimeupdate = () => {
        if (!isDragging) {
          setCurrentTime(newAudio.currentTime);
        }
      };

      newAudio.onplay = () => {
        setIsActuallyPlaying(true);
      };

      newAudio.onpause = () => {
        setIsActuallyPlaying(false);
      };

      newAudio.onended = () => {
        setIsActuallyPlaying(false);
        setPlayingVoice(null);
        setCurrentTime(0);
        URL.revokeObjectURL(url);
      };

      newAudio.onerror = (e) => {
        console.error('Audio error:', e);
        // 只有在还没开始播放时才清除状态
        if (!hasStarted) {
          setIsActuallyPlaying(false);
          // 延迟清除，让用户看到是哪个音色出错了
          setTimeout(() => {
            if (playingVoice === voice.voiceId) {
              setPlayingVoice(null);
            }
          }, 1000);
        }
        URL.revokeObjectURL(url);
      };

      // 保存 audio 实例
      setAudio(newAudio);

    } catch (err) {
      console.error('Failed to play voice preview:', err);
      setIsActuallyPlaying(false);
      setPlayingVoice(null);
    }
  }, [playingVoice, audio, isDragging, playbackSpeed, isMuted]);

  // 播放/暂停切换
  const togglePlayPause = useCallback(async () => {
    if (!audio) return;
    
    if (isActuallyPlaying) {
      audio.pause();
      setIsActuallyPlaying(false);
    } else {
      try {
        await audio.play();
        setIsActuallyPlaying(true);
      } catch (err) {
        console.error('Play failed:', err);
      }
    }
  }, [audio, isActuallyPlaying]);

  // 进度跳转
  const seekTo = useCallback((time: number) => {
    if (!audio) return;
    audio.currentTime = time;
    setCurrentTime(time);
  }, [audio]);

  // 倍速切换
  const cyclePlaybackSpeed = useCallback(() => {
    const speeds = [0.5, 1.0, 1.5, 2.0];
    const currentIndex = speeds.indexOf(playbackSpeed);
    const nextSpeed = speeds[(currentIndex + 1) % speeds.length];
    setPlaybackSpeed(nextSpeed);
    if (audio) {
      audio.playbackRate = nextSpeed;
    }
  }, [playbackSpeed, audio]);

  // 静音切换
  const toggleMute = useCallback(() => {
    if (!audio) return;
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    audio.muted = newMuted;
  }, [audio, isMuted]);

  // 重播
  const replay = useCallback(async () => {
    if (!audio) return;
    audio.currentTime = 0;
    setCurrentTime(0);
    try {
      await audio.play();
      setIsActuallyPlaying(true);
    } catch (err) {
      console.error('Replay failed:', err);
    }
  }, [audio]);

  // 格式化时间
  const formatTime = (seconds: number): string => {
    if (!Number.isFinite(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // 获取当前播放的音色信息
  const currentPlayingVoiceInfo = voices.find(v => v.voiceId === playingVoice);

  // Group voices by category
  const recommendedVoices = visibleVoices.filter(v => v.isHot);
  const premiumVoices = visibleVoices.filter(v => v.isPremium);
  const flashVoices = visibleVoices.filter(v => !v.isPremium && v.model.includes('qwen'));
  const cosyVoices = visibleVoices.filter(v => v.model.includes('cosy'));
  const minimaxVoices = visibleVoices.filter(isMiniMaxVoice);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 text-slate-900 dark:bg-neutral-950 dark:text-neutral-100">
      <MusicSidebar activeTab={activeTab} onTabChange={onTabChange} onBack={onBack} />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Header */}
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-center gap-8">
            <span className="text-xl font-bold">音乐库</span>
            <nav className="flex items-center gap-1">
              <button className="flex items-center gap-2 rounded-full bg-sky-100 px-4 py-1.5 text-sm font-medium text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
                <Sparkles size={16} />
                语音
              </button>
              <button className="flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-neutral-800">
                视频
              </button>
            </nav>
          </div>
          
          <div className="flex items-center gap-4">
            <button className="flex items-center gap-2 rounded-full bg-white px-4 py-1.5 text-sm font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 dark:bg-neutral-800 dark:border-neutral-700 dark:text-slate-200 dark:hover:bg-neutral-700">
              <span className="text-xs">📖</span>
              新手教程
            </button>
            <button className="flex items-center gap-2 rounded-full bg-white px-4 py-1.5 text-sm font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 dark:bg-neutral-800 dark:border-neutral-700 dark:text-slate-200 dark:hover:bg-neutral-700">
              <span className="text-xs">🔑</span>
              10,000
              <span className="text-xs text-slate-400">升级以获得更多声贝</span>
            </button>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-6">
          {/* Error Banner */}
          {error && (
            <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Top Cards */}
          <div className="mb-8 grid grid-cols-1 md:grid-cols-3 gap-6">
            <button onClick={() => onTabChange('voice-design')} className="group flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-6 hover:shadow-md transition-shadow dark:border-neutral-700 dark:bg-neutral-900">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-gradient-to-br from-violet-100 to-violet-200 dark:from-violet-900/30 dark:to-violet-800/30">
                  <div className="h-8 w-8 flex items-center justify-center">
                    <div className="flex gap-1 items-end h-6">
                      <div className="w-1 bg-violet-500 h-2 animate-pulse rounded-full"></div>
                      <div className="w-1 bg-violet-500 h-4 animate-pulse rounded-full" style={{ animationDelay: '0.1s' }}></div>
                      <div className="w-1 bg-violet-500 h-6 animate-pulse rounded-full" style={{ animationDelay: '0.2s' }}></div>
                      <div className="w-1 bg-violet-500 h-3 animate-pulse rounded-full" style={{ animationDelay: '0.3s' }}></div>
                      <div className="w-1 bg-violet-500 h-5 animate-pulse rounded-full" style={{ animationDelay: '0.4s' }}></div>
                    </div>
                  </div>
                </div>
                <div className="text-left">
                  <h3 className="text-lg font-semibold">音色设计</h3>
                </div>
              </div>
              <ArrowRight size={20} className="text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300" />
            </button>

            <button onClick={() => onTabChange('voice-clone')} className="group flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-6 hover:shadow-md transition-shadow dark:border-neutral-700 dark:bg-neutral-900">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-100 to-indigo-200 dark:from-indigo-900/30 dark:to-indigo-800/30">
                  <div className="h-8 w-8 flex items-center justify-center">
                    <div className="flex gap-0.5 items-end h-5">
                      <div className="w-1.5 bg-indigo-500 h-3 rounded-full"></div>
                      <div className="w-1.5 bg-indigo-500 h-5 rounded-full"></div>
                      <div className="w-1.5 bg-indigo-500 h-4 rounded-full"></div>
                    </div>
                  </div>
                </div>
                <div className="text-left">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold">音色克隆</h3>
                    <span className="px-2 py-0.5 text-[10px] font-medium bg-violet-100 text-violet-700 rounded-full dark:bg-violet-900/50 dark:text-violet-300">公测</span>
                  </div>
                </div>
              </div>
              <ArrowRight size={20} className="text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300" />
            </button>

            <button onClick={() => onTabChange('voice-extraction')} className="group flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-6 hover:shadow-md transition-shadow dark:border-neutral-700 dark:bg-neutral-900">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-gradient-to-br from-amber-100 to-orange-200 dark:from-amber-900/30 dark:to-orange-800/30">
                  <div className="h-8 w-8 flex items-center justify-center">
                    <User size={24} className="text-amber-600 dark:text-amber-400" />
                  </div>
                </div>
                <div className="text-left">
                  <h3 className="text-lg font-semibold">人声提取</h3>
                </div>
              </div>
              <ArrowRight size={20} className="text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300" />
            </button>
          </div>

          {/* Voice Library Content */}
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden dark:border-neutral-700 dark:bg-neutral-900">
            {/* Voice Library Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-neutral-700">
              <div className="flex items-center gap-6">
                {TAB_OPTIONS.map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveSubTab(tab)}
                    className={`text-sm font-medium transition-colors ${
                      activeSubTab === tab
                        ? 'border-b-2 border-sky-500 text-sky-700 pb-3 -mb-4 dark:border-sky-400 dark:text-sky-300'
                        : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
                <span>剩余音色档位：2/3</span>
              </div>
            </div>

            {/* Search, Model Switcher and Filter */}
            <div className="px-6 py-4 flex flex-wrap items-center gap-4">
              {/* Search */}
              <div className="order-1 w-64 flex-none relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder={activeSubTab === '音乐生成' ? '搜索歌曲或文件名' : '搜索音色库'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-slate-200"
                />
              </div>
              
              {/* Model Switcher */}
              <div className={`${activeSubTab === '音乐生成' || activeSubTab === '音轨分离' ? 'hidden' : 'flex'} order-2 min-w-0 max-w-full items-center gap-1 overflow-x-auto bg-slate-100 rounded-lg p-0.5 scrollbar-none dark:bg-neutral-800`}>
                {MODEL_OPTIONS.map((model) => (
                  <button
                    key={model.value}
                    onClick={() => setSelectedModel(model.value)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                      selectedModel === model.value
                        ? 'bg-white text-sky-700 shadow-sm dark:bg-neutral-700 dark:text-sky-300'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    {model.label}
                  </button>
                ))}
              </div>

              {/* Filter Button */}
              <button 
                hidden={activeSubTab === '音乐生成' || activeSubTab === '音轨分离'}
                onClick={() => setShowFilterModal(true)}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-full transition-colors ${
                  hasActiveFilters
                    ? 'bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:border-sky-800'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-neutral-800'
                }`}
              >
                <Filter size={16} />
                筛选
                {hasActiveFilters && (
                  <span className="w-1.5 h-1.5 bg-sky-500 rounded-full"></span>
                )}
              </button>

              {/* Reset Filters (only show when filters active) */}
              {hasActiveFilters && (
                <button 
                  hidden={activeSubTab === '音乐生成' || activeSubTab === '音轨分离'}
                  onClick={resetFilters}
                  className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  重置筛选
                </button>
              )}
            </div>

            {assetLoading && (activeSubTab === '音乐库' || activeSubTab === '音乐生成' || activeSubTab === '音轨分离') && (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={22} className="animate-spin text-violet-500" />
                <span className="ml-3 text-slate-500 dark:text-slate-400">加载音乐资产...</span>
              </div>
            )}

            {activeSubTab === '音轨分离' && (
              <SeparationHistoryPanel
                tasks={separationTasks}
                filter={separationFilter}
                onFilterChange={setSeparationFilter}
                searchQuery={searchQuery}
                onRefresh={() => void fetchMusicAssets()}
              />
            )}

            {(activeSubTab === '音乐生成' || (activeSubTab === '音乐库' && !hasActiveFilters)) && (
              <MusicAssetPanel tasks={musicTasks} searchQuery={searchQuery} />
            )}

            {/* Loading State */}
            {loading && activeSubTab !== '音乐库' && activeSubTab !== '音乐生成' && activeSubTab !== '音轨分离' && (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={24} className="animate-spin text-slate-400" />
                <span className="ml-3 text-slate-500 dark:text-slate-400">加载音色库...</span>
              </div>
            )}

            {/* Voice Cards */}
            {!loading && (
              <div className="px-6 pb-6 space-y-6">
                {activeSubTab !== '音乐库' && activeSubTab !== '音乐生成' && activeSubTab !== '音轨分离' && (
                  <section>
                    <div className="mb-3 flex items-center justify-between">
                      <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        {activeSubTab} {myVoicesLoading && <Loader2 size={14} className="ml-2 inline animate-spin" />}
                      </h4>
                      {activeSubTab === '我的音色' && (
                        <button onClick={() => onTabChange('voice-design')} className="text-sm text-violet-600 hover:text-violet-700 dark:text-violet-400">
                          音色设计
                        </button>
                      )}
                    </div>
                    <div className="space-y-4">
                      {visibleVoices.map(voice => (
                        <VoiceCard
                          key={`${voice.model}-${voice.voiceId}`}
                          voice={voice}
                          isSelected={selectedVoice === voice.voiceId}
                          isFavorite={Boolean(voice.isFavorite)}
                          isPlaying={playingVoice === voice.voiceId}
                          onSelect={() => setSelectedVoice(voice.voiceId)}
                          onToggleFavorite={() => void toggleFavorite(voice)}
                          onPlay={() => void playVoicePreview(voice)}
                          onEdit={voice.isCustom ? () => void editCustomVoice(voice) : undefined}
                          onDelete={voice.isCustom ? () => void deleteCustomVoice(voice.voiceId) : undefined}
                          onCopy={() => void copyVoiceId(voice.voiceId)}
                          onShare={() => void shareVoice(voice)}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {/* Recommended */}
                {activeSubTab === '音乐库' && recommendedVoices.length > 0 && (
                  <section>
                    <h4 className="text-sm font-medium text-slate-700 mb-3 dark:text-slate-300">推荐音色</h4>
                    <div className="space-y-4">
                      {recommendedVoices.map(voice => (
                        <VoiceCard
                          key={`${voice.model}-${voice.voiceId}`}
                          voice={voice}
                          isSelected={selectedVoice === voice.voiceId}
                          isFavorite={favorites.includes(voice.voiceId)}
                          isPlaying={playingVoice === voice.voiceId}
                          onSelect={() => setSelectedVoice(voice.voiceId)}
                          onToggleFavorite={() => void toggleFavorite(voice)}
                          onPlay={() => playVoicePreview(voice)}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {/* Premium */}
                {activeSubTab === '音乐库' && premiumVoices.length > 0 && (
                  <section>
                    <h4 className="text-sm font-medium text-slate-700 mb-3 dark:text-slate-300">旗舰音色</h4>
                    <div className="space-y-4">
                      {premiumVoices.map(voice => (
                        <VoiceCard
                          key={`${voice.model}-${voice.voiceId}`}
                          voice={voice}
                          isSelected={selectedVoice === voice.voiceId}
                          isFavorite={favorites.includes(voice.voiceId)}
                          isPlaying={playingVoice === voice.voiceId}
                          onSelect={() => setSelectedVoice(voice.voiceId)}
                          onToggleFavorite={() => void toggleFavorite(voice)}
                          onPlay={() => playVoicePreview(voice)}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {/* Flash */}
                {activeSubTab === '音乐库' && flashVoices.length > 0 && (
                  <section>
                    <h4 className="text-sm font-medium text-slate-700 mb-3 dark:text-slate-300">精品音色</h4>
                    <div className="space-y-4">
                      {flashVoices.map(voice => (
                        <VoiceCard
                          key={`${voice.model}-${voice.voiceId}`}
                          voice={voice}
                          isSelected={selectedVoice === voice.voiceId}
                          isFavorite={favorites.includes(voice.voiceId)}
                          isPlaying={playingVoice === voice.voiceId}
                          onSelect={() => setSelectedVoice(voice.voiceId)}
                          onToggleFavorite={() => void toggleFavorite(voice)}
                          onPlay={() => playVoicePreview(voice)}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {/* CosyVoice */}
                {activeSubTab === '音乐库' && cosyVoices.length > 0 && (
                  <section>
                    <h4 className="text-sm font-medium text-slate-700 mb-3 dark:text-slate-300">CosyVoice</h4>
                    <div className="space-y-4">
                      {cosyVoices.map(voice => (
                        <VoiceCard
                          key={`${voice.model}-${voice.voiceId}`}
                          voice={voice}
                          isSelected={selectedVoice === voice.voiceId}
                          isFavorite={favorites.includes(voice.voiceId)}
                          isPlaying={playingVoice === voice.voiceId}
                          onSelect={() => setSelectedVoice(voice.voiceId)}
                          onToggleFavorite={() => void toggleFavorite(voice)}
                          onPlay={() => playVoicePreview(voice)}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {activeSubTab === '音乐库' && minimaxVoices.length > 0 && (
                  <section>
                    <h4 className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-300">MiniMax</h4>
                    <div className="space-y-4">
                      {minimaxVoices.map(voice => (
                        <VoiceCard
                          key={`${voice.model}-${voice.voiceId}`}
                          voice={voice}
                          isSelected={selectedVoice === voice.voiceId}
                          isFavorite={favorites.includes(voice.voiceId)}
                          isPlaying={playingVoice === voice.voiceId}
                          onSelect={() => setSelectedVoice(voice.voiceId)}
                          onToggleFavorite={() => void toggleFavorite(voice)}
                          onPlay={() => void playVoicePreview(voice)}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {/* No Results */}
                {((activeSubTab !== '音乐库' && activeSubTab !== '音乐生成' && activeSubTab !== '音轨分离')
                  || (activeSubTab === '音乐库' && hasActiveFilters)) && visibleVoices.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Search size={48} className="text-slate-300 mb-4" />
                    <h5 className="text-slate-700 font-medium mb-1 dark:text-slate-300">未找到匹配的音色</h5>
                    <p className="text-slate-500 text-sm dark:text-slate-400">尝试使用其他关键词搜索</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </main>

        {/* 语音过滤器弹窗 */}
        <VoiceFilterModal
          isOpen={showFilterModal}
          onClose={() => setShowFilterModal(false)}
          filterOptions={filterOptions}
          selectedScenario={selectedScenario}
          setSelectedScenario={setSelectedScenario}
          selectedTrait={selectedTrait}
          setSelectedTrait={setSelectedTrait}
          selectedGender={selectedGender}
          setSelectedGender={setSelectedGender}
          selectedAge={selectedAge}
          setSelectedAge={setSelectedAge}
          onReset={resetFilters}
        />

        {/* 播放控制器 */}
        {playingVoice && currentPlayingVoiceInfo && (
          <AudioPlayer
            voice={currentPlayingVoiceInfo}
            isPlaying={isActuallyPlaying}
            currentTime={currentTime}
            duration={duration}
            playbackSpeed={playbackSpeed}
            isMuted={isMuted}
            onTogglePlayPause={togglePlayPause}
            onSeek={seekTo}
            onSpeedChange={cyclePlaybackSpeed}
            onToggleMute={toggleMute}
            onReplay={replay}
            formatTime={formatTime}
            setIsDragging={setIsDragging}
          />
        )}
      </div>
    </div>
  );
}

function MusicAssetPanel({ tasks, searchQuery }: { tasks: MusicGenerationTask[]; searchQuery: string }) {
  const query = searchQuery.trim().toLowerCase();
  const clips = tasks.flatMap(task => task.clips.map(clip => ({ ...clip, taskId: task.id, createdAt: task.created_at })));
  const visible = clips.filter(clip => !query || `${clip.title || ''} ${clip.id}`.toLowerCase().includes(query));
  if (!visible.length) {
    return <div className="mx-6 mb-6 rounded-xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500 dark:border-neutral-700">音乐生成完成后，歌曲和封面会自动出现在这里。</div>;
  }
  return (
    <section className="mx-6 mb-6">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">音乐生成结果</h4>
        <span className="text-xs text-slate-500">{visible.length} 首</span>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {visible.map(clip => (
          <article key={clip.id} className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-neutral-700 dark:bg-neutral-800/60">
            {clip.image_url ? <img src={clip.image_url} alt="" className="h-16 w-16 rounded-lg object-cover" /> : <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-900/30"><Music2 size={22} /></div>}
            <div className="min-w-0 flex-1">
              <h5 className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{clip.title || '未命名歌曲'}</h5>
              <p className="mt-0.5 truncate text-[10px] font-mono text-slate-500">task: {clip.taskId}</p>
              {clip.audio_url ? <audio controls preload="none" className="mt-2 h-8 w-full" src={clip.audio_url} /> : <p className="mt-2 text-xs text-amber-600">音频资产尚未就绪</p>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function SeparationHistoryPanel({
  tasks,
  filter,
  onFilterChange,
  searchQuery,
  onRefresh,
}: {
  tasks: SeparationTaskAsset[];
  filter: 'vocals' | 'instrumental';
  onFilterChange: (value: 'vocals' | 'instrumental') => void;
  searchQuery: string;
  onRefresh: () => void;
}) {
  const query = searchQuery.trim().toLowerCase();
  const visible = tasks.filter(task => {
    if (query && !task.originalName.toLowerCase().includes(query)) return false;
    return task.status !== 'SUCCESS' || task.stems.some(stem => filter === 'vocals' ? stem.key === 'vocals' : stem.key === 'instrumental');
  });
  return (
    <section className="mx-6 mb-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">音轨分离结果历史</h4>
          <p className="mt-1 text-xs text-slate-500">分离完成后自动保存到音乐库，音频链接已本地化保存。</p>
        </div>
        <div className="flex items-center gap-2">
          {(['vocals', 'instrumental'] as const).map(value => (
            <button key={value} onClick={() => onFilterChange(value)} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${filter === value ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' : 'border border-slate-200 text-slate-500 dark:border-neutral-700'}`}>
              {value === 'vocals' ? '人声提取历史' : '伴奏提取历史'}
            </button>
          ))}
          <button onClick={onRefresh} className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 dark:border-neutral-700 dark:hover:bg-neutral-800" title="刷新"><RotateCcw size={14} /></button>
        </div>
      </div>
      {!visible.length ? <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500 dark:border-neutral-700">暂无{filter === 'vocals' ? '人声' : '伴奏'}提取记录。</div> : (
        <div className="space-y-3">
          {visible.map(task => {
            const stem = task.stems.find(item => item.key === filter);
            return <article key={task.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 dark:border-neutral-700">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-900/30"><Music2 size={18} /></div>
              <div className="min-w-0 flex-1"><h5 className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{task.originalName}</h5><p className="text-[10px] text-slate-500">{task.status} · {new Date(task.createdAt * 1000).toLocaleString('zh-CN')}</p></div>
              {stem?.url ? <><audio controls preload="none" className="h-8 max-w-[260px]" src={stem.url} /><a href={stem.url} target="_blank" rel="noreferrer" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-neutral-800" title="下载"><Download size={16} /></a></> : <span className="text-xs text-amber-600">处理中</span>}
            </article>;
          })}
        </div>
      )}
    </section>
  );
}

function VoiceCard({
  voice,
  isSelected,
  isFavorite,
  isPlaying,
  onSelect,
  onToggleFavorite,
  onPlay,
  onEdit,
  onDelete,
  onCopy,
  onShare,
}: {
  voice: VoiceModel;
  isSelected: boolean;
  isFavorite: boolean;
  isPlaying: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
  onPlay: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onCopy?: () => void;
  onShare?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex items-start gap-4 p-4 rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors dark:border-neutral-700 dark:hover:bg-neutral-800">
      {/* Avatar */}
      {voice.avatar ? (
        <img
          src={voice.avatar}
          alt={voice.name}
          className="h-14 w-14 rounded-xl object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
            (e.target as HTMLImageElement).nextElementSibling!.classList.remove('hidden');
          }}
        />
      ) : null}
      <div className={`flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 dark:from-neutral-700 dark:to-neutral-600 ${voice.avatar ? 'hidden' : ''}`}>
        <span className="text-lg font-medium text-slate-500 dark:text-slate-300">
          {voice.name.charAt(0)}
        </span>
      </div>
      
      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h5 className="text-sm font-medium text-slate-900 truncate dark:text-slate-100">{voice.name}</h5>
              {voice.isNew && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-100 text-green-700 rounded-full dark:bg-green-900/50 dark:text-green-300">
                  新
                </span>
              )}
              {voice.isHot && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-orange-100 text-orange-700 rounded-full dark:bg-orange-900/50 dark:text-orange-300">
                  热
                </span>
              )}
              {voice.isPremium && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-violet-100 text-violet-700 rounded-full dark:bg-violet-900/50 dark:text-violet-300">
                  旗舰
                </span>
              )}
              {voice.isCustom && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-indigo-100 text-indigo-700 rounded-full dark:bg-indigo-900/50 dark:text-indigo-300">
                  {voice.status === 'DEPLOYING' ? '审核中' : '自定义'}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1 line-clamp-2 dark:text-slate-400">{voice.description}</p>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[10px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full dark:bg-neutral-800">
                {voice.model}
              </span>
            </div>
          </div>
          
          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1">
              {voice.tags.map((tag) => (
                <span key={`${voice.voiceId}-${tag}`} className="px-2 py-0.5 text-[10px] bg-slate-100 text-slate-600 rounded-full dark:bg-neutral-800 dark:text-slate-400">
                  {tag}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-1 ml-2">
              <button
                onClick={onPlay}
                className={`p-2 rounded-lg hover:bg-slate-100 transition-colors ${
                  isPlaying ? 'text-sky-500' : 'text-slate-400 hover:text-sky-500'
                } dark:hover:bg-neutral-700`}
                title="试听"
              >
                {isPlaying ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <button
                onClick={onToggleFavorite}
                className={`p-2 rounded-lg hover:bg-slate-100 transition-colors ${
                  isFavorite ? 'text-red-500' : 'text-slate-400'
                } dark:hover:bg-neutral-700`}
              >
                <Heart size={16} fill={isFavorite ? 'currentColor' : 'none'} />
              </button>
              {onShare && (
                <button onClick={onShare} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-neutral-700" title="分享">
                  <Share2 size={16} />
                  <span className="hidden md:inline">分享</span>
                </button>
              )}
              <div className="relative">
              <button onClick={() => setMenuOpen((open) => !open)} className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-neutral-700" title="更多操作">
                <MoreHorizontal size={16} />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-10 z-20 w-44 rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                  {onCopy && (
                    <button onClick={() => { onCopy(); setMenuOpen(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-neutral-800">
                      <Copy size={15} /> 复制 Voice ID
                    </button>
                  )}
                  {onEdit && (
                    <button onClick={() => { onEdit(); setMenuOpen(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-neutral-800">
                      <Pencil size={15} /> 编辑
                    </button>
                  )}
                  {onDelete && (
                    <button onClick={() => { onDelete(); setMenuOpen(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30">
                      <Trash2 size={15} /> 删除
                    </button>
                  )}
                </div>
              )}
              </div>
              <button
                onClick={onSelect}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isSelected
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100'
                }`}
              >
                {isSelected ? (
                  <><Check size={16} /> 已选</>
                ) : (
                  '选择'
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// 播放控制器组件
function AudioPlayer({
  voice,
  isPlaying,
  currentTime,
  duration,
  playbackSpeed,
  isMuted,
  onTogglePlayPause,
  onSeek,
  onSpeedChange,
  onToggleMute,
  onReplay,
  formatTime,
  setIsDragging,
}: {
  voice: VoiceModel;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackSpeed: number;
  isMuted: boolean;
  onTogglePlayPause: () => void;
  onSeek: (time: number) => void;
  onSpeedChange: () => void;
  onToggleMute: () => void;
  onReplay: () => void;
  formatTime: (seconds: number) => string;
  setIsDragging: (dragging: boolean) => void;
}) {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  // 进度条点击跳转
  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = clickX / rect.width;
    const newTime = percentage * duration;
    onSeek(newTime);
  };

  // 进度条拖拽处理
  const handleProgressMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true);
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const moveX = moveEvent.clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, moveX / rect.width));
      const newTime = percentage * duration;
      onSeek(newTime);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div className="border-t border-slate-200 bg-white px-6 py-3 dark:border-neutral-700 dark:bg-neutral-900">
      <div className="flex items-center gap-4">
        {/* 音色信息 */}
        <div className="flex items-center gap-3 min-w-0 flex-shrink-0 max-w-xs">
          {voice.avatar ? (
            <img
              src={voice.avatar}
              alt={voice.name}
              className="h-10 w-10 rounded-lg object-cover"
            />
          ) : (
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-slate-100 to-slate-200 dark:from-neutral-700 dark:to-neutral-600 flex items-center justify-center">
              <span className="text-sm font-medium text-slate-500">{voice.name.charAt(0)}</span>
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900 truncate dark:text-slate-100">{voice.name}</p>
            <p className="text-xs text-slate-500 truncate dark:text-slate-400">
              {voice.tags.slice(0, 3).join(' · ')}
            </p>
          </div>
        </div>

        {/* 播放控制按钮 */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={onReplay}
            className="p-2 rounded-full hover:bg-slate-100 text-slate-500 transition-colors dark:hover:bg-neutral-800"
            title="重播"
          >
            <RotateCcw size={16} />
          </button>
          <button
            onClick={onTogglePlayPause}
            className="p-3 rounded-full bg-slate-900 text-white hover:bg-slate-800 transition-colors dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
          >
            {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          </button>
        </div>

        {/* 进度条和时间 */}
        <div className="flex-1 flex items-center gap-3 min-w-0">
          <span className="text-xs text-slate-500 w-12 text-right font-mono dark:text-slate-400">
            {formatTime(currentTime)}
          </span>
          <div 
            className="flex-1 h-1.5 bg-slate-200 rounded-full cursor-pointer group relative dark:bg-neutral-700"
            onClick={handleProgressClick}
            onMouseDown={handleProgressMouseDown}
          >
            <div 
              className="h-full bg-sky-500 rounded-full relative group-hover:bg-sky-400 transition-colors"
              style={{ width: `${progress}%` }}
            >
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white border-2 border-sky-500 rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-sm" />
            </div>
          </div>
          <span className="text-xs text-slate-500 w-12 font-mono dark:text-slate-400">
            {formatTime(duration)}
          </span>
        </div>

        {/* 倍速和音量控制 */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={onSpeedChange}
            className="px-2 py-1 text-xs font-medium rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50 transition-colors dark:border-neutral-600 dark:text-slate-400 dark:hover:bg-neutral-800"
            title={`当前倍速: ${playbackSpeed}x`}
          >
            {playbackSpeed}x
          </button>
          <button
            onClick={onToggleMute}
            className="p-2 rounded-full hover:bg-slate-100 text-slate-500 transition-colors dark:hover:bg-neutral-800"
            title={isMuted ? "取消静音" : "静音"}
          >
            {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}

// 语音过滤器弹窗组件
function VoiceFilterModal({
  isOpen,
  onClose,
  filterOptions,
  selectedScenario,
  setSelectedScenario,
  selectedTrait,
  setSelectedTrait,
  selectedGender,
  setSelectedGender,
  selectedAge,
  setSelectedAge,
  onReset,
}: {
  isOpen: boolean;
  onClose: () => void;
  filterOptions: FilterOptions;
  selectedScenario: string;
  setSelectedScenario: (value: string) => void;
  selectedTrait: string;
  setSelectedTrait: (value: string) => void;
  selectedGender: string;
  setSelectedGender: (value: string) => void;
  selectedAge: string;
  setSelectedAge: (value: string) => void;
  onReset: () => void;
}) {
  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
      />
      
      {/* Modal - 固定宽度居中 */}
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[680px] max-h-[85vh] bg-white rounded-2xl shadow-xl z-50 overflow-hidden flex flex-col dark:bg-neutral-900">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0 dark:border-neutral-700">
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">语音过滤器</h3>
          <button 
            onClick={onClose}
            className="p-1 rounded-full hover:bg-slate-100 text-slate-400 transition-colors dark:hover:bg-neutral-800"
          >
            <X size={18} />
          </button>
        </div>

        {/* Filter Content - 可滚动区域 */}
        <div className="px-6 py-5 space-y-5 overflow-y-auto">
          {/* 场景 (Scenario) - 动态从API获取 */}
          <div>
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2.5 dark:text-slate-400">
              场景 {filterOptions.scenarios.length > 0 && `(${filterOptions.scenarios.length})`}
            </h4>
            {filterOptions.scenarios.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto pr-1">
                {filterOptions.scenarios.map((scenario) => (
                  <button
                    key={scenario}
                    onClick={() => setSelectedScenario(selectedScenario === scenario ? '' : scenario)}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-all whitespace-nowrap ${
                      selectedScenario === scenario
                        ? 'bg-sky-50 text-sky-700 border-sky-300 dark:bg-sky-900/30 dark:text-sky-300 dark:border-sky-700'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50 dark:bg-neutral-800 dark:text-slate-400 dark:border-neutral-700 dark:hover:border-neutral-600'
                    }`}
                  >
                    {scenario}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400 italic">加载中...</p>
            )}
          </div>

          {/* 特质 (Trait) - 动态从API获取 */}
          <div>
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2.5 dark:text-slate-400">
              特质 {filterOptions.traits.length > 0 && `(${filterOptions.traits.length})`}
            </h4>
            {filterOptions.traits.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto pr-1">
                {filterOptions.traits.map((trait) => (
                  <button
                    key={trait}
                    onClick={() => setSelectedTrait(selectedTrait === trait ? '' : trait)}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-all whitespace-nowrap ${
                      selectedTrait === trait
                        ? 'bg-violet-50 text-violet-700 border-violet-300 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-700'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50 dark:bg-neutral-800 dark:text-slate-400 dark:border-neutral-700 dark:hover:border-neutral-600'
                    }`}
                  >
                    {trait}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400 italic">加载中...</p>
            )}
          </div>

          {/* 性别 (Gender) - 动态从API获取 */}
          <div>
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2.5 dark:text-slate-400">性别</h4>
            <div className="flex gap-1 p-1 bg-slate-100 rounded-lg dark:bg-neutral-800">
              {['全部', ...filterOptions.genders].map((gender) => (
                <button
                  key={gender}
                  onClick={() => setSelectedGender(gender)}
                  className={`flex-1 px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                    selectedGender === gender
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-neutral-700 dark:text-slate-100'
                      : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'
                  }`}
                >
                  {gender}
                </button>
              ))}
            </div>
          </div>

          {/* 年龄 (Age) */}
          <div>
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2.5 dark:text-slate-400">年龄</h4>
            <div className="flex gap-1.5">
              {AGE_OPTIONS.map((age) => (
                <button
                  key={age}
                  onClick={() => setSelectedAge(selectedAge === age ? '' : age)}
                  className={`px-4 py-1.5 text-sm rounded-lg border transition-all ${
                    selectedAge === age
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50 dark:bg-neutral-800 dark:text-slate-400 dark:border-neutral-700 dark:hover:border-neutral-600'
                  }`}
                >
                  {age}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 shrink-0 dark:border-neutral-700">
          <button
            onClick={onReset}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors dark:text-slate-400 dark:hover:bg-neutral-800"
          >
            重置所有
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2 text-sm font-medium text-white bg-sky-500 hover:bg-sky-600 rounded-lg transition-colors"
          >
            筛选
          </button>
        </div>
      </div>
    </>
  );
}
