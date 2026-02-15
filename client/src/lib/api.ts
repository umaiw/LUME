/**
 * API клиент для взаимодействия с сервером
 */

import { sign, IdentityKeys } from '../crypto/keys';
import { encodeBase64 } from 'tweetnacl-util';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

interface ApiResponse<T = unknown> {
    data?: T;
    error?: string;
}

async function request<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<ApiResponse<T>> {
    try {
        const response = await fetch(`${API_URL}${endpoint}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers,
            },
        });

        if (response.status === 429) {
            return { error: 'Too many requests. Please try again later.' };
        }

        let data;
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            try {
                data = await response.json();
            } catch (e) {
                console.error('Failed to parse JSON response:', e);
                return { error: 'Invalid server response' };
            }
        } else {
            // If not JSON, try to read text or ignore
            try {
                const text = await response.text();
                // If it's a small text error, use it, otherwise generic
                data = { error: text.length < 100 ? text : 'Server error' };
            } catch {
                data = { error: 'Unknown server error' };
            }
        }

        if (!response.ok) {
            return { error: data.error || `Request failed: ${response.status}` };
        }

        return { data };
    } catch (error) {
        console.error('API request failed:', error);
        return { error: 'Network error' };
    }
}

// ==================== Auth API ====================

export interface RegisterData {
    username: string;
    identityKey: string;
    exchangeIdentityKey?: string;
    signedPrekey: string;
    signedPrekeySignature: string;
    oneTimePrekeys: Array<{ id: string; publicKey: string }>;
}

export interface UserBundle {
    id: string;
    username: string;
    identityKey: string;
    exchangeKey?: string;
    exchangeIdentityKey?: string;
    signedPrekey: string;
    signedPrekeySignature: string;
    oneTimePrekey?: string;
}


function signRequest(
    method: string,
    endpoint: string,
    body: unknown,
    identityKeys: IdentityKeys
): Record<string, string> {
    const timestamp = Date.now().toString();
    const crypto = globalThis.crypto;
    const nonce = (crypto && typeof (crypto as Crypto & { randomUUID?: () => string }).randomUUID === 'function')
        ? (crypto as Crypto & { randomUUID: () => string }).randomUUID()
        : (() => {
            const bytes = new Uint8Array(16);
            crypto.getRandomValues(bytes);
            return `${Date.now()}-${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`;
          })();
    const normalizedMethod = method.toUpperCase();
    const normalizedPath = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const bodyString = body && Object.keys(body as object).length > 0 ? JSON.stringify(body) : '';
    const message = `${timestamp}.${nonce}.${normalizedMethod}.${normalizedPath}.${bodyString}`;

    const messageBytes = new TextEncoder().encode(message);
    const signature = sign(messageBytes, identityKeys.signing.secretKey);

    return {
        'X-Lume-Identity-Key': identityKeys.signing.publicKey,
        'X-Lume-Signature': encodeBase64(signature),
        'X-Lume-Timestamp': timestamp,
        'X-Lume-Nonce': nonce,
        'X-Lume-Path': normalizedPath,
    };
}

export const authApi = {
    register: (data: RegisterData) =>
        request<{ id: string; username: string; message: string }>('/auth/register', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    checkUsername: (username: string) =>
        request<{ available: boolean; reason?: string }>(`/auth/check/${username}`),

    getUser: (username: string) =>
        request<UserBundle>(`/auth/user/${username}`),

    getBundle: (username: string, identityKeys: IdentityKeys) => {
        const body = { username };
        const headers = signRequest('POST', '/auth/bundle', body, identityKeys);
        return request<UserBundle>('/auth/bundle', {
            method: 'POST',
            body: JSON.stringify(body),
            headers,
        });
    },

    uploadPrekeys: (userId: string, prekeys: Array<{ id: string; publicKey: string }>, identityKeys: IdentityKeys) => {
        const body = { userId, prekeys };
        const headers = signRequest('POST', '/auth/prekeys', body, identityKeys);
        return request<{ message: string; totalPrekeys: number }>('/auth/prekeys', {
            method: 'POST',
            body: JSON.stringify(body),
            headers,
        });
    },

    updateSignedPrekey: (
        userId: string,
        signedPrekey: string,
        signedPrekeySignature: string,
        identityKeys: IdentityKeys
    ) => {
        const body = { userId, signedPrekey, signedPrekeySignature };
        const headers = signRequest('POST', '/auth/keys', body, identityKeys);
        return request<{ message: string }>('/auth/keys', {
            method: 'POST',
            body: JSON.stringify(body),
            headers,
        });
    },

    deleteAccount: (userId: string, identityKeys: IdentityKeys) => {
        const headers = signRequest('DELETE', `/auth/user/${userId}`, {}, identityKeys);
        return request<{ message: string }>(`/auth/user/${userId}`, {
            method: 'DELETE',
            headers,
        });
    },

    getSession: (userId: string, identityKeys: IdentityKeys) => {
        const body = { userId };
        const headers = signRequest('POST', '/auth/session', body, identityKeys);
        return request<{ token: string; expiresIn: number }>('/auth/session', {
            method: 'POST',
            body: JSON.stringify(body),
            headers,
        });
    },
};

// ==================== Messages API ====================

export interface SendMessageData {
    senderId: string;
    recipientUsername: string;
    encryptedPayload: string;
}

export interface PendingMessage {
    id: string;
    senderId: string;
    senderUsername: string;
    encryptedPayload: string;
    timestamp: number;
}

export const messagesApi = {
    send: (data: SendMessageData, identityKeys: IdentityKeys) => {
        const headers = signRequest('POST', '/messages/send', data, identityKeys);
        return request<{ messageId: string; delivered: boolean }>('/messages/send', {
            method: 'POST',
            body: JSON.stringify(data),
            headers,
        });
    },

    getPending: (userId: string, identityKeys: IdentityKeys) => {
        const headers = signRequest('GET', `/messages/pending/${userId}`, {}, identityKeys);
        return request<{ messages: PendingMessage[] }>(`/messages/pending/${userId}`, {
            headers
        });
    },

    acknowledge: (messageId: string, identityKeys: IdentityKeys) => {
        const headers = signRequest('DELETE', `/messages/${messageId}`, {}, identityKeys);
        return request<{ message: string }>(`/messages/${messageId}`, {
            method: 'DELETE',
            headers
        });
    },

    acknowledgeBatch: (messageIds: string[], identityKeys: IdentityKeys) => {
        const body = { messageIds };
        const headers = signRequest('POST', '/messages/acknowledge', body, identityKeys);
        return request<{ acknowledged: number }>('/messages/acknowledge', {
            method: 'POST',
            body: JSON.stringify(body),
            headers,
        });
    },
};

// ==================== Health API ====================

export const healthApi = {
    check: () =>
        request<{
            status: string;
            timestamp: string;
            connectedUsers: number;
            activeConnections: number;
        }>('/health'),
};
