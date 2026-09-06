import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'crypto';
import { AllotmentIdentifierType } from './allotment.types';

/**
 * Masks sensitive identifiers (PAN, Application No, DP Client ID) for logging and display.
 * Example: PAN 'ABCDE1234F' -> 'ABCDE****F'
 */
export function maskIdentifier(
  value: string,
  type: AllotmentIdentifierType,
): string {
  const trimmed = value.trim();
  if (!trimmed) return '****';

  if (type === AllotmentIdentifierType.PAN) {
    if (trimmed.length === 10) {
      return `${trimmed.slice(0, 5)}****${trimmed.slice(9)}`;
    }
    return `${trimmed.slice(0, 2)}****${trimmed.slice(-2)}`;
  }

  if (trimmed.length <= 4) {
    return '****';
  }

  const prefix = trimmed.slice(0, 3);
  const suffix = trimmed.slice(-2);
  return `${prefix}****${suffix}`;
}

/**
 * Generates a keyed HMAC-SHA-256 hash of an identifier for secure indexing.
 * Protects against offline enumeration attacks on constrained formats (e.g. PAN).
 */
export function hashIdentifier(value: string, secretKey?: string): string {
  const normalized = value.trim().toUpperCase();
  const secret =
    secretKey ||
    process.env.ALLOTMENT_HASH_SECRET ||
    'ipovault_default_secure_allotment_hash_secret_key';
  return createHmac('sha256', secret).update(normalized).digest('hex');
}

/**
 * Validates Indian PAN format (10 characters: 5 letters, 4 digits, 1 letter).
 */
export function isValidPan(pan: string): boolean {
  return /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/i.test(pan.trim());
}

/**
 * Encrypts a sensitive PAN string transiently for secure storage at rest using AES-256-GCM.
 */
export function encryptPan(pan: string, secretKey?: string): string {
  const secret = (
    secretKey ||
    process.env.ALLOTMENT_ENCRYPTION_SECRET ||
    'ipovault_default_encryption_secret_key_32_bytes!'
  )
    .slice(0, 32)
    .padEnd(32, '0');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(secret), iv);
  let encrypted = cipher.update(pan.trim().toUpperCase(), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts a stored encrypted PAN string transiently in memory.
 */
export function decryptPan(encryptedData: string, secretKey?: string): string {
  const secret = (
    secretKey ||
    process.env.ALLOTMENT_ENCRYPTION_SECRET ||
    'ipovault_default_encryption_secret_key_32_bytes!'
  )
    .slice(0, 32)
    .padEnd(32, '0');
  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format');
  }
  const ivHex = parts[0] as string;
  const authTagHex = parts[1] as string;
  const encryptedHex = parts[2] as string;

  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(secret),
    Buffer.from(ivHex, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
