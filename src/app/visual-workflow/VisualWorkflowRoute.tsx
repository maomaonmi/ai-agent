'use client';

import { useRouter } from 'next/navigation';
import VisualWorkflowWorkspace from '../../features/visual-workflow/VisualWorkflowWorkspace';

export default function VisualWorkflowRoute() {
  const router = useRouter();
  return (
    <main className="h-screen w-screen overflow-hidden bg-slate-50 dark:bg-slate-950">
      <VisualWorkflowWorkspace onBack={() => router.push('/')} />
    </main>
  );
}
