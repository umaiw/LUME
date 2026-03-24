/**
 * Tests for lib/api.ts
 * Covers: request() helper, authApi, messagesApi, healthApi
 * Mocks: global.fetch, crypto/keys sign, tweetnacl-util encodeBase64
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  sign: vi.fn(() => new Uint8Array(64)),
  encodeBase64: vi.fn(() => 'mock-base64-signature'),
}));

vi.mock('@/crypto/keys', () => ({
  sign: mocks.sign,
}));

vi.mock('tweetnacl-util', () => ({
  encodeBase64: mocks.encodeBase64,
  decodeBase64: vi.fn(),
}));

import { authApi, messagesApi, healthApi } from '@/lib/api';
import type { IdentityKeys } from '@/crypto/keys';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeIdentityKeys(): IdentityKeys {
  return {
    signing: { publicKey: 'test-signing-pk', secretKey: 'test-signing-sk' },
    exchange: { publicKey: 'test-exchange-pk', secretKey: 'test-exchange-sk' },
  };
}

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function textResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain' },
  });
}

// ── Setup ────────────────────────────────────────────────────────────────────

const fetchSpy = vi.fn<(...args: unknown[]) => Promise<Response>>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchSpy);
  fetchSpy.mockReset();
  mocks.sign.mockReturnValue(new Uint8Array(64));
  mocks.encodeBase64.mockReturnValue('mock-base64-signature');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── request() core behaviour (tested via healthApi.check) ────────────────────

describe('request() core', () => {
  it('sends correct URL with Content-Type header', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ status: 'ok' }));

    await healthApi.check();

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/api/health');
    expect(opts.headers).toEqual(expect.objectContaining({ 'Content-Type': 'application/json' }));
  });

  it('returns data on successful JSON response', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ status: 'ok', timestamp: '2025-01-01' }));

    const result = await healthApi.check();

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({ status: 'ok', timestamp: '2025-01-01' });
  });

  it('returns error on 429 (rate limited)', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({}, 429));

    const result = await healthApi.check();

    expect(result.error).toBe('Too many requests. Please try again later.');
    expect(result.data).toBeUndefined();
  });

  it('returns error on non-ok status with error field', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ error: 'Not found' }, 404));

    const result = await healthApi.check();

    expect(result.error).toBe('Not found');
  });

  it('returns generic error on non-ok status without error field', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ foo: 'bar' }, 500));

    const result = await healthApi.check();

    expect(result.error).toBe('Request failed: 500');
  });

  it('returns "Network error" on fetch rejection', async () => {
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await healthApi.check();

    expect(result.error).toBe('Network error');
  });

  it('returns "Invalid server response" on invalid JSON', async () => {
    // Response with JSON content-type but invalid body
    const resp = new Response('not-json!!!', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    // Override .json() to throw
    const origJson = resp.json.bind(resp);
    let called = false;
    resp.json = async () => {
      if (!called) {
        called = true;
        // The response body has already been read if we got text, so let's
        // just have the original fail naturally.
        return origJson();
      }
      throw new Error('bad json');
    };
    fetchSpy.mockResolvedValue(resp);

    const result = await healthApi.check();

    // The body "not-json!!!" will fail JSON.parse, returning "Invalid server response"
    expect(result.error).toBe('Invalid server response');
  });

  it('handles non-JSON (text) response body', async () => {
    fetchSpy.mockResolvedValue(textResponse('Short error', 200));

    const result = await healthApi.check();

    // non-ok is false (200), but content is not JSON - data.error from text parsing
    expect(result.data).toEqual({ error: 'Short error' });
  });

  it('truncates long text responses to generic "Server error"', async () => {
    const longText = 'x'.repeat(200);
    fetchSpy.mockResolvedValue(textResponse(longText, 200));

    const result = await healthApi.check();

    expect(result.data).toEqual({ error: 'Server error' });
  });
});

// ── authApi ──────────────────────────────────────────────────────────────────

describe('authApi', () => {
  describe('register', () => {
    it('sends POST with register data', async () => {
      const regData = {
        username: 'alice',
        identityKey: 'ik',
        signedPrekey: 'spk',
        signedPrekeySignature: 'sig',
        oneTimePrekeys: [{ id: '1', publicKey: 'pk1' }],
      };
      fetchSpy.mockResolvedValue(jsonResponse({ id: 'u1', username: 'alice', message: 'ok' }));

      const result = await authApi.register(regData);

      const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.body as string)).toEqual(regData);
      expect(result.data).toEqual({ id: 'u1', username: 'alice', message: 'ok' });
    });
  });

  describe('checkUsername', () => {
    it('sends GET to correct endpoint', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ available: true }));

      const result = await authApi.checkUsername('bob');

      const [url] = fetchSpy.mock.calls[0] as [string];
      expect(url).toContain('/auth/check/bob');
      expect(result.data?.available).toBe(true);
    });
  });

  describe('getUser', () => {
    it('signs the request and sends GET', async () => {
      const keys = makeIdentityKeys();
      fetchSpy.mockResolvedValue(jsonResponse({ id: 'u1', username: 'bob' }));

      await authApi.getUser('bob', keys);

      expect(mocks.sign).toHaveBeenCalled();
      const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/auth/user/bob');
      const headers = opts.headers as Record<string, string>;
      expect(headers['X-Lume-Identity-Key']).toBe('test-signing-pk');
      expect(headers['X-Lume-Signature']).toBe('mock-base64-signature');
      expect(headers['X-Lume-Timestamp']).toBeDefined();
      expect(headers['X-Lume-Nonce']).toBeDefined();
    });
  });

  describe('getBundle', () => {
    it('sends signed POST with username in body', async () => {
      const keys = makeIdentityKeys();
      fetchSpy.mockResolvedValue(jsonResponse({ id: 'u1' }));

      await authApi.getBundle('bob', keys);

      const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/auth/bundle');
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.body as string)).toEqual({ username: 'bob' });
    });
  });

  describe('uploadPrekeys', () => {
    it('sends signed POST with prekeys payload', async () => {
      const keys = makeIdentityKeys();
      fetchSpy.mockResolvedValue(jsonResponse({ message: 'ok', totalPrekeys: 10 }));

      const result = await authApi.uploadPrekeys('u1', [{ id: 'k1', publicKey: 'pk1' }], keys);

      const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(opts.body as string)).toEqual({
        userId: 'u1',
        prekeys: [{ id: 'k1', publicKey: 'pk1' }],
      });
      expect(result.data?.totalPrekeys).toBe(10);
    });
  });

  describe('updateSignedPrekey', () => {
    it('sends signed POST', async () => {
      const keys = makeIdentityKeys();
      fetchSpy.mockResolvedValue(jsonResponse({ message: 'ok' }));

      await authApi.updateSignedPrekey('u1', 'spk', 'sig', keys);

      const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/auth/keys');
      expect(JSON.parse(opts.body as string)).toEqual({
        userId: 'u1',
        signedPrekey: 'spk',
        signedPrekeySignature: 'sig',
      });
    });
  });

  describe('deleteAccount', () => {
    it('sends signed DELETE', async () => {
      const keys = makeIdentityKeys();
      fetchSpy.mockResolvedValue(jsonResponse({ message: 'deleted' }));

      await authApi.deleteAccount('u1', keys);

      const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/auth/user/u1');
      expect(opts.method).toBe('DELETE');
    });
  });

  describe('getSession', () => {
    it('sends signed POST and returns token', async () => {
      const keys = makeIdentityKeys();
      fetchSpy.mockResolvedValue(jsonResponse({ token: 'jwt-token', expiresIn: 3600 }));

      const result = await authApi.getSession('u1', keys);

      expect(result.data?.token).toBe('jwt-token');
      expect(result.data?.expiresIn).toBe(3600);
    });
  });

  describe('blockUser / unblockUser / getBlockedUsers', () => {
    it('blockUser sends signed POST', async () => {
      const keys = makeIdentityKeys();
      fetchSpy.mockResolvedValue(jsonResponse({ ok: true }));

      const result = await authApi.blockUser('blocked-id', keys);

      const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/auth/block');
      expect(JSON.parse(opts.body as string)).toEqual({ blockedId: 'blocked-id' });
      expect(result.data?.ok).toBe(true);
    });

    it('unblockUser sends signed POST', async () => {
      const keys = makeIdentityKeys();
      fetchSpy.mockResolvedValue(jsonResponse({ ok: true }));

      await authApi.unblockUser('blocked-id', keys);

      const [url] = fetchSpy.mock.calls[0] as [string];
      expect(url).toContain('/auth/unblock');
    });

    it('getBlockedUsers sends signed GET', async () => {
      const keys = makeIdentityKeys();
      fetchSpy.mockResolvedValue(jsonResponse({ blockedIds: ['a', 'b'] }));

      const result = await authApi.getBlockedUsers(keys);

      const [url] = fetchSpy.mock.calls[0] as [string];
      expect(url).toContain('/auth/blocked');
      expect(result.data?.blockedIds).toEqual(['a', 'b']);
    });
  });
});

// ── messagesApi ──────────────────────────────────────────────────────────────

describe('messagesApi', () => {
  const keys = makeIdentityKeys();

  describe('send', () => {
    it('sends signed POST with message data', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ messageId: 'm1', delivered: true }));

      const data = { senderId: 'u1', recipientUsername: 'bob', encryptedPayload: 'enc' };
      const result = await messagesApi.send(data, keys);

      const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/messages/send');
      expect(opts.method).toBe('POST');
      expect(result.data?.messageId).toBe('m1');
    });
  });

  describe('getPending', () => {
    it('sends signed GET', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ messages: [] }));

      const result = await messagesApi.getPending('u1', keys);

      const [url] = fetchSpy.mock.calls[0] as [string];
      expect(url).toContain('/messages/pending/u1');
      expect(result.data?.messages).toEqual([]);
    });
  });

  describe('acknowledge', () => {
    it('sends signed DELETE', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ message: 'ack' }));

      await messagesApi.acknowledge('m1', keys);

      const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/messages/m1');
      expect(opts.method).toBe('DELETE');
    });
  });

  describe('acknowledgeBatch', () => {
    it('sends signed POST with messageIds', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ acknowledged: 3 }));

      const result = await messagesApi.acknowledgeBatch(['m1', 'm2', 'm3'], keys);

      const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(opts.body as string)).toEqual({ messageIds: ['m1', 'm2', 'm3'] });
      expect(result.data?.acknowledged).toBe(3);
    });
  });
});

// ── signRequest header validation ────────────────────────────────────────────

describe('signRequest headers', () => {
  it('includes all X-Lume-* headers on signed requests', async () => {
    const keys = makeIdentityKeys();
    fetchSpy.mockResolvedValue(jsonResponse({ token: 'jwt' }));

    await authApi.getSession('u1', keys);

    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;

    expect(headers).toHaveProperty('X-Lume-Identity-Key');
    expect(headers).toHaveProperty('X-Lume-Signature');
    expect(headers).toHaveProperty('X-Lume-Timestamp');
    expect(headers).toHaveProperty('X-Lume-Nonce');
    expect(headers).toHaveProperty('X-Lume-Path');
    expect(headers['X-Lume-Path']).toBe('/auth/session');
  });
});
