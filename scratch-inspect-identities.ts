import { PrismaClient } from './node_modules/@prisma/client';

async function inspectIdentities() {
  const prisma = new PrismaClient();
  const identities = await prisma.ipoSourceIdentity.findMany({
    include: { ipo: true, source: true },
  });
  console.log('--- ALL IPO SOURCE IDENTITIES IN DATABASE ---');
  for (const id of identities) {
    console.log(`id: ${id.id} | ipoId: ${id.ipoId} | externalId: ${id.externalId} | source: ${id.source?.code} | IPO name: ${id.ipo?.symbol || id.ipoId}`);
  }
  await prisma.$disconnect();
}

inspectIdentities();
