"use client";

import Image from "next/image";
import { Eye, LockKeyhole, Play, Sparkles } from "lucide-react";

import type { PptTemplate } from "../api";


interface TemplateCardProps {
  template: PptTemplate;
  cover: string;
  onPreview: (template: PptTemplate) => void;
  onUse: (template: PptTemplate) => void;
}


export default function TemplateCard({ template, cover, onPreview, onUse }: TemplateCardProps) {
  return (
    <article className="group relative overflow-hidden rounded-[22px] border border-slate-200/90 bg-white shadow-[0_12px_36px_rgba(15,23,42,0.06)] transition duration-300 hover:-translate-y-1 hover:border-slate-300 hover:shadow-[0_20px_55px_rgba(15,23,42,0.12)] focus-within:-translate-y-1 focus-within:border-violet-300">
      <div className="relative aspect-[16/9] overflow-hidden bg-slate-950">
        <Image
          src={cover}
          alt={`${template.name} 模板封面`}
          fill
          sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
          className="object-cover transition duration-500 group-hover:scale-[1.025]"
        />
        <div className="absolute inset-0 bg-slate-950/0 transition group-hover:bg-slate-950/50 group-focus-within:bg-slate-950/50" />
        <div className="absolute inset-x-4 bottom-4 flex translate-y-3 items-center justify-center gap-2 opacity-0 transition duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 max-md:translate-y-0 max-md:opacity-100">
          <button
            type="button"
            onClick={() => onPreview(template)}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-white/30 bg-white/95 px-4 text-sm font-semibold text-slate-900 shadow-lg outline-none transition hover:bg-white focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            <Eye size={16} />
            预览
          </button>
          <button
            type="button"
            onClick={() => onUse(template)}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-violet-600 px-4 text-sm font-semibold text-white shadow-lg outline-none transition hover:bg-violet-500 focus-visible:ring-2 focus-visible:ring-violet-300"
          >
            <Play size={15} fill="currentColor" />
            使用此模板
          </button>
        </div>
        <div className="absolute left-3 top-3 flex items-center gap-1.5">
          {template.isPrivate ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-slate-950/55 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-md">
              <LockKeyhole size={11} /> 私有
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-slate-800 backdrop-blur-md">
              <Sparkles size={11} className="text-violet-600" /> 精选
            </span>
          )}
        </div>
      </div>
      <div className="flex items-start justify-between gap-4 px-4 py-4">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold tracking-tight text-slate-950">{template.name}</h3>
          <p className="mt-1 line-clamp-1 text-xs leading-5 text-slate-500">{template.description || "智能版式与完整主题"}</p>
        </div>
        <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500">
          {template.pageCount || 12} 页
        </span>
      </div>
    </article>
  );
}
