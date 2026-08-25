import type { ChatAttachment, RuntimeSettings } from '../../lib/api';
import type { ArtifactPanelState, ArtifactSummary, OmniTurnContext } from './types';
import type { OmniComposerCapability } from './composerCapabilities';

const CAPABILITY_TO_ARTIFACT_KIND = {
  omni: 'auto',
  ppt: 'presentation',
  music: 'auto',
  writing: 'document',
  image: 'image',
  video: 'video',
  research: 'research_report',
} as const;

export function createOmniTurnContext(input: {
  preferredCapability: OmniComposerCapability;
  runtimeSettings: Pick<RuntimeSettings, 'webSearch' | 'deepThinking'>;
  attachments: ChatAttachment[];
  artifactPanelState: ArtifactPanelState;
  mentionedArtifacts?: ArtifactSummary[];
  projectSummary?: string;
  candidateArtifactSummaries?: ArtifactSummary[];
}): OmniTurnContext {
  const activeArtifact = input.artifactPanelState.status === 'closed'
    ? undefined
    : {
        artifactId: input.artifactPanelState.artifactId,
        versionId: input.artifactPanelState.versionId,
      };

  return {
    preferredCapability: CAPABILITY_TO_ARTIFACT_KIND[input.preferredCapability],
    runtimeCapabilities: {
      webSearch: input.runtimeSettings.webSearch,
      deepThinking: input.runtimeSettings.deepThinking,
    },
    activeArtifact,
    mentionedArtifacts: (input.mentionedArtifacts ?? []).map((artifact) => ({ artifactId: artifact.artifactId, versionId: artifact.versionId })),
    attachments: input.attachments.map((attachment) => ({ ...attachment })),
    projectSummary: input.projectSummary,
    candidateArtifactSummaries: input.candidateArtifactSummaries,
  };
}
