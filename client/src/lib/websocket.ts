/**
 * WebSocket клиент для real-time сообщений
 */

import { useUIStore, useTypingStore } from '@/stores';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001/ws';

type WSMessageHandler = (data: unknown) => void;

const CloseCodes = {
    MISSING_AUTH: 4001,
    INVALID_AUTH: 4002,
    EXPIRED_AUTH: 4003,
    TOO_MANY_CONNECTIONS: 4005,
    RATE_LIMITED: 4006,
} as const;

class WebSocketClient {
    private ws: WebSocket | null = null;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 50;
    private reconnectDelay = 1000;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private handlers: Map<string, WSMessageHandler[]> = new Map();
    private pingInterval: NodeJS.Timeout | null = null;
    private isManuallyDisconnected = false;
    private token: string | null = null;
    private onTokenExpired: (() => void) | null = null;

    private refreshAttempts = 0;
    private lastRefreshTime = 0;

    /**
     * Подключается к WebSocket серверу
     */
    connect(token: string): Promise<void> {
        return new Promise((resolve) => {
            this.clearReconnectTimer();
            if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
                if (this.token === token) {
                    resolve();
                    return;
                }
                this._closeSocket();
            }

            this.token = token;
            this.isManuallyDisconnected = false;
            useUIStore.getState().setWsStatus('connecting');

            try {
                this.ws = new WebSocket(WS_URL, ['lume', 'auth.' + token]);
            } catch (e) {
                console.warn('WebSocket creation failed, will retry:', e);
                this.attemptReconnect();
                resolve();
                return;
            }

            this.ws.onopen = () => {
                console.log('WebSocket connected');
                useUIStore.getState().setWsStatus('connected');
                this.startPing();
                this.reconnectAttempts = 0;
                this.refreshAttempts = 0; // Reset refresh attempts on success
                this.clearReconnectTimer();
                resolve();
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (error) {
                    console.error('Failed to parse WS message:', error);
                }
            };

            this.ws.onclose = (event) => {
                if (this.isManuallyDisconnected) {
                    useUIStore.getState().setWsStatus('disconnected');
                    return;
                }

                console.log('WebSocket disconnected', event.code, event.reason);
                this.stopPing();

                // Map close codes to status/actions
                switch (event.code) {
                    case CloseCodes.EXPIRED_AUTH: // 4003
                        console.warn('WS Token Expired. Requesting refresh...');
                        // Limit: 5 attempts per 10 minutes
                        const now = Date.now();
                        if (now - this.lastRefreshTime > 10 * 60 * 1000) {
                            this.refreshAttempts = 0;
                        }

                        if (this.refreshAttempts >= 5) {
                            console.error('Too many refresh attempts separately. Stopping.');
                            useUIStore.getState().setWsStatus('auth_error');
                            return;
                        }

                        this.refreshAttempts++;
                        this.lastRefreshTime = now;

                        if (this.onTokenExpired) {
                            this.onTokenExpired();
                        } else {
                            useUIStore.getState().setWsStatus('auth_error');
                        }
                        return;

                    case CloseCodes.MISSING_AUTH: // 4001
                    case CloseCodes.INVALID_AUTH: // 4002
                        console.error('WS Auth Fatal Error');
                        useUIStore.getState().setWsStatus('auth_error');
                        return;

                    case CloseCodes.TOO_MANY_CONNECTIONS: // 4005
                        console.error('WS Kicked: Too many connections');
                        useUIStore.getState().setWsStatus('kicked');
                        return;

                    case CloseCodes.RATE_LIMITED: // 4006
                        console.warn('WS Rate Limited');
                        useUIStore.getState().setWsStatus('rate_limited');
                        this.attemptReconnect(60000); // 60s forced delay
                        return;

                    default:
                        // Normal disconnect or unknown error -> standard reconnect
                        useUIStore.getState().setWsStatus('disconnected');
                        this.attemptReconnect();
                        break;
                }
            };

            this.ws.onerror = () => {
                console.warn('WebSocket connection error');
                // onerror usually followed by onclose
            };
        });
    }

    setTokenExpireHandler(handler: () => void) {
        this.onTokenExpired = handler;
    }

    /**
     * Обрабатывает входящие сообщения
     */
    private handleMessage(data: { type: string;[key: string]: unknown }): void {
        const { type } = data;

        switch (type) {
            case 'new_message':
                // Handled by useMessengerSync via event emitter
                break;

            case 'typing': {
                // Update global typing store so any component can react
                const senderId = data.senderId as string | undefined;
                const isTypingNow = data.isTyping as boolean | undefined;
                if (senderId && typeof isTypingNow === 'boolean') {
                    useTypingStore.getState().setTyping(senderId, isTypingNow);

                    // Auto-clear typing after 5s if no update received
                    if (isTypingNow) {
                        setTimeout(() => {
                            const current = useTypingStore.getState().typingUsers[senderId];
                            if (current) {
                                useTypingStore.getState().setTyping(senderId, false);
                            }
                        }, 5000);
                    }
                }
                break;
            }

            case 'pong':
                // Heartbeat response — no action needed
                break;

            case 'read':
                // Read receipt — handled by useMessengerSync via event emitter
                break;

            default:
                console.warn('Unknown WS message type:', type);
        }
        this.emit(type, data);
    }

    /**
     * Отправляет сообщение через WebSocket
     */
    send(data: object): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    /**
     * Отправляет индикатор набора
     */
    sendTyping(recipientId: string, isTyping: boolean): void {
        this.send({ type: 'typing', recipientId, isTyping });
    }

    /**
     * Отправляет подтверждение прочтения
     */
    sendReadReceipt(recipientId: string, messageIds: string[]): void {
        if (messageIds.length === 0) return;
        this.send({ type: 'read', recipientId, messageIds });
    }

    /**
     * Регистрирует обработчик события
     */
    on(type: string, handler: WSMessageHandler): void {
        if (!this.handlers.has(type)) {
            this.handlers.set(type, []);
        }
        this.handlers.get(type)!.push(handler);
    }

    /**
     * Удаляет обработчик события
     */
    off(type: string, handler: WSMessageHandler): void {
        const handlers = this.handlers.get(type);
        if (handlers) {
            const index = handlers.indexOf(handler);
            if (index > -1) {
                handlers.splice(index, 1);
            }
        }
    }

    /**
     * Эмитит событие
     */
    private emit(type: string, data: unknown): void {
        const handlers = this.handlers.get(type);
        if (handlers) {
            handlers.forEach((handler) => handler(data));
        }
    }

    /**
     * Ping для поддержания соединения
     */
    private startPing(): void {
        this.stopPing();
        this.pingInterval = setInterval(() => {
            this.send({ type: 'ping' });
        }, 30000);
    }

    private stopPing(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    /**
     * Попытка переподключения
     */
    private attemptReconnect(forcedDelay?: number): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.warn(`Max reconnect attempts (${this.maxReconnectAttempts}) reached. Giving up.`);
            useUIStore.getState().setWsStatus('disconnected');
            return;
        }

        this.reconnectAttempts++;

        let delay = forcedDelay;
        if (delay === undefined) {
            // Backoff: 1s, 2s, 4s, 8s, 16s... cap at 30s
            delay = Math.min(30000, this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1));
        }

        console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

        this.clearReconnectTimer();
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            // Check if we should still reconnect
            if (this.token && !this.isManuallyDisconnected) {
                // If we are in a terminal state (like kicked or auth_error from another source), stop? 
                // Currently onclose sets state. 
                // We rely on connect() to reset status to 'connecting'.
                this.connect(this.token).catch(console.error);
            }
        }, delay);
    }

    private clearReconnectTimer(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    /**
     * Closes the underlying socket without clearing event handlers.
     * Used internally on reconnect to preserve registered listeners.
     */
    private _closeSocket(): void {
        this.stopPing();
        if (this.ws) {
            this.ws.onopen = null;
            this.ws.onmessage = null;
            this.ws.onclose = null;
            this.ws.onerror = null;
            this.ws.close();
            this.ws = null;
        }
    }

    /**
     * Закрывает соединение (full logout — clears handlers)
     */
    disconnect(): void {
        this.isManuallyDisconnected = true;
        this.clearReconnectTimer();
        this._closeSocket();
        this.token = null;
        this.handlers.clear();
        useUIStore.getState().setWsStatus('disconnected');
        useTypingStore.getState().clearAll();
    }

    /**
     * Проверяет состояние соединения
     */
    isConnected(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }
}

// Singleton instance
export const wsClient = new WebSocketClient();
