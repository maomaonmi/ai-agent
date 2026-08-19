import { create } from 'zustand';
import type { Edge, Node } from '@xyflow/react';
import type { VisualWorkflowDocument, VisualWorkflowNodeDefinition, VisualWorkflowViewport } from '../../lib/api';
import { documentToFlow, flowToDocument, type WorkflowCanvasEdge, type WorkflowCanvasNode, type WorkflowCanvasNodeData } from './types';

type GraphSnapshot = { nodes: WorkflowCanvasNode[]; edges: WorkflowCanvasEdge[] };

interface VisualWorkflowState extends GraphSnapshot {
  workflowId: string;
  revision: number;
  name: string;
  viewport: VisualWorkflowViewport;
  definitions: VisualWorkflowNodeDefinition[];
  selectedNodeId: string | null;
  dirty: boolean;
  undoStack: GraphSnapshot[];
  redoStack: GraphSnapshot[];
  hydrate: (document: VisualWorkflowDocument, definitions?: VisualWorkflowNodeDefinition[]) => void;
  setDefinitions: (definitions: VisualWorkflowNodeDefinition[]) => void;
  setName: (name: string) => void;
  setGraph: (nodes: Node[], edges: Edge[], options?: { recordHistory?: boolean; markDirty?: boolean }) => void;
  updateNodeConfig: (nodeId: string, patch: Record<string, unknown>) => void;
  setViewport: (viewport: VisualWorkflowViewport) => void;
  setNodeStatuses: (statuses: Record<string, WorkflowCanvasNodeData['status']>, artifacts?: Record<string, Array<Record<string, unknown>>>) => void;
  selectNode: (nodeId: string | null) => void;
  undo: () => void;
  redo: () => void;
  markSaved: (revision: number) => void;
  toDocument: () => VisualWorkflowDocument;
}

const cloneGraph = (snapshot: GraphSnapshot): GraphSnapshot => ({
  nodes: snapshot.nodes.map((node) => ({ ...node, position: { ...node.position }, data: { ...node.data, config: { ...node.data.config } } })),
  edges: snapshot.edges.map((edge) => ({ ...edge })),
});

export const useVisualWorkflowStore = create<VisualWorkflowState>((set, get) => ({
  nodes: [],
  edges: [],
  workflowId: '',
  revision: 1,
  name: '未命名工作流',
  viewport: { x: 0, y: 0, zoom: 1 },
  definitions: [],
  selectedNodeId: null,
  dirty: false,
  undoStack: [],
  redoStack: [],
  hydrate: (document, definitions = []) => {
    const graph = documentToFlow(document);
    set({
      ...graph,
      workflowId: document.workflowId,
      revision: Math.max(document.revision, 1),
      name: document.name,
      viewport: document.viewport,
      definitions,
      selectedNodeId: null,
      dirty: false,
      undoStack: [],
      redoStack: [],
    });
  },
  setDefinitions: (definitions) => set({ definitions }),
  setName: (name) => set({ name, dirty: true }),
  setGraph: (nodes, edges, options = {}) => set((state) => {
    const next = { nodes: nodes as WorkflowCanvasNode[], edges: edges as WorkflowCanvasEdge[] };
    const previous = cloneGraph(state);
    const undoStack = options.recordHistory === false ? state.undoStack : [...state.undoStack, previous].slice(-100);
    return { ...next, undoStack, redoStack: [], dirty: options.markDirty === false ? state.dirty : true };
  }),
  updateNodeConfig: (nodeId, patch) => set((state) => ({
    nodes: state.nodes.map((node) => node.id === nodeId ? {
      ...node,
      data: { ...node.data, ...(typeof patch.label === 'string' ? { label: patch.label } : {}), config: { ...node.data.config, ...Object.fromEntries(Object.entries(patch).filter(([key]) => key !== 'label')) } },
    } : node),
    dirty: true,
  })),
  setViewport: (viewport) => set({ viewport, dirty: true }),
  setNodeStatuses: (statuses, artifacts) => set((state) => ({
    nodes: state.nodes.map((node) => {
      if (!statuses[node.id]) return node;
      const nextArtifacts = artifacts && Object.prototype.hasOwnProperty.call(artifacts, node.id)
        ? artifacts[node.id]
        : node.data.runtimeArtifacts;
      return { ...node, data: { ...node.data, status: statuses[node.id], runtimeArtifacts: nextArtifacts } };
    }),
  })),
  selectNode: (selectedNodeId) => set({ selectedNodeId }),
  undo: () => set((state) => {
    const previous = state.undoStack[state.undoStack.length - 1];
    if (!previous) return state;
    return {
      ...cloneGraph(previous),
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, cloneGraph(state)].slice(-100),
      dirty: true,
    };
  }),
  redo: () => set((state) => {
    const next = state.redoStack[state.redoStack.length - 1];
    if (!next) return state;
    return {
      ...cloneGraph(next),
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, cloneGraph(state)].slice(-100),
      dirty: true,
    };
  }),
  markSaved: (revision) => set({ revision, dirty: false }),
  toDocument: () => {
    const state = get();
    return flowToDocument({
      workflowId: state.workflowId,
      revision: state.revision,
      name: state.name,
      nodes: state.nodes,
      edges: state.edges,
      viewport: state.viewport,
    });
  },
}));
