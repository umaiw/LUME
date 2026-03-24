import { Router, Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import nacl from 'tweetnacl'
import { decodeBase64 } from 'tweetnacl-util'
import rateLimit from 'express-rate-limit'

import database from '../db/database'
import { broadcastToUser } from '../websocket/handler'
import { requireSignature } from '../middleware/auth'
import { isValidUsername, isValidUuidLike } from '../utils/validators'
import { sendPushNotification } from '../services/pushService'

const router = Router()

const sendRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    const identityKey = req.user?.identityKey
    if (identityKey) {
      const user = database.getUserByIdentityKey(identityKey)
      if (user) {
        return `uid:${user.id}`
      }
    }
    return `ip:${req.ip || '127.0.0.1'}`
  },
})

// === Types ==================================================================

export interface SendMessageRequest {
  senderId: string
  recipientUsername: string
  encryptedPayload: string // JSON string with envelope, ciphertext, nonce
}

const MAX_ENCRYPTED_PAYLOAD_BYTES = 64 * 1024

// === Validation =============================================================

export function isValidEncryptedPayload(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0) {
    return false
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_ENCRYPTED_PAYLOAD_BYTES) {
    return false
  }

  try {
    const parsed = JSON.parse(value) as Record<string, unknown> | null
    if (!parsed || typeof parsed !== 'object') {
      return false
    }

    // v1: NaCl box envelope (legacy).
    if (parsed.v === 1 && parsed.alg === 'nacl-box') {
      if (
        typeof parsed.senderExchangeKey !== 'string' ||
        typeof parsed.ciphertext !== 'string' ||
        typeof parsed.nonce !== 'string' ||
        typeof parsed.timestamp !== 'number'
      ) {
        return false
      }

      try {
        const senderKeyBytes = decodeBase64(parsed.senderExchangeKey)
        const nonceBytes = decodeBase64(parsed.nonce)
        if (senderKeyBytes.length !== 32) return false
        if (nonceBytes.length !== nacl.box.nonceLength) return false

        const ciphertextBytes = decodeBase64(parsed.ciphertext)
        if (ciphertextBytes.length === 0 || ciphertextBytes.length > MAX_ENCRYPTED_PAYLOAD_BYTES)
          return false
      } catch {
        return false
      }
    }

    // v2: X3DH + Double Ratchet envelope.
    else if (parsed.v === 2 && parsed.alg === 'lume-ratchet') {
      if (
        typeof parsed.ciphertext !== 'string' ||
        typeof parsed.nonce !== 'string' ||
        typeof parsed.timestamp !== 'number' ||
        typeof parsed.header !== 'object' ||
        parsed.header === null
      ) {
        return false
      }

      const header = parsed.header as Record<string, unknown>
      if (
        typeof header.publicKey !== 'string' ||
        typeof header.previousChainLength !== 'number' ||
        typeof header.messageNumber !== 'number'
      ) {
        return false
      }

      try {
        const headerKeyBytes = decodeBase64(header.publicKey)
        if (headerKeyBytes.length !== 32) return false

        const nonceBytes = decodeBase64(parsed.nonce)
        if (nonceBytes.length !== nacl.secretbox.nonceLength) return false

        const ciphertextBytes = decodeBase64(parsed.ciphertext)
        if (ciphertextBytes.length === 0 || ciphertextBytes.length > MAX_ENCRYPTED_PAYLOAD_BYTES)
          return false
      } catch {
        return false
      }

      // Optional X3DH init block.
      if (parsed.x3dh !== undefined && parsed.x3dh !== null) {
        if (typeof parsed.x3dh !== 'object') return false
        const x3dh = parsed.x3dh as Record<string, unknown>
        if (
          typeof x3dh.senderIdentityKey !== 'string' ||
          typeof x3dh.senderEphemeralKey !== 'string'
        ) {
          return false
        }
        try {
          const ik = decodeBase64(x3dh.senderIdentityKey)
          const ek = decodeBase64(x3dh.senderEphemeralKey)
          if (ik.length !== 32 || ek.length !== 32) return false

          if (x3dh.recipientOneTimePreKey !== undefined && x3dh.recipientOneTimePreKey !== null) {
            if (typeof x3dh.recipientOneTimePreKey !== 'string') return false
            const opk = decodeBase64(x3dh.recipientOneTimePreKey)
            if (opk.length !== 32) return false
          }
        } catch {
          return false
        }
      }
    } else {
      return false
    }

    if (parsed.selfDestruct != null) {
      if (typeof parsed.selfDestruct !== 'number') return false
      const maxSeconds = 7 * 24 * 60 * 60
      if (
        !Number.isFinite(parsed.selfDestruct) ||
        parsed.selfDestruct < 0 ||
        parsed.selfDestruct > maxSeconds
      ) {
        return false
      }
    }

    return true
  } catch {
    return false
  }
}

// === Routes =================================================================

