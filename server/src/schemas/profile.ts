/**
 * Zod schemas for /profile routes.
 */

import { z } from 'zod'
import { UuidSchema, DisplayNameSchema } from './common'

// GET/PUT /profile/:userId
export const ProfileParamSchema = z.object({
  userId: UuidSchema,
})

// PUT /profile/:userId body
export const UpdateProfileBodySchema = z.object({
  displayName: DisplayNameSchema.optional(),
  avatarFileId: z.string().trim().max(128).nullable().optional(),
})
