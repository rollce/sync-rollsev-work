import { prisma } from '../lib/prisma.js';

export async function buildBoardState(boardId: string) {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    include: {
      lists: {
        orderBy: {
          order: 'asc'
        }
      },
      cards: {
        orderBy: [{ listId: 'asc' }, { order: 'asc' }]
      },
      comments: {
        include: {
          user: {
            select: {
              id: true,
              name: true
            }
          }
        },
        orderBy: {
          createdAt: 'asc'
        }
      },
      workspace: {
        select: {
          id: true,
          name: true,
          slug: true
        }
      }
    }
  });

  if (!board) {
    return null;
  }

  return {
    board: {
      id: board.id,
      workspaceId: board.workspaceId,
      title: board.title,
      description: board.description,
      seq: board.seq,
      createdAt: board.createdAt,
      updatedAt: board.updatedAt
    },
    workspace: board.workspace,
    lists: board.lists.map((list) => ({
      id: list.id,
      boardId: list.boardId,
      title: list.title,
      order: list.order,
      createdAt: list.createdAt
    })),
    cards: board.cards.map((card) => ({
      id: card.id,
      boardId: card.boardId,
      listId: card.listId,
      title: card.title,
      description: card.description,
      order: card.order,
      lastEditedBy: card.lastEditedBy,
      lastEditedAt: card.lastEditedAt,
      createdAt: card.createdAt,
      updatedAt: card.updatedAt
    })),
    comments: board.comments.map((comment) => ({
      id: comment.id,
      boardId: comment.boardId,
      cardId: comment.cardId,
      userId: comment.userId,
      content: comment.content,
      mentions: comment.mentions,
      createdAt: comment.createdAt,
      authorName: comment.user.name
    }))
  };
}

export async function createBoardSnapshot(boardId: string, seq: number) {
  const state = await buildBoardState(boardId);
  if (!state) {
    return null;
  }

  return prisma.boardSnapshot.create({
    data: {
      boardId,
      seq,
      state
    }
  });
}
