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
    it('should correctly encrypt and decrypt PAN transiently using AES-256-GCM', () => {
      const originalPan = 'ABCDE1234F';
      const encrypted = encryptPan(originalPan);
      expect(encrypted).not.toContain(originalPan);
      expect(encrypted.split(':')).toHaveLength(3);

      const decrypted = decryptPan(encrypted);
      expect(decrypted).toBe('ABCDE1234F');
    });
  });
});
