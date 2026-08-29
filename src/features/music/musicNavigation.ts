export function musicComposeSessionUrl(sessionId: string): string {
  return `/music/compose?session=${encodeURIComponent(sessionId)}`;
}

export function musicCreationDraftUrl(sessionId: string): string {
  return `/music/music-creation?lyricsSession=${encodeURIComponent(sessionId)}`;
}
