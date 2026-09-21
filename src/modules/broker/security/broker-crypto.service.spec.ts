import { ConfigService } from '@nestjs/config';
import { BrokerCryptoService } from './broker-crypto.service';
import { Env } from '../../../config/env';

describe('BrokerCryptoService', () => {
  let service: BrokerCryptoService;
  let mockConfigService: jest.Mocked<ConfigService<Env, true>>;

  const valid32ByteSecret = 'a'.repeat(32);

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'BROKER_TOKEN_ENCRYPTION_SECRET') {
          return valid32ByteSecret;
        }
        if (key === 'NODE_ENV') {
          return 'test';
        }
        return undefined;
      }),
    } as unknown as jest.Mocked<ConfigService<Env, true>>;

    service = new BrokerCryptoService(mockConfigService);
  });

  describe('1. Encrypt / Decrypt Round Trip', () => {
    it('successfully encrypts and decrypts standard broker token strings', () => {
      const plaintextToken = 'ya29.a0AfH6SMD_SampleUpstoxOAuthToken1234567890';
      const encrypted = service.encrypt(plaintextToken);

      expect(encrypted).toBeDefined();
      expect(typeof encrypted).toBe('string');
      expect(encrypted).not.toBe(plaintextToken);

      const decrypted = service.decrypt(encrypted);
      expect(decrypted).toBe(plaintextToken);
    });
  });

  describe('2. Nonce/IV Randomness', () => {
    it('produces distinct ciphertexts and IVs for identical plaintext inputs', () => {
      const plaintext = 'identical_access_token_payload';
      const encrypted1 = service.encrypt(plaintext);
      const encrypted2 = service.encrypt(plaintext);

      expect(encrypted1).not.toBe(encrypted2);

      const [iv1] = encrypted1.split(':');
      const [iv2] = encrypted2.split(':');
      expect(iv1).not.toBe(iv2);

      expect(service.decrypt(encrypted1)).toBe(plaintext);
      expect(service.decrypt(encrypted2)).toBe(plaintext);
    });
  });

  describe('3. Authenticated Encryption - Tampered Ciphertext', () => {
    it('fails decryption when ciphertext payload is modified by even one character', () => {
      const plaintext = 'sensitive_broker_refresh_token_value';
      const encrypted = service.encrypt(plaintext);

      const parts = encrypted.split(':');
      const iv = parts[0];
      const tag = parts[1];
      const ciphertext = parts[2];

      // Flip the first character of ciphertext
      const modifiedChar = ciphertext[0] === 'a' ? 'b' : 'a';
      const tamperedCiphertext = modifiedChar + ciphertext.slice(1);
      const tamperedPayload = `${iv}:${tag}:${tamperedCiphertext}`;

      expect(() => service.decrypt(tamperedPayload)).toThrow(
        /Decryption failed: authentication tag verification failed/,
      );
    });
  });

  describe('4. Authenticated Encryption - Tampered Auth Tag', () => {
    it('fails decryption when the authentication tag is modified', () => {
      const plaintext = 'sensitive_broker_access_token_value';
      const encrypted = service.encrypt(plaintext);

      const parts = encrypted.split(':');
      const iv = parts[0];
      const tag = parts[1];
      const ciphertext = parts[2];

      // Flip the first character of auth tag
      const modifiedChar = tag[0] === 'a' ? 'b' : 'a';
      const tamperedTag = modifiedChar + tag.slice(1);
      const tamperedPayload = `${iv}:${tamperedTag}:${ciphertext}`;

      expect(() => service.decrypt(tamperedPayload)).toThrow(
        /Decryption failed: authentication tag verification failed/,
      );
    });
  });

  describe('5. Malformed Encrypted Value Handling', () => {
    it('rejects payload with incorrect number of colon-separated segments', () => {
      expect(() => service.decrypt('invalid_string_no_colons')).toThrow(
        /Invalid encrypted token format/,
      );
      expect(() => service.decrypt('part1:part2')).toThrow(
        /Invalid encrypted token format/,
      );
      expect(() => service.decrypt('part1:part2:part3:part4')).toThrow(
        /Invalid encrypted token format/,
      );
    });

    it('rejects empty or non-string encrypted payloads', () => {
      expect(() => service.decrypt('')).toThrow(
        /Invalid encrypted token payload/,
      );
      expect(() => service.decrypt(null as unknown as string)).toThrow(
        /Invalid encrypted token payload/,
      );
    });

    it('rejects IV with invalid hex or invalid length', () => {
      const validTag = '0'.repeat(32);
      const validCipher = 'beef';

      // 10 bytes instead of 12 (20 hex chars)
      expect(() =>
        service.decrypt(`${'0'.repeat(20)}:${validTag}:${validCipher}`),
      ).toThrow(/Invalid IV format/);

      // Non-hex characters in IV
      expect(() =>
        service.decrypt(`${'z'.repeat(24)}:${validTag}:${validCipher}`),
      ).toThrow(/Invalid IV format/);
    });

    it('rejects Auth Tag with invalid length or non-hex characters', () => {
      const validIv = '0'.repeat(24);
      const validCipher = 'beef';

      // 14 bytes instead of 16 (28 hex chars)
      expect(() =>
        service.decrypt(`${validIv}:${'0'.repeat(28)}:${validCipher}`),
      ).toThrow(/Invalid authentication tag format/);

      // Non-hex characters in tag
      expect(() =>
        service.decrypt(`${validIv}:${'q'.repeat(32)}:${validCipher}`),
      ).toThrow(/Invalid authentication tag format/);
    });

    it('rejects odd-length or non-hex ciphertext', () => {
      const validIv = '0'.repeat(24);
      const validTag = '0'.repeat(32);

      // Odd length hex
      expect(() =>
        service.decrypt(`${validIv}:${validTag}:abc`),
      ).toThrow(/Invalid ciphertext format/);

      // Non-hex ciphertext
      expect(() =>
        service.decrypt(`${validIv}:${validTag}:zzzz`),
      ).toThrow(/Invalid ciphertext format/);
    });
  });

  describe('6. Empty Plaintext Handling', () => {
    it('consistently encrypts and decrypts empty plaintext string', () => {
      const emptyPlaintext = '';
      const encrypted = service.encrypt(emptyPlaintext);

      expect(encrypted).toBeDefined();
      const parts = encrypted.split(':');
      expect(parts.length).toBe(3);
      expect(parts[0].length).toBe(24); // 12-byte IV
      expect(parts[1].length).toBe(32); // 16-byte tag
      expect(parts[2]).toBe(''); // empty ciphertext

      const decrypted = service.decrypt(encrypted);
      expect(decrypted).toBe('');
    });

    it('rejects non-string plaintext input', () => {
      expect(() => service.encrypt(null as unknown as string)).toThrow(
        /Plaintext must be a string/,
      );
      expect(() => service.encrypt(undefined as unknown as string)).toThrow(
        /Plaintext must be a string/,
      );
    });
  });

  describe('7. Unicode and Complex Token Strings', () => {
    it('round-trips complex strings containing JSON, unicode, symbols, and URL-safe characters', () => {
      const complexInputs = [
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeak',
        'token-with-special-chars-!@#$%^&*()_+~`-={}|[]\\:";\'<>?,./',
        'token-with-unicode-₹-हिन्दी-🚀-IPO-Vault-✨',
        '{"access_token":"ya29.sample","expires_in":86400,"token_type":"Bearer"}',
      ];

      for (const input of complexInputs) {
        const encrypted = service.encrypt(input);
        const decrypted = service.decrypt(encrypted);
        expect(decrypted).toBe(input);
      }
    });
  });

  describe('8. Secret & Key Length Management', () => {
    it('uses fallback in development/test when BROKER_TOKEN_ENCRYPTION_SECRET is absent', () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'development';
        return undefined;
      });

      const devService = new BrokerCryptoService(mockConfigService);
      const plaintext = 'test-token-under-dev-key';
      const encrypted = devService.encrypt(plaintext);
      expect(devService.decrypt(encrypted)).toBe(plaintext);
    });

    it('throws when secret is not 32 bytes in length', () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'BROKER_TOKEN_ENCRYPTION_SECRET') return 'too-short-secret';
        if (key === 'NODE_ENV') return 'development';
        return undefined;
      });

      const invalidKeyService = new BrokerCryptoService(mockConfigService);
      expect(() => invalidKeyService.encrypt('any-token')).toThrow(
        /BROKER_TOKEN_ENCRYPTION_SECRET must be exactly 32 bytes/,
      );
    });

    it('throws in production when BROKER_TOKEN_ENCRYPTION_SECRET is absent', () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'BROKER_TOKEN_ENCRYPTION_SECRET') return undefined;
        if (key === 'NODE_ENV') return 'production';
        return undefined;
      });

      const prodService = new BrokerCryptoService(mockConfigService);
      expect(() => prodService.encrypt('any-token')).toThrow(
        /BROKER_TOKEN_ENCRYPTION_SECRET is required in production environment/,
      );
    });
  });
});
