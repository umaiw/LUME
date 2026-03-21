import { Router, Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import jwt from 'jsonwebtoken'
import nacl from 'tweetnacl'
import { decodeBase64 } from 'tweetnacl-util'
import rateLimit from 'express-rate-limit'

import database from '../db/database'
import { requireSignature } from '../middleware/auth'
import {
  isValidBase64Key,
  isValidPrekeys,
  isValidSignature,
  isValidUsername,
  isValidUuidLike,
} from '../utils/validators'

const router = Router()
const LOG_SECURITY = process.env.LOG_SECURITY === '1'

function audit(event: string, details: Record<string, unknown>) {
  if (!LOG_SECURITY) return
  const safeDetails = JSON.stringify(details, (_k, v) =>
    typeof v === 'string' && v.length > 64 ? `${v.slice(0, 32)}…` : v
  )
  console.log(`[audit] ${event} ${safeDetails}`)
}

// === Rate Limiting ==========================================================

const registerRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => `ip:${req.ip || '127.0.0.1'}`,
})

const usernameCheckRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => `ip:${req.ip || '127.0.0.1'}`,
})

const sessionRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
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

// Authenticated write endpoints (prekey rotation, uploads, etc.)
const keysRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
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

// === Request Types ==========================================================

interface RegisterRequest {
  username: string
  identityKey: string
  exchangeIdentityKey?: string
  signedPrekey: string
  signedPrekeySignature: string
  oneTimePrekeys?: Array<{ id: string; publicKey: string }>
}

interface GetUserResponse {
  id: string
  username: string
  identityKey: string
  exchangeKey?: string
  exchangeIdentityKey?: string
  signedPrekey: string
  signedPrekeySignature: string
  oneTimePrekey?: string
}

// === Helpers ================================================================

function verifySignature(signedPrekey: string, signature: string, identityKey: string): boolean {
  try {
    const messageBytes = decodeBase64(signedPrekey)
    const signatureBytes = decodeBase64(signature)
    const publicKeyBytes = decodeBase64(identityKey)
    return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes)
  } catch {
    return false
  }
}

// === Routes =================================================================

// POST /auth/register
router.post('/register', registerRateLimit, (req: Request, res: Response) => {
  try {
    const body = req.body as RegisterRequest
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'Invalid request body' })
      return
    }

    body.username =
      typeof body.username === 'string' ? body.username.trim() : (body.username as string)

    if (!isValidUsername(body.username)) {
      res.status(400).json({
        error: 'Invalid username. Must be 3-32 characters, alphanumeric and underscores only.',
      })
      return
    }

    const existingUser = database.getUserByUsername(body.username)
    if (existingUser) {
      res.status(409).json({ error: 'Username already taken' })
      return
    }

    if (!isValidBase64Key(body.identityKey)) {
      res.status(400).json({ error: 'Invalid identity key' })
      return
    }

    if (body.exchangeIdentityKey !== undefined && !isValidBase64Key(body.exchangeIdentityKey)) {
      res.status(400).json({ error: 'Invalid exchange identity key' })
      return
    }

    if (!isValidBase64Key(body.signedPrekey)) {
      res.status(400).json({ error: 'Invalid signed prekey' })
      return
    }

    if (!isValidSignature(body.signedPrekeySignature)) {
      res.status(400).json({ error: 'Invalid signed prekey signature format' })
      return
    }

    if (body.oneTimePrekeys !== undefined && !isValidPrekeys(body.oneTimePrekeys)) {
      res.status(400).json({ error: 'Invalid one-time prekeys format' })
      return
    }

    // Cap initial prekey upload
    if (body.oneTimePrekeys && body.oneTimePrekeys.length > 1000) {
      res.status(400).json({ error: 'Too many initial prekeys (max 1000)' })
      return
    }

    if (!verifySignature(body.signedPrekey, body.signedPrekeySignature, body.identityKey)) {
      res.status(400).json({ error: 'Invalid signed prekey signature' })
      return
    }

    const userId = uuidv4()
    const exchangeIdentityKey =
      typeof body.exchangeIdentityKey === 'string' && isValidBase64Key(body.exchangeIdentityKey)
        ? body.exchangeIdentityKey
        : body.signedPrekey

    database.createUser(
      userId,
      body.username,
      body.identityKey,
      exchangeIdentityKey,
      body.signedPrekey,
      body.signedPrekeySignature
    )

    if (body.oneTimePrekeys && body.oneTimePrekeys.length > 0) {
      database.addPrekeys(userId, body.oneTimePrekeys)
    }

    res.status(201).json({
      id: userId,
      username: body.username,
      message: 'Registration successful',
    })
    audit('register', { userId, username: body.username })
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('UNIQUE constraint failed')) {
        res.status(409).json({ error: 'Registration conflict. Try a different username.' })
        return
      }
    }
    console.error('Registration error:', error instanceof Error ? error.message : String(error))
    res.status(500).json({ error: 'Failed to register account' })
  }
})

