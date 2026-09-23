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
  | 'listingPrice'
  | 'listingGainPct'
  | 'profitAmount'
  | 'profitPercentage'
  | 'preIpoEps'
  | 'postIpoEps'
  | 'preIpoPe'
  | 'postIpoPe'
  | 'preIpoPromoterHolding'
  | 'postIpoPromoterHolding'
  | 'preIpoMarketCap'
  | 'postIpoMarketCap'
  | 'allotmentResultAvailableAt'
  | 'isin'
  | 'nseSymbol'
  | 'bseSymbol'
> & {
  listingPrice?: BaseIpoWithRelations['listingPrice'];
  listingGainPct?: BaseIpoWithRelations['listingGainPct'];
  profitAmount?: BaseIpoWithRelations['profitAmount'];
  profitPercentage?: BaseIpoWithRelations['profitPercentage'];
  preIpoEps?: BaseIpoWithRelations['preIpoEps'];
  postIpoEps?: BaseIpoWithRelations['postIpoEps'];
  preIpoPe?: BaseIpoWithRelations['preIpoPe'];
  postIpoPe?: BaseIpoWithRelations['postIpoPe'];
  preIpoPromoterHolding?: BaseIpoWithRelations['preIpoPromoterHolding'];
  postIpoPromoterHolding?: BaseIpoWithRelations['postIpoPromoterHolding'];
  preIpoMarketCap?: BaseIpoWithRelations['preIpoMarketCap'];
  postIpoMarketCap?: BaseIpoWithRelations['postIpoMarketCap'];
  allotmentResultAvailableAt?: BaseIpoWithRelations['allotmentResultAvailableAt'];
  isin?: BaseIpoWithRelations['isin'];
  nseSymbol?: BaseIpoWithRelations['nseSymbol'];
  bseSymbol?: BaseIpoWithRelations['bseSymbol'];
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
