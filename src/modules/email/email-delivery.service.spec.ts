import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { EmailDeliveryService } from './email-delivery.service';
import { RESEND_CLIENT } from './email.constants';
import { AppException } from '../../common/errors/app.exception';

describe('EmailDeliveryService', () => {
  let service: EmailDeliveryService;
  let resendMock: any;
  let configMock: any;
  let loggerLogSpy: jest.SpyInstance;
  let loggerErrorSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;

  beforeEach(async () => {
    resendMock = {
      emails: {
        send: jest.fn().mockResolvedValue({
          data: { id: 'email_msg_12345' },
          error: null,
        }),
      },
    };

    configMock = {
      get: jest.fn((key: string) => {
        if (key === 'NODE_ENV') return 'test';
        if (key === 'RESEND_API_KEY') return 're_test_key_1234567890';
        if (key === 'EMAIL_FROM') return 'IPOVault Security <noreply@getipovault.in>';
        if (key === 'PUBLIC_APP_URL') return 'https://getipovault.in/';
        return null;
      }),
    };

    loggerLogSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailDeliveryService,
        {
          provide: ConfigService,
          useValue: configMock,
        },
        {
          provide: RESEND_CLIENT,
          useValue: resendMock,
        },
      ],
    }).compile();

    service = module.get<EmailDeliveryService>(EmailDeliveryService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('buildConfirmationUrl', () => {
    it('should construct confirmation URL with normalized base URL and encoded token', () => {
      const token = 'payloadBase64.signatureHash-123_456';
      const url = service.buildConfirmationUrl(token);

      expect(url).toBe(
        'https://getipovault.in/api/v1/user/confirm-deletion?token=payloadBase64.signatureHash-123_456',
      );
      expect(url).not.toContain('//api/v1');
    });

    it('should URL-encode special characters in the token if present', () => {
      const specialToken = 'part1+part2==.sig/test';
      const url = service.buildConfirmationUrl(specialToken);

      expect(url).toContain(encodeURIComponent(specialToken));
    });
  });

  describe('sendAccountDeletionConfirmation', () => {
    it('should successfully dispatch account deletion email with proper subject, text, and html', async () => {
      const recipient = 'investor@example.com';
      const uid = 'uid-test-123';
      const token = 'header.payload.signature';

      const result = await service.sendAccountDeletionConfirmation(recipient, uid, token);

      expect(result.id).toBe('email_msg_12345');
      expect(resendMock.emails.send).toHaveBeenCalledTimes(1);

      const sendArgs = resendMock.emails.send.mock.calls[0][0];
      expect(sendArgs.to).toBe('investor@example.com');
      expect(sendArgs.from).toBe('IPOVault Security <noreply@getipovault.in>');
      expect(sendArgs.subject).toBe('Confirm Permanent Deletion of Your IPOVault Account');
      expect(sendArgs.text).toContain('https://getipovault.in/api/v1/user/confirm-deletion?token=');
      expect(sendArgs.text).toContain(encodeURIComponent(token));
      expect(sendArgs.html).toContain('Confirm &amp; Permanently Delete Account');
      expect(sendArgs.html).toContain(encodeURIComponent(token));
    });

    it('should reject invalid recipient email with 400 validation error', async () => {
      await expect(
        service.sendAccountDeletionConfirmation('not-an-email', 'uid-1', 'token-1'),
      ).rejects.toThrow(AppException);
      expect(resendMock.emails.send).not.toHaveBeenCalled();
    });

    it('should handle Resend API rejection error safely and fail closed with 500', async () => {
      resendMock.emails.send.mockResolvedValue({
        data: null,
        error: {
          name: 'validation_error',
          message: 'Sender domain getipovault.in is not verified',
        },
      });

      await expect(
        service.sendAccountDeletionConfirmation('user@example.com', 'uid-fail', 'sample-token'),
      ).rejects.toThrow(
        expect.objectContaining({
          httpStatus: 500,
        }),
      );

      // Verify safe logging: error logged, but never raw token or unmasked email
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Resend rejected deletion email for uid: uid-fail'),
      );
      const loggedError = loggerErrorSpy.mock.calls[0][0];
      expect(loggedError).not.toContain('sample-token');
      expect(loggedError).not.toContain('re_test_key_1234567890');
    });

    it('should handle Resend network timeout or connection error safely and fail closed with 500', async () => {
      resendMock.emails.send.mockRejectedValue(new Error('FetchError: connection timeout after 10000ms'));

      await expect(
        service.sendAccountDeletionConfirmation('timeout@example.com', 'uid-timeout', 'sample-token-2'),
      ).rejects.toThrow(
        expect.objectContaining({
          httpStatus: 500,
        }),
      );

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Resend network error dispatching deletion email'),
      );
      const loggedError = loggerErrorSpy.mock.calls[0][0];
      expect(loggedError).not.toContain('sample-token-2');
      expect(loggedError).not.toContain('re_test_key_1234567890');
    });

    it('should enforce safe logging and never expose raw token, API key, or unmasked email in success logs', async () => {
      loggerLogSpy.mockClear();
      await service.sendAccountDeletionConfirmation('confidential.user@gmail.com', 'uid-sensitive', 'super-secret-raw-token');

      const loggedSuccess = loggerLogSpy.mock.calls
        .map((call) => call[0])
        .find((msg) => typeof msg === 'string' && msg.includes('dispatched successfully'));

      expect(loggedSuccess).toBeDefined();
      // Must contain masked email
      expect(loggedSuccess).toContain('co***r@gmail.com');
      // Must NOT contain full raw email
      expect(loggedSuccess).not.toContain('confidential.user@gmail.com');
      // Must NOT contain raw confirmation token
      expect(loggedSuccess).not.toContain('super-secret-raw-token');
      // Must NOT contain API key
      expect(loggedSuccess).not.toContain('re_test_key_1234567890');
    });
  });

  describe('production configuration failure (fail-closed)', () => {
    it('should throw an error on startup if RESEND_API_KEY is missing in production environment', () => {
      const prodConfigMock = {
        get: jest.fn((key: string) => {
          if (key === 'NODE_ENV') return 'production';
          if (key === 'RESEND_API_KEY') return '';
          return null;
        }),
      };

      expect(() => {
        new EmailDeliveryService(prodConfigMock as any);
      }).toThrow(/RESEND_API_KEY must be configured in production environment/);
    });

    it('should skip email and log warning in non-production when RESEND_API_KEY is not configured', async () => {
      const devConfigMock = {
        get: jest.fn((key: string) => {
          if (key === 'NODE_ENV') return 'development';
          if (key === 'RESEND_API_KEY') return null;
          return null;
        }),
      };

      const devService = new EmailDeliveryService(devConfigMock as any);
      const result = await devService.sendAccountDeletionConfirmation(
        'developer@example.com',
        'uid-dev-1',
        'token-dev-123',
      );

      expect(result.skipped).toBe(true);
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('RESEND_API_KEY not configured; skipping email dispatch'),
      );
      // Verify email was masked in the warning log
      expect(loggerWarnSpy.mock.calls[0][0]).toContain('de***r@example.com');
      expect(loggerWarnSpy.mock.calls[0][0]).not.toContain('developer@example.com');
    });
  });
});
