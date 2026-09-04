import { randomUUID } from 'node:crypto';

import { DiscoveryStatus, Prisma } from '@prisma/client';

type Row = Record<string, unknown>;

export type FakeDb = {
  companies: Row[];
  ipos: Row[];
  identities: Row[];
  lifecycle: Row[];
  discovery: Row[];
  provenance: Row[];
  changes: Row[];
  sources: Row[];
};

function cloneRows(rows: Row[]): Row[] {
  return JSON.parse(JSON.stringify(rows)) as Row[];
}

function reviveDate(value: unknown): unknown {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return new Date(value);
  }

  return value;
}

function reviveRow(row: Row): Row {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, reviveDate(value)]),
  );
}

type FakePrismaClient = {
  company: {
    findFirst: (args: { where: Row }) => Promise<Row | null>;
    findUnique: (args: { where: { id: string } }) => Promise<Row | null>;
    create: (args: { data: Row }) => Promise<Row>;
    update: (args: { where: { id: string }; data: Row }) => Promise<Row>;
  };
  ipo: {
    findUnique: (args: { where: { id: string } }) => Promise<Row | null>;
    count: (args: { where: { companyId: string } }) => Promise<number>;
    create: (args: { data: Row }) => Promise<Row>;
    update: (args: { where: { id: string }; data: Row }) => Promise<Row>;
  };
  ipoSourceIdentity: {
    findFirst: (args: {
      where: Row;
      include?: { ipo: boolean };
    }) => Promise<Row | null>;
    create: (args: { data: Row }) => Promise<Row>;
    update: (args: { where: { id: string }; data: Row }) => Promise<Row>;
  };
  ipoLifecycleEvent: {
    findFirst: (args: { where: Row }) => Promise<Row | null>;
    create: (args: { data: Row }) => Promise<Row>;
    update: (args: { where: { id: string }; data: Row }) => Promise<Row>;
  };
  discoveryRecord: {
    findFirst: (args: { where: Row }) => Promise<Row | null>;
    create: (args: { data: Row }) => Promise<Row>;
    update: (args: { where: { id: string }; data: Row }) => Promise<Row>;
  };
  fieldProvenance: {
    create: (args: { data: Row }) => Promise<Row>;
    findFirst: (args: {
      where: Row;
      orderBy?: { retrievedAt?: 'asc' | 'desc' };
    }) => Promise<Row | null>;
  };
  ipoChangeEvent: {
    create: (args: { data: Row }) => Promise<Row>;
  };
  source: {
    findUnique: (args: {
      where: { id?: string; code?: string };
    }) => Promise<Row | null>;
  };
  $transaction: <T>(fn: (tx: FakePrismaClient) => Promise<T>) => Promise<T>;
};

