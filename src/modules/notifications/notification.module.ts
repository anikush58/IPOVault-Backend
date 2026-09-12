import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { DiscoveryModule } from '../discovery/discovery.module';
import { InAppDeliveryAdapter } from './adapters/in-app-delivery.adapter';
import { NotificationEventGenerator } from './notification-event.generator';
import { NotificationDeliveryRepository } from './notification-delivery.repository';
import { NotificationDeliveryService } from './notification-delivery.service';
import { NotificationDeliveryRetryPolicy } from './notification-delivery-retry-policy';
import { NotificationDeliveryWorkerService } from './notification-delivery-worker.service';
import { NotificationDeliverySchedulerService } from './notification-delivery-scheduler.service';
import { NotificationDeliveryOperationsService } from './notification-delivery-operations.service';
import { NotificationOrchestratorService } from './notification-orchestrator.service';
import { NotificationController } from './notification.controller';
import { NotificationRepository } from './notification.repository';
import { NotificationService } from './notification.service';

@Module({
  imports: [DatabaseModule, DiscoveryModule],
  controllers: [NotificationController],
  providers: [
    // Phase 29.4, 29.6 & 29.8 — Delivery Infrastructure, Automation & Operations
    NotificationDeliveryRepository,
    InAppDeliveryAdapter,
    NotificationDeliveryService,
    NotificationDeliveryRetryPolicy,
    NotificationDeliveryWorkerService,
    NotificationDeliverySchedulerService,
    NotificationDeliveryOperationsService,
    // Phase 29.1-29.3 — Notification Domain
    NotificationRepository,
    NotificationEventGenerator,
    NotificationService,
    NotificationOrchestratorService,
  ],
  exports: [
    NotificationRepository,
    NotificationEventGenerator,
    NotificationService,
    NotificationOrchestratorService,
    NotificationDeliveryService,
    NotificationDeliveryRetryPolicy,
    NotificationDeliveryWorkerService,
    NotificationDeliverySchedulerService,
    NotificationDeliveryOperationsService,
  ],
})
export class NotificationModule {}