// GET /auth/user/:username — requires authentication to prevent username enumeration
router.get(
  '/user/:username',
  requireSignature,
  usernameCheckRateLimit,
  (req: Request, res: Response) => {
    try {
      const username = (req.params.username as string).trim()
      if (!isValidUsername(username)) {
        res.status(400).json({ error: 'Invalid username format' })
        return
      }

      const user = database.getUserByUsername(username)
      if (!user) {
        res.status(404).json({ error: 'User not found' })
        return
      }
      const exchangeIdentityKey = user.exchange_identity_key || user.signed_prekey

      const response: GetUserResponse = {
        id: user.id,
        username: user.username,
        identityKey: user.identity_key,
        exchangeKey: exchangeIdentityKey,
        exchangeIdentityKey,
        signedPrekey: user.signed_prekey,
        signedPrekeySignature: user.signed_prekey_signature,
      }

      res.json(response)
    } catch (error) {
      console.error('Get user error:', error instanceof Error ? error.message : String(error))
      res.status(500).json({ error: 'Failed to retrieve user profile' })
    }
  }
)

// Prekey bundle rate limit — tighter per-requester limit to prevent prekey exhaustion.
const bundleRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10, // max 10 bundle fetches per minute per requester
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    const identityKey = req.user?.identityKey
    if (identityKey) {
      const user = database.getUserByIdentityKey(identityKey)
      if (user) {
        return `bundle:${user.id}`
      }
    }
    return `bundle:ip:${req.ip || '127.0.0.1'}`
  },
})

// POST /auth/bundle
// Returns a prekey bundle and consumes one one-time prekey (if available).
router.post('/bundle', requireSignature, bundleRateLimit, (req: Request, res: Response) => {
  try {
    const body = req.body as { username?: string }
    const username = typeof body?.username === 'string' ? body.username.trim() : ''
    if (!isValidUsername(username)) {
      res.status(400).json({ error: 'Invalid username format' })
      return
    }

    // Prevent requesting your own bundle (no reason to consume your own prekeys).
    const requester = req.user?.identityKey
      ? database.getUserByIdentityKey(req.user.identityKey)
      : undefined

    const user = database.getUserByUsername(username)
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    if (requester && requester.id === user.id) {
      res.status(400).json({ error: 'Cannot request your own bundle' })
      return
    }

    const exchangeIdentityKey = user.exchange_identity_key || user.signed_prekey
    const oneTimePrekey = database.consumePrekey(user.id)

    const response: GetUserResponse = {
      id: user.id,
      username: user.username,
      identityKey: user.identity_key,
      exchangeKey: exchangeIdentityKey,
      exchangeIdentityKey,
      signedPrekey: user.signed_prekey,
      signedPrekeySignature: user.signed_prekey_signature,
    }

    if (oneTimePrekey) {
      response.oneTimePrekey = oneTimePrekey
    }

    res.json(response)
    audit('bundle_consume', {
      requesterId: requester?.id,
      targetId: user.id,
      hadOPK: !!oneTimePrekey,
    })
  } catch (error) {
    console.error('Get bundle error:', error instanceof Error ? error.message : String(error))
    res.status(500).json({ error: 'Failed to retrieve prekey bundle' })
  }
})

