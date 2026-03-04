#!/usr/bin/env npx ts-node
/**
 * Script to check Neon DB state: users, canvases, nodes, edges, ai_conversations
 * Run: npx ts-node scripts/check-db.ts (or: cd base-backend && npx ts-node scripts/check-db.ts)
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('\n========== Neon DB Health Check ==========\n');

  const [users, canvases, nodes, edges, aiConversations] = await Promise.all([
    prisma.user.count(),
    prisma.canvas.count(),
    prisma.node.count(),
    prisma.edge.count(),
    prisma.aIConversation.count(),
  ]);

  console.log('Table counts:');
  console.log('  users:', users);
  console.log('  canvases:', canvases);
  console.log('  nodes:', nodes);
  console.log('  edges:', edges);
  console.log('  ai_conversations:', aiConversations);

  if (canvases > 0) {
    console.log('\n--- Canvas sample (first 3) ---');
    const canvasList = await prisma.canvas.findMany({
      take: 3,
      select: {
        id: true,
        name: true,
        nodeCount: true,
        edgeCount: true,
        userId: true,
        createdAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
    console.log(JSON.stringify(canvasList, null, 2));
  }

  if (nodes > 0) {
    console.log('\n--- Node sample (first 3) ---');
    const nodeList = await prisma.node.findMany({
      take: 3,
      select: {
        id: true,
        clientId: true,
        canvasId: true,
        nodeType: true,
        x: true,
        y: true,
      },
    });
    console.log(JSON.stringify(nodeList, null, 2));
  }

  if (edges > 0) {
    console.log('\n--- Edge sample (first 3) ---');
    const edgeList = await prisma.edge.findMany({
      take: 3,
      select: {
        id: true,
        canvasId: true,
        sourceNodeId: true,
        targetNodeId: true,
      },
    });
    console.log(JSON.stringify(edgeList, null, 2));
  }

  if (aiConversations > 0) {
    console.log('\n--- AI Conversation sample (first 3) ---');
    const convList = await prisma.aIConversation.findMany({
      take: 3,
      select: {
        id: true,
        nodeId: true,
        canvasId: true,
        status: true,
        prompt: true,
        response: true,
      },
    });
    console.log(JSON.stringify(convList, null, 2));
  } else {
    console.log('\n--- AI conversations: EMPTY (0 rows) ---');
    console.log('  The sync logic only fills: canvas, nodes, edges.');
    console.log('  AI conversations are written when the Gemini API generates a response.');
    console.log('  Check: GeminiApi.tsx / ai/gemini/generate flow.');
  }

  console.log('\n========== Done ==========\n');
}

main()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