export function createFakePrisma() {
  const db: FakeDb = {
    companies: [],
    ipos: [],
    identities: [],
    lifecycle: [],
    discovery: [],
    provenance: [],
    changes: [],
    sources: [],
  };

  const prisma: FakePrismaClient = {
    company: {
      findFirst: async ({ where }: { where: Row }) =>
        db.companies.find((row) => matches(row, where)) ?? null,
      findUnique: async ({ where }: { where: { id: string } }) =>
        db.companies.find((row) => row.id === where.id) ?? null,
      create: async ({ data }: { data: Row }) => {
        const row = { id: randomUUID(), ...data };
        db.companies.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = db.companies.find((item) => item.id === where.id);
        if (!row) {
          throw new Error('company not found');
        }
        Object.assign(row, data);
        return row;
      },
    },
    ipo: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        db.ipos.find((row) => row.id === where.id) ?? null,
      count: async ({ where }: { where: { companyId: string } }) =>
        db.ipos.filter((row) => row.companyId === where.companyId).length,
      create: async ({ data }: { data: Row }) => {
        const row = { id: randomUUID(), ...data };
        db.ipos.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = db.ipos.find((item) => item.id === where.id);
        if (!row) {
          throw new Error('ipo not found');
        }
        Object.assign(row, data);
        return row;
      },
    },
    ipoSourceIdentity: {
      findFirst: async ({
        where,
        include,
      }: {
        where: Row;
        include?: { ipo: boolean };
      }) => {
        const row = db.identities.find((item) => matches(item, where));
        if (!row) {
          return null;
        }
        if (include?.ipo) {
          return {
            ...row,
            ipo: db.ipos.find((ipo) => ipo.id === row.ipoId),
          };
        }
        return row;
      },
      create: async ({ data }: { data: Row }) => {
        const row = { id: randomUUID(), ...data };
        db.identities.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = db.identities.find((item) => item.id === where.id);
        if (!row) {
          throw new Error('identity not found');
        }
        Object.assign(row, data);
        return row;
      },
    },
    ipoLifecycleEvent: {
      findFirst: async ({ where }: { where: Row }) =>
        db.lifecycle.find((row) => matches(row, where)) ?? null,
      create: async ({ data }: { data: Row }) => {
        const row = { id: randomUUID(), ...data };
        db.lifecycle.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = db.lifecycle.find((item) => item.id === where.id);
        if (!row) {
          throw new Error('lifecycle not found');
        }
        Object.assign(row, data);
        return row;
      },
    },
    discoveryRecord: {
      findFirst: async ({ where }: { where: Row }) =>
        db.discovery.find((row) => matches(row, where)) ?? null,
      create: async ({ data }: { data: Row }) => {
        const row = {
          id: randomUUID(),
          status: DiscoveryStatus.NEW,
          errorMessage: null,
          processedAt: null,
          ...data,
        };
        db.discovery.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = db.discovery.find((item) => item.id === where.id);
        if (!row) {
          throw new Error('discovery not found');
        }
        Object.assign(row, data);
        return row;
      },
    },
    fieldProvenance: {
      findFirst: async ({
        where,
        orderBy,
      }: {
        where: Row;
        orderBy?: { retrievedAt?: 'asc' | 'desc' };
      }) => {
        const rows = db.provenance.filter((row) => matches(row, where));
        if (orderBy?.retrievedAt === 'desc') {
          rows.sort(
            (left, right) =>
              new Date(String(right.retrievedAt)).getTime() -
              new Date(String(left.retrievedAt)).getTime(),
          );
        }
        if (orderBy?.retrievedAt === 'asc') {
          rows.sort(
            (left, right) =>
              new Date(String(left.retrievedAt)).getTime() -
              new Date(String(right.retrievedAt)).getTime(),
          );
        }
        return rows[0] ?? null;
      },
      create: async ({ data }: { data: Row }) => {
        const row = { id: randomUUID(), ...data };
        db.provenance.push(row);
        return row;
      },
    },
    ipoChangeEvent: {
      create: async ({ data }: { data: Row }) => {
        const row = { id: randomUUID(), ...data };
        db.changes.push(row);
        return row;
      },
    },
    source: {
      findUnique: async ({
        where,
      }: {
        where: { id?: string; code?: string };
      }) => {
        if (where.id) {
          return db.sources.find((row) => row.id === where.id) ?? null;
        }
        if (where.code) {
          return db.sources.find((row) => row.code === where.code) ?? null;
        }
        return null;
      },
    },
    $transaction: async <T>(
      fn: (tx: FakePrismaClient) => Promise<T>,
    ): Promise<T> => {
      const snapshot = {
        companies: cloneRows(db.companies).map(reviveRow),
        ipos: cloneRows(db.ipos).map((row) => reviveIpo(row)),
        identities: cloneRows(db.identities).map(reviveRow),
        lifecycle: cloneRows(db.lifecycle).map(reviveRow),
        provenance: cloneRows(db.provenance).map(reviveRow),
        changes: cloneRows(db.changes).map(reviveRow),
        sources: cloneRows(db.sources).map(reviveRow),
      };

      try {
        return await fn(prisma);
      } catch (error) {
        db.companies = snapshot.companies;
        db.ipos = snapshot.ipos;
        db.identities = snapshot.identities;
        db.lifecycle = snapshot.lifecycle;
        db.provenance = snapshot.provenance;
        db.changes = snapshot.changes;
        db.sources = snapshot.sources;
        throw error;
      }
    },
  };

  return { db, prisma };
}

function reviveIpo(row: Row): Row {
  const revived = reviveRow(row);
  for (const field of [
    'issueSize',
    'freshIssueSize',
    'ofsSize',
    'issueShareCount',
    'freshIssueShareCount',
    'ofsShareCount',
    'faceValue',
    'priceBandLow',
    'priceBandHigh',
  ]) {
    const value = revived[field];
    if (typeof value === 'string') {
      revived[field] = new Prisma.Decimal(value);
    }
  }
  return revived;
}

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}
