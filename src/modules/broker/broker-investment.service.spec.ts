import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  BrokerTradeSide,
  BrokerType,
  ExchangeListing,
  Prisma,
} from '@prisma/client';
import { BrokerInvestmentService } from './broker-investment.service';
import { BrokerAccountService } from './broker-account.service';
import { BrokerConnectionService } from './broker-connection.service';
import { BrokerRegistry } from './broker.registry';
import { PrismaService } from '../../database/prisma.service';

describe('BrokerInvestmentService', () => {
  let service: BrokerInvestmentService;
  let mockPrisma: any;
  let mockAccountService: any;
  let mockConnectionService: any;
  let mockRegistry: any;
  let mockAdapter: any;

  const mockDate = new Date('2026-09-22T10:00:00Z');

  const sampleAccount = {
    id: 'acc-uuid-1',
    userId: 'user-123',
    profileId: 'profile-abc',
    broker: BrokerType.UPSTOX,
    accountName: 'My Upstox',
    clientId: 'UP12345',
    isActive: true,
  };

  const sampleIpo = {
    id: 'ipo-uuid-1',
    isin: 'INE002A01018',
    symbol: 'RELIANCE',
    exchange: ExchangeListing.NSE,
  };

  const sampleInvestmentPrisma = {
    id: 'inv-uuid-1',
    brokerAccountId: 'acc-uuid-1',
    ipoId: 'ipo-uuid-1',
    allottedQuantity: new Prisma.Decimal(50),
    allotmentPrice: new Prisma.Decimal(500),
    allotmentDate: mockDate,
    ipo: sampleIpo,
  };

  const sampleInstrument = {
    id: 'inst-uuid-1',
    broker: BrokerType.UPSTOX,
    isin: 'INE002A01018',
    exchange: ExchangeListing.NSE,
    symbol: 'RELIANCE',
    ipoId: 'ipo-uuid-1',
  };

  beforeEach(() => {
    mockPrisma = {
      ipo: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      ipoInvestment: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        upsert: jest.fn(),
      },
      brokerInstrument: {
        findFirst: jest.fn(),
        upsert: jest.fn(),
      },
      brokerHolding: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
      },
      brokerTrade: {
        findMany: jest.fn(),
        upsert: jest.fn(),
      },
      brokerConnection: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(mockPrisma)),
    };

    mockAccountService = {
      getAccount: jest.fn().mockResolvedValue(sampleAccount),
      verifyOwnership: jest.fn().mockResolvedValue(sampleAccount),
    };

    mockConnectionService = {
      getDecryptedTokens: jest.fn().mockResolvedValue({
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        tokenType: 'Bearer',
      }),
      markExpired: jest.fn().mockResolvedValue({ id: 'conn-1' }),
    };

    mockAdapter = {
      brokerType: BrokerType.UPSTOX,
      getHoldings: jest.fn(),
      getTrades: jest.fn(),
      getQuote: jest.fn(),
    };

    mockRegistry = {
      getAdapter: jest.fn().mockReturnValue(mockAdapter),
      getSupportedBrokers: jest.fn().mockReturnValue([
        BrokerType.UPSTOX,
        BrokerType.DHAN,
        BrokerType.FYERS,
        BrokerType.ZERODHA,
        BrokerType.GROWW,
        BrokerType.MILLIONS,
      ]),
    };

    service = new BrokerInvestmentService(
      mockPrisma as unknown as PrismaService,
      mockAccountService as unknown as BrokerAccountService,
      mockConnectionService as unknown as BrokerConnectionService,
      mockRegistry as unknown as BrokerRegistry,
    );
  });

  describe('recordAllotmentInvestment', () => {
    it('records initial allotment basis and matches by ISIN', async () => {
      mockPrisma.ipo.findUnique.mockResolvedValue(sampleIpo);
      mockPrisma.ipoInvestment.upsert.mockResolvedValue(sampleInvestmentPrisma);

      const result = await service.recordAllotmentInvestment(
        'user-123',
        'acc-uuid-1',
        {
          ipoId: 'ipo-uuid-1',
          isin: 'INE002A01018',
          allottedQuantity: 50,
          allotmentPrice: 500,
          allotmentDate: mockDate,
          profileId: 'profile-abc',
        },
      );

      expect(mockAccountService.getAccount).toHaveBeenCalledWith('user-123', 'acc-uuid-1');
      expect(mockPrisma.ipo.findUnique).toHaveBeenCalledWith({
        where: { id: 'ipo-uuid-1' },
        select: expect.any(Object),
      });
      expect(mockPrisma.ipoInvestment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            brokerAccountId_ipoId: {
              brokerAccountId: 'acc-uuid-1',
              ipoId: 'ipo-uuid-1',
            },
          },
          create: expect.objectContaining({
            brokerAccountId: 'acc-uuid-1',
            ipoId: 'ipo-uuid-1',
            allottedQuantity: new Prisma.Decimal(50),
            allotmentPrice: new Prisma.Decimal(500),
            allotmentDate: mockDate,
          }),
        }),
      );
      expect(result).toEqual(sampleInvestmentPrisma);
    });

    it('rejects with BadRequestException on ISIN mismatch', async () => {
      mockPrisma.ipo.findUnique.mockResolvedValue(sampleIpo); // ISIN: INE002A01018

      await expect(
        service.recordAllotmentInvestment('user-123', 'acc-uuid-1', {
          ipoId: 'ipo-uuid-1',
          isin: 'INE999X01019', // Mismatched ISIN
          allottedQuantity: 50,
          allotmentPrice: 500,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.ipoInvestment.upsert).not.toHaveBeenCalled();
    });

    it('enforces profileId ownership boundary', async () => {
      await expect(
        service.recordAllotmentInvestment('user-123', 'acc-uuid-1', {
          ipoId: 'ipo-uuid-1',
          isin: 'INE002A01018',
          allottedQuantity: 50,
          allotmentPrice: 500,
          profileId: 'different-profile-xyz',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.ipo.findUnique).not.toHaveBeenCalled();
    });

    it('throws NotFoundException if IPO is not found', async () => {
      mockPrisma.ipo.findUnique.mockResolvedValue(null);

      await expect(
        service.recordAllotmentInvestment('user-123', 'acc-uuid-1', {
          ipoId: 'missing-ipo',
          isin: 'INE002A01018',
          allottedQuantity: 50,
          allotmentPrice: 500,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('Derived Investment Summary (Detection & Quantity Calculations)', () => {
    it('1. Holding with no sale: derived remainingQuantity equals allottedQuantity, status HOLDING', async () => {
      mockPrisma.ipoInvestment.findUnique.mockResolvedValue(sampleInvestmentPrisma);
      mockPrisma.brokerInstrument.findFirst.mockResolvedValue(sampleInstrument);
      mockPrisma.brokerHolding.findUnique.mockResolvedValue({
        id: 'holding-1',
        brokerAccountId: 'acc-uuid-1',
        instrumentId: 'inst-uuid-1',
        quantity: new Prisma.Decimal(50),
        averagePrice: new Prisma.Decimal(500),
        lastPrice: new Prisma.Decimal(650),
        currentValue: new Prisma.Decimal(32500),
        unrealizedPnl: new Prisma.Decimal(7500),
        asOf: mockDate,
      });
      mockPrisma.brokerTrade.findMany.mockResolvedValue([]); // 0 sell trades

      const summary = await service.getDerivedInvestmentSummary(
        'user-123',
        'acc-uuid-1',
        'ipo-uuid-1',
      );

      expect(summary).toEqual({
        brokerAccountId: 'acc-uuid-1',
        ipoId: 'ipo-uuid-1',
        isin: 'INE002A01018',
        exchange: ExchangeListing.NSE,
        symbol: 'RELIANCE',
        allottedQuantity: 50,
        allotmentPrice: 500,
        allotmentDate: mockDate,
        totalSoldQuantity: 0,
        remainingQuantity: 50,
        currentHoldingQuantity: 50,
        status: 'HOLDING',
        sellTrades: [],
        holding: {
          lastPrice: 650,
          currentValue: 32500,
          unrealizedPnl: 7500,
          asOf: mockDate,
        },
      });
    });

    it('2. Partial sale: detects SELL trade, remainingQuantity is reduced, status PARTIALLY_SOLD', async () => {
      mockPrisma.ipoInvestment.findUnique.mockResolvedValue(sampleInvestmentPrisma); // 50 allotted
      mockPrisma.brokerInstrument.findFirst.mockResolvedValue(sampleInstrument);
      mockPrisma.brokerHolding.findUnique.mockResolvedValue({
        id: 'holding-1',
        brokerAccountId: 'acc-uuid-1',
        instrumentId: 'inst-uuid-1',
        quantity: new Prisma.Decimal(30), // 30 remaining
        averagePrice: new Prisma.Decimal(500),
        lastPrice: new Prisma.Decimal(750),
        currentValue: new Prisma.Decimal(22500),
        unrealizedPnl: new Prisma.Decimal(7500),
        asOf: mockDate,
      });
      mockPrisma.brokerTrade.findMany.mockResolvedValue([
        {
          brokerTradeId: 'trade-sell-1',
          side: BrokerTradeSide.SELL,
          quantity: new Prisma.Decimal(20), // 20 sold
          price: new Prisma.Decimal(720),
          tradedAt: mockDate,
        },
      ]);

      const summary = await service.getDerivedInvestmentSummary(
        'user-123',
        'acc-uuid-1',
        'ipo-uuid-1',
      );

      expect(summary.allottedQuantity).toBe(50);
      expect(summary.totalSoldQuantity).toBe(20);
      expect(summary.remainingQuantity).toBe(30);
      expect(summary.status).toBe('PARTIALLY_SOLD');
      expect(summary.sellTrades).toHaveLength(1);
      expect(summary.sellTrades[0]).toEqual({
        brokerTradeId: 'trade-sell-1',
        quantity: 20,
        price: 720,
        tradedAt: mockDate,
      });
    });

    it('3. Full sale: detects all SELL trades, remainingQuantity is 0, status FULLY_SOLD', async () => {
      mockPrisma.ipoInvestment.findUnique.mockResolvedValue(sampleInvestmentPrisma); // 50 allotted
      mockPrisma.brokerInstrument.findFirst.mockResolvedValue(sampleInstrument);
      mockPrisma.brokerHolding.findUnique.mockResolvedValue({
        id: 'holding-1',
        brokerAccountId: 'acc-uuid-1',
        instrumentId: 'inst-uuid-1',
        quantity: new Prisma.Decimal(0), // 0 remaining
        averagePrice: new Prisma.Decimal(500),
        lastPrice: new Prisma.Decimal(800),
        currentValue: new Prisma.Decimal(0),
        unrealizedPnl: new Prisma.Decimal(0),
        asOf: mockDate,
      });
      mockPrisma.brokerTrade.findMany.mockResolvedValue([
        {
          brokerTradeId: 'trade-sell-1',
          side: BrokerTradeSide.SELL,
          quantity: new Prisma.Decimal(30),
          price: new Prisma.Decimal(720),
          tradedAt: mockDate,
        },
        {
          brokerTradeId: 'trade-sell-2',
          side: BrokerTradeSide.SELL,
          quantity: new Prisma.Decimal(20),
          price: new Prisma.Decimal(780),
          tradedAt: mockDate,
        },
      ]);

      const summary = await service.getDerivedInvestmentSummary(
        'user-123',
        'acc-uuid-1',
        'ipo-uuid-1',
      );

      expect(summary.allottedQuantity).toBe(50);
      expect(summary.totalSoldQuantity).toBe(50);
      expect(summary.remainingQuantity).toBe(0);
      expect(summary.status).toBe('FULLY_SOLD');
      expect(summary.sellTrades).toHaveLength(2);
    });

    it('4. ISIN mismatch handling: rejects if IpoInvestment record is not found', async () => {
      mockPrisma.ipoInvestment.findUnique.mockResolvedValue(null);

      await expect(
        service.getDerivedInvestmentSummary(
          'user-123',
          'acc-uuid-1',
          'non-existent-ipo',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('persistHoldingsAndTrades', () => {
    it('persists normalized holdings, trades, and matches instruments by ISIN', async () => {
      mockPrisma.ipo.findFirst.mockResolvedValue(sampleIpo);
      mockPrisma.brokerInstrument.upsert.mockResolvedValue(sampleInstrument);
      mockPrisma.brokerHolding.upsert.mockResolvedValue({ id: 'h-1' });
      mockPrisma.brokerTrade.upsert.mockResolvedValue({ id: 't-1' });

      const holdings = [
        {
          brokerAccountId: 'acc-uuid-1',
          isin: 'INE002A01018',
          exchange: ExchangeListing.NSE,
          symbol: 'RELIANCE',
          quantity: 50,
          averagePrice: 500,
          lastPrice: 650,
          currentValue: 32500,
          unrealizedPnl: 7500,
          asOf: mockDate,
        },
      ];

      const trades = [
        {
          brokerAccountId: 'acc-uuid-1',
          brokerTradeId: 'trade-buy-1',
          isin: 'INE002A01018',
          exchange: ExchangeListing.NSE,
          symbol: 'RELIANCE',
          side: BrokerTradeSide.BUY,
          quantity: 50,
          price: 500,
          tradedAt: mockDate,
        },
      ];

      const result = await service.persistHoldingsAndTrades(
        'user-123',
        'acc-uuid-1',
        holdings,
        trades,
      );

      expect(result).toEqual({
        persistedHoldingsCount: 1,
        persistedTradesCount: 1,
      });
      expect(mockPrisma.brokerInstrument.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            broker_isin_exchange: {
              broker: BrokerType.UPSTOX,
              isin: 'INE002A01018',
              exchange: ExchangeListing.NSE,
            },
          },
          create: expect.objectContaining({
            broker: BrokerType.UPSTOX,
            isin: 'INE002A01018',
            exchange: ExchangeListing.NSE,
            ipoId: 'ipo-uuid-1',
          }),
        }),
      );
      expect(mockPrisma.brokerHolding.upsert).toHaveBeenCalled();
      expect(mockPrisma.brokerTrade.upsert).toHaveBeenCalled();
    });
  });

  describe('syncAndMatchInvestment', () => {
    it('fetches Upstox live holdings/trades in memory, persists, and returns derived summary', async () => {
      mockAdapter.getHoldings.mockResolvedValue([
        {
          brokerAccountId: 'acc-uuid-1',
          isin: 'INE002A01018',
          exchange: ExchangeListing.NSE,
          symbol: 'RELIANCE',
          quantity: 50,
          averagePrice: 500,
          lastPrice: 650,
          currentValue: 32500,
          unrealizedPnl: 7500,
          asOf: mockDate,
        },
      ]);
      mockAdapter.getTrades.mockResolvedValue([]);

      mockPrisma.ipo.findFirst.mockResolvedValue(sampleIpo);
      mockPrisma.brokerInstrument.upsert.mockResolvedValue(sampleInstrument);
      mockPrisma.brokerHolding.upsert.mockResolvedValue({ id: 'h-1' });
      mockPrisma.ipoInvestment.findUnique.mockResolvedValue(sampleInvestmentPrisma);
      mockPrisma.brokerInstrument.findFirst.mockResolvedValue(sampleInstrument);
      mockPrisma.brokerHolding.findUnique.mockResolvedValue({
        id: 'holding-1',
        brokerAccountId: 'acc-uuid-1',
        instrumentId: 'inst-uuid-1',
        quantity: new Prisma.Decimal(50),
        averagePrice: new Prisma.Decimal(500),
        lastPrice: new Prisma.Decimal(650),
        currentValue: new Prisma.Decimal(32500),
        unrealizedPnl: new Prisma.Decimal(7500),
        asOf: mockDate,
      });
      mockPrisma.brokerTrade.findMany.mockResolvedValue([]);

      const summary = await service.syncAndMatchInvestment(
        'user-123',
        'acc-uuid-1',
        'ipo-uuid-1',
      );

      expect(mockConnectionService.getDecryptedTokens).toHaveBeenCalledWith(
        'user-123',
        'acc-uuid-1',
      );
      expect(mockAdapter.getHoldings).toHaveBeenCalled();
      expect(mockAdapter.getTrades).toHaveBeenCalled();
      expect(summary.status).toBe('HOLDING');
      expect(summary.remainingQuantity).toBe(50);
    });
  });

  describe('syncAccountPostListingInvestments', () => {
    it('syncs account when position is fully sold', async () => {
      // Setup holdings: empty / 0 qty
      mockAdapter.getHoldings.mockResolvedValue([]);
      // Setup trades: full sale 50 qty
      mockAdapter.getTrades.mockResolvedValue([
        {
          brokerAccountId: 'acc-uuid-1',
          brokerTradeId: 'trade-sell-full-1',
          isin: 'INE002A01018',
          exchange: ExchangeListing.NSE,
          symbol: 'RELIANCE',
          side: BrokerTradeSide.SELL,
          quantity: 50,
          price: 700,
          tradedAt: mockDate,
        },
      ]);

      mockPrisma.ipo.findFirst.mockResolvedValue(sampleIpo);
      mockPrisma.brokerInstrument.upsert.mockResolvedValue(sampleInstrument);
      mockPrisma.brokerTrade.upsert.mockResolvedValue({ id: 't-1' });

      mockPrisma.ipoInvestment.findMany.mockResolvedValue([sampleInvestmentPrisma]);
      mockPrisma.ipoInvestment.findUnique.mockResolvedValue(sampleInvestmentPrisma);
      mockPrisma.brokerInstrument.findFirst.mockResolvedValue(sampleInstrument);
      mockPrisma.brokerHolding.findUnique.mockResolvedValue(null);
      mockPrisma.brokerTrade.findMany.mockResolvedValue([
        {
          id: 't-1',
          brokerTradeId: 'trade-sell-full-1',
          brokerAccountId: 'acc-uuid-1',
          instrumentId: 'inst-uuid-1',
          side: BrokerTradeSide.SELL,
          quantity: new Prisma.Decimal(50),
          price: new Prisma.Decimal(700),
          tradedAt: mockDate,
        },
      ]);
      mockPrisma.brokerConnection.update.mockResolvedValue({ id: 'conn-1' });

      const result = await service.syncAccountPostListingInvestments(
        'user-123',
        'acc-uuid-1',
      );

      expect(result.brokerAccountId).toBe('acc-uuid-1');
      expect(result.syncedInvestmentsCount).toBe(1);
      expect(result.investments[0].status).toBe('FULLY_SOLD');
      expect(result.investments[0].remainingQuantity).toBe(0);
      expect(result.investments[0].totalSoldQuantity).toBe(50);
      expect(mockPrisma.brokerConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { brokerAccountId: 'acc-uuid-1' },
          data: expect.objectContaining({
            lastError: null,
          }),
        }),
      );
    });

    it('syncs account when position is partially sold', async () => {
      // Setup holdings: 30 remaining
      mockAdapter.getHoldings.mockResolvedValue([
        {
          brokerAccountId: 'acc-uuid-1',
          isin: 'INE002A01018',
          exchange: ExchangeListing.NSE,
          symbol: 'RELIANCE',
          quantity: 30,
          averagePrice: 500,
          lastPrice: 650,
          currentValue: 19500,
          unrealizedPnl: 4500,
          asOf: mockDate,
        },
      ]);
      // Setup trades: 20 sold
      mockAdapter.getTrades.mockResolvedValue([
        {
          brokerAccountId: 'acc-uuid-1',
          brokerTradeId: 'trade-sell-part-1',
          isin: 'INE002A01018',
          exchange: ExchangeListing.NSE,
          symbol: 'RELIANCE',
          side: BrokerTradeSide.SELL,
          quantity: 20,
          price: 680,
          tradedAt: mockDate,
        },
      ]);
      mockAdapter.getQuote.mockResolvedValue({
        isin: 'INE002A01018',
        exchange: ExchangeListing.NSE,
        symbol: 'RELIANCE',
        lastPrice: 690,
        asOf: mockDate,
      });

      mockPrisma.ipo.findFirst.mockResolvedValue(sampleIpo);
      mockPrisma.brokerInstrument.upsert.mockResolvedValue(sampleInstrument);
      mockPrisma.brokerHolding.upsert.mockResolvedValue({ id: 'h-1' });
      mockPrisma.brokerTrade.upsert.mockResolvedValue({ id: 't-1' });

      mockPrisma.ipoInvestment.findMany.mockResolvedValue([sampleInvestmentPrisma]);
      mockPrisma.ipoInvestment.findUnique.mockResolvedValue(sampleInvestmentPrisma);
      mockPrisma.brokerInstrument.findFirst.mockResolvedValue(sampleInstrument);
      mockPrisma.brokerHolding.findUnique.mockResolvedValue({
        id: 'h-1',
        brokerAccountId: 'acc-uuid-1',
        instrumentId: 'inst-uuid-1',
        quantity: new Prisma.Decimal(30),
        averagePrice: new Prisma.Decimal(500),
        lastPrice: new Prisma.Decimal(650),
        currentValue: new Prisma.Decimal(19500),
        unrealizedPnl: new Prisma.Decimal(4500),
        asOf: mockDate,
      });
      mockPrisma.brokerTrade.findMany.mockResolvedValue([
        {
          id: 't-1',
          brokerTradeId: 'trade-sell-part-1',
          brokerAccountId: 'acc-uuid-1',
          instrumentId: 'inst-uuid-1',
          side: BrokerTradeSide.SELL,
          quantity: new Prisma.Decimal(20),
          price: new Prisma.Decimal(680),
          tradedAt: mockDate,
        },
      ]);
      mockPrisma.brokerHolding.update.mockResolvedValue({ id: 'h-1' });
      mockPrisma.brokerConnection.update.mockResolvedValue({ id: 'conn-1' });

      const result = await service.syncAccountPostListingInvestments(
        'user-123',
        'acc-uuid-1',
      );

      expect(result.brokerAccountId).toBe('acc-uuid-1');
      expect(result.syncedInvestmentsCount).toBe(1);
      expect(result.investments[0].status).toBe('PARTIALLY_SOLD');
      expect(result.investments[0].remainingQuantity).toBe(30);
      expect(result.investments[0].totalSoldQuantity).toBe(20);
      expect(mockPrisma.brokerHolding.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'h-1' },
          data: expect.objectContaining({
            lastPrice: new Prisma.Decimal(690),
            currentValue: new Prisma.Decimal(30 * 690),
          }),
        }),
      );
    });

    it('syncs account when still holding with updated live quote', async () => {
      mockAdapter.getHoldings.mockResolvedValue([
        {
          brokerAccountId: 'acc-uuid-1',
          isin: 'INE002A01018',
          exchange: ExchangeListing.NSE,
          symbol: 'RELIANCE',
          quantity: 50,
          averagePrice: 500,
          lastPrice: 650,
          currentValue: 32500,
          unrealizedPnl: 7500,
          asOf: mockDate,
        },
      ]);
      mockAdapter.getTrades.mockResolvedValue([]);
      mockAdapter.getQuote.mockResolvedValue({
        isin: 'INE002A01018',
        exchange: ExchangeListing.NSE,
        symbol: 'RELIANCE',
        lastPrice: 720,
        asOf: mockDate,
      });

      mockPrisma.ipo.findFirst.mockResolvedValue(sampleIpo);
      mockPrisma.brokerInstrument.upsert.mockResolvedValue(sampleInstrument);
      mockPrisma.brokerHolding.upsert.mockResolvedValue({ id: 'h-1' });
      mockPrisma.ipoInvestment.findMany.mockResolvedValue([sampleInvestmentPrisma]);
      mockPrisma.ipoInvestment.findUnique.mockResolvedValue(sampleInvestmentPrisma);
      mockPrisma.brokerInstrument.findFirst.mockResolvedValue(sampleInstrument);
      mockPrisma.brokerHolding.findUnique.mockResolvedValue({
        id: 'h-1',
        brokerAccountId: 'acc-uuid-1',
        instrumentId: 'inst-uuid-1',
        quantity: new Prisma.Decimal(50),
        averagePrice: new Prisma.Decimal(500),
        lastPrice: new Prisma.Decimal(650),
        currentValue: new Prisma.Decimal(32500),
        unrealizedPnl: new Prisma.Decimal(7500),
        asOf: mockDate,
      });
      mockPrisma.brokerTrade.findMany.mockResolvedValue([]);
      mockPrisma.brokerHolding.update.mockResolvedValue({ id: 'h-1' });
      mockPrisma.brokerConnection.update.mockResolvedValue({ id: 'conn-1' });

      const result = await service.syncAccountPostListingInvestments(
        'user-123',
        'acc-uuid-1',
      );

      expect(result.brokerAccountId).toBe('acc-uuid-1');
      expect(result.syncedInvestmentsCount).toBe(1);
      expect(result.investments[0].status).toBe('HOLDING');
      expect(result.investments[0].remainingQuantity).toBe(50);
      expect(mockAdapter.getQuote).toHaveBeenCalledWith(
        expect.any(Object),
        'INE002A01018',
        ExchangeListing.NSE,
      );
      expect(mockPrisma.brokerHolding.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'h-1' },
          data: expect.objectContaining({
            lastPrice: new Prisma.Decimal(720),
            currentValue: new Prisma.Decimal(50 * 720),
            unrealizedPnl: new Prisma.Decimal((720 - 500) * 50),
          }),
        }),
      );
    });

    it('transitions connection to EXPIRED when token is expired or invalid', async () => {
      mockAdapter.getHoldings.mockRejectedValue(
        new BadRequestException('Upstox authentication failed: Token has expired (status 401)'),
      );

      await expect(
        service.syncAccountPostListingInvestments('user-123', 'acc-uuid-1'),
      ).rejects.toThrow(BadRequestException);

      expect(mockConnectionService.markExpired).toHaveBeenCalledWith(
        'user-123',
        'acc-uuid-1',
        'Broker connection token expired or revoked',
      );
    });

    it('transitions Dhan connection to EXPIRED when session is expired or token invalid', async () => {
      mockAccountService.getAccount.mockResolvedValue({
        ...sampleAccount,
        broker: BrokerType.DHAN,
      });
      mockAdapter.getHoldings.mockRejectedValue(
        new BadRequestException('Dhan holdings fetch failed: Session expired (status 401)'),
      );

      await expect(
        service.syncAccountPostListingInvestments('user-123', 'acc-uuid-1'),
      ).rejects.toThrow(BadRequestException);

      expect(mockConnectionService.markExpired).toHaveBeenCalledWith(
        'user-123',
        'acc-uuid-1',
        'Broker connection token expired or revoked',
      );
    });

    it('transitions FYERS connection to EXPIRED when token is expired or unauthorized', async () => {
      mockAccountService.getAccount.mockResolvedValue({
        ...sampleAccount,
        broker: BrokerType.FYERS,
      });
      mockAdapter.getHoldings.mockRejectedValue(
        new BadRequestException('FYERS holdings fetch failed: Token expired or invalid (status 401)'),
      );

      await expect(
        service.syncAccountPostListingInvestments('user-123', 'acc-uuid-1'),
      ).rejects.toThrow(BadRequestException);

      expect(mockConnectionService.markExpired).toHaveBeenCalledWith(
        'user-123',
        'acc-uuid-1',
        'Broker connection token expired or revoked',
      );
    });

    it('transitions Zerodha connection to EXPIRED when token is expired or unauthorized', async () => {
      mockAccountService.getAccount.mockResolvedValue({
        ...sampleAccount,
        broker: BrokerType.ZERODHA,
      });
      mockAdapter.getHoldings.mockRejectedValue(
        new BadRequestException('Zerodha holdings fetch failed: Token exception: Invalid session or token expired (status 403)'),
      );

      await expect(
        service.syncAccountPostListingInvestments('user-123', 'acc-uuid-1'),
      ).rejects.toThrow(BadRequestException);

      expect(mockConnectionService.markExpired).toHaveBeenCalledWith(
        'user-123',
        'acc-uuid-1',
        'Broker connection token expired or revoked',
      );
    });

    it('transitions Groww connection to EXPIRED when token is expired or unauthorized', async () => {
      mockAccountService.getAccount.mockResolvedValue({
        ...sampleAccount,
        broker: BrokerType.GROWW,
      });
      mockAdapter.getHoldings.mockRejectedValue(
        new BadRequestException('Groww holdings fetch failed: Token expired or invalid (status 401)'),
      );

      await expect(
        service.syncAccountPostListingInvestments('user-123', 'acc-uuid-1'),
      ).rejects.toThrow(BadRequestException);

      expect(mockConnectionService.markExpired).toHaveBeenCalledWith(
        'user-123',
        'acc-uuid-1',
        'Broker connection token expired or revoked',
      );
    });

    it('transitions Millions connection to EXPIRED when token is expired or unauthorized', async () => {
      mockAccountService.getAccount.mockResolvedValue({
        ...sampleAccount,
        broker: BrokerType.MILLIONS,
      });
      mockAdapter.getHoldings.mockRejectedValue(
        new BadRequestException('Dhan holdings fetch failed: Session expired (status 401)'),
      );

      await expect(
        service.syncAccountPostListingInvestments('user-123', 'acc-uuid-1'),
      ).rejects.toThrow(BadRequestException);

      expect(mockConnectionService.markExpired).toHaveBeenCalledWith(
        'user-123',
        'acc-uuid-1',
        'Broker connection token expired or revoked',
      );
    });
  });

  describe('syncAllConnectedUpstoxAccounts', () => {
    it('processes all connected accounts for registered brokers and handles individual failures gracefully', async () => {
      mockPrisma.brokerConnection.findMany.mockResolvedValue([
        {
          brokerAccountId: 'acc-1',
          brokerAccount: { id: 'acc-1', userId: 'user-1' },
        },
        {
          brokerAccountId: 'acc-2',
          brokerAccount: { id: 'acc-2', userId: 'user-2' },
        },
      ]);

      const syncSpy = jest
        .spyOn(service, 'syncAccountPostListingInvestments')
        .mockResolvedValueOnce({
          brokerAccountId: 'acc-1',
          syncTimestamp: mockDate,
          syncedInvestmentsCount: 1,
          investments: [],
        })
        .mockRejectedValueOnce(new Error('Network failure'));

      const batchResult = await service.syncAllConnectedUpstoxAccounts();

      expect(mockPrisma.brokerConnection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            brokerAccount: expect.objectContaining({
              broker: {
                in: [
                  BrokerType.UPSTOX,
                  BrokerType.DHAN,
                  BrokerType.FYERS,
                  BrokerType.ZERODHA,
                  BrokerType.GROWW,
                  BrokerType.MILLIONS,
                ],
              },
            }),
          }),
        }),
      );
      expect(batchResult.processedCount).toBe(2);
      expect(batchResult.successCount).toBe(1);
      expect(batchResult.failureCount).toBe(1);
      expect(batchResult.results[0]).toEqual({
        brokerAccountId: 'acc-1',
        status: 'SUCCESS',
      });
      expect(batchResult.results[1]).toEqual({
        brokerAccountId: 'acc-2',
        status: 'FAILED',
        error: 'Network failure',
      });

      syncSpy.mockRestore();
    });
  });
});
