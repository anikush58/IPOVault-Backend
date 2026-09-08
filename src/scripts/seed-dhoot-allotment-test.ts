import {
  ExchangeListing,
  IpoStatus,
  MarketSegment,
  PrismaClient,
  SourceType,
} from '@prisma/client';

const prisma = new PrismaClient();

export async function seedDhootAllotmentFixture() {
  console.log('Preparing Dhoot Transmission allotment-checker backend records...');

  // 1. Ensure KFINTECH Source exists
  const source = await prisma.source.upsert({
    where: { code: 'KFINTECH' },
    update: {
      name: 'KFin Technologies',
      sourceType: SourceType.REGISTRAR,
      enabled: true,
      baseUrl: 'https://ipostatus.kfintech.com',
    },
    create: {
      code: 'KFINTECH',
      name: 'KFin Technologies',
      sourceType: SourceType.REGISTRAR,
      enabled: true,
      baseUrl: 'https://ipostatus.kfintech.com',
    },
  });
  console.log(`Source KFINTECH ready: ID ${source.id}`);

  // 2. Ensure Company record for Dhoot Transmission exists
  let company = await prisma.company.findFirst({
    where: {
      OR: [
        { legalName: 'Dhoot Transmission Limited' },
        { displayName: 'Dhoot Transmission' },
      ],
    },
  });

  if (!company) {
    company = await prisma.company.create({
      data: {
        legalName: 'Dhoot Transmission Limited',
        displayName: 'Dhoot Transmission',
        industry: 'Auto Components',
        sector: 'Automotive',
        website: 'https://dhoottransmission.com',
      },
    });
    console.log(`Created Company Dhoot Transmission: ID ${company.id}`);
  } else {
    console.log(`Found existing Company Dhoot Transmission: ID ${company.id}`);
  }

  // 3. Ensure Ipo record for Dhoot Transmission exists (using standard DB UUID)
  let ipo = await prisma.ipo.findFirst({
    where: {
      OR: [
        { symbol: 'DHOOT' },
        { companyId: company.id },
      ],
    },
  });

  if (!ipo) {
    ipo = await prisma.ipo.create({
      data: {
        companyId: company.id,
        marketSegment: MarketSegment.MAINBOARD,
        exchange: ExchangeListing.NSE,
        status: IpoStatus.ALLOTMENT_COMPLETED,
        symbol: 'DHOOT',
      },
    });
    console.log(`Created IPO Dhoot Transmission: ID ${ipo.id} (Symbol: ${ipo.symbol})`);
  } else {
    ipo = await prisma.ipo.update({
      where: { id: ipo.id },
      data: {
        status: IpoStatus.ALLOTMENT_COMPLETED,
        symbol: 'DHOOT',
      },
    });
    console.log(`Updated existing IPO Dhoot Transmission: ID ${ipo.id} (Symbol: ${ipo.symbol})`);
  }

  // 4. Ensure IpoSourceIdentity linking IPO to KFINTECH with official KFin client_id '94818267561'
  const sourceIdentity = await prisma.ipoSourceIdentity.upsert({
    where: {
      ipoId_sourceId: {
        ipoId: ipo.id,
        sourceId: source.id,
      },
    },
    update: {
      externalId: '94818267561',
      symbol: 'DHOOT',
    },
    create: {
      ipoId: ipo.id,
      sourceId: source.id,
      externalId: '94818267561',
      symbol: 'DHOOT',
    },
  });
  console.log(
    `IpoSourceIdentity ready: ID ${sourceIdentity.id} (External ID: ${sourceIdentity.externalId})`,
  );

  return { source, company, ipo, sourceIdentity };
}

async function main() {
  try {
    await seedDhootAllotmentFixture();
    console.log('Seeding completed successfully.');
  } catch (error) {
    console.error('Error seeding Dhoot Transmission fixture:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main();
}
