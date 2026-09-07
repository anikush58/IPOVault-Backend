import { PrismaClient } from './node_modules/@prisma/client';

async function listIpos() {
  const prisma = new PrismaClient();
  const ipos = await prisma.ipo.findMany({
    include: { company: true },
  });
  console.log('--- ALL IPOS IN DATABASE ---');
  for (const ipo of ipos) {
    console.log(`ID: ${ipo.id} | Symbol: ${ipo.symbol} | Company: ${ipo.company?.legalName || ipo.company?.displayName}`);
  }
  await prisma.$disconnect();
}

listIpos();
