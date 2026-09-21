import { Module } from '@nestjs/common';
import { BrokerCryptoService } from './security/broker-crypto.service';

@Module({
  providers: [BrokerCryptoService],
  exports: [BrokerCryptoService],
})
export class BrokerModule {}
