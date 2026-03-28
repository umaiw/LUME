import { WebSocket, WebSocketServer } from 'ws'
import { IncomingMessage } from 'http'
import jwt from 'jsonwebtoken'

import database from '../db/database'
import { buildOriginAllowlist, isOriginAllowed } from '../utils/originAllowlist'
import { isValidMessageIds, isValidRecipientId } from '../utils/validators'

// Connected users map: userId -> Set<WebSocket>
const connectedUsers = new Map<string, Set<WebSocket>>()

// Rate limits
const connectionRateLimits = new Map<string, number[]>() // IP -> timestamps
const typingRateLimits = new Map<string, { lastAt: number; state: boolean }>()
const ORIGIN_ALLOWLIST = buildOriginAllowlist(process.env.CLIENT_ORIGIN || 'http://localhost:3000')

let rateLimitCleanupInterval: NodeJS.Timeout | null = null

interface AuthenticatedWebSocket extends WebSocket {
  userId: string
  username: string
  isAlive: boolean // Heartbeat flag
}

interface WSMessage {
  type: string
  [key: string]: unknown
}

interface TypingMessage extends WSMessage {
  type: 'typing'
  recipientId: string
  isTyping: boolean
}

interface ReadReceiptMessage extends WSMessage {
  type: 'read'
  recipientId: string
  messageIds: string[]
}

function getClientIp(req: IncomingMessage): string {
  const trustProxy =
    process.env.TRUST_PROXY === '1' ||
    process.env.TRUST_PROXY === 'true' ||
    process.env.WS_TRUST_PROXY === '1' ||
    process.env.WS_TRUST_PROXY === 'true'
  const xForwardedFor = req.headers['x-forwarded-for']
  if (trustProxy && xForwardedFor) {
    const raw = Array.isArray(xForwardedFor) ? (xForwardedFor[0] ?? '') : xForwardedFor
    const ips = raw.split(',')
    return ips[0]?.trim() || 'unknown'
  }
  return req.socket.remoteAddress || 'unknown'
}

export function initWebSocket(wss: WebSocketServer): void {
  if (!rateLimitCleanupInterval) {
    rateLimitCleanupInterval = setInterval(() => {
      const now = Date.now()
      for (const [ip, timestamps] of connectionRateLimits.entries()) {
        const validTimestamps = timestamps.filter(t => now - t < 60_000)
        if (validTimestamps.length === 0) {
          connectionRateLimits.delete(ip)
        } else {
          connectionRateLimits.set(ip, validTimestamps)
        }
      }

      for (const [key, value] of typingRateLimits.entries()) {
        if (now - value.lastAt > 10 * 60 * 1000) {
          typingRateLimits.delete(key)
        }
      }
    }, 60_000)
  }

  wss.on('connection', (ws: AuthenticatedWebSocket, req: IncomingMessage) => {
    ws.isAlive = true

    if (process.env.NODE_ENV === 'development' && process.env.WS_DEV_FORCE_CLOSE_CODE) {
      const forceCode = parseInt(process.env.WS_DEV_FORCE_CLOSE_CODE, 10)
      if (!Number.isNaN(forceCode)) {
        console.warn(`[DEV] Forcing connection close with code: ${forceCode}`)
        ws.close(forceCode, 'DEV_FORCE_CLOSE')
        ws.terminate()
        return
      }
    }

    // Handshake rate limit by IP (10 per minute)
    const ip = getClientIp(req)
    const now = Date.now()
    const timestamps = connectionRateLimits.get(ip) || []
    const validTimestamps = timestamps.filter(t => now - t < 60_000)

    if (validTimestamps.length >= 10) {
      ws.close(4006, 'Rate limit exceeded')
      ws.terminate()
      return
    }

    validTimestamps.push(now)
    connectionRateLimits.set(ip, validTimestamps)

    const skipOriginCheck =
      process.env.SKIP_ORIGIN_CHECK === '1' && process.env.NODE_ENV !== 'production'
    if (!skipOriginCheck) {
      const origin = (req.headers.origin as string | undefined) || ''
      if (!isOriginAllowed(origin, ORIGIN_ALLOWLIST)) {
        ws.close(4007, 'Origin not allowed')
        ws.terminate()
        return
      }
    }

    // Sec-WebSocket-Protocol: expect "lume" plus "auth.<token>"
    const protocols = req.headers['sec-websocket-protocol']

    let token: string | undefined
    let hasLumeProtocol = false

    if (protocols) {
      const parts = protocols.split(',').map(p => p.trim())
      for (const part of parts) {
        if (part === 'lume') {
          hasLumeProtocol = true
        } else if (part.startsWith('auth.')) {
          token = part.slice(5)
        }
      }
    }

    const abort = (code: number, reason: string) => {
      ws.close(code, reason)
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CLOSING) {
          ws.terminate()
        }
      }, 1000)
    }

    if (!hasLumeProtocol) {
      return abort(4002, 'Missing protocol marker')
    }

    if (!token) {
      return abort(4001, 'Missing auth token')
    }

    try {
      const decoded = jwt.verify(token, process.env.WS_JWT_SECRET as string, {
        audience: 'lume-ws',
        issuer: 'lume',
        algorithms: ['HS256'],
      }) as jwt.JwtPayload

      if (!decoded.sub || typeof decoded.sub !== 'string') {
        throw new Error('No subject in token')
      }

      const userId = decoded.sub
      ws.userId = userId

      const user = database.getUserById(userId)
      if (!user) {
        return abort(4002, 'User not found')
      }

      ws.username = user.username
      addConnection(userId, ws)
      database.touchLastSeen(userId)
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        return abort(4003, 'Token expired')
      }
      return abort(4002, 'Invalid token')
    }

    ws.on('pong', () => {
      ws.isAlive = true
    })

    ws.on('message', (data: Buffer) => {
      try {
        if (ws.readyState !== WebSocket.OPEN) return

        // Reject oversized payloads (64 KB max for any WS message)
        if (data.length > 65_536) return

        const raw = data.toString()
        const message = JSON.parse(raw) as WSMessage

        // Every message must have a valid string type
        if (
          typeof message.type !== 'string' ||
          message.type.length === 0 ||
          message.type.length > 32
        ) {
          return
        }

        const VALID_WS_TYPES = ['ping', 'typing', 'read'] as const
        if (!VALID_WS_TYPES.includes(message.type as (typeof VALID_WS_TYPES)[number])) {
          return
        }

        switch (message.type) {
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }))
            break

          case 'typing': {
            const typed = message as TypingMessage
            if (!isValidRecipientId(typed.recipientId)) break
            if (typeof typed.isTyping !== 'boolean') break
            // Prevent sending typing to self
            if (typed.recipientId === ws.userId) break
            handleTyping(ws.userId, ws.username, typed)
            break
          }

          case 'read': {
            const readMsg = message as ReadReceiptMessage
            if (!isValidRecipientId(readMsg.recipientId)) break
            if (!isValidMessageIds(readMsg.messageIds)) break
            // Prevent sending read receipt to self
            if (readMsg.recipientId === ws.userId) break
            handleReadReceipt(ws.userId, readMsg)
            break
          }

          default:
            break
        }
      } catch (error) {
        console.error('WS parse error:', error instanceof Error ? error.message : String(error))
      }
    })

    ws.on('close', () => {
      if (ws.userId) {
        removeConnection(ws.userId, ws)
        database.touchLastSeen(ws.userId)
      }
    })

    ws.on('error', error => {
      console.error('WS error:', error instanceof Error ? error.message : String(error))
    })
  })

  // Heartbeat
  const interval = setInterval(() => {
    wss.clients.forEach(ws => {
      const extWs = ws as AuthenticatedWebSocket
      if (extWs.isAlive === false) {
        return ws.terminate()
      }
      extWs.isAlive = false
      ws.ping()
    })
  }, 30_000)

  wss.on('close', () => {
    clearInterval(interval)
    if (rateLimitCleanupInterval) {
      clearInterval(rateLimitCleanupInterval)
      rateLimitCleanupInterval = null
    }
  })
}

