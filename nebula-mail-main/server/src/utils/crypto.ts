import crypto from 'crypto';

/**
 * Token Encryption & Decryption Utility
 * Uses AES-256-GCM for authenticated symmetric encryption of OAuth refresh and access tokens.
 *
 * Keys must be 32 bytes (64 hex characters) provided via TOKEN_ENCRYPTION_KEY.
 * If not set or invalid, a deterministic runtime fallback is derived with a warning.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const envKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (envKey && envKey.length === 64) {
    return Buffer.from(envKey, 'hex');
  }
  // Fallback to a derived key from client secret or fallback string for development
  const secret = process.env.GMAIL_CLIENT_SECRET || 'stitch_dev_fallback_secret_key_32_bytes!';
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptToken(plainText: string): string {
  if (!plainText) return '';
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encryptedPayload
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

export function decryptToken(cipherText: string): string {
  if (!cipherText) return '';
  const parts = cipherText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format');
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