// GET /auth/check/:username
router.get('/check/:username', usernameCheckRateLimit, (req: Request, res: Response) => {
  try {
    const username = (req.params.username as string).trim()

    if (!isValidUsername(username)) {
      res.json({ available: false, reason: 'Invalid format' })
      return
    }

    const user = database.getUserByUsername(username)
    res.json({ available: !user })
  } catch (error) {
    console.error('Check username error:', error instanceof Error ? error.message : String(error))
    res.status(500).json({ error: 'Failed to check username availability' })
  }
})

// POST /auth/prekeys
router.post('/prekeys', requireSignature, (req: Request, res: Response) => {
  try {
    const { userId, prekeys } = req.body as {
      userId: string
      prekeys: Array<{ id: string; publicKey: string }>
    }
    if (!isValidUuidLike(userId)) {
      res.status(400).json({ error: 'Invalid userId' })
      return
    }
    if (!isValidPrekeys(prekeys)) {
      res.status(400).json({ error: 'Invalid prekeys payload' })
      return
    }

    const user = database.getUserById(userId)
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    if (user.identity_key !== req.user?.identityKey) {
      res.status(403).json({ error: 'Unauthorized: Identity key mismatch' })
      return
    }

    // Enforce total prekey cap to prevent storage abuse
    const MAX_PREKEYS = 1000
    const currentCount = database.getPrekeyCount(userId)
    if (currentCount + prekeys.length > MAX_PREKEYS) {
      res.status(400).json({
        error: `Prekey limit exceeded. Max ${MAX_PREKEYS}, current ${currentCount}, attempted +${prekeys.length}`,
      })
      return
    }

    database.addPrekeys(userId, prekeys)

    const count = database.getPrekeyCount(userId)
    res.json({
      message: 'Prekeys uploaded',
      totalPrekeys: count,
    })
  } catch (error) {
    console.error('Upload prekeys error:', error instanceof Error ? error.message : String(error))
    res.status(500).json({ error: 'Failed to upload prekeys' })
  }
})

// POST /auth/keys
router.post('/keys', requireSignature, keysRateLimit, (req: Request, res: Response) => {
  try {
    const { userId, signedPrekey, signedPrekeySignature } = req.body as {
      userId: string
      signedPrekey: string
      signedPrekeySignature: string
    }

    if (!isValidUuidLike(userId)) {
      res.status(400).json({ error: 'Invalid userId' })
      return
    }
    if (!isValidBase64Key(signedPrekey)) {
      res.status(400).json({ error: 'Invalid signed prekey' })
      return
    }
    if (!isValidSignature(signedPrekeySignature)) {
      res.status(400).json({ error: 'Invalid signed prekey signature format' })
      return
    }

    const user = database.getUserById(userId)
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }
    if (user.identity_key !== req.user?.identityKey) {
      res.status(403).json({ error: 'Unauthorized: Identity key mismatch' })
      return
    }
    if (!verifySignature(signedPrekey, signedPrekeySignature, user.identity_key)) {
      res.status(400).json({ error: 'Invalid signed prekey signature' })
      return
    }

    database.setSignedPrekey(userId, signedPrekey, signedPrekeySignature)
    res.json({ message: 'Signed prekey updated' })
  } catch (error) {
    console.error(
      'Update signed prekey error:',
      error instanceof Error ? error.message : String(error)
    )
    res.status(500).json({ error: 'Failed to update signed prekey' })
  }
})

