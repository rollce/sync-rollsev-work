import { WorkspaceRole } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export type AccessContext = {
  workspaceId: string;
  boardId: string;
  role: WorkspaceRole;
};

export async function getBoardAccess(userId: string, boardId: string): Promise<AccessContext | null> {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: {
      id: true,
      workspaceId: true
    }
  });

  if (!board) {
    return null;
  }

  const member = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId: board.workspaceId,
        userId
      }
    },
    select: {
      role: true
    }
  });

  if (!member) {
    return null;
  }

  return {
    workspaceId: board.workspaceId,
    boardId: board.id,
    role: member.role
  };
}

export async function getWorkspaceRole(userId: string, workspaceId: string): Promise<WorkspaceRole | null> {
  const member = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId
      }
    },
    select: {
      role: true
    }
  });

  return member?.role ?? null;
}

export function canEdit(role: WorkspaceRole): boolean {
  return role === 'OWNER' || role === 'EDITOR';
}
