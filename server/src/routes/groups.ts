import { Router, Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import rateLimit from 'express-rate-limit'

import database from '../db/database'
import { requireSignature } from '../middleware/auth'
import { isValidUuidLike } from '../utils/validators'

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
router.post('/create', requireSignature, groupRateLimit, (req: Request, res: Response) => {
  try {
    const signer = getSignerUser(req)
    if (!signer) {
      res.status(403).json({ error: 'Unauthorized' })
      return
    }

    const { name, memberIds } = req.body as { name?: string; memberIds?: string[] }

    if (!name || typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 64) {
      res.status(400).json({ error: 'Group name must be 1-64 characters' })
      return
    }

    if (!Array.isArray(memberIds) || memberIds.length === 0 || memberIds.length > 50) {
      res.status(400).json({ error: 'Must include 1-50 member IDs' })
      return
    }

    if (memberIds.some(id => !isValidUuidLike(id))) {
      res.status(400).json({ error: 'Invalid member ID format' })
      return
    }

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
})

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
router.get('/:groupId', requireSignature, (req: Request, res: Response) => {
  try {
    const groupId = req.params.groupId as string
    if (!isValidUuidLike(groupId)) {
      res.status(400).json({ error: 'Invalid groupId' })
      return
    }

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
})

// POST /groups/:groupId/members — add a member
router.post(
  '/:groupId/members',
  requireSignature,
  groupRateLimit,
  (req: Request, res: Response) => {
    try {
      const groupId = req.params.groupId as string
      if (!isValidUuidLike(groupId)) {
        res.status(400).json({ error: 'Invalid groupId' })
        return
      }

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

      const { userId } = req.body as { userId?: string }
      if (!userId || !isValidUuidLike(userId)) {
        res.status(400).json({ error: 'Invalid userId' })
        return
      }

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
router.delete('/:groupId/members/:userId', requireSignature, (req: Request, res: Response) => {
  try {
    const { groupId, userId } = req.params
    if (!isValidUuidLike(groupId) || !isValidUuidLike(userId)) {
      res.status(400).json({ error: 'Invalid ID format' })
      return
    }

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
    if (userId === group.creator_id && !remaining.some(m => m.role === 'admin')) {
      database.removeGroupMember(groupId, remaining[0].user_id)
      database.addGroupMember(groupId, remaining[0].user_id, 'admin')
    }

    res.json({ ok: true, members: database.getGroupMembers(groupId) })
  } catch (error) {
    console.error(
      'Remove group member error:',
      error instanceof Error ? error.message : String(error)
    )
    res.status(500).json({ error: 'Failed to remove member' })
  }
})

export default router
