import nacl from 'tweetnacl';
import { decodeBase64 } from 'tweetnacl-util';

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function sortPair(a: Uint8Array, b: Uint8Array): [Uint8Array, Uint8Array] {
  return compareBytes(a, b) <= 0 ? [a, b] : [b, a];
}

export function computeSafetyNumber(params: {
  mySigningPublicKey: string;
  myExchangeIdentityPublicKey: string;
  theirSigningPublicKey: string;
  theirExchangeIdentityPublicKey: string;
}): string {
  const mySign = decodeBase64(params.mySigningPublicKey);
  const theirSign = decodeBase64(params.theirSigningPublicKey);
  const myExchange = decodeBase64(params.myExchangeIdentityPublicKey);
  const theirExchange = decodeBase64(params.theirExchangeIdentityPublicKey);

  const [signA, signB] = sortPair(mySign, theirSign);
  const [exA, exB] = sortPair(myExchange, theirExchange);

  const prefix = new TextEncoder().encode('LUME-SAFETY-V1');
  const input = concatBytes(prefix, signA, signB, exA, exB);
  const digest = nacl.hash(input); // 64 bytes (SHA-512)

  // 10 groups of 5 digits (50-digit "safety number").
  const bytes = digest.slice(0, 20);
  const groups: string[] = [];
  for (let i = 0; i < 10; i++) {
    const hi = bytes[i * 2]!;
    const lo = bytes[i * 2 + 1]!;
    const value = ((hi << 8) | lo) % 100000;
    groups.push(value.toString().padStart(5, '0'));
  }
  return groups.join(' ');
}

