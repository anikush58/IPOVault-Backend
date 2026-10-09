import { AllotmentIdentifierType } from './allotment.types';
import {
  decryptPan,
  encryptPan,
  hashIdentifier,
  isValidPan,
  maskIdentifier,
} from './allotment.utils';

describe('Allotment Utilities', () => {
  describe('maskIdentifier', () => {
    it('should correctly mask PAN numbers', () => {
      expect(maskIdentifier('ABCDE1234F', AllotmentIdentifierType.PAN)).toBe(
        'ABCDE****F',
      );
    });

    it('should mask application numbers and DP client IDs preserving prefix/suffix', () => {
      expect(
        maskIdentifier(
          '123456789012',
          AllotmentIdentifierType.APPLICATION_NUMBER,
        ),
      ).toBe('123****12');
    });

    it('should return default mask for empty values', () => {
      expect(maskIdentifier('', AllotmentIdentifierType.PAN)).toBe('****');
    });
  });

  describe('hashIdentifier', () => {
    it('should produce deterministic HMAC SHA-256 hex string', () => {
      const hash1 = hashIdentifier('ABCDE1234F', 'test_secret');
      const hash2 = hashIdentifier('abcde1234f', 'test_secret');
      expect(hash1).toHaveLength(64);
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different secret keys', () => {
      const hash1 = hashIdentifier('ABCDE1234F', 'secret_a');
      const hash2 = hashIdentifier('ABCDE1234F', 'secret_b');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('isValidPan', () => {
    it('should validate correct 10-char Indian PAN numbers', () => {
      expect(isValidPan('ABCDE1234F')).toBe(true);
      expect(isValidPan('abcde1234f')).toBe(true);
    });

    it('should reject invalid PAN numbers', () => {
      expect(isValidPan('12345ABCDE')).toBe(false);
      expect(isValidPan('INVALID')).toBe(false);
    });
  });

  describe('encryptPan & decryptPan', () => {
    const testSecret = 'test_encryption_secret_key_32_bytes!';

    it('should correctly encrypt and decrypt PAN transiently using explicit secret key', () => {
      const originalPan = 'ABCDE1234F';
      const encrypted = encryptPan(originalPan, testSecret);
      expect(encrypted).not.toContain(originalPan);
      expect(encrypted.split(':')).toHaveLength(3);

      const decrypted = decryptPan(encrypted, testSecret);
      expect(decrypted).toBe('ABCDE1234F');
    });

    it('should correctly encrypt and decrypt PAN transiently using process.env secret', () => {
      process.env.ALLOTMENT_ENCRYPTION_SECRET = testSecret;
      const originalPan = 'XYZAB5678C';
      const encrypted = encryptPan(originalPan);
      expect(encrypted).not.toContain(originalPan);
      expect(encrypted.split(':')).toHaveLength(3);

      const decrypted = decryptPan(encrypted);
      expect(decrypted).toBe('XYZAB5678C');
    });

    it('should throw when encryption secret is missing or too short', () => {
      const oldSecret = process.env.ALLOTMENT_ENCRYPTION_SECRET;
      delete process.env.ALLOTMENT_ENCRYPTION_SECRET;

      expect(() => encryptPan('ABCDE1234F')).toThrow(
        /ALLOTMENT_ENCRYPTION_SECRET.*is required/,
      );
      expect(() => encryptPan('ABCDE1234F', 'short')).toThrow(
        /ALLOTMENT_ENCRYPTION_SECRET.*is required/,
      );

      process.env.ALLOTMENT_ENCRYPTION_SECRET = oldSecret;
    });

    it('should throw when hash secret is missing', () => {
      const oldSecret = process.env.ALLOTMENT_HASH_SECRET;
      delete process.env.ALLOTMENT_HASH_SECRET;

      expect(() => hashIdentifier('ABCDE1234F')).toThrow(
        /ALLOTMENT_HASH_SECRET.*is required/,
      );

      process.env.ALLOTMENT_HASH_SECRET = oldSecret;
    });
  });
});
