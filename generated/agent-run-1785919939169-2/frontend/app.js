const API_BASE_URL = 'http://localhost:8000';

const MOCK_TRACKS = [
  { id: 1, title: "星空漫步", artist: "夜行者", album: "城市夜曲", duration: 245, cover: "https://picsum.photos/seed/track1/300/300", plays: 15234, likes: 892, genre: "电子" },
  { id: 2, title: "霓虹之夜", artist: "电子梦想家", album: "未来之声", duration: 198, cover: "https://picsum.photos/seed/track2/300/300", plays: 9876, likes: 654, genre: "合成波" },
  { id: 3, title: "深海漫游", artist: "蓝色星球", album: "海洋交响曲", duration: 312, cover: "https://picsum.photos/seed/track3/300/300", plays: 23456, likes: 1234, genre: "氛围" },
  { id: 4, title: "城市脉搏", artist: "节拍机器", album: "都市律动", duration: 187, cover: "https://picsum.photos/seed/track4/300/300", plays: 8765, likes: 432, genre: "嘻哈" },
  { id: 5, title: "极光幻想", artist: "北极光", album: "冰原回响", duration: 276, cover: "https://picsum.photos/seed/track5/300/300", plays: 12345, likes: 789, genre: "新世纪" },
  { id: 6, title: "午夜列车", artist: "旅途者", album: "穿越时空", duration: 223, cover: "https://picsum.photos/seed/track6/300/300", plays: 6543, likes: 321, genre: "摇滚" }
];

const state = {
  tracks: [],
  currentTrack: null,
  isPlaying: false,
  progress: 0,
  volume: 0.7,
  audioContext: null,
  analyser: null,
  animationId: null
};

const elements = {
  particles: document.getElementById('particles'),
  visualizer: document.getElementById('visualizer'),
  tracksGrid: document.getElementById('tracksGrid'),
  trackCover: document.getElementById('trackCover'),
  trackTitle: document.getElementById('trackTitle'),
  trackArtist: document.getElementById('trackArtist'),
  playBtn: document.getElementById('playBtn'),
  prevBtn: document.getElementById('prevBtn'),
  nextBtn: document.getElementById('nextBtn'),
  progressBar: document.getElementById('progressBar'),
  progressFill: document.getElementById('progressFill'),
  progressHandle: document.getElementById('progressHandle'),
  currentTime: document.getElementById('currentTime'),
  totalTime: document.getElementById('totalTime'),
  volumeBar: document.getElementById('volumeBar'),
  volumeFill: document.getElementById('volumeFill'),
  audioEq: document.querySelector('.audio-eq')
};

function initParticles() {
  const count = 50;
  for (let i = 0; i < count; i++) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    particle.style.left = Math.random() * 100 + '%';
    particle.style.top = Math.random() * 100 + '%';
    particle.style.animationDelay = Math.random() * 8 + 's';
    particle.style.animationDuration = (5 + Math.random() * 5) + 's';
    const hue = Math.random() * 60 + 250;
    particle.style.background = `hsla(${hue}, 80%, 60%, ${0.3 + Math.random() * 0.5})`;
    elements.particles.appendChild(particle);
  }
}

function initVisualizer() {
  const canvas = elements.visualizer;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = 300 * dpr;
  canvas.height = 300 * dpr;
  ctx.scale(dpr, dpr);
  drawIdleVisualizer(ctx, 300, 300);
}

