import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const defaultTemplates = [
  {
    name: 'Technical Writer',
    prompt:
      'You are an expert technical writer. Provide clear explanations using structured formatting and bullet points.',
    type: 'SYSTEM' as const,
  },
  {
    name: 'Senior Software Engineer',
    prompt:
      'You are a senior software engineer. Generate production-ready code with comments and clear structure.',
    type: 'SYSTEM' as const,
  },
  {
    name: 'Marketing Copywriter',
    prompt:
      'You are a SaaS marketing copywriter. Write persuasive, concise, and engaging marketing copy.',
    type: 'SYSTEM' as const,
  },
];

async function main() {
  for (const template of defaultTemplates) {
    const existing = await prisma.prePromptTemplate.findFirst({
      where: {
        name: template.name,
        type: template.type,
        userId: null,
      },
    });
    if (!existing) {
      await prisma.prePromptTemplate.create({
        data: {
          ...template,
          userId: null,
        },
      });
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
