/**
 * Zod schemas for validating server API responses.
 * Every response from the server is validated before use.
 */

import { z } from 'zod'

// ── Primitives ──────────────────────────────────────────────

const UuidSchema = z.string().min(1)
const UsernameSchema = z.string().min(3).max(32)
const Base64KeySchema = z.string().min(1)

// ── Auth responses ──────────────────────────────────────────

export const RegisterResponseSchema = z.object({
  id: UuidSchema,
  username: UsernameSchema,
  message: z.string(),
})

export const CheckUsernameResponseSchema = z.object({
  available: z.boolean(),
  reason: z.string().optional(),
})

export const UserBundleSchema = z.object({
  id: UuidSchema,
  username: UsernameSchema,
  identityKey: Base64KeySchema,
  exchangeKey: Base64KeySchema.optional(),
  exchangeIdentityKey: Base64KeySchema.optional(),
  signedPrekey: Base64KeySchema,
  signedPrekeySignature: Base64KeySchema,
  oneTimePrekey: Base64KeySchema.optional(),
})

export const SessionResponseSchema = z.object({
  token: z.string().min(1),
  expiresIn: z.number().positive(),
})

export const BlockedUsersResponseSchema = z.object({
  blockedIds: z.array(UuidSchema),
})

// ── Messages responses ──────────────────────────────────────

export const SendMessageResponseSchema = z.object({
  messageId: UuidSchema,
  delivered: z.boolean(),
})

export const PendingMessageSchema = z.object({
  id: UuidSchema,
  senderId: UuidSchema,
  senderUsername: UsernameSchema,
  encryptedPayload: z.string().min(1),
  timestamp: z.number(),
})

export const PendingMessagesResponseSchema = z.object({
  messages: z.array(PendingMessageSchema),
})

export const AcknowledgeResponseSchema = z.object({
  acknowledged: z.number().int().nonnegative(),
})

// ── Files responses ─────────────────────────────────────────

export const UploadFileResponseSchema = z.object({
  fileId: UuidSchema,
  size: z.number().positive(),
  expiresAt: z.number(),
})

export const DownloadFileResponseSchema = z.object({
  fileId: UuidSchema,
  data: z.string().min(1),
  mimeHint: z.string(),
  size: z.number(),
})

// ── Groups responses ────────────────────────────────────────

export const GroupMemberSchema = z.object({
  user_id: UuidSchema,
  username: UsernameSchema,
  role: z.string(),
})

export const GroupDataSchema = z.object({
  id: UuidSchema,
  name: z.string().min(1),
  creator_id: UuidSchema,
  created_at: z.number(),
  members: z.array(GroupMemberSchema),
})

export const GroupListResponseSchema = z.object({
  groups: z.array(GroupDataSchema),
})

// ── Profile responses ───────────────────────────────────────

export const ProfileDataSchema = z.object({
  id: UuidSchema,
  username: UsernameSchema,
  displayName: z.string().nullable(),
  avatarFileId: z.string().nullable(),
})

// ── WebSocket messages ──────────────────────────────────────

export const WsNewMessageSchema = z.object({
  type: z.literal('new_message'),
  messageId: UuidSchema,
  senderId: UuidSchema,
  senderUsername: UsernameSchema,
  encryptedPayload: z.string().min(1),
  timestamp: z.number(),
})

export const WsReadReceiptSchema = z.object({
  type: z.literal('read_receipt'),
  messageIds: z.array(UuidSchema).min(1),
  readerId: UuidSchema,
})

export const WsTypingSchema = z.object({
  type: z.literal('typing'),
  senderId: UuidSchema,
})

export const WsIncomingMessageSchema = z.discriminatedUnion('type', [
  WsNewMessageSchema,
  WsReadReceiptSchema,
  WsTypingSchema,
])
