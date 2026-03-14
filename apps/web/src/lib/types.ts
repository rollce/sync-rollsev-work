export type WorkspaceRole = 'OWNER' | 'EDITOR' | 'VIEWER';

export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
  boards: Array<{
    id: string;
    title: string;
    updatedAt: string;
  }>;
};

export type BoardState = {
  board: {
    id: string;
    workspaceId: string;
    title: string;
    description: string | null;
    seq: number;
    createdAt: string;
    updatedAt: string;
  };
  workspace: {
    id: string;
    name: string;
    slug: string;
  };
  lists: Array<{
    id: string;
    boardId: string;
    title: string;
    order: number;
    createdAt: string;
  }>;
  cards: Array<{
    id: string;
    boardId: string;
    listId: string;
    title: string;
    description: string | null;
    order: number;
    lastEditedBy: string;
    lastEditedAt: string;
    createdAt: string;
    updatedAt: string;
  }>;
  comments: Array<{
    id: string;
    boardId: string;
    cardId: string;
    userId: string;
    content: string;
    mentions: string[] | null;
    createdAt: string;
    authorName: string;
  }>;
};

export type RoomUser = {
  userId: string;
  name: string;
  cursor?: { x: number; y: number; viewport?: string };
  typing?: { cardId?: string; active: boolean };
  lastSeenAt: string;
};

export type ActivityEvent = {
  id: string;
  seq: number;
  eventType: string;
  actor: {
    id: string;
    name: string;
  };
  createdAt: string;
  payload?: unknown;
};

export type Snapshot = {
  id: string;
  seq: number;
  createdAt: string;
};