// POST /messages/send
router.post('/send', requireSignature, sendRateLimit, (req: Request, res: Response) => {
  try {
    const { senderId, recipientUsername, encryptedPayload } = req.body as SendMessageRequest
    const normalizedRecipient =
      typeof recipientUsername === 'string' ? recipientUsername.trim() : recipientUsername

    if (!isValidUuidLike(senderId)) {
      res.status(400).json({ error: 'Invalid senderId' })
      return
    }
    if (!isValidUsername(normalizedRecipient)) {
      res.status(400).json({ error: 'Invalid recipient username' })
      return
    }
    if (!isValidEncryptedPayload(encryptedPayload)) {
      res.status(400).json({ error: 'Invalid encrypted payload' })
      return
    }

    const sender = database.getUserById(senderId)
    if (!sender) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    if (sender.identity_key !== req.user?.identityKey) {
      res.status(403).json({ error: 'Identity mismatch' })
      return
    }

    const recipient = database.getUserByUsername(normalizedRecipient)
    if (!recipient) {
      res.status(404).json({ error: 'Recipient not found' })
      return
    }

    // If the recipient has blocked the sender, silently accept
    // (don't leak the block status to the sender)
    if (database.isBlocked(recipient.id, senderId)) {
      res.status(201).json({
        messageId: uuidv4(),
        delivered: false,
      })
      return
    }

    const MAX_PENDING_PER_USER = 10000
    if (database.getPendingMessageCount(recipient.id) >= MAX_PENDING_PER_USER) {
      res.status(429).json({ error: 'Recipient inbox is full' })
      return
    }

    const messageId = uuidv4()
    database.queueMessage(messageId, senderId, recipient.id, encryptedPayload)

    const delivered = broadcastToUser(recipient.id, {
      type: 'new_message',
      messageId,
      senderId,
      senderUsername: sender.username,
      encryptedPayload,
      timestamp: Date.now(),
    })

    // Send push notification if recipient is offline
    if (!delivered) {
      void sendPushNotification(recipient.id, sender.username)
    }

    res.status(201).json({
      messageId,
      delivered,
    })
  } catch (error) {
    console.error('Send message error:', error instanceof Error ? error.message : String(error))
    res.status(500).json({ error: 'Failed to send message' })
  }
})

// GET /messages/pending/:userId
router.get('/pending/:userId', requireSignature, (req: Request, res: Response) => {
  try {
    const userId = req.params.userId as string
    if (!isValidUuidLike(userId)) {
      res.status(400).json({ error: 'Invalid userId' })
      return
    }

    const user = database.getUserById(userId)
    if (!user || user.identity_key !== req.user?.identityKey) {
      res.status(403).json({ error: 'Unauthorized access to messages' })
      return
    }

    const messages = database.getPendingMessages(userId)
    const senderIds = [...new Set(messages.map(msg => msg.sender_id))]
    const senderMap = new Map(
      database.getUsersByIds(senderIds).map(sender => [sender.id, sender.username])
    )

    const messagesWithSenders = messages.map(msg => ({
      id: msg.id,
      senderId: msg.sender_id,
      senderUsername: senderMap.get(msg.sender_id) || 'unknown',
      encryptedPayload: msg.encrypted_payload,
      timestamp: msg.created_at * 1000,
    }))

    res.json({ messages: messagesWithSenders })
  } catch (error) {
    console.error(
      'Get pending messages error:',
      error instanceof Error ? error.message : String(error)
    )
    res.status(500).json({ error: 'Failed to retrieve pending messages' })
  }
})

// DELETE /messages/:messageId
router.delete('/:messageId', requireSignature, (req: Request, res: Response) => {
  try {
    const messageId = req.params.messageId as string
    if (!isValidUuidLike(messageId)) {
      res.status(400).json({ error: 'Invalid messageId' })
      return
    }

    const signer = req.user?.identityKey
      ? database.getUserByIdentityKey(req.user.identityKey)
      : undefined

    if (!signer) {
      res.status(403).json({ error: 'Unauthorized' })
      return
    }

    const pending = database.getMessageById(messageId)
    if (!pending) {
      res.status(404).json({ error: 'Message not found' })
      return
    }

    if (pending.recipient_id !== signer.id) {
      res.status(403).json({ error: 'Unauthorized access to message' })
      return
    }

    database.deleteMessage(messageId)
    res.json({ message: 'Message acknowledged' })
  } catch (error) {
    console.error(
      'Acknowledge message error:',
      error instanceof Error ? error.message : String(error)
    )
    res.status(500).json({ error: 'Failed to acknowledge message' })
  }
})

// POST /messages/acknowledge
router.post('/acknowledge', requireSignature, (req: Request, res: Response) => {
  try {
    const { messageIds } = req.body as { messageIds: string[] }
    if (
      !Array.isArray(messageIds) ||
      messageIds.length > 500 ||
      messageIds.some(id => !isValidUuidLike(id))
    ) {
      res.status(400).json({ error: 'Invalid messageIds' })
      return
    }

    const signer = req.user?.identityKey
      ? database.getUserByIdentityKey(req.user.identityKey)
      : undefined

    if (!signer) {
      res.status(403).json({ error: 'Unauthorized' })
      return
    }

    let acknowledged = 0
    acknowledged = database.batchDeleteMessages(messageIds, signer.id)

    res.json({ acknowledged })
  } catch (error) {
    console.error(
      'Batch acknowledge error:',
      error instanceof Error ? error.message : String(error)
    )
    res.status(500).json({ error: 'Failed to acknowledge messages' })
  }
})

export default router
