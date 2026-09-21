import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Env } from '../../../config/env';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
const DEV_FALLBACK_SECRET = 'ipovault_dev_broker_token_sec_32';

@Injectable()
export class BrokerCryptoService {
  constructor(private readonly configService: ConfigService<Env, true>) {}

  /**
   * Retrieves and validates the 32-byte (256-bit) encryption key buffer.
   */
  private getKey(): Buffer {
    const secret = this.configService.get('BROKER_TOKEN_ENCRYPTION_SECRET', {
      infer: true,
    });

    if (secret) {
      const keyBuffer = Buffer.from(secret, 'utf8');
      if (keyBuffer.length !== 32) {
        throw new Error(
          'BROKER_TOKEN_ENCRYPTION_SECRET must be exactly 32 bytes (256 bits)',
        );
      }
      return keyBuffer;
    }

    const nodeEnv = this.configService.get('NODE_ENV', { infer: true });
    if (nodeEnv === 'production') {
      throw new Error(
        'BROKER_TOKEN_ENCRYPTION_SECRET is required in production environment',
      );
    }

    return Buffer.from(DEV_FALLBACK_SECRET, 'utf8');
  }

  /**
   * Encrypts plaintext using AES-256-GCM with a cryptographically random 12-byte IV.
   *
   * @param plaintext Plaintext string to encrypt.
   * @returns Formatted string in `ivHex:authTagHex:ciphertextHex` format.
   */
  encrypt(plaintext: string): string {
    if (typeof plaintext !== 'string') {
      throw new Error('Plaintext must be a string');
    }

    const key = this.getKey();
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
    ciphertext += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext}`;
  }

  /**
   * Decrypts an authenticated encrypted payload using AES-256-GCM.
   *
   * @param encrypted Formatted string in `ivHex:authTagHex:ciphertextHex` format.
   * @returns Decrypted plaintext string.
   */
  decrypt(encrypted: string): string {
    if (typeof encrypted !== 'string' || !encrypted) {
      throw new Error('Invalid encrypted token payload');
    }

    const parts = encrypted.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted token format');
    }

    const [ivHex, authTagHex, ciphertextHex] = parts;

    if (!ivHex || ivHex.length !== IV_LENGTH_BYTES * 2 || !/^[0-9a-fA-F]+$/.test(ivHex)) {
      throw new Error('Invalid IV format in encrypted token');
    }

    if (!authTagHex || authTagHex.length !== AUTH_TAG_LENGTH_BYTES * 2 || !/^[0-9a-fA-F]+$/.test(authTagHex)) {
      throw new Error('Invalid authentication tag format in encrypted token');
    }

    if (ciphertextHex === undefined || (ciphertextHex.length > 0 && (!/^[0-9a-fA-F]+$/.test(ciphertextHex) || ciphertextHex.length % 2 !== 0))) {
      throw new Error('Invalid ciphertext format in encrypted token');
    }

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const key = this.getKey();
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    try {
      let plaintext = decipher.update(ciphertextHex, 'hex', 'utf8');
      plaintext += decipher.final('utf8');
      return plaintext;
    } catch {
      throw new Error('Decryption failed: authentication tag verification failed or corrupted payload');
    }
  }
}
