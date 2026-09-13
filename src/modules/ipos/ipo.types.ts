import { Prisma } from '@prisma/client';

type BaseIpoWithRelations = Prisma.IpoGetPayload<{
  include: {
    company: {
      include: {
        financials: true;
      };
    };
    lifecycleEvents: true;
    offerCategories: true;
    participants: true;
    documents: true;
    allotmentConfig: true;
    gmpObservations: {
      include: { source: true };
    };
    subscriptionObservations: {
      include: { source: true };
    };
  };
}>;

export type IpoWithRelations = Omit<
  BaseIpoWithRelations,
  | 'company'
  | 'offerCategories'
  | 'participants'
  | 'documents'
  | 'allotmentConfig'
  | 'gmpObservations'
  | 'subscriptionObservations'
> & {
  company: Partial<BaseIpoWithRelations['company']> & {
    id: string;
    legalName: string;
    displayName: string;
    financials?: BaseIpoWithRelations['company']['financials'];
  };
  offerCategories?: BaseIpoWithRelations['offerCategories'];
  participants?: BaseIpoWithRelations['participants'];
  documents?: BaseIpoWithRelations['documents'];
  allotmentConfig?: BaseIpoWithRelations['allotmentConfig'];
  gmpObservations?: BaseIpoWithRelations['gmpObservations'];
  subscriptionObservations?: BaseIpoWithRelations['subscriptionObservations'];
};
