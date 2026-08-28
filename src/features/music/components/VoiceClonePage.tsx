'use client';

import React, { useState, useRef } from 'react';
import { UserPlus, Upload, Mic, Play, Trash2, CheckCircle2 } from 'lucide-react';
import { type MusicTab } from './MusicSidebar';

interface VoiceClonePageProps {
  activeTab: MusicTab;
  onTabChange: (tab: MusicTab) => void;
  onBack: () => void;
}

interface AudioFile {
  id: string;
  name: string;
  duration: string;
  status: 'uploading' | 'success' | 'error';
}

export default function VoiceClonePage({ activeTab, onTabChange, onBack }: VoiceClonePageProps) {
  const [voiceName, setVoiceName] = useState('');
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isCloning, setIsCloning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      const newFile: AudioFile = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        name: file.name,
        duration: '0:00',
        status: 'uploading',
      };
      setAudioFiles(prev => [...prev, newFile]);
      
      // 模拟上传
      setTimeout(() => {
        setAudioFiles(prev => prev.map(f => 
          f.id === newFile.id ? { ...f, status: 'success', duration: '0:30' } : f
        ));
      }, 1500);
    });
  };

  const handleStartRecording = () => {
    setIsRecording(true);
    setRecordingTime(0);
    recordingTimerRef.current = setInterval(() => {
      setRecordingTime(prev => prev + 1);
    }, 1000);
  };

  const handleStopRecording = () => {
    setIsRecording(false);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
    }
    // 添加录音文件
    const newFile: AudioFile = {
      id: Date.now().toString(),
      name: '录音_' + new Date().toLocaleString(),
      duration: formatTime(recordingTime),
      status: 'success',
    };
    setAudioFiles(prev => [...prev, newFile]);
    setRecordingTime(0);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleDeleteFile = (id: string) => {
    setAudioFiles(prev => prev.filter(f => f.id !== id));
  };

  const handlePlayFile = (file: AudioFile) => {
    // 模拟播放
    console.log('播放:', file.name);
  };

  const handleClone = async () => {
    if (!voiceName.trim() || audioFiles.length === 0) return;
    
    setIsCloning(true);
    try {
      // 模拟克隆过程
      await new Promise(resolve => setTimeout(resolve, 3000));
      // 克隆成功后跳转到音色库或合成页面
      onTabChange('voice-library');
    } catch (error) {
      console.error('克隆失败:', error);
    } finally {
      setIsCloning(false);
    }
  };

  const totalDuration = audioFiles.length * 30;
  const isValid = voiceName.trim() && audioFiles.length > 0 && totalDuration >= 30;

  return (
    <div className="mx-auto w-full max-w-4xl px-8 py-10">
      {/* 页面标题 */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">音色克隆</h1>
        <p className="text-slate-500 dark:text-slate-400">上传音频或录制声音，克隆属于你的专属音色</p>
      </div>

      {/* 音色名称 */}
      <div className="mb-8">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          音色名称
        </label>
        <input
          type="text"
          value={voiceName}
          onChange={(e) => setVoiceName(e.target.value)}
          placeholder="为你的音色起个名字..."
          className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:bg-neutral-800 dark:border-neutral-700 dark:text-white"
        />
      </div>

      {/* 上传区域 */}
      <div className="mb-8">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          音频素材
          <span className="text-slate-400 ml-2">（至少30秒，支持WAV、MP3格式）</span>
        </label>
        
        {/* 上传按钮 */}
        <div className="flex gap-4 mb-6">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-6 py-3 border-2 border-dashed border-slate-300 hover:border-emerald-500 rounded-xl text-slate-600 hover:text-emerald-600 transition-colors dark:border-neutral-600 dark:text-slate-400 dark:hover:border-emerald-400 dark:hover:text-emerald-400"
          >
            <Upload size={20} />
            <span>上传音频</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
          
          <button
            onClick={isRecording ? handleStopRecording : handleStartRecording}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl transition-colors ${
              isRecording
                ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse'
                : 'border-2 border-slate-300 hover:border-red-500 text-slate-600 hover:text-red-600 dark:border-neutral-600 dark:text-slate-400'
            }`}
          >
            <Mic size={20} />
            <span>{isRecording ? '停止录音 (' + formatTime(recordingTime) + ')' : '开始录制'}</span>
          </button>
        </div>

        {/* 文件列表 */}
        {audioFiles.length > 0 && (
          <div className="space-y-3">
            {audioFiles.map(file => (
              <div key={file.id} className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-neutral-800 rounded-xl">
                {file.status === 'uploading' ? (
                  <div className="w-10 h-10 rounded-full border-2 border-slate-300 border-t-emerald-500 animate-spin" />
                ) : file.status === 'success' ? (
                  <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                    <CheckCircle2 size={20} className="text-emerald-600 dark:text-emerald-400" />
                  </div>
                ) : (
                  <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                    <Trash2 size={20} className="text-red-600 dark:text-red-400" />
                  </div>
                )}
                <div className="flex-1">
                  <h3 className="font-medium text-slate-900 dark:text-white truncate">{file.name}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{file.duration}</p>
                </div>
                {file.status === 'success' && (
                  <button
                    onClick={() => handlePlayFile(file)}
                    className="p-2 text-slate-500 hover:text-emerald-600 dark:text-slate-400 dark:hover:text-emerald-400 transition-colors"
                  >
                    <Play size={18} />
                  </button>
                )}
                <button
                  onClick={() => handleDeleteFile(file.id)}
                  className="p-2 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 transition-colors"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 时长统计 */}
        <div className="mt-4 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <div className={`w-2 h-2 rounded-full ${totalDuration >= 30 ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          <span>已收集 {totalDuration} 秒 {totalDuration >= 30 ? '✓' : '(还需 ' + (30 - totalDuration) + ' 秒)'}</span>
        </div>
      </div>

      {/* 克隆按钮 */}
      <div className="flex items-center justify-end">
        <button
          onClick={handleClone}
          disabled={!isValid || isCloning}
          className="flex items-center gap-2 px-8 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-full font-medium hover:from-emerald-600 hover:to-teal-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-emerald-500/30"
        >
          {isCloning ? (
            <>
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>克隆中...</span>
            </>
          ) : (
            <>
              <UserPlus size={18} />
              <span>开始克隆</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
