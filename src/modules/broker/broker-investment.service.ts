import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BrokerConnectionStatus,
  BrokerTradeSide,
  BrokerType,
  ExchangeListing,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { BrokerAccountService } from './broker-account.service';
import { BrokerConnectionService } from './broker-connection.service';
import { BrokerRegistry } from './broker.registry';
import { NormalizedHolding, NormalizedTrade } from './broker.types';

export interface RecordAllotmentInvestmentParams {
  ipoId: string;
  isin: string;
  allottedQuantity: number;
  allotmentPrice: number;
  allotmentDate?: Date | string | null;
  profileId?: string;
}

export type DerivedInvestmentStatus = 'HOLDING' | 'PARTIALLY_SOLD' | 'FULLY_SOLD';

export interface DerivedInvestmentSummary {
  brokerAccountId: string;
  ipoId: string;
  isin: string;
  exchange: ExchangeListing;
  symbol: string | null;
  allottedQuantity: number;
  allotmentPrice: number;
  allotmentDate: Date | null;
  totalSoldQuantity: number;
  remainingQuantity: number;
  currentHoldingQuantity: number;
  status: DerivedInvestmentStatus;
  sellTrades: Array<{
    brokerTradeId: string;
    quantity: number;
    price: number;
    tradedAt: Date;
  }>;
  holding: {
    lastPrice: number | null;
    currentValue: number | null;
    unrealizedPnl: number | null;
    asOf: Date | null;
  } | null;
}

export function isTokenExpiredError(err: unknown): boolean {
  if (!err) return false;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('expired') ||
    msg.includes('invalid token') ||
    msg.includes('token is invalid') ||
    msg.includes('unauthorized') ||
    msg.includes('status 401') ||
    msg.includes('status 403') ||
    msg.includes('udapi100050') ||
    msg.includes('re-authorization is required') ||
    msg.includes('re-authentication is required') ||
    msg.includes('session expired') ||
    msg.includes('tokenexception') ||
    msg.includes('session is invalid') ||
    msg.includes('session invalid')
  );
}

