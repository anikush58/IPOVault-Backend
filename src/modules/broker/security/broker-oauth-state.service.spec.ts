import { BadRequestException } from '@nestjs/common';
import { BrokerOAuthStateService } from './broker-oauth-state.service';

describe('BrokerOAuthStateService', () => {
  let service: BrokerOAuthStateService;

  beforeEach(() => {
    service = new BrokerOAuthStateService();
  });

  it('1. valid state: generates, verifies, and successfully validates state bound to user and account', () => {
    const state = service.generateState('user-123', 'acc-uuid-1');

    expect(state).toBeDefined();
    expect(typeof state).toBe('string');
    expect(state.length).toBe(64); // 32 bytes hex = 64 chars

    expect(() => {
      service.validateAndConsumeState(state, 'user-123', 'acc-uuid-1');
    }).not.toThrow();
  });

  it('2. invalid state: rejects missing, malformed, or non-existent state tokens', () => {
    // Missing / empty state
    expect(() => {
      service.validateAndConsumeState(undefined, 'user-123', 'acc-uuid-1');
    }).toThrow(BadRequestException);

    expect(() => {
      service.validateAndConsumeState('', 'user-123', 'acc-uuid-1');
    }).toThrow(BadRequestException);

    // Non-existent state
    expect(() => {
      service.validateAndConsumeState(
        'non-existent-state-token-123',
        'user-123',
        'acc-uuid-1',
      );
    }).toThrow(BadRequestException);

    // State generated for different user/account
    const state = service.generateState('user-123', 'acc-uuid-1');
    expect(() => {
      service.validateAndConsumeState(state, 'different-user', 'acc-uuid-1');
    }).toThrow(BadRequestException);
  });

  it('3. expired state: rejects state tokens that have exceeded their TTL', () => {
    // Generate state with a negative or 0ms TTL so it is already expired
    const expiredState = service.generateState('user-123', 'acc-uuid-1', -1000);

    expect(() => {
      service.validateAndConsumeState(expiredState, 'user-123', 'acc-uuid-1');
    }).toThrow(BadRequestException);
  });

  it('4. reused state: enforces single-use and invalidates token after first consumption', () => {
    const state = service.generateState('user-123', 'acc-uuid-1');

    // First use must succeed
    expect(() => {
      service.validateAndConsumeState(state, 'user-123', 'acc-uuid-1');
    }).not.toThrow();

    // Reused state must fail
    expect(() => {
      service.validateAndConsumeState(state, 'user-123', 'acc-uuid-1');
    }).toThrow(BadRequestException);
  });

  it('5. resolves bound record when validating state without explicit expected user/account', () => {
    const state = service.generateState('user-123', 'acc-uuid-1');

    const record = service.validateAndConsumeState(state);
    expect(record).toBeDefined();
    expect(record.userId).toBe('user-123');
    expect(record.brokerAccountId).toBe('acc-uuid-1');
  });
});
