import { WRITING_SCENE_MAP } from '../writingScenes';
import { CompiledWritingPrompt, WritingSceneId } from '../writingTypes';

export function compileWritingPrompt(sceneId: WritingSceneId, instruction: string, parameters: Record<string, string>): CompiledWritingPrompt {
  const scene = WRITING_SCENE_MAP[sceneId];
  const lengthValue = parameters.length?.match(/\d+/)?.[0];
  return {
    systemPrompt: `你是一名专业中文写作助手。当前任务场景：${scene.label}。`,
    userPrompt: instruction.trim(),
    constraints: scene.fields.map((item) => `${item.label}：${parameters[item.id] ?? item.defaultValue}`),
    routingHints: { capability: scene.routingProfile, prefersOutlineFirst: Number(lengthValue ?? 0) >= 3000 || sceneId === 'thesis', requestedLength: lengthValue ? Number(lengthValue) : undefined },
  };
}
