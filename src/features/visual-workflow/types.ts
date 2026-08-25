import type { Edge, Node } from '@xyflow/react';
import type {
  VisualWorkflowDocument,
  VisualWorkflowEdge,
  VisualWorkflowNode,
  VisualWorkflowNodeDefinition,
  VisualWorkflowPosition,
  VisualWorkflowViewport,
} from '../../lib/api';

export type WorkflowCanvasNodeData = {
  label: string;
  kind: string;
  definition?: VisualWorkflowNodeDefinition;
  config: Record<string, unknown>;
  status?: 'idle' | 'running' | 'success' | 'error';
  /** Latest run artifacts projected into the card; successful outputs are also copied to config.outputArtifacts on save. */
  runtimeArtifacts?: Array<Record<string, unknown>>;
};

export type WorkflowCanvasNode = Node<WorkflowCanvasNodeData>;
export type WorkflowCanvasEdge = Edge;

export function documentToFlow(document: VisualWorkflowDocument): {
  nodes: WorkflowCanvasNode[];
  edges: WorkflowCanvasEdge[];
} {
  return {
    nodes: document.nodes.map((node) => ({
      id: node.id,
      type: 'workflow',
      position: node.position,
      data: {
        label: node.label || node.kind,
        kind: node.kind,
        config: node.config,
        status: 'idle',
        runtimeArtifacts: Array.isArray(node.config.outputArtifacts)
          ? node.config.outputArtifacts as Array<Record<string, unknown>>
          : undefined,
      },
    })),
    edges: document.edges.map((edge) => ({
      id: edge.id,
      source: edge.sourceNodeId,
      sourceHandle: edge.sourcePortId,
      target: edge.targetNodeId,
      targetHandle: edge.targetPortId,
      type: 'smoothstep',
      animated: false,
    })),
  };
}

export function flowToDocument(input: {
  workflowId: string;
  revision: number;
  name: string;
  nodes: WorkflowCanvasNode[];
  edges: WorkflowCanvasEdge[];
  viewport: VisualWorkflowViewport;
}): VisualWorkflowDocument {
  return {
    schemaVersion: 1,
    workflowId: input.workflowId,
    revision: input.revision,
    name: input.name,
    nodes: input.nodes.map((node): VisualWorkflowNode => ({
      id: node.id,
      kind: node.data.kind,
      definitionVersion: node.data.definition?.version ?? 1,
      position: { x: node.position.x, y: node.position.y } satisfies VisualWorkflowPosition,
      label: node.data.label,
      config: node.data.config,
      isDisabled: false,
    })),
    edges: input.edges.map((edge): VisualWorkflowEdge => ({
      id: edge.id,
      sourceNodeId: edge.source,
      sourcePortId: edge.sourceHandle ?? 'out',
      targetNodeId: edge.target,
      targetPortId: edge.targetHandle ?? 'in',
    })),
    viewport: input.viewport,
  };
}

export function displayLabel(kind: string): string {
  const labels: Record<string, string> = {
    prompt_input: '提示词输入',
    image_input: '图片输入',
    video_input: '视频输入',
    audio_url_input: '音频 URL',
    vision_to_prompt: '视觉转提示词',
    prompt_template: '提示词模板',
    image_generate: '图片生成',
    image_edit: '图片编辑',
    image_compare: '图片对比',
    text_to_video: '文生视频',
    image_to_video: '图生视频',
    start_end_video: '首尾帧视频',
    reference_to_video: '参考视频生成',
    preview_output: '预览输出',
    gallery_output: '画廊输出',
  };
  return labels[kind] ?? kind;
}
