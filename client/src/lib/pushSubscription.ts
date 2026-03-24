/**
 * Web Push subscription management.
 * Subscribes the client to push notifications using VAPID.
 */

import type { IdentityKeys } from '@/crypto/keys';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    arr[i] = raw.charCodeAt(i);
  }
  return arr;
}

/**
 * Fetch the VAPID public key from the server.
 * Returns null if push is not configured on the server.
 */
async function getVapidKey(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/push/vapid-key`);
    if (!res.ok) return null;
    const data = (await res.json()) as { vapidPublicKey?: string };
    return data.vapidPublicKey || null;
  } catch {
    return null;
  }
}

/**
 * Subscribe the current browser to push notifications.
 * Registers the subscription with the server.
 */
export async function subscribeToPush(
  userId: string,
  identityKeys: IdentityKeys,
  signRequest: (method: string, path: string, body: Record<string, unknown>, keys: IdentityKeys) => Record<string, string>,
): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return false;
  }

  const vapidKey = await getVapidKey();
  if (!vapidKey) return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey).buffer as ArrayBuffer,
    });

    const body = { userId, subscription: subscription.toJSON() };
    const headers = signRequest('POST', '/push/subscribe', body as unknown as Record<string, unknown>, identityKeys);

    const res = await fetch(`${API_BASE}/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Unsubscribe from push notifications.
 */
export async function unsubscribeFromPush(
  userId: string,
  identityKeys: IdentityKeys,
  signRequest: (method: string, path: string, body: Record<string, unknown>, keys: IdentityKeys) => Record<string, string>,
): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await subscription.unsubscribe();
    }

    const body = { userId };
    const headers = signRequest('POST', '/push/unsubscribe', body as unknown as Record<string, unknown>, identityKeys);

    const res = await fetch(`${API_BASE}/push/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Check if the browser is currently subscribed to push.
 */
export async function isPushSubscribed(): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return !!subscription;
  } catch {
    return false;
  }
}
