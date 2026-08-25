import type { ArtifactId, ArtifactPanelState, ArtifactVersionId } from './types';

export type ArtifactPanelAction =
  | { type: 'open'; artifactId: ArtifactId; versionId: ArtifactVersionId }
  | { type: 'loaded' }
  | { type: 'setDisplayMode'; displayMode: 'split' | 'maximized' }
  | { type: 'close' };

export function artifactPanelReducer(
  state: ArtifactPanelState,
  action: ArtifactPanelAction,
): ArtifactPanelState {
  switch (action.type) {
    case 'open':
      return {
        status: 'opening',
        artifactId: action.artifactId,
        versionId: action.versionId,
        displayMode: state.status === 'closed' ? 'split' : state.displayMode,
      };
    case 'loaded':
      return state.status === 'closed' ? state : { ...state, status: 'open' };
    case 'setDisplayMode':
      return state.status === 'closed' ? state : { ...state, displayMode: action.displayMode };
    case 'close':
      return { status: 'closed' };
  }
}
