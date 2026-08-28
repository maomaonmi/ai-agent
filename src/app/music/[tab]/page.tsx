import type { Metadata } from 'next';
import MusicWorkshopTab from '../../../features/music/MusicWorkshopTab';

export const metadata: Metadata = {
  title: '音乐创意工坊',
  description: '妙响，灵感打磨成歌',
};

interface MusicTabPageProps {
  params: Promise<{ tab: string }>;
}

export default async function MusicTabPage({ params }: MusicTabPageProps) {
  const { tab } = await params;
  return <MusicWorkshopTab initialTab={tab} />;
}