@Injectable()
export class BrokerInvestmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountService: BrokerAccountService,
    private readonly connectionService: BrokerConnectionService,
    private readonly brokerRegistry: BrokerRegistry,
  ) {}

  /**
   * Records initial IPO investment basis (allotted quantity, allotment price, allotment date)
   * after verifying user ownership, profile ownership, and ISIN matching against the IPO.
   */
  async recordAllotmentInvestment(
    userId: string,
    brokerAccountId: string,
    params: RecordAllotmentInvestmentParams,
  ) {
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new BadRequestException('User ID is required');
    }
    if (!brokerAccountId || typeof brokerAccountId !== 'string' || !brokerAccountId.trim()) {
      throw new BadRequestException('Broker Account ID is required');
    }
    if (!params.ipoId || typeof params.ipoId !== 'string' || !params.ipoId.trim()) {
      throw new BadRequestException('IPO ID is required');
    }
    if (!params.isin || typeof params.isin !== 'string' || !params.isin.trim()) {
      throw new BadRequestException('ISIN is required for investment matching');
    }
    if (params.allottedQuantity <= 0) {
      throw new BadRequestException('Allotted quantity must be greater than 0');
    }
    if (params.allotmentPrice < 0) {
      throw new BadRequestException('Allotment price must be non-negative');
    }

    // 1. Verify user ownership of the broker account
    const account = await this.accountService.getAccount(userId, brokerAccountId.trim());

    // 2. Verify profile ownership boundary if profileId is passed
    if (params.profileId && params.profileId.trim() !== account.profileId) {
      throw new BadRequestException(
        `Account belongs to profile ${account.profileId}, not ${params.profileId}`,
      );
    }

    // 3. Verify IPO existence and validate ISIN match
    const ipo = await this.prisma.ipo.findUnique({
      where: { id: params.ipoId.trim() },
      select: { id: true, isin: true, symbol: true, exchange: true },
    });

    if (!ipo) {
      throw new NotFoundException(`IPO with id ${params.ipoId} not found`);
    }

    const normalizedParamIsin = params.isin.trim().toUpperCase();
    const normalizedIpoIsin = ipo.isin ? ipo.isin.trim().toUpperCase() : null;

    if (normalizedIpoIsin && normalizedIpoIsin !== normalizedParamIsin) {
      throw new BadRequestException(
        `ISIN mismatch: IPO ISIN is ${normalizedIpoIsin}, provided allotment ISIN is ${normalizedParamIsin}`,
      );
    }

    const allotmentDate = params.allotmentDate ? new Date(params.allotmentDate) : null;

    // 4. Persist/update IpoInvestment record
    return this.prisma.ipoInvestment.upsert({
      where: {
        brokerAccountId_ipoId: {
          brokerAccountId: brokerAccountId.trim(),
          ipoId: ipo.id,
        },
      },
      create: {
        brokerAccountId: brokerAccountId.trim(),
        ipoId: ipo.id,
        allottedQuantity: new Prisma.Decimal(params.allottedQuantity),
        allotmentPrice: new Prisma.Decimal(params.allotmentPrice),
        allotmentDate,
      },
      update: {
        allottedQuantity: new Prisma.Decimal(params.allottedQuantity),
        allotmentPrice: new Prisma.Decimal(params.allotmentPrice),
        allotmentDate,
      },
    });
  }

  /**
   * Persists normalized holdings and trades fetched from a connected broker account.
   * Matches instruments primarily by ISIN and links to IPOs if ISIN corresponds to an active IPO.
   */
  async persistHoldingsAndTrades(
    userId: string,
    brokerAccountId: string,
    holdings: NormalizedHolding[],
    trades: NormalizedTrade[],
  ) {
    if (!userId || !brokerAccountId) {
      throw new BadRequestException('User ID and Account ID are required');
    }

    const account = await this.accountService.getAccount(userId, brokerAccountId.trim());

    return this.prisma.$transaction(async (tx) => {
      // 1. Collect all distinct ISIN + Exchange pairs from holdings & trades
      const instrumentMap = new Map<
        string,
        {
          isin: string;
          exchange: ExchangeListing;
          symbol: string | null;
        }
      >();

      for (const h of holdings) {
        if (h.isin) {
          const key = `${account.broker}_${h.isin.trim().toUpperCase()}_${h.exchange}`;
          instrumentMap.set(key, {
            isin: h.isin.trim().toUpperCase(),
            exchange: h.exchange,
            symbol: h.symbol ?? null,
          });
        }
      }

      for (const t of trades) {
        if (t.isin) {
          const key = `${account.broker}_${t.isin.trim().toUpperCase()}_${t.exchange}`;
          if (!instrumentMap.has(key)) {
            instrumentMap.set(key, {
              isin: t.isin.trim().toUpperCase(),
              exchange: t.exchange,
              symbol: t.symbol ?? null,
            });
          }
        }
      }

      // 2. For each instrument, find if an IPO matches by ISIN and upsert BrokerInstrument
      const isinToInstrumentId = new Map<string, string>();

      for (const inst of instrumentMap.values()) {
        const matchingIpo = await tx.ipo.findFirst({
          where: { isin: inst.isin },
          select: { id: true },
        });

        const brokerInstrument = await tx.brokerInstrument.upsert({
          where: {
            broker_isin_exchange: {
              broker: account.broker,
              isin: inst.isin,
              exchange: inst.exchange,
            },
          },
          create: {
            broker: account.broker,
            isin: inst.isin,
            exchange: inst.exchange,
            symbol: inst.symbol,
            ipoId: matchingIpo?.id ?? null,
          },
          update: {
            symbol: inst.symbol ?? undefined,
            ipoId: matchingIpo ? matchingIpo.id : undefined,
          },
        });

        const key = `${inst.isin}_${inst.exchange}`;
        isinToInstrumentId.set(key, brokerInstrument.id);
      }

      // 3. Persist holdings
      for (const h of holdings) {
        const instKey = `${h.isin.trim().toUpperCase()}_${h.exchange}`;
        const instrumentId = isinToInstrumentId.get(instKey);
        if (!instrumentId) continue;

        await tx.brokerHolding.upsert({
          where: {
            brokerAccountId_instrumentId: {
              brokerAccountId: account.id,
              instrumentId,
            },
          },
          create: {
            brokerAccountId: account.id,
            instrumentId,
            quantity: new Prisma.Decimal(h.quantity),
            averagePrice: h.averagePrice != null ? new Prisma.Decimal(h.averagePrice) : null,
            lastPrice: h.lastPrice != null ? new Prisma.Decimal(h.lastPrice) : null,
            currentValue: h.currentValue != null ? new Prisma.Decimal(h.currentValue) : null,
            unrealizedPnl: h.unrealizedPnl != null ? new Prisma.Decimal(h.unrealizedPnl) : null,
            asOf: h.asOf,
          },
          update: {
            quantity: new Prisma.Decimal(h.quantity),
            averagePrice: h.averagePrice != null ? new Prisma.Decimal(h.averagePrice) : null,
            lastPrice: h.lastPrice != null ? new Prisma.Decimal(h.lastPrice) : null,
            currentValue: h.currentValue != null ? new Prisma.Decimal(h.currentValue) : null,
            unrealizedPnl: h.unrealizedPnl != null ? new Prisma.Decimal(h.unrealizedPnl) : null,
            asOf: h.asOf,
          },
        });
      }

      // 4. Persist trades
      for (const t of trades) {
        const instKey = `${t.isin.trim().toUpperCase()}_${t.exchange}`;
        const instrumentId = isinToInstrumentId.get(instKey);
        if (!instrumentId) continue;

        await tx.brokerTrade.upsert({
          where: {
            brokerAccountId_brokerTradeId: {
              brokerAccountId: account.id,
              brokerTradeId: t.brokerTradeId,
            },
          },
          create: {
            brokerAccountId: account.id,
            instrumentId,
            brokerTradeId: t.brokerTradeId,
            side: t.side,
            quantity: new Prisma.Decimal(t.quantity),
            price: new Prisma.Decimal(t.price),
            tradedAt: t.tradedAt,
          },
          update: {
            side: t.side,
            quantity: new Prisma.Decimal(t.quantity),
            price: new Prisma.Decimal(t.price),
            tradedAt: t.tradedAt,
          },
        });
      }

      return {
        persistedHoldingsCount: holdings.length,
        persistedTradesCount: trades.length,
      };
    });
  }

  /**
   * Derives current investment position and sell trade detection dynamically
   * without redundant database fields.
   */
  async getDerivedInvestmentSummary(
    userId: string,
    brokerAccountId: string,
    ipoId: string,
  ): Promise<DerivedInvestmentSummary> {
    if (!userId || !brokerAccountId || !ipoId) {
      throw new BadRequestException('User ID, Account ID, and IPO ID are required');
    }

    const account = await this.accountService.getAccount(userId, brokerAccountId.trim());

    // 1. Retrieve IpoInvestment record
    const investment = await this.prisma.ipoInvestment.findUnique({
      where: {
        brokerAccountId_ipoId: {
          brokerAccountId: account.id,
          ipoId: ipoId.trim(),
        },
      },
      include: {
        ipo: {
          select: {
            id: true,
            isin: true,
            symbol: true,
            exchange: true,
          },
        },
      },
    });

    if (!investment) {
      throw new NotFoundException(`No IPO investment record found for IPO ${ipoId}`);
    }

    const isin = investment.ipo.isin?.trim().toUpperCase();
    if (!isin) {
      throw new BadRequestException(`IPO ${ipoId} does not have a configured ISIN`);
    }

    // 2. Find BrokerInstrument linked to this ISIN
    const instrument = await this.prisma.brokerInstrument.findFirst({
      where: {
        broker: account.broker,
        isin,
      },
    });

    const allottedQuantity = Number(investment.allottedQuantity);
    const allotmentPrice = Number(investment.allotmentPrice);
    const allotmentDate = investment.allotmentDate ? new Date(investment.allotmentDate) : null;

    if (!instrument) {
      return {
        brokerAccountId: account.id,
        ipoId: investment.ipoId,
        isin,
        exchange: investment.ipo.exchange,
        symbol: investment.ipo.symbol,
        allottedQuantity,
        allotmentPrice,
        allotmentDate,
        totalSoldQuantity: 0,
        remainingQuantity: allottedQuantity,
        currentHoldingQuantity: 0,
        status: 'HOLDING',
        sellTrades: [],
        holding: null,
      };
    }

    // 3. Find current BrokerHolding
    const holding = await this.prisma.brokerHolding.findUnique({
      where: {
        brokerAccountId_instrumentId: {
          brokerAccountId: account.id,
          instrumentId: instrument.id,
        },
      },
    });

    // 4. Find all SELL trades for this instrument
    const sellTrades = await this.prisma.brokerTrade.findMany({
      where: {
        brokerAccountId: account.id,
        instrumentId: instrument.id,
        side: BrokerTradeSide.SELL,
      },
      orderBy: { tradedAt: 'asc' },
    });

    const totalSoldQuantity = sellTrades.reduce(
      (sum, t) => sum + Number(t.quantity),
      0,
    );

    const currentHoldingQuantity = holding ? Number(holding.quantity) : 0;

    // Remaining quantity derived from holding or (allottedQuantity - totalSoldQuantity)
    const remainingQuantity = holding
      ? currentHoldingQuantity
      : Math.max(0, allottedQuantity - totalSoldQuantity);

    let status: DerivedInvestmentStatus = 'HOLDING';
    if (remainingQuantity === 0 || totalSoldQuantity >= allottedQuantity) {
      status = 'FULLY_SOLD';
    } else if (totalSoldQuantity > 0 && remainingQuantity > 0) {
      status = 'PARTIALLY_SOLD';
    }

    return {
      brokerAccountId: account.id,
      ipoId: investment.ipoId,
      isin,
      exchange: instrument.exchange,
      symbol: instrument.symbol || investment.ipo.symbol,
      allottedQuantity,
      allotmentPrice,
      allotmentDate,
      totalSoldQuantity,
      remainingQuantity,
      currentHoldingQuantity,
      status,
      sellTrades: sellTrades.map((t) => ({
        brokerTradeId: t.brokerTradeId,
        quantity: Number(t.quantity),
        price: Number(t.price),
        tradedAt: t.tradedAt,
      })),
      holding: holding
        ? {
            lastPrice: holding.lastPrice != null ? Number(holding.lastPrice) : null,
            currentValue: holding.currentValue != null ? Number(holding.currentValue) : null,
            unrealizedPnl: holding.unrealizedPnl != null ? Number(holding.unrealizedPnl) : null,
            asOf: holding.asOf,
          }
        : null,
    };
  }

  /**
   * Syncs live portfolio holdings and trades in memory via Upstox adapter,
   * updates the persistence layer, and returns the derived investment summary.
   */
  async syncAndMatchInvestment(
    userId: string,
    brokerAccountId: string,
    ipoId: string,
  ): Promise<DerivedInvestmentSummary> {
    const account = await this.accountService.getAccount(userId, brokerAccountId.trim());
    const tokens = await this.connectionService.getDecryptedTokens(userId, account.id);

    const adapter = this.brokerRegistry.getAdapter(account.broker);
    const holdings = await adapter.getHoldings(tokens, account.id);
    const trades = await adapter.getTrades(tokens, account.id);

    await this.persistHoldingsAndTrades(userId, account.id, holdings, trades);

    return this.getDerivedInvestmentSummary(userId, account.id, ipoId);
  }

  /**
   * Syncs all relevant post-listing IPO investments for a connected account.
   * - Fetches today's trades and current holdings in memory.
   * - Persists normalized holdings and trades.
   * - For each matched IPO investment:
   *   - Detects full or partial sell trades.
   *   - If still held (remainingQuantity > 0), fetches real-time quote and updates holding.
   *   - Updates BrokerConnection.lastSyncAt.
   *   - Derives updated investment summary.
   * - Transitions connection to EXPIRED if token is expired/invalid.
   */
  async syncAccountPostListingInvestments(
    userId: string,
    brokerAccountId: string,
  ): Promise<{
    brokerAccountId: string;
    syncTimestamp: Date;
    syncedInvestmentsCount: number;
    investments: DerivedInvestmentSummary[];
  }> {
    const account = await this.accountService.getAccount(
      userId,
      brokerAccountId.trim(),
    );

    try {
      const tokens = await this.connectionService.getDecryptedTokens(
        userId,
        account.id,
      );

      const adapter = this.brokerRegistry.getAdapter(account.broker);
      const [holdings, trades] = await Promise.all([
        adapter.getHoldings(tokens, account.id),
        adapter.getTrades(tokens, account.id),
      ]);

      await this.persistHoldingsAndTrades(userId, account.id, holdings, trades);

      // Find all IpoInvestment records for this account
      const investments = await this.prisma.ipoInvestment.findMany({
        where: { brokerAccountId: account.id },
        include: {
          ipo: {
            select: {
              id: true,
              isin: true,
              symbol: true,
              exchange: true,
              status: true,
            },
          },
        },
      });

      const summaries: DerivedInvestmentSummary[] = [];

      for (const inv of investments) {
        if (!inv.ipo.isin) continue;

        let summary = await this.getDerivedInvestmentSummary(
          userId,
          account.id,
          inv.ipoId,
        );

        // If still holding and adapter supports quotes, fetch current market quote to update holding
        if (
          summary.remainingQuantity > 0 &&
          summary.holding &&
          adapter.capabilities?.quotes
        ) {
          try {
            const quote = await adapter.getQuote(
              tokens,
              summary.isin,
              summary.exchange,
            );

            if (quote && quote.lastPrice > 0) {
              const instrument = await this.prisma.brokerInstrument.findFirst({
                where: {
                  broker: account.broker,
                  isin: summary.isin,
                },
              });

              if (instrument) {
                const currentHolding = await this.prisma.brokerHolding.findUnique({
                  where: {
                    brokerAccountId_instrumentId: {
                      brokerAccountId: account.id,
                      instrumentId: instrument.id,
                    },
                  },
                });

                if (currentHolding) {
                  const qty = Number(currentHolding.quantity);
                  const avgPrice = currentHolding.averagePrice
                    ? Number(currentHolding.averagePrice)
                    : summary.allotmentPrice;
                  const lastPrice = quote.lastPrice;
                  const currentValue = qty * lastPrice;
                  const unrealizedPnl = (lastPrice - avgPrice) * qty;

                  await this.prisma.brokerHolding.update({
                    where: { id: currentHolding.id },
                    data: {
                      lastPrice: new Prisma.Decimal(lastPrice),
                      currentValue: new Prisma.Decimal(currentValue),
                      unrealizedPnl: new Prisma.Decimal(unrealizedPnl),
                      asOf: quote.asOf || new Date(),
                    },
                  });

                  // Refresh summary with updated quote
                  summary = await this.getDerivedInvestmentSummary(
                    userId,
                    account.id,
                    inv.ipoId,
                  );
                }
              }
            }
          } catch {
            // Quote fetch failure should not fail the entire sync flow
          }
        }

        summaries.push(summary);
      }

      const syncTimestamp = new Date();
      await this.prisma.brokerConnection.update({
        where: { brokerAccountId: account.id },
        data: {
          lastSyncAt: syncTimestamp,
          lastError: null,
          lastErrorAt: null,
        },
      });

      return {
        brokerAccountId: account.id,
        syncTimestamp,
        syncedInvestmentsCount: summaries.length,
        investments: summaries,
      };
    } catch (err: unknown) {
      if (isTokenExpiredError(err)) {
        await this.connectionService
          .markExpired(
            userId,
            account.id,
            'Broker connection token expired or revoked',
          )
          .catch(() => {});
      } else {
        const safeMsg = (
          err instanceof Error ? err.message : String(err)
        ).slice(0, 500);
        await this.prisma.brokerConnection
          .update({
            where: { brokerAccountId: account.id },
            data: {
              lastError: safeMsg,
              lastErrorAt: new Date(),
            },
          })
          .catch(() => {});
      }
      throw err;
    }
  }

  /**
   * Iterates across all active CONNECTED Upstox accounts and executes post-listing sync.
   * Isolates failures per account so one failing account doesn't abort the batch.
   */
  async syncAllConnectedUpstoxAccounts(): Promise<{
    processedCount: number;
    successCount: number;
    failureCount: number;
    results: Array<{
      brokerAccountId: string;
      status: 'SUCCESS' | 'FAILED';
      error?: string;
    }>;
  }> {
    const supportedBrokers = this.brokerRegistry.getSupportedBrokers();
    const connectedAccounts = await this.prisma.brokerConnection.findMany({
      where: {
        status: BrokerConnectionStatus.CONNECTED,
        brokerAccount: {
          broker:
            supportedBrokers.length > 0
              ? { in: supportedBrokers }
              : BrokerType.UPSTOX,
          isActive: true,
        },
      },
      include: {
        brokerAccount: {
          select: {
            id: true,
            userId: true,
          },
        },
      },
    });

    let successCount = 0;
    let failureCount = 0;
    const results: Array<{
      brokerAccountId: string;
      status: 'SUCCESS' | 'FAILED';
      error?: string;
    }> = [];

    for (const conn of connectedAccounts) {
      try {
        await this.syncAccountPostListingInvestments(
          conn.brokerAccount.userId,
          conn.brokerAccountId,
        );
        successCount++;
        results.push({
          brokerAccountId: conn.brokerAccountId,
          status: 'SUCCESS',
        });
      } catch (err: unknown) {
        failureCount++;
        const msg = err instanceof Error ? err.message : String(err);
        results.push({
          brokerAccountId: conn.brokerAccountId,
          status: 'FAILED',
          error: msg,
        });
      }
    }

    return {
      processedCount: connectedAccounts.length,
      successCount,
      failureCount,
      results,
    };
  }
}

