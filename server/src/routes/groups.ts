import { Router, Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import rateLimit from 'express-rate-limit'

import database from '../db/database'
import { requireSignature } from '../middleware/auth'
import { validateBody, validateParams } from '../middleware/validate'
import {
  CreateGroupBodySchema,
  GroupIdParamSchema,
  AddMemberBodySchema,
  GroupMemberParamSchema,
} from '../schemas/groups'

const router = Router()

const groupRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    const identityKey = req.user?.identityKey
    if (identityKey) {
      const user = database.getUserByIdentityKey(identityKey)
      if (user) return `group:${user.id}`
    }
    return `group:ip:${req.ip || '127.0.0.1'}`
  },
})

function getSignerUser(req: Request) {
  return req.user?.identityKey ? database.getUserByIdentityKey(req.user.identityKey) : undefined
}

// POST /groups/create
router.post(
  '/create',
  requireSignature,
  groupRateLimit,
  validateBody(CreateGroupBodySchema),
  (req: Request, res: Response) => {
    try {
      const signer = getSignerUser(req)
      if (!signer) {
        res.status(403).json({ error: 'Unauthorized' })
        return
      }

      const { name, memberIds } = req.body as { name: string; memberIds: string[] }

      const groupId = uuidv4()
      database.createGroup(groupId, name.trim(), signer.id)

      // Add other members
      for (const memberId of memberIds) {
        if (memberId === signer.id) continue
        const user = database.getUserById(memberId)
        if (user) {
          database.addGroupMember(groupId, memberId)
        }
      }

      const members = database.getGroupMembers(groupId)
      res.status(201).json({ id: groupId, name: name.trim(), members })
    } catch (error) {
      console.error('Create group error:', error instanceof Error ? error.message : String(error))
      res.status(500).json({ error: 'Failed to create group' })
    }
  }
)

// GET /groups — list user's groups
router.get('/', requireSignature, (req: Request, res: Response) => {
  try {
    const signer = getSignerUser(req)
    if (!signer) {
      res.status(403).json({ error: 'Unauthorized' })
      return
    }

    const groups = database.getUserGroups(signer.id)
    const result = groups.map(g => ({
      ...g,
      members: database.getGroupMembers(g.id),
    }))

    res.json({ groups: result })
  } catch (error) {
    console.error('List groups error:', error instanceof Error ? error.message : String(error))
    res.status(500).json({ error: 'Failed to list groups' })
  }
})

// GET /groups/:groupId
router.get(
  '/:groupId',
  requireSignature,
  validateParams(GroupIdParamSchema),
  (req: Request, res: Response) => {
    try {
      const groupId = req.params.groupId!

      const signer = getSignerUser(req)
      if (!signer) {
        res.status(403).json({ error: 'Unauthorized' })
        return
      }

      const group = database.getGroupById(groupId)
      if (!group) {
        res.status(404).json({ error: 'Group not found' })
        return
      }

      const members = database.getGroupMembers(groupId)
      const isMember = members.some(m => m.user_id === signer.id)
      if (!isMember) {
        res.status(403).json({ error: 'Not a member of this group' })
        return
      }

      res.json({ ...group, members })
    } catch (error) {
      console.error('Get group error:', error instanceof Error ? error.message : String(error))
      res.status(500).json({ error: 'Failed to get group' })
    }
  }
)

// POST /groups/:groupId/members — add a member
router.post(
  '/:groupId/members',
  requireSignature,
  groupRateLimit,
  validateParams(GroupIdParamSchema),
  validateBody(AddMemberBodySchema),
  (req: Request, res: Response) => {
    try {
      const groupId = req.params.groupId!

      const signer = getSignerUser(req)
      if (!signer) {
        res.status(403).json({ error: 'Unauthorized' })
        return
      }

      const group = database.getGroupById(groupId)
      if (!group) {
        res.status(404).json({ error: 'Group not found' })
        return
      }

      const members = database.getGroupMembers(groupId)
      const signerMember = members.find(m => m.user_id === signer.id)
      if (!signerMember || signerMember.role !== 'admin') {
        res.status(403).json({ error: 'Only admins can add members' })
        return
      }

      if (members.length >= 50) {
        res.status(400).json({ error: 'Group is full (max 50 members)' })
        return
      }

      const { userId } = req.body as { userId: string }

      const targetUser = database.getUserById(userId)
      if (!targetUser) {
        res.status(404).json({ error: 'User not found' })
        return
      }

      database.addGroupMember(groupId, userId)
      res.json({ ok: true, members: database.getGroupMembers(groupId) })
    } catch (error) {
      console.error(
        'Add group member error:',
        error instanceof Error ? error.message : String(error)
      )
      res.status(500).json({ error: 'Failed to add member' })
    }
  }
)

// DELETE /groups/:groupId/members/:userId — remove a member or leave
router.delete(
  '/:groupId/members/:userId',
  requireSignature,
  validateParams(GroupMemberParamSchema),
  (req: Request, res: Response) => {
    try {
      const groupId = req.params.groupId!
      const userId = req.params.userId!

      const signer = getSignerUser(req)
      if (!signer) {
        res.status(403).json({ error: 'Unauthorized' })
        return
      }

      const group = database.getGroupById(groupId)
      if (!group) {
        res.status(404).json({ error: 'Group not found' })
        return
      }

      const members = database.getGroupMembers(groupId)
      const signerMember = members.find(m => m.user_id === signer.id)
      if (!signerMember) {
        res.status(403).json({ error: 'Not a member' })
        return
      }

      // Anyone can leave (remove themselves), admins can remove others
      if (userId !== signer.id && signerMember.role !== 'admin') {
        res.status(403).json({ error: 'Only admins can remove members' })
        return
      }

      database.removeGroupMember(groupId, userId)

      // If no members left, delete the group
      const remaining = database.getGroupMembers(groupId)
      if (remaining.length === 0) {
        database.deleteGroup(groupId)
        res.json({ ok: true, deleted: true })
        return
      }

      // If the admin left, promote the next member
      const nextMember = remaining[0]
      if (userId === group.creator_id && nextMember && !remaining.some(m => m.role === 'admin')) {
        database.removeGroupMember(groupId, nextMember.user_id)
        database.addGroupMember(groupId, nextMember.user_id, 'admin')
      }

      res.json({ ok: true, members: database.getGroupMembers(groupId) })
    } catch (error) {
      console.error(
        'Remove group member error:',
        error instanceof Error ? error.message : String(error)
      )
      res.status(500).json({ error: 'Failed to remove member' })
    }
  }
)

export default router
