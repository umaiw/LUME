/**
 * Client-side file encryption for E2E encrypted attachments.
 * Files are encrypted with a random key using XSalsa20-Poly1305 (NaCl secretbox).
 * The key is then shared via the message payload (already encrypted by the ratchet).
 */

import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';

/**
 * Yield the thread so the browser can paint and React can update.
 * Used to wrap heavy synchronous crypto operations.
 */
async function yieldThread(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

export interface EncryptedFile {
  /** Base64-encoded encrypted data */
  ciphertext: string;
  /** Base64-encoded nonce */
  nonce: string;
  /** Base64-encoded symmetric key (to be sent via message payload) */
  key: string;
  /** Original MIME type */
  mimeType: string;
  /** Original file name */
  fileName: string;
  /** Original file size in bytes */
  originalSize: number;
}

export interface DecryptedFile {
  data: Uint8Array;
  mimeType: string;
  fileName: string;
}

/**
 * Encrypt a file for upload.
 * Returns the encrypted data + a symmetric key that must be sent in the message.
 */
export async function encryptFile(
  data: Uint8Array,
  mimeType: string,
  fileName: string
): Promise<EncryptedFile> {
  const key = nacl.randomBytes(nacl.secretbox.keyLength);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);

  await yieldThread();
  const ciphertext = nacl.secretbox(data, nonce, key);
  await yieldThread();

  return {
    ciphertext: encodeBase64(ciphertext),
    nonce: encodeBase64(nonce),
    key: encodeBase64(key),
    mimeType,
    fileName,
    originalSize: data.length,
  };
}

/**
 * Decrypt a downloaded file using the key from the message payload.
 */
export async function decryptFile(
  ciphertextBase64: string,
  nonceBase64: string,
  keyBase64: string,
  mimeType: string,
  fileName: string
): Promise<DecryptedFile | null> {
  try {
    const ciphertext = decodeBase64(ciphertextBase64);
    const nonce = decodeBase64(nonceBase64);
    const key = decodeBase64(keyBase64);

    await yieldThread();
    const plaintext = nacl.secretbox.open(ciphertext, nonce, key);
    await yieldThread();

    if (!plaintext) return null;

    return { data: plaintext, mimeType, fileName };
  } catch {
    return null;
  }
}

/**
 * Read a File object into a Uint8Array.
 */
export function readFileAsUint8Array(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(new Uint8Array(reader.result));
      } else {
        reject(new Error('Unexpected result type'));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Create an object URL from decrypted file data.
 */
export function createFileUrl(data: Uint8Array, mimeType: string): string {
  const blob = new Blob([data.buffer as ArrayBuffer], { type: mimeType });
  return URL.createObjectURL(blob);
}

/**
 * Format file size for display.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Max file size: 5MB */
export const MAX_FILE_SIZE = 5 * 1024 * 1024;

/** Allowed image MIME types */
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/** Check if a MIME type is an image */
export function isImageMime(mime: string): boolean {
  return IMAGE_MIME_TYPES.includes(mime);
}
