import type { SessionSummary } from '../../lib/api';
import type { ProjectWithConversations } from './api';

export interface ProjectConversationGroup {
  project: ProjectWithConversations;
  conversations: SessionSummary[];
}

export interface ProjectConversationTree {
  groups: ProjectConversationGroup[];
  unassigned: SessionSummary[];
  projectByConversationId: Map<string, ProjectWithConversations>;
}

export function buildProjectConversationTree(
  projects: ProjectWithConversations[],
  sessions: SessionSummary[],
): ProjectConversationTree {
  const sessionById = new Map(sessions.map((session) => [session.session_id, session]));
  const projectByConversationId = new Map<string, ProjectWithConversations>();
  const groups = projects.map((project) => {
    const conversations = project.conversationIds.flatMap((conversationId) => {
      const session = sessionById.get(conversationId);
      if (!session) return [];
      projectByConversationId.set(conversationId, project);
      return [session];
    });
    return { project, conversations };
  });
  const unassigned = sessions.filter(
    (session) => !projectByConversationId.has(session.session_id),
  );
  return { groups, unassigned, projectByConversationId };
}
