'use client';

import { useParams, useRouter } from 'next/navigation';
import VisualWorkflowWorkspace from '../../features/visual-workflow/VisualWorkflowWorkspace';

export default function VisualWorkflowCanvasRoute() {
  const router = useRouter();
  const params = useParams<{ workflowId: string }>();
  const workflowId = typeof params.workflowId === 'string' ? params.workflowId : '';
  return (
    <main className="h-screen w-screen overflow-hidden bg-slate-50 dark:bg-slate-950">
      <VisualWorkflowWorkspace workflowId={workflowId} onBack={() => router.push('/visual-workflow')} />
    </main>
  );
}