// DELETE /auth/user/:userId
router.delete('/user/:userId', requireSignature, (req: Request, res: Response) => {
  try {
    const userId = req.params.userId as string

    if (!isValidUuidLike(userId)) {
      res.status(400).json({ error: 'Invalid userId' })
      return
    }

    const user = database.getUserById(userId)
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    if (user.identity_key !== req.user?.identityKey) {
      res.status(403).json({ error: 'Unauthorized: Identity key mismatch' })
      return
    }

    database.deleteUser(userId)
    res.json({ message: 'Account deleted' })
    audit('delete_user', { userId })
  } catch (error) {
    console.error('Delete user error:', error instanceof Error ? error.message : String(error))
    res.status(500).json({ error: 'Failed to delete account' })
  }
})

// POST /auth/session
router.post('/session', requireSignature, sessionRateLimit, (req: Request, res: Response) => {
  try {
    const userId = req.body.userId

    if (!isValidUuidLike(userId)) {
      res.status(400).json({ error: 'Missing userId' })
      return
    }

    const user = database.getUserById(userId)
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    if (user.identity_key !== req.user?.identityKey) {
      res.status(403).json({ error: 'Identity key mismatch' })
      return
    }

    const token = jwt.sign({ sub: userId }, process.env.WS_JWT_SECRET as string, {
      algorithm: 'HS256',
      expiresIn: '10m',
      issuer: 'lume',
      audience: 'lume-ws',
    })

    res.json({ token, expiresIn: 600 })
    audit('session_issue', { userId })
  } catch (error) {
    console.error('Session error:', error instanceof Error ? error.message : String(error))
    res.status(500).json({ error: 'Failed to create session' })
  }
})

// === Block / Unblock ========================================================

// POST /auth/block
router.post('/block', requireSignature, (req: Request, res: Response) => {
  try {
    const { blockedId } = req.body as { blockedId: string }
    if (!isValidUuidLike(blockedId)) {
      res.status(400).json({ error: 'Invalid blockedId' })
      return
    }

    const signer = req.user?.identityKey
      ? database.getUserByIdentityKey(req.user.identityKey)
      : undefined
    if (!signer) {
      res.status(403).json({ error: 'Unauthorized' })
      return
    }

    if (signer.id === blockedId) {
      res.status(400).json({ error: 'Cannot block yourself' })
      return
    }

    const targetUser = database.getUserById(blockedId)
    if (!targetUser) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    database.blockUser(signer.id, blockedId)
    audit('block_user', { blockerId: signer.id, blockedId })
    res.json({ ok: true })
  } catch (error) {
    console.error('Block error:', error instanceof Error ? error.message : String(error))
    res.status(500).json({ error: 'Failed to block user' })
  }
})

// POST /auth/unblock
router.post('/unblock', requireSignature, (req: Request, res: Response) => {
  try {
    const { blockedId } = req.body as { blockedId: string }
    if (!isValidUuidLike(blockedId)) {
      res.status(400).json({ error: 'Invalid blockedId' })
      return
    }

    const signer = req.user?.identityKey
      ? database.getUserByIdentityKey(req.user.identityKey)
      : undefined
    if (!signer) {
      res.status(403).json({ error: 'Unauthorized' })
      return
    }

    database.unblockUser(signer.id, blockedId)
    audit('unblock_user', { blockerId: signer.id, blockedId })
    res.json({ ok: true })
  } catch (error) {
    console.error('Unblock error:', error instanceof Error ? error.message : String(error))
    res.status(500).json({ error: 'Failed to unblock user' })
  }
})

// GET /auth/blocked
router.get('/blocked', requireSignature, keysRateLimit, (req: Request, res: Response) => {
  try {
    const signer = req.user?.identityKey
      ? database.getUserByIdentityKey(req.user.identityKey)
      : undefined
    if (!signer) {
      res.status(403).json({ error: 'Unauthorized' })
      return
    }

    const blockedIds = database.getBlockedUsers(signer.id)
    res.json({ blockedIds })
  } catch (error) {
    console.error(
      'Get blocked users error:',
      error instanceof Error ? error.message : String(error)
    )
    res.status(500).json({ error: 'Failed to retrieve blocked users list' })
  }
})

export default router
