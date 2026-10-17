import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { createLoggerParams } from './common/logging/logger.config';
import { Env, validateEnv } from './config/env';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { IposModule } from './modules/ipos/ipos.module';
import { SourcesModule } from './modules/sources/sources.module';
import { AllotmentModule } from './modules/allotment/allotment.module';
import { UserModule } from './modules/user/user.module';
import { NotificationModule } from './modules/notifications/notification.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { ConsoleModule } from './modules/console/console.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { BrokerModule } from './modules/broker/broker.module';
import { IpoGuruModule } from './modules/ipo-guru/ipo-guru.module';
import { EnrichmentModule } from './modules/enrichment/enrichment.module';
import { EmailModule } from './modules/email/email.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        createLoggerParams(config),
    }),
    DatabaseModule,
    EmailModule,
    AuthModule,
    CompaniesModule,
    IposModule,
    SourcesModule,
    DiscoveryModule,
    AllotmentModule,
    UserModule,
    NotificationModule,
    AnalyticsModule,
    ConsoleModule,
    AdminModule,
    BrokerModule,
    IpoGuruModule,
    EnrichmentModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseEnvelopeInterceptor,
    },
  ],
})
export class AppModule {}
