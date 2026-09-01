import { Prisma } from '@prisma/client';

export type IpoWithRelations = Prisma.IpoGetPayload<{
  include: {
    company: true;
    lifecycleEvents: true;
  };
}>;
