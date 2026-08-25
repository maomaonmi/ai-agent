import type { CapabilityMode, ChatAttachment, TokenUsage } from '../../lib/api';

type Brand<TValue, TBrand extends string> = TValue & { readonly __brand: TBrand };

export type ProjectId = Brand<string, 'ProjectId'>;
export type ConversationId = Brand<string, 'ConversationId'>;
export type MessageId = Brand<string, 'MessageId'>;
export type ArtifactId = Brand<string, 'ArtifactId'>;
export type ArtifactVersionId = Brand<string, 'ArtifactVersionId'>;

export type ArtifactKind =
  | 'image'
  | 'video'
  | 'document'
  | 'thesis'
  | 'research_report'
  | 'presentation';

export type ArtifactStatus =
  | 'draft'
  | 'queued'
  | 'generating'
  | 'ready'
  | 'failed'
  | 'archived';

export interface Project {
  id: ProjectId;
  name: string;
  description?: string;
  summary?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface Artifact {
  id: ArtifactId;
  projectId: ProjectId | null;
  originConversationId: ConversationId | string;
  kind: ArtifactKind;
  title: string;
  summary: string;
  status: ArtifactStatus;
  currentVersionId: ArtifactVersionId;
  metadata: Readonly<Record<string, unknown>>;
  createdAt: string;
  updatedAt: string;
}

export type ArtifactSourceRef =
  | {
      type: 'image_batch';
      imageBatchId: string;
      imageAssetIds: string[];
    }
  | {
      type: 'video_task';
      videoTaskId: string;
    }
  | {
      type: 'writing_document';
      documentId: string;
      revision: number;
    }
  | {
      type: 'research_report';
      reportId: string;
      revision: number;
    }
  | {
      type: 'presentation';
      presentationId: string;
      revision: number;
      runId?: string;
    };

export interface ArtifactVersion {
  id: ArtifactVersionId;
  artifactId: ArtifactId;
  versionNumber: number;
  parentVersionId?: ArtifactVersionId;
  status: Extract<ArtifactStatus, 'draft' | 'generating' | 'ready' | 'failed'>;
  sourceRef: ArtifactSourceRef;
  payload?: unknown;
  summary: string;
  createdByMessageId?: MessageId;
  createdAt: string;
}

export type MessageArtifactRelation = 'created' | 'updated' | 'referenced' | 'derived';

export interface MessageArtifactLink {
  id: string;
  conversationId: ConversationId | string;
  messageId: MessageId;
  artifactId: ArtifactId;
  versionId: ArtifactVersionId;
  relation: MessageArtifactRelation;
  displayOrder: number;
  createdAt: string;
}

export interface ArtifactMention {
  artifactId: ArtifactId;
  versionId?: ArtifactVersionId;
}

export interface ArtifactSummary {
  artifactId: ArtifactId;
  versionId: ArtifactVersionId;
  kind: ArtifactKind;
  title: string;
  summary: string;
  projectId: ProjectId | null;
  projectName?: string;
}

export interface OmniTurnContext {
  preferredCapability: ArtifactKind | 'auto';
  runtimeCapabilities: {
    webSearch: CapabilityMode;
    deepThinking: CapabilityMode;
  };
  activeArtifact?: Required<ArtifactMention>;
  mentionedArtifacts: ArtifactMention[];
  attachments: ChatAttachment[];
  projectSummary?: string;
  candidateArtifactSummaries?: ArtifactSummary[];
}

export type ArtifactPanelState =
  | { status: 'closed' }
  | {
      status: 'opening' | 'open';
      artifactId: ArtifactId;
      versionId: ArtifactVersionId;
      displayMode: 'split' | 'maximized';
    };

export function createClosedArtifactPanelState(): ArtifactPanelState {
  return { status: 'closed' };
}

interface OmniEventBase {
  runId: string;
}

export interface AssistantDeltaEvent extends OmniEventBase {
  type: 'assistant.delta';
  messageId: MessageId;
  delta: string;
}

export interface ArtifactCreatedEvent extends OmniEventBase {
  type: 'artifact.created';
  artifact: Artifact;
  version: ArtifactVersion;
}

export interface ArtifactProgressEvent extends OmniEventBase {
  type: 'artifact.progress';
  artifactId: ArtifactId;
  versionId: ArtifactVersionId;
  progress: number;
  phase: string;
}

export interface ArtifactReadyEvent extends OmniEventBase {
  type: 'artifact.ready';
  artifactId: ArtifactId;
  versionId: ArtifactVersionId;
}

export interface ArtifactFailedEvent extends OmniEventBase {
  type: 'artifact.failed';
  artifactId: ArtifactId;
  versionId: ArtifactVersionId;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface MessageArtifactLinkedEvent extends OmniEventBase {
  type: 'message.artifact_linked';
  link: MessageArtifactLink;
}

export interface OmniRunDoneEvent extends OmniEventBase {
  type: 'run.done';
  usage?: TokenUsage;
}

export type ArtifactEvent =
  | ArtifactCreatedEvent
  | ArtifactProgressEvent
  | ArtifactReadyEvent
  | ArtifactFailedEvent
  | MessageArtifactLinkedEvent;

export type OmniEvent = AssistantDeltaEvent | ArtifactEvent | OmniRunDoneEvent;

const ARTIFACT_EVENT_TYPES = new Set<OmniEvent['type']>([
  'artifact.created',
  'artifact.progress',
  'artifact.ready',
  'artifact.failed',
  'message.artifact_linked',
]);

export function isArtifactEvent(event: OmniEvent): event is ArtifactEvent {
  return ARTIFACT_EVENT_TYPES.has(event.type);
}
