import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '音乐创意工坊',
  description: '妙响，灵感打磨成歌',
};

// Why: 根路由重定向到 compose tab，确保刷新后保持在正确页面
export default function MusicPage() {
  redirect('/music/compose');
}
