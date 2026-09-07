import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import type { NextFunction, Request, Response } from 'express'
import { Role } from '@prisma/client'

const secret = process.env.JWT_SECRET || 'local-development-secret'

export type AuthRequest = Request & { user?: { id: string; role: Role } }

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash)
}

export function createToken(user: { id: string; role: Role }) {
  return jwt.sign(user, secret, { expiresIn: '7d' })
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.header('authorization')
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' })
  try {
    req.user = jwt.verify(header.slice(7), secret) as { id: string; role: Role }
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' })
  }
}

export function requireRole(...roles: Role[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' })
    next()
  }
}
