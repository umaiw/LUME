import { Router, type Request, type Response } from 'express'
import { requireSignature } from '../middleware/auth'
import database from '../db/database'
import rateLimit from 'express-rate-limit'

const router = Router()

const profileLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyGenerator: (req: Request) =>
    (req as unknown as { user?: { identityKey: string } }).user?.identityKey || req.ip || 'unknown',
  standardHeaders: true,
  legacyHeaders: false,
})

/** GET /profile/:userId — get user profile */
router.get('/:userId', requireSignature, profileLimiter, (req: Request, res: Response) => {
  const { userId } = req.params
  const user = database.getUserById(userId)
  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  res.json({
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    avatarFileId: user.avatar_file_id,
  })
})

/** PUT /profile/:userId — update own profile */
router.put('/:userId', requireSignature, profileLimiter, (req: Request, res: Response) => {
  const { userId } = req.params
  const { displayName, avatarFileId } = req.body as {
    displayName?: string | null
    avatarFileId?: string | null
  }

  const user = database.getUserById(userId)
  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  // Verify the requester is the user
  const requesterKey = (req as unknown as { user?: { identityKey: string } }).user?.identityKey
  if (requesterKey !== user.identity_key) {
    res.status(403).json({ error: "Cannot edit another user's profile" })
    return
  }

  // Validate display name
  const name = displayName !== undefined ? displayName : user.display_name
  if (name !== null && (typeof name !== 'string' || name.length > 64)) {
    res.status(400).json({ error: 'Display name must be 64 characters or less' })
    return
  }

  const avatar = avatarFileId !== undefined ? avatarFileId : user.avatar_file_id

  database.setProfile(userId, name ?? null, avatar ?? null)

  res.json({
    id: user.id,
    username: user.username,
    displayName: name,
    avatarFileId: avatar,
  })
})

export default router