function drawIdleVisualizer(ctx, width, height) {
  ctx.clearRect(0, 0, width, height);
  const centerX = width / 2;
  const centerY = height / 2;
  const bars = 60;
  const baseRadius = 80;
  for (let i = 0; i < bars; i++) {
    const angle = (i / bars) * Math.PI * 2;
    const barHeight = 20 + Math.sin(Date.now() * 0.002 + i * 0.2) * 15;
    const innerRadius = baseRadius;
    const outerRadius = baseRadius + barHeight;
    const x1 = centerX + Math.cos(angle) * innerRadius;
    const y1 = centerY + Math.sin(angle) * innerRadius;
    const x2 = centerX + Math.cos(angle) * outerRadius;
    const y2 = centerY + Math.sin(angle) * outerRadius;
    const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
    gradient.addColorStop(0, 'rgba(124, 58, 237, 0.8)');
    gradient.addColorStop(1, 'rgba(236, 72, 153, 0.8)');
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  if (!state.isPlaying) {
    requestAnimationFrame(() => drawIdleVisualizer(ctx, width, height));
  }
}

function drawActiveVisualizer(analyser, ctx, width, height) {
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  analyser.getByteFrequencyData(dataArray);
  ctx.clearRect(0, 0, width, height);
  const centerX = width / 2;
  const centerY = height / 2;
  const bars = 60;
  const baseRadius = 80;
  for (let i = 0; i < bars; i++) {
    const dataIndex = Math.floor(i * bufferLength / bars);
    const value = dataArray[dataIndex] || 0;
    const barHeight = 20 + (value / 255) * 60;
    const angle = (i / bars) * Math.PI * 2;
    const innerRadius = baseRadius;
    const outerRadius = baseRadius + barHeight;
    const x1 = centerX + Math.cos(angle) * innerRadius;
    const y1 = centerY + Math.sin(angle) * innerRadius;
    const x2 = centerX + Math.cos(angle) * outerRadius;
    const y2 = centerY + Math.sin(angle) * outerRadius;
    const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
    const hue = 260 + (value / 255) * 60;
    gradient.addColorStop(0, `hsla(${hue}, 80%, 50%, 0.9)`);
    gradient.addColorStop(1, `hsla(${hue + 30}, 80%, 60%, 0.9)`);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  if (state.isPlaying) {
    state.animationId = requestAnimationFrame(() => 
      drawActiveVisualizer(analyser, ctx, width, height)
    );
  }
}

async function fetchTracks() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/tracks`);
    if (!response.ok) throw new Error('Network response was not ok');
    const data = await response.json();
    state.tracks = data;
    renderTracks();
  } catch (error) {
    console.warn('Backend unavailable, using mock data:', error.message);
    state.tracks = MOCK_TRACKS;
    renderTracks();
  }
}

function renderTracks() {
  elements.tracksGrid.innerHTML = state.tracks.map(track => `
    <div class="track-card ${state.currentTrack?.id === track.id ? 'active' : ''}" 
         data-id="${track.id}">
      <img src="${track.cover}" alt="${track.title}" class="track-card-cover">
      <div class="track-card-info">
        <div class="track-card-title">${track.title}</div>
        <div class="track-card-artist">${track.artist}</div>
      </div>
      <div class="track-card-duration">${formatTime(track.duration)}</div>
      <div class="track-card-play">
        <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
      </div>
    </div>
  `).join('');
  document.querySelectorAll('.track-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = parseInt(card.dataset.id);
      const track = state.tracks.find(t => t.id === id);
      if (track) {
        selectTrack(track);
      }
    });
  });
}

function selectTrack(track) {
  state.currentTrack = track;
  state.progress = 0;
  state.isPlaying = true;
  updateCurrentTrack();
  updatePlayButton();
  startVisualizer();
  renderTracks();
  recordPlay(track.id);
}

function updateCurrentTrack() {
  if (!state.currentTrack) return;
  elements.trackCover.src = state.currentTrack.cover;
  elements.trackTitle.textContent = state.currentTrack.title;
  elements.trackArtist.textContent = state.currentTrack.artist;
  elements.totalTime.textContent = formatTime(state.currentTrack.duration);
}

function updatePlayButton() {
  elements.playBtn.classList.toggle('playing', state.isPlaying);
  elements.audioEq.classList.toggle('paused', !state.isPlaying);
}

function startVisualizer() {
  if (state.animationId) {
    cancelAnimationFrame(state.animationId);
  }
  const canvas = elements.visualizer;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = 300 * dpr;
  canvas.height = 300 * dpr;
  ctx.scale(dpr, dpr);
  const mockAnalyser = {
    frequencyBinCount: 256,
    getByteFrequencyData: (arr) => {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.sin(Date.now() * 0.01 + i * 0.1) * 50 + 
                 Math.sin(Date.now() * 0.005 + i * 0.05) * 50 +
                 Math.random() * 50;
      }
    }
  };
  drawActiveVisualizer(mockAnalyser, ctx, 300, 300);
}

function togglePlay() {
  if (!state.currentTrack) {
    if (state.tracks.length > 0) {
      selectTrack(state.tracks[0]);
    }
    return;
  }
  state.isPlaying = !state.isPlaying;
  updatePlayButton();
  if (state.isPlaying) {
    startVisualizer();
  } else {
    if (state.animationId) {
      cancelAnimationFrame(state.animationId);
    }
    const canvas = elements.visualizer;
    const ctx = canvas.getContext('2d');
    drawIdleVisualizer(ctx, 300, 300);
  }
}

function prevTrack() {
  if (!state.currentTrack) return;
  const currentIndex = state.tracks.findIndex(t => t.id === state.currentTrack.id);
  const prevIndex = (currentIndex - 1 + state.tracks.length) % state.tracks.length;
  selectTrack(state.tracks[prevIndex]);
}

function nextTrack() {
  if (!state.currentTrack) return;
  const currentIndex = state.tracks.findIndex(t => t.id === state.currentTrack.id);
  const nextIndex = (currentIndex + 1) % state.tracks.length;
  selectTrack(state.tracks[nextIndex]);
}

function updateProgress() {
  if (!state.currentTrack || !state.isPlaying) return;
  state.progress += 0.1;
  if (state.progress >= state.currentTrack.duration) {
    nextTrack();
    return;
  }
  const percent = (state.progress / state.currentTrack.duration) * 100;
  elements.progressFill.style.width = percent + '%';
  elements.progressHandle.style.left = percent + '%';
  elements.currentTime.textContent = formatTime(state.progress);
}

function seekProgress(e) {
  if (!state.currentTrack) return;
  const rect = elements.progressBar.getBoundingClientRect();
  const percent = (e.clientX - rect.left) / rect.width;
  state.progress = percent * state.currentTrack.duration;
  elements.progressFill.style.width = (percent * 100) + '%';
  elements.progressHandle.style.left = (percent * 100) + '%';
  elements.currentTime.textContent = formatTime(state.progress);
}

function setVolume(e) {
  const rect = elements.volumeBar.getBoundingClientRect();
  const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  state.volume = percent;
  elements.volumeFill.style.width = (percent * 100) + '%';
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

async function recordPlay(trackId) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/tracks/${trackId}/play`, { method: 'POST' });
    if (!response.ok) throw new Error('Network response was not ok');
    const data = await response.json();
    console.log('Play recorded:', data);
  } catch (error) {
    console.error('Failed to record play (backend may not be running):', error);
    const track = state.tracks.find(t => t.id === trackId);
    if (track) {
      track.plays = (track.plays || 0) + 1;
      console.log('Mock play recorded locally, total plays:', track.plays);
    }
  }
}

function init() {
  initParticles();
  initVisualizer();
  fetchTracks();
  elements.playBtn.addEventListener('click', togglePlay);
  elements.prevBtn.addEventListener('click', prevTrack);
  elements.nextBtn.addEventListener('click', nextTrack);
  elements.progressBar.addEventListener('click', seekProgress);
  elements.volumeBar.addEventListener('click', setVolume);
  setInterval(updateProgress, 100);
}

document.addEventListener('DOMContentLoaded', init);
