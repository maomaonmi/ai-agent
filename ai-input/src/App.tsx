import { useState } from 'react';
import { InputBar } from './components/InputBar';
import { PPTView } from './components/views/PPTView';
import { VideoView } from './components/views/VideoView';
import { ImageView } from './components/views/ImageView';
import { ResearchView } from './components/views/ResearchView';
import type { ModeType } from './types';
import './App.css';
import './components/views.css';

function App() {
  const [mode, setMode] = useState<ModeType>('chat');

  const goChat = () => setMode('chat');

  return (
    <div className="app">
      <div className="app__bg" aria-hidden />

      <main className="app__main">
        {mode === 'chat' ? (
          <div className="app__welcome">
            <div className="app__welcome-icon" aria-hidden>
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <defs>
                  <linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#7c7cff" />
                    <stop offset="100%" stopColor="#b48cf0" />
                  </linearGradient>
                </defs>
                <path
                  d="M24 4l4.5 12.5L41 18l-10 8 3 13-10-7-10 7 3-13-10-8 12.5-1.5L24 4z"
                  fill="url(#g1)"
                />
              </svg>
            </div>
            <h1 className="app__welcome-title">有什么我可以帮你的吗？</h1>
            <p className="app__welcome-sub">
              选择下方任一模式开始创作，或直接输入你的问题
            </p>
          </div>
        ) : mode === 'ppt' ? (
          <PPTView onBack={goChat} />
        ) : mode === 'video' ? (
          <VideoView onBack={goChat} />
        ) : mode === 'image' ? (
          <ImageView onBack={goChat} />
        ) : (
          <ResearchView onBack={goChat} />
        )}
      </main>

      {mode === 'chat' && (
        <footer className="app__footer">
          <div className="app__footer-inner">
            <InputBar
              mode="chat"
              placeholder="发消息或按住空格说话..."
              currentMode={mode}
              onModeChange={setMode}
            />
          </div>
        </footer>
      )}
    </div>
  );
}

export default App;
