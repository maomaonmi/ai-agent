import type { Metadata } from "next";

import PptWorkspace from "../../../../features/ppt/workspace/PptWorkspace";


export const metadata: Metadata = {
  title: "AI PPT 工作台",
  description: "查看 AI 的规划与素材收集过程，并实时编辑完整演示文稿。",
};


export default async function PptWorkspacePage({ params }: { params: Promise<{ presentationId: string }> }) {
  const { presentationId } = await params;
  return <PptWorkspace presentationId={presentationId} />;
}
