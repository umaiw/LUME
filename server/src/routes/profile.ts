import { Router, type Request, type Response } from 'express'
import { requireSignature } from '../middleware/auth'
import { validateBody, validateParams } from '../middleware/validate'
import { ProfileParamSchema, UpdateProfileBodySchema } from '../schemas/profile'
import database from '../db/database'
import rateLimit from 'express-rate-limit'

const router = Router()

const profileLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyGenerator: (req: Request) => req.user?.identityKey || req.ip || 'unknown',
  standardHeaders: true,
  legacyHeaders: false,
})

/** GET /profile/:userId — get user profile */
router.get(
  '/:userId',
  requireSignature,
  profileLimiter,
  validateParams(ProfileParamSchema),
  (req: Request, res: Response) => {
    const userId = req.params.userId!
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
  }
)

/** PUT /profile/:userId — update own profile */
router.put(
  '/:userId',
  requireSignature,
  profileLimiter,
  validateParams(ProfileParamSchema),
  validateBody(UpdateProfileBodySchema),
  (req: Request, res: Response) => {
    const userId = req.params.userId!
    const { displayName, avatarFileId } = req.body as {
      displayName?: string | null
      avatarFileId?: string | null
    }

    const user = database.getUserById(userId)
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    if (req.user?.identityKey !== user.identity_key) {
      res.status(403).json({ error: "Cannot edit another user's profile" })
      return
    }

    const name = displayName !== undefined ? displayName : user.display_name
    const avatar = avatarFileId !== undefined ? avatarFileId : user.avatar_file_id

    database.setProfile(userId, name ?? null, avatar ?? null)

    res.json({
      id: user.id,
      username: user.username,
      displayName: name,
      avatarFileId: avatar,
    })
  }
)

export default router