function handleTyping(senderId: string, senderUsername: string, message: TypingMessage): void {
  const now = Date.now()
  const key = `${senderId}|${message.recipientId}`
  const prev = typingRateLimits.get(key)
  if (prev) {
    if (prev.state === message.isTyping && now - prev.lastAt < 800) {
      return
    }
    if (now - prev.lastAt < 150) {
      return
    }
  }
  typingRateLimits.set(key, { lastAt: now, state: message.isTyping })

  broadcastToUser(message.recipientId, {
    type: 'typing',
    senderId,
    senderUsername,
    isTyping: message.isTyping,
  })
}

function handleReadReceipt(senderId: string, message: ReadReceiptMessage): void {
  // Validate: max 100 IDs per receipt, all strings
  const ids = message.messageIds
  if (ids.length === 0 || ids.length > 100 || ids.some(id => typeof id !== 'string')) {
    return
  }

  broadcastToUser(message.recipientId, {
    type: 'read',
    senderId,
    messageIds: ids,
  })
}

function addConnection(userId: string, ws: WebSocket): void {
  if (!connectedUsers.has(userId)) {
    connectedUsers.set(userId, new Set())
  }

  const connections = connectedUsers.get(userId)!

  if (connections.size >= 5) {
    const oldest = connections.values().next().value
    if (oldest) {
      try {
        oldest.close(4005, 'Too many connections')
        setTimeout(() => {
          if (oldest.readyState === WebSocket.OPEN || oldest.readyState === WebSocket.CLOSING) {
            try {
              oldest.terminate()
            } catch {
              /* ignore */
            }
          }
        }, 1000)
      } catch (e) {
        console.error('Error closing old socket:', e instanceof Error ? e.message : String(e))
      }
      connections.delete(oldest)
    }
  }

  connections.add(ws)
}

function removeConnection(userId: string, ws: WebSocket): void {
  const connections = connectedUsers.get(userId)
  if (connections) {
    connections.delete(ws)
    if (connections.size === 0) {
      connectedUsers.delete(userId)
    }
  }
}

export function broadcastToUser(userId: string, message: object): boolean {
  const connections = connectedUsers.get(userId)
  if (!connections || connections.size === 0) {
    return false
  }

  const payload = JSON.stringify(message)
  let delivered = false

  for (const ws of connections) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(payload)
        delivered = true
      } catch {
        connections.delete(ws)
      }
    } else if (ws.readyState === WebSocket.CLOSED) {
      connections.delete(ws)
    }
  }

  if (connections.size === 0) {
    connectedUsers.delete(userId)
  }

  return delivered
}

export function isUserOnline(userId: string): boolean {
  const connections = connectedUsers.get(userId)
  return connections !== undefined && connections.size > 0
}

export function getConnectionStats(): { users: number; connections: number } {
  let totalConnections = 0
  for (const connections of connectedUsers.values()) {
    totalConnections += connections.size
  }

  return {
    users: connectedUsers.size,
    connections: totalConnections,
  }
}
