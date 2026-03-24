/**
 * Zod schemas for /push routes.
 */

import { z } from 'zod'
import { UuidSchema } from './common'

const PushSubscriptionSchema = z.object({
  endpoint: z.string().url('Invalid endpoint URL'),
  keys: z.object({
    p256dh: z.string().min(1, 'p256dh key required'),
    auth: z.string().min(1, 'auth key required'),
  }),
})

// POST /push/subscribe
export const SubscribeBodySchema = z.object({
  userId: UuidSchema,
  subscription: PushSubscriptionSchema,
})

// POST /push/unsubscribe
export const UnsubscribeBodySchema = z.object({
  userId: UuidSchema,
})
