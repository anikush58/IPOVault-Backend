import { Module } from '@nestjs/common';
import { BrokerCryptoService } from './security/broker-crypto.service';
import { BrokerAccountService } from './broker-account.service';
import { BrokerConnectionService } from './broker-connection.service';

@Module({
  providers: [
    BrokerCryptoService,
    BrokerAccountService,
    BrokerConnectionService,
  ],
  exports: [
    BrokerCryptoService,
    BrokerAccountService,
    BrokerConnectionService,
  ],
})
export class BrokerModule {}

