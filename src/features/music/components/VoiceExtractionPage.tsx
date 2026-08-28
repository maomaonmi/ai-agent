'use client';

import React, { useState, useRef } from 'react';
import { User, Upload, Music2, Mic, Play, Download, Trash2 } from 'lucide-react';
import { type MusicTab } from './MusicSidebar';

interface VoiceExtractionPageProps {
  activeTab: MusicTab;
  onTabChange: (tab: MusicTab) => void;
  onBack: () => void;
}

type ExtractionStatus = 'idle' | 'uploading' | 'processing' | 'success' | 'error';

type ExtractionResult = {
  id: string;
  originalName: string;
  vocalUrl: string;
  instrumentalUrl: string;
  duration: string;
  createdAt: Date;
};

export default function VoiceExtractionPage({ activeTab, onTabChange, onBack }: VoiceExtractionPageProps) {
  const [status, setStatus] = useState<ExtractionStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<ExtractionResult[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatus('uploading');
    setProgress(30);

    try {
      // 模拟上传和处理
      await new Promise(resolve => setTimeout(resolve, 1000));
      setStatus('processing');
      setProgress(60);
      await new Promise(resolve => setTimeout(resolve, 2000));
      setProgress(100);
      
      // 模拟成功
      const newResult: ExtractionResult = {
        id: Date.now().toString(),
        originalName: file.name,
        vocalUrl: 'mock-vocal-url',
        instrumentalUrl: 'mock-instrumental-url',
        duration: '3:45',
        createdAt: new Date(),
      };
      
      setResults(prev => [newResult, ...prev]);
      setStatus('success');
      
      // 重置状态
      setTimeout(() => {
        setStatus('idle');
        setProgress(0);
      }, 1000);
    } catch (error) {
      console.error('提取失败:', error);
      setStatus('error');
    }
  };

  const handlePlay = (url: string, type: 'vocal' | 'instrumental') => {
    console.log('播放', type, url);
  };

  const handleDownload = (url: string, filename: string) => {
    console.log('下载', filename, url);
  };

  const handleDelete = (id: string) => {
    setResults(prev => prev.filter(r => r.id !== id));
  };

  const handleGoToClone = (result: ExtractionResult) => {
    // 这里可以传递提取的人声到克隆页面
    onTabChange('voice-clone');
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-8 py-10">
      {/* 页面标题 */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">人声提取</h1>
        <p className="text-slate-500 dark:text-slate-400">从音乐中分离人声和伴奏，支持多种音频格式</p>
      </div>

      {/* 上传区域 */}
      <div className="mb-8">
        {status === 'idle' && (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-slate-300 hover:border-amber-500 rounded-2xl p-12 text-center cursor-pointer transition-colors dark:border-neutral-600 dark:hover:border-amber-400"
          >
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <Upload size={32} className="text-amber-600 dark:text-amber-400" />
            </div>
            <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-2">
              点击或拖拽上传音频文件
            </h3>
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              支持 MP3、WAV、FLAC 格式，最大 100MB
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>
        )}

        {(status === 'uploading' || status === 'processing' || status === 'success') && (
          <div className="border border-slate-200 dark:border-neutral-700 rounded-2xl p-8">
            <div className="flex items-center gap-4 mb-4">
              {status === 'uploading' && (
                <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                  <Upload size={24} className="text-amber-600 dark:text-amber-400 animate-pulse" />
                </div>
              )}
              {status === 'processing' && (
                <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                  <div className="w-6 h-6 border-3 border-blue-600 dark:border-blue-400 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {status === 'success' && (
                <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
              <div>
                <h3 className="font-medium text-slate-900 dark:text-white">
                  {status === 'uploading' && '上传中...'}
                  {status === 'processing' && '正在分离人声和伴奏...'}
                  {status === 'success' && '提取完成！'}
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {progress}%
                </p>
              </div>
            </div>
            <div className="w-full h-2 bg-slate-200 dark:bg-neutral-700 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  status === 'success' ? 'bg-green-500' : 'bg-amber-500'
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* 历史结果 */}
      {results.length > 0 && (
        <div>
          <h2 className="text-lg font-medium text-slate-700 dark:text-slate-300 mb-4">
            提取历史
          </h2>
          <div className="space-y-4">
            {results.map(result => (
              <div key={result.id} className="border border-slate-200 dark:border-neutral-700 rounded-xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-medium text-slate-900 dark:text-white truncate max-w-md">
                      {result.originalName}
                    </h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {result.duration} · {result.createdAt.toLocaleString()}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDelete(result.id)}
                    className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
                
                {/* 人声轨道 */}
                <div className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-neutral-800 rounded-lg mb-3">
                  <div className="w-10 h-10 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
                    <Mic size={20} className="text-violet-600 dark:text-violet-400" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-medium text-slate-900 dark:text-white">人声轨道</h4>
                  </div>
                  <button
                    onClick={() => handlePlay(result.vocalUrl, 'vocal')}
                    className="p-2 text-slate-500 hover:text-violet-600 dark:text-slate-400 dark:hover:text-violet-400 transition-colors"
                  >
                    <Play size={18} />
                  </button>
                  <button
                    onClick={() => handleDownload(result.vocalUrl, 'vocal_' + result.originalName)}
                    className="p-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
                  >
                    <Download size={18} />
                  </button>
                  <button
                    onClick={() => handleGoToClone(result)}
                    className="px-4 py-2 bg-violet-500 hover:bg-violet-600 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    用于克隆
                  </button>
                </div>
                
                {/* 伴奏轨道 */}
                <div className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-neutral-800 rounded-lg">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                    <Music2 size={20} className="text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-medium text-slate-900 dark:text-white">伴奏轨道</h4>
                  </div>
                  <button
                    onClick={() => handlePlay(result.instrumentalUrl, 'instrumental')}
                    className="p-2 text-slate-500 hover:text-emerald-600 dark:text-slate-400 dark:hover:text-emerald-400 transition-colors"
                  >
                    <Play size={18} />
                  </button>
                  <button
                    onClick={() => handleDownload(result.instrumentalUrl, 'instrumental_' + result.originalName)}
                    className="p-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
                  >
                    <Download size={18} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
