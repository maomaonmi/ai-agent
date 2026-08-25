'use client';

import { useEffect, useMemo, useState } from 'react';
import { getArtifact, getArtifactVersion, getConversationOmniContext } from './api';
import ArtifactMessageCard from './ArtifactMessageCard';
import type { Artifact, ArtifactVersion, MessageArtifactLink } from './types';

interface LoadedArtifactLink { link: MessageArtifactLink; artifact: Artifact; version: ArtifactVersion }

export default function ArtifactMessageCards({ links, onOpen, conversationId }: { links: MessageArtifactLink[]; onOpen: (artifact: Artifact, version: ArtifactVersion) => void; conversationId: string }) {
  const [items, setItems] = useState<LoadedArtifactLink[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  // A task gets an initial "generating" link and a later "updated" link when
  // polling reaches a terminal state. Keep one chat card for that artifact;
  // the complete version chain remains available inside the right panel.
  const visibleLinks = useMemo(() => {
    const latestByArtifact = new Map<string, MessageArtifactLink>();
    const passthrough: MessageArtifactLink[] = [];
    links.forEach((link) => {
      if (link.relation === 'updated' || link.relation === 'created') {
        latestByArtifact.set(link.artifactId, link);
      } else {
        passthrough.push(link);
      }
    });
    return [...latestByArtifact.values(), ...passthrough];
  }, [links]);
  useEffect(() => {
    let cancelled = false;
    Promise.all(visibleLinks.map(async (link) => ({
      link,
      artifact: await getArtifact(link.artifactId),
      version: await getArtifactVersion(link.artifactId, link.versionId),
    }))).then((loaded) => { if (!cancelled) setItems(loaded); }).catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [visibleLinks]);
  useEffect(() => { void getConversationOmniContext(conversationId).then((value) => setProjectId(value.projectId)).catch(() => setProjectId(null)); }, [conversationId]);
  if (items.length === 0) return null;
  return <div className="space-y-2">{items.map(({ link, artifact, version }) => <ArtifactMessageCard key={link.id} artifact={artifact} version={version} fromOtherProject={artifact.projectId !== projectId} onOpen={onOpen} />)}</div>;
}
