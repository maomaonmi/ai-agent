import { NextResponse } from "next/server";

import { exportPptxBlob, type PptxDocument } from "../../../../features/ppt/export/pptxExporter";


export const runtime = "nodejs";


export async function POST(request: Request) {
  try {
    const document = await request.json() as PptxDocument;
    const blob = await exportPptxBlob(document);
    const buffer = Buffer.from(await blob.arrayBuffer());
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "content-disposition": 'attachment; filename="AI-PPT.pptx"',
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "PPTX 导出失败" }, { status: 400 });
  }
}
