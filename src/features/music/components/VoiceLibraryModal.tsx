'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Play, 
  Pause, 
  Heart, 
  MoreHorizontal, 
  Search, 
  Filter,
  Loader2,
  Volume2,
  VolumeX,
  X
} from 'lucide-react';
import { normalizeVoices, type VoiceApiModel, type VoiceModel } from '../voiceCatalog';

const TAB_OPTIONS = ['音色库', '我的音色', '收藏音色'] as const;
type TabOption = typeof TAB_OPTIONS[number];

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

interface VoiceLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectVoice?: (voice: VoiceModel) => void;
}

export default function VoiceLibraryModal({ isOpen, onClose, onSelectVoice }: VoiceLibraryModalProps) {
  const [activeSubTab, setActiveSubTab] = useState<TabOption>('音色库');
  const [voices, setVoices] = useState<VoiceModel[]>([]);
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
  const [isMuted, setIsMuted] = useState(false);
  const [isActuallyPlaying, setIsActuallyPlaying] = useState(false); // 独立的播放状态

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
      
      // “我的音色/收藏音色”需要完整列表；模型和数据库筛选只作用于音色库，
      // 否则用户从音色库切换标签时，先前选中的 Plus/CosyVoice 筛选会把自定义音色隐藏。
      const params = new URLSearchParams();
      if (activeSubTab === '音色库') {
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
      }
      if (searchQuery) params.append('search', searchQuery);
      
      const url = `/api/music/voices${params.toString() ? `?${params.toString()}` : ''}`;
      console.log('📡 请求音色列表:', url);
      
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch voices');
      const data = normalizeVoices(await response.json() as VoiceApiModel[]);
      setVoices(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load voices');
    } finally {
      setLoading(false);
    }
  }, [activeSubTab, selectedModel, selectedScenario, selectedTrait, selectedGender, selectedAge, searchQuery, filterOptions]);

  useEffect(() => {
    if (isOpen) {
      fetchVoices();
    }
  }, [fetchVoices, isOpen]);

  // Filter voices（前端二次筛选）
  const filteredVoices = useMemo(() => {
    return voices.filter(voice => {
      // 搜索筛选
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const searchText = `${voice.name} ${voice.description} ${voice.voiceId} ${voice.tags.join(' ')}`.toLowerCase();
        if (!searchText.includes(query)) return false;
      }
      return true;
    });
  }, [voices, searchQuery]);

  // 标签切换必须改变真正渲染的数据集合。此前 activeSubTab 只更新了
  // 下划线样式，列表始终使用全部 voices，因此“我的音色/收藏音色”看起来无法切换。
  const visibleVoices = useMemo(() => {
    if (activeSubTab === '我的音色') {
      return filteredVoices.filter((voice) => voice.isCustom);
    }
    if (activeSubTab === '收藏音色') {
      return filteredVoices.filter((voice) => (
        voice.isCustom ? Boolean(voice.isFavorite) : favorites.includes(voice.voiceId)
      ));
    }
    return filteredVoices.filter((voice) => !voice.isCustom);
  }, [activeSubTab, favorites, filteredVoices]);

  // Separate voices into categories
  const recommendedVoices = useMemo(() => visibleVoices.filter(v => v.isHot), [visibleVoices]);

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return selectedModel !== 'all' || selectedScenario || selectedTrait || selectedGender !== '全部' || selectedAge;
  }, [selectedModel, selectedScenario, selectedTrait, selectedGender, selectedAge]);

  // Reset all filters
  const resetFilters = () => {
    setSelectedModel('all');
    setSelectedScenario('');
    setSelectedTrait('');
    setSelectedGender('全部');
    setSelectedAge('');
    setSearchQuery('');
  };

  // Toggle favorite
  const toggleFavorite = useCallback(async (voice: VoiceModel) => {
    const nextFavorite = voice.isCustom
      ? !Boolean(voice.isFavorite)
      : !favorites.includes(voice.voiceId);

    if (voice.isCustom) {
      try {
        const response = await fetch(`/api/music/my-voices/${encodeURIComponent(voice.voiceId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_favorite: nextFavorite }),
        });
        if (!response.ok) throw new Error('收藏状态更新失败');
        const updated = await response.json() as VoiceApiModel;
        setVoices(prev => prev.map(item => item.voiceId === voice.voiceId
          ? { ...item, isFavorite: Boolean(updated.is_favorite) }
          : item
        ));
      } catch (err) {
        setError(err instanceof Error ? err.message : '收藏状态更新失败');
      }
      return;
    }

    setFavorites(prev => prev.includes(voice.voiceId)
      ? prev.filter(id => id !== voice.voiceId)
      : [...prev, voice.voiceId]
    );
  }, [favorites]);

  // Play voice preview
  const playVoicePreview = useCallback((voice: VoiceModel) => {
    // Stop current audio if playing
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.onended = null;
    }

    if (playingVoice === voice.voiceId) {
      // Stop playback
      setPlayingVoice(null);
      setIsActuallyPlaying(false);
    } else {
      // Start new playback
      setPlayingVoice(voice.voiceId);
      
      // Build preview URL with model info
      const params = new URLSearchParams();
      if (voice.model) {
        params.append('model', voice.model);
      }
      
      const previewUrl = `/api/music/voices/${voice.voiceId}/preview${params.toString() ? `?${params.toString()}` : ''}`;
      console.log('🎵 播放预览:', previewUrl);
      
      // Create and play audio
      const newAudio = new Audio(previewUrl);
      
      // Setup event listeners
      newAudio.onplay = () => {
        setIsActuallyPlaying(true);
      };
      
      newAudio.onended = () => {
        setPlayingVoice(null);
        setIsActuallyPlaying(false);
      };
      
      newAudio.onerror = (err) => {
        console.error('❌ 预览音频播放失败:', err);
        setPlayingVoice(null);
        setIsActuallyPlaying(false);
      };
      
      // Play audio
      newAudio.play().catch((err) => {
        console.error('❌ 播放失败:', err);
        setPlayingVoice(null);
        setIsActuallyPlaying(false);
      });
      
      setAudio(newAudio);
    }
  }, [playingVoice, audio]);

  // Voice Card Component
  const VoiceCard = ({ voice, isSelected, isFavorite, isPlaying, onSelect, onToggleFavorite, onPlay }: { 
    voice: VoiceModel; 
    isSelected: boolean;
    isFavorite: boolean;
    isPlaying: boolean;
    onSelect: () => void;
    onToggleFavorite: () => void;
    onPlay: () => void;
  }) => {
    return (
      <div className={`flex gap-4 p-4 rounded-xl border transition-all ${
        isSelected 
          ? 'border-sky-500 bg-sky-50/50' 
          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
      }`}>
        {/* Avatar with Play Button */}
        <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 bg-gradient-to-br from-slate-100 to-slate-200 relative group cursor-pointer">
          {voice.avatar ? (
            <img src={voice.avatar} alt={voice.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-violet-500 to-indigo-600">
              <span className="text-white text-xl font-bold">{voice.name.charAt(0)}</span>
            </div>
          )}
          
          {/* Play Overlay */}
          <div 
            onClick={(e) => {
              e.stopPropagation();
              onPlay();
            }}
            className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <div className={`w-10 h-10 rounded-full bg-white/90 flex items-center justify-center shadow-lg transform ${isPlaying ? 'scale-110' : ''}`}>
              {isPlaying ? (
                <Pause size={20} className="text-black" fill="currentColor" />
              ) : (
                <Play size={20} className="text-black ml-1" fill="currentColor" />
              )}
            </div>
          </div>
          
          {/* Playing Indicator */}
          {isPlaying && (
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute inset-0 border-2 border-white rounded-xl animate-pulse" />
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h4 className="font-medium text-slate-900 truncate">{voice.name}</h4>
              <p className="text-sm text-slate-500 line-clamp-2 mt-1">{voice.description}</p>
            </div>
            
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Tags */}
              <div className="hidden md:flex gap-1">
                {voice.tags.slice(0, 2).map(tag => (
                  <span key={tag} className="px-2 py-0.5 text-[10px] bg-slate-100 text-slate-600 rounded-full">
                    {tag}
                  </span>
                ))}
                {voice.tags.length > 2 && (
                  <span className="px-2 py-0.5 text-[10px] bg-slate-100 text-slate-600 rounded-full">
                    +{voice.tags.length - 2}
                  </span>
                )}
              </div>
              
              {/* Select Button */}
              <button
                onClick={onSelect}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                  isSelected 
                    ? 'bg-sky-600 text-white' 
                    : 'bg-black text-white hover:bg-black/80'
                }`}
              >
                {isSelected ? '已选' : '选择'}
              </button>
              
              {/* Favorite */}
              <button
                onClick={onToggleFavorite}
                className="p-2 rounded-full hover:bg-slate-100"
              >
                <Heart 
                  size={16} 
                  fill={isFavorite ? '#ef4444' : 'none'} 
                  className={isFavorite ? 'text-red-500' : 'text-slate-400'} 
                />
              </button>
              
              {/* More */}
              <button className="p-2 rounded-full hover:bg-slate-100">
                <MoreHorizontal size={16} className="text-slate-400" />
              </button>
            </div>
          </div>
          
          {/* Tags for mobile */}
          <div className="md:hidden mt-2 flex gap-1">
            {voice.tags.slice(0, 2).map(tag => (
              <span key={tag} className="px-2 py-0.5 text-[10px] bg-slate-100 text-slate-600 rounded-full">
                {tag}
              </span>
            ))}
            {voice.tags.length > 2 && (
              <span className="px-2 py-0.5 text-[10px] bg-slate-100 text-slate-600 rounded-full">
                +{voice.tags.length - 2}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Filter Modal
  const FilterModal = () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl w-[680px] max-h-[80vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white p-6 border-b border-slate-200">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">筛选</h3>
            <button onClick={() => setShowFilterModal(false)} className="p-1 hover:bg-slate-100 rounded-full">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-8">
          {/* 性别 */}
          <section>
            <h4 className="text-sm font-medium text-slate-700 mb-3">性别</h4>
            <div className="flex flex-wrap gap-2">
              {['全部', ...filterOptions.genders].map(gender => (
                <button
                  key={gender}
                  onClick={() => setSelectedGender(gender)}
                  className={`px-4 py-1.5 text-sm rounded-full border transition-all ${
                    selectedGender === gender
                      ? 'bg-sky-600 text-white border-sky-600'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {gender}
                </button>
              ))}
            </div>
          </section>

          {/* 场景 */}
          <section>
            <h4 className="text-sm font-medium text-slate-700 mb-3">场景</h4>
            <div className="flex flex-wrap gap-2">
              {filterOptions.scenarios.map(scenario => (
                <button
                  key={scenario}
                  onClick={() => setSelectedScenario(selectedScenario === scenario ? '' : scenario)}
                  className={`px-4 py-1.5 text-sm rounded-full border transition-all ${
                    selectedScenario === scenario
                      ? 'bg-sky-600 text-white border-sky-600'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {scenario}
                </button>
              ))}
            </div>
          </section>

          {/* 特质 */}
          <section>
            <h4 className="text-sm font-medium text-slate-700 mb-3">特质</h4>
            <div className="flex flex-wrap gap-2">
              {filterOptions.traits.map(trait => (
                <button
                  key={trait}
                  onClick={() => setSelectedTrait(selectedTrait === trait ? '' : trait)}
                  className={`px-4 py-1.5 text-sm rounded-full border transition-all ${
                    selectedTrait === trait
                      ? 'bg-sky-600 text-white border-sky-600'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {trait}
                </button>
              ))}
            </div>
          </section>

          {/* 年龄 */}
          <section>
            <h4 className="text-sm font-medium text-slate-700 mb-3">年龄</h4>
            <div className="flex flex-wrap gap-2">
              {AGE_OPTIONS.map(age => (
                <button
                  key={age}
                  onClick={() => setSelectedAge(selectedAge === age ? '' : age)}
                  className={`px-4 py-1.5 text-sm rounded-full border transition-all ${
                    selectedAge === age
                      ? 'bg-sky-600 text-white border-sky-600'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {age}
                </button>
              ))}
            </div>
          </section>
        </div>

        <div className="sticky bottom-0 bg-white p-6 border-t border-slate-200">
          <button
            onClick={() => setShowFilterModal(false)}
            className="w-full py-2 bg-black text-white rounded-full text-sm font-medium hover:bg-black/80"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <h2 className="text-2xl font-bold text-slate-900">音色选择</h2>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-full transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Tabs */}
        <div className="border-b border-slate-200">
          <div className="flex gap-4 px-6">
            {TAB_OPTIONS.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveSubTab(tab)}
                className={`py-3 border-b-2 text-sm font-medium transition-colors ${
                  activeSubTab === tab
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Search, Model Switcher and Filter */}
        <div className="px-6 py-4 flex flex-wrap items-center gap-4">
          {/* Search */}
          <div className="order-1 w-64 flex-none relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="搜索音色库"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
            />
          </div>
          
          {/* Model Switcher */}
          <div className="order-2 min-w-0 max-w-full flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 overflow-x-auto scrollbar-none">
            {MODEL_OPTIONS.map((model) => (
              <button
                key={model.value}
                onClick={() => setSelectedModel(model.value)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap ${
                  selectedModel === model.value
                    ? 'bg-white text-sky-700 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {model.label}
              </button>
            ))}
          </div>

          {/* Filter Button */}
          <button 
            onClick={() => setShowFilterModal(true)}
            className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-full transition-colors ${
              hasActiveFilters
                ? 'bg-sky-50 text-sky-700 border border-sky-200'
                : 'text-slate-600 hover:bg-slate-100'
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
              onClick={resetFilters}
              className="text-xs text-slate-500 hover:text-slate-700"
            >
              重置筛选
            </button>
          )}
        </div>

        {/* Voice Cards */}
        <div className="px-6 pb-6 space-y-6 overflow-y-auto max-h-[60vh]">
          {/* Loading State */}
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-slate-400" />
              <span className="ml-3 text-slate-500">加载音色库...</span>
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-red-500">{error}</p>
              <button onClick={fetchVoices} className="mt-4 text-sky-600 hover:text-sky-700">
                重试
              </button>
            </div>
          )}

          {/* Empty State */}
          {!loading && !error && visibleVoices.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                <Search size={32} className="text-slate-400" />
              </div>
              <p className="text-lg font-medium text-slate-700">
                {activeSubTab === '我的音色' ? '还没有自定义音色' : activeSubTab === '收藏音色' ? '还没有收藏音色' : '未找到匹配的音色'}
              </p>
              <p className="text-slate-500 mt-2">
                {activeSubTab === '音色库' ? '尝试使用其他关键词搜索' : '可先在音色卡片上点击心形按钮收藏'}
              </p>
            </div>
          )}

          {/* Voice List */}
          {!loading && !error && visibleVoices.length > 0 && (
            <>
              {/* Recommended */}
              {recommendedVoices.length > 0 && (
                <section>
                  <h4 className="text-sm font-medium text-slate-700 mb-3">推荐音色</h4>
                  <div className="space-y-4">
                    {recommendedVoices.map(voice => (
                      <VoiceCard
                        key={`${voice.model}-${voice.voiceId}`}
                        voice={voice}
                        isSelected={selectedVoice === voice.voiceId}
                        isFavorite={voice.isCustom ? Boolean(voice.isFavorite) : favorites.includes(voice.voiceId)}
                        isPlaying={playingVoice === voice.voiceId}
                        onSelect={() => {
                          setSelectedVoice(voice.voiceId);
                          if (onSelectVoice) {
                            onSelectVoice(voice);
                            onClose();
                          }
                        }}
                        onToggleFavorite={() => { void toggleFavorite(voice); }}
                        onPlay={() => playVoicePreview(voice)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* All Voices */}
              <section>
                <h4 className="text-sm font-medium text-slate-700 mb-3">全部音色</h4>
                <div className="space-y-4">
                  {visibleVoices.map(voice => (
                    <VoiceCard
                      key={`${voice.model}-${voice.voiceId}`}
                      voice={voice}
                      isSelected={selectedVoice === voice.voiceId}
                      isFavorite={voice.isCustom ? Boolean(voice.isFavorite) : favorites.includes(voice.voiceId)}
                      isPlaying={playingVoice === voice.voiceId}
                      onSelect={() => {
                        setSelectedVoice(voice.voiceId);
                        if (onSelectVoice) {
                          onSelectVoice(voice);
                          onClose();
                        }
                      }}
                      onToggleFavorite={() => { void toggleFavorite(voice); }}
                      onPlay={() => playVoicePreview(voice)}
                    />
                  ))}
                </div>
              </section>
            </>
          )}
        </div>

        {/* 常驻底部播放控制器 */}
        <div className="sticky bottom-0 bg-white border-t border-slate-200 p-4">
          <div className="flex items-center gap-4">
            {/* 播放/暂停按钮 */}
            <button
              onClick={() => {
                const currentVoice = voices.find(v => v.voiceId === playingVoice);
                if (currentVoice) {
                  playVoicePreview(currentVoice);
                }
              }}
              disabled={!playingVoice}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                isActuallyPlaying
                  ? 'bg-black text-white hover:bg-black/80'
                  : playingVoice
                  ? 'bg-sky-600 text-white hover:bg-sky-700'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed'
              }`}
            >
              {isActuallyPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" className="ml-1" />}
            </button>

            {/* 当前播放信息 */}
            <div className="flex-1 min-w-0">
              {playingVoice ? (
                <>
                  <p className="text-sm font-medium text-slate-900 truncate">
                    {voices.find(v => v.voiceId === playingVoice)?.name || '播放中...'}
                  </p>
                  <p className="text-xs text-slate-500 truncate">
                    {voices.find(v => v.voiceId === playingVoice)?.description || ''}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm text-slate-500">点击音色头像预览播放</p>
                  <p className="text-xs text-slate-400">播放后可在此控制</p>
                </>
              )}
            </div>

            {/* 音量控制 */}
            <div className="flex items-center gap-2">
              <button onClick={() => audio && setIsMuted(!isMuted)} disabled={!playingVoice} className="p-2 hover:bg-slate-100 rounded-full">
                {isMuted || !audio ? <VolumeX size={18} className="text-slate-400" /> : <Volume2 size={18} className="text-slate-600" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Filter Modal */}
      {showFilterModal && <FilterModal />}
    </div>
  );
}
