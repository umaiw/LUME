/**
 * Desktop Notifications via the Notification API.
 * Requests permission on first call and sends notifications for incoming messages.
 */

let permissionGranted: boolean | null = null;

/**
 * Request notification permission (idempotent).
 * Returns true if granted.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;

  if (Notification.permission === 'granted') {
    permissionGranted = true;
    return true;
  }

  if (Notification.permission === 'denied') {
    permissionGranted = false;
    return false;
  }

  const result = await Notification.requestPermission();
  permissionGranted = result === 'granted';
  return permissionGranted;
}

/**
 * Returns the current browser notification permission state.
 * Useful for showing permission status in settings UI.
 */
export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

/**
 * Show a desktop notification for an incoming message.
 * Only fires when the tab is not focused.
 * Body never includes message content — E2E encrypted messenger, privacy first.
 */
export function notifyIncomingMessage(senderUsername: string): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  // Don't notify if the window is focused
  if (document.hasFocus()) return;

  const notification = new Notification('LUME', {
    body: `New message from ${senderUsername}`,
    icon: '/lume-icon.png',
    tag: `lume-msg-${senderUsername}`, // collapse per sender
    silent: false,
  });

  // Auto-close after 5 seconds
  setTimeout(() => notification.close(), 5000);

  // Focus window on click
  notification.onclick = () => {
    window.focus();
    notification.close();
  };
}
