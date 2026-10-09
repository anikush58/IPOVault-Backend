import { Module, OnModuleInit } from '@nestjs/common';
import { BrokerCryptoService } from './security/broker-crypto.service';
import { BrokerOAuthStateService } from './security/broker-oauth-state.service';
import { BrokerAccountService } from './broker-account.service';
import { BrokerConnectionService } from './broker-connection.service';
import { BrokerInvestmentService } from './broker-investment.service';
import { BrokerSyncSchedulerService } from './broker-sync-scheduler.service';
import { BrokerAccountController } from './broker-account.controller';
import { BrokerRegistry } from './broker.registry';
import { UpstoxBrokerAdapter } from './adapters/upstox.adapter';
import { DhanBrokerAdapter } from './adapters/dhan.adapter';
import { FyersBrokerAdapter } from './adapters/fyers.adapter';
import { ZerodhaBrokerAdapter } from './adapters/zerodha.adapter';
import { GrowwBrokerAdapter } from './adapters/groww.adapter';
import { MillionsBrokerAdapter } from './adapters/millions.adapter';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [BrokerAccountController],
  providers: [
    BrokerCryptoService,
    BrokerOAuthStateService,
    BrokerAccountService,
    BrokerConnectionService,
    BrokerInvestmentService,
    BrokerSyncSchedulerService,
    BrokerRegistry,
    UpstoxBrokerAdapter,
    DhanBrokerAdapter,
    FyersBrokerAdapter,
    ZerodhaBrokerAdapter,
    GrowwBrokerAdapter,
    MillionsBrokerAdapter,
  ],
  exports: [
    BrokerCryptoService,
    BrokerOAuthStateService,
    BrokerAccountService,
    BrokerConnectionService,
    BrokerInvestmentService,
    BrokerSyncSchedulerService,
    BrokerRegistry,
    UpstoxBrokerAdapter,
    DhanBrokerAdapter,
    FyersBrokerAdapter,
    ZerodhaBrokerAdapter,
    GrowwBrokerAdapter,
    MillionsBrokerAdapter,
  ],
})
export class BrokerModule implements OnModuleInit {
  constructor(
    private readonly registry: BrokerRegistry,
    private readonly upstoxAdapter: UpstoxBrokerAdapter,
    private readonly dhanAdapter: DhanBrokerAdapter,
    private readonly fyersAdapter: FyersBrokerAdapter,
    private readonly zerodhaAdapter: ZerodhaBrokerAdapter,
    private readonly growwAdapter: GrowwBrokerAdapter,
    private readonly millionsAdapter: MillionsBrokerAdapter,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.upstoxAdapter);
    this.registry.register(this.dhanAdapter);
    this.registry.register(this.fyersAdapter);
    this.registry.register(this.zerodhaAdapter);
    this.registry.register(this.growwAdapter);
    this.registry.register(this.millionsAdapter);
  }
}

