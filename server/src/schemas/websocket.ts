import { z } from 'zod'

const PingMessageSchema = z.object({
  type: z.literal('ping'),
})

const TypingMessageSchema = z.object({
  type: z.literal('typing'),
  recipientId: z.string(),
  isTyping: z.boolean(),
})

const ReadReceiptMessageSchema = z.object({
  type: z.literal('read'),
  recipientId: z.string(),
  messageIds: z.array(z.string()),
})

export const WsMessageSchema = z.discriminatedUnion('type', [
  PingMessageSchema,
  TypingMessageSchema,
  ReadReceiptMessageSchema,
])

export type WsMessage = z.infer<typeof WsMessageSchema>
export type TypingMessage = z.infer<typeof TypingMessageSchema>
export type ReadReceiptMessage = z.infer<typeof ReadReceiptMessageSchema>
