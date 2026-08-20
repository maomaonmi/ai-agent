import type { Metadata } from "next";

import PptTemplateMarket from "../../features/ppt/market/PptTemplateMarket";


export const metadata: Metadata = {
  title: "AI PPT · 模板与创作",
  description: "选择模板、上传私有 PPT，并由 AI Agent 完成调研、配图与逐页搭建。",
};


export default function PptPage() {
  return <PptTemplateMarket />;
}
