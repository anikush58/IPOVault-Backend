import { BrokerConnectionStatus, BrokerType } from '@prisma/client';

export interface BrokerConnectionResponseDto {
  id?: string;
  brokerAccountId?: string;
  status: BrokerConnectionStatus;
  connectedAt: Date | null;
  lastSyncAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface BrokerAccountResponseDto {
  id: string;
  profileId: string;
  broker: BrokerType;
  accountName: string | null;
  clientId: string | null;
  isActive: boolean;
  connection: BrokerConnectionResponseDto | null;
  createdAt: Date;
  updatedAt: Date;
}
