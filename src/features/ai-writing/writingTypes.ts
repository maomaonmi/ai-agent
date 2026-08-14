export type WritingSceneId =
  | 'general'
  | 'essay'
  | 'novel'
  | 'thesis'
  | 'work-summary'
  | 'reflection'
  | 'internship'
  | 'application'
  | 'report'
  | 'thought'
  | 'teaching'
  | 'rewrite'
  | 'scheme'
  | 'business-plan'
  | 'blessing'
  | 'friend-circle'
  | 'little-red-book'
  | 'book-review'
  | 'speech'
  | 'poem'
  | 'emotional-reply'
  | 'self-introduction'
  | 'daily-report'
  | 'survey';

export interface WritingOption { value: string; label: string }
export interface WritingFieldDefinition {
  id: string;
  label: string;
  options: WritingOption[];
  defaultValue: string;
}
export interface WritingSceneDefinition {
  id: WritingSceneId;
  label: string;
  description: string;
  placeholder: string;
  fields: WritingFieldDefinition[];
  routingProfile: WritingCapability;
}
export type WritingCapability = 'general-writing' | 'character-writing' | 'deep-research' | 'long-context';
export interface WritingDraft {
  scene: WritingSceneId;
  instruction: string;
  valuesByScene: Record<WritingSceneId, Record<string, string>>;
}
export interface CompiledWritingPrompt {
  systemPrompt: string;
  userPrompt: string;
  constraints: string[];
  routingHints: { capability: WritingCapability; prefersOutlineFirst: boolean; requestedLength?: number };
}
