import bcrypt from 'bcryptjs';
import { PrismaClient, WorkspaceRole } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = 'demo@rollsev.work';
  const passwordHash = await bcrypt.hash('demo12345', 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: 'Demo User',
      passwordHash
    }
  });

  const workspace = await prisma.workspace.upsert({
    where: { slug: 'rollsev-sync' },
    update: {},
    create: {
      slug: 'rollsev-sync',
      name: 'Rollsev Sync Workspace',
      ownerId: user.id,
      members: {
        create: {
          userId: user.id,
          role: WorkspaceRole.OWNER
        }
      }
    }
  });

  const board = await prisma.board.upsert({
    where: { id: 'demo-board' },
    update: {},
    create: {
      id: 'demo-board',
      workspaceId: workspace.id,
      createdById: user.id,
      title: 'Product Launch Board',
      description: 'Realtime Kanban with comments and presence'
    }
  });

  const existingLists = await prisma.boardList.findMany({ where: { boardId: board.id } });
  if (existingLists.length === 0) {
    const todo = await prisma.boardList.create({
      data: { boardId: board.id, title: 'Todo', order: 0 }
    });
    const progress = await prisma.boardList.create({
      data: { boardId: board.id, title: 'In Progress', order: 1 }
    });
    const done = await prisma.boardList.create({
      data: { boardId: board.id, title: 'Done', order: 2 }
    });

    await prisma.boardCard.createMany({
      data: [
        {
          boardId: board.id,
          listId: todo.id,
          title: 'Design live cursor UI',
          description: 'Render avatars on board canvas with pointer positions.',
          order: 0,
          lastEditedBy: user.id
        },
        {
          boardId: board.id,
          listId: progress.id,
          title: 'Implement room join auth',
          description: 'Socket auth + board membership check before join.',
          order: 0,
          lastEditedBy: user.id
        },
        {
          boardId: board.id,
          listId: done.id,
          title: 'Draft event protocol v1',
          description: 'Versioned events, mutation ids, ack statuses.',
          order: 0,
          lastEditedBy: user.id
        }
      ]
    });
  }

  console.log('Seed complete');
  console.log('Demo login:', email, '/ demo12345');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
