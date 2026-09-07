import 'dotenv/config'
import cors from 'cors'
import crypto from 'node:crypto'
import express from 'express'
import QRCode from 'qrcode'
import { z } from 'zod'
import { prisma } from './db.js'
import { createToken, hashPassword, requireAuth, requireRole, verifyPassword, type AuthRequest } from './auth.js'
import { ROLES } from './roles.js'
import { EMPLOYMENT_STATUSES, JOB_TYPES, RATING_TYPES } from './domain.js'

const app = express()
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }))
app.use(express.json({ limit: '1mb' }))

const registerSchema = z.object({ email: z.string().email(), password: z.string().min(8), firstName: z.string().min(1), lastName: z.string().min(1), role: z.nativeEnum(ROLES).default(ROLES.CUSTOMER), city: z.string().optional(), country: z.string().optional(), position: z.string().optional() })
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) })
const ratingSchema = z.object({ targetEmployeeId: z.string(), restaurantId: z.string(), type: z.nativeEnum(RATING_TYPES), score: z.number().min(1).max(5), comment: z.string().max(1000).optional(), teamwork: z.number().min(1).max(5).optional(), reliability: z.number().min(1).max(5).optional(), professionalism: z.number().min(1).max(5).optional(), communication: z.number().min(1).max(5).optional(), workQuality: z.number().min(1).max(5).optional() })
const reviewSchema = z.object({ employeeId: z.string(), restaurantId: z.string(), score: z.number().min(1).max(5), comment: z.string().min(10).max(2000) })
const managerRatingSchema = z.object({ managerId: z.string(), restaurantId: z.string(), leadership: z.number().min(1).max(5), communication: z.number().min(1).max(5), fairness: z.number().min(1).max(5), professionalism: z.number().min(1).max(5), scheduling: z.number().min(1).max(5), workplace: z.number().min(1).max(5) })
const applicationSchema = z.object({ jobId: z.string() })
const reportSchema = z.object({ reviewId: z.string(), reason: z.enum(['SPAM', 'HARASSMENT', 'FAKE_REVIEW', 'OFFENSIVE_CONTENT', 'PERSONAL_INFORMATION', 'DISCRIMINATION', 'OTHER']), details: z.string().max(500).optional() })

type EmploymentLike = { restaurantId: string; status: string }
type RatingLike = { type: string; score: number }
type RankingEmployee = { id: string; position: string; user: { firstName: string; lastName: string }; ratings: RatingLike[]; employments: { restaurant: { name: string } }[] }
type ProfileEmployee = { id: string; position: string; user: { firstName: string; lastName: string; city: string | null }; ratings: (RatingLike & { comment: string | null; createdAt: Date })[]; reviews: { score: number; comment: string; createdAt: Date }[]; employments: { restaurant: { id: string; name: string; city: string } }[]; badges: { badge: { id: string; name: string; icon: string; description: string; requirement: string } }[] }

app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'floorstaff-api' }))

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const input = registerSchema.parse(req.body)
    if (input.role === ROLES.ADMIN) return res.status(403).json({ error: 'Admin accounts cannot be self-created' })
    const existing = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } })
    if (existing) return res.status(409).json({ error: 'Email is already registered' })
    const user = await prisma.user.create({ data: { email: input.email.toLowerCase(), passwordHash: await hashPassword(input.password), firstName: input.firstName, lastName: input.lastName, role: input.role, city: input.city, country: input.country, ...(input.role === ROLES.EMPLOYEE ? { employeeProfile: { create: { position: input.position || 'Hospitality professional' } } } : {}) } })
    res.status(201).json({ token: createToken(user), user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role } })
  } catch (error) { next(error) }
})

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const input = loginSchema.parse(req.body)
    const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } })
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) return res.status(401).json({ error: 'Email or password is incorrect' })
    if (user.isSuspended) return res.status(403).json({ error: 'This account is suspended' })
    res.json({ token: createToken(user), user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role } })
  } catch (error) { next(error) }
})

app.get('/api/restaurants', async (req, res, next) => {
  try {
    const city = typeof req.query.city === 'string' ? req.query.city : undefined
    const restaurants = await prisma.restaurant.findMany({ where: city ? { city } : undefined, include: { _count: { select: { employments: true, jobs: true, reviews: true } } }, orderBy: { createdAt: 'desc' } })
    res.json(restaurants)
  } catch (error) { next(error) }
})

app.get('/api/restaurants/:id', async (req, res, next) => {
  try {
    const restaurant = await prisma.restaurant.findUnique({ where: { id: req.params.id }, include: { employments: { where: { status: EMPLOYMENT_STATUSES.ACTIVE }, include: { employee: { include: { user: true, badges: { include: { badge: true } } } } } }, jobs: true, reviews: { where: { status: 'APPROVED' }, include: { author: true }, orderBy: { createdAt: 'desc' } }, manager: { include: { user: true } } } })
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' })
    res.json(restaurant)
  } catch (error) { next(error) }
})

app.get('/api/jobs', async (req, res, next) => {
  try {
    const city = typeof req.query.city === 'string' ? req.query.city : undefined
    const jobs = await prisma.job.findMany({ where: city ? { city } : undefined, include: { restaurant: true }, orderBy: { createdAt: 'desc' } })
    res.json(jobs)
  } catch (error) { next(error) }
})

app.get('/api/qr/:token', async (req, res, next) => {
  try {
    const tokenHash = crypto.createHash('sha256').update(req.params.token).digest('hex')
    const qr = await prisma.qrToken.findFirst({ where: { tokenHash, revokedAt: null }, include: { employee: { include: { user: true } } } })
    if (!qr) return res.status(404).json({ error: 'QR code is invalid or revoked' })
    res.json({ employeeId: qr.employee.id, name: `${qr.employee.user.firstName} ${qr.employee.user.lastName}`, position: qr.employee.position })
  } catch (error) { next(error) }
})

app.post('/api/qr/:token/ratings', requireAuth, requireRole(ROLES.CUSTOMER), async (req: AuthRequest, res, next) => {
  try {
    const input = z.object({ score: z.number().min(1).max(5), comment: z.string().max(1000).optional() }).parse(req.body)
    const tokenHash = crypto.createHash('sha256').update(String(req.params.token)).digest('hex')
    const qr = await prisma.qrToken.findFirst({ where: { tokenHash, revokedAt: null }, include: { employee: true } })
    if (!qr) return res.status(404).json({ error: 'QR code is invalid or revoked' })
    const duplicate = await prisma.rating.findFirst({ where: { raterId: req.user!.id, targetEmployeeId: qr.employeeId, type: RATING_TYPES.CUSTOMER, createdAt: { gt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } })
    if (duplicate) return res.status(429).json({ error: 'You have already rated this employee recently' })
    const employment = await prisma.employment.findFirst({ where: { employeeId: qr.employeeId, status: EMPLOYMENT_STATUSES.ACTIVE } })
    if (!employment) return res.status(400).json({ error: 'Employee is not currently active at a restaurant' })
    const rating = await prisma.rating.create({ data: { raterId: req.user!.id, targetEmployeeId: qr.employeeId, restaurantId: employment.restaurantId, type: RATING_TYPES.CUSTOMER, score: input.score, comment: input.comment, moderation: 'PENDING' } })
    res.status(201).json(rating)
  } catch (error) { next(error) }
})

app.post('/api/ratings', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const input = ratingSchema.parse(req.body)
    const target = await prisma.employee.findUnique({ where: { id: input.targetEmployeeId }, select: { userId: true } })
    if (!target) return res.status(404).json({ error: 'Employee not found' })
    if (target.userId === req.user!.id) return res.status(400).json({ error: 'You cannot rate yourself' })
    if (input.type === RATING_TYPES.COWORKER && req.user!.role !== ROLES.EMPLOYEE) return res.status(403).json({ error: 'Only employees can submit coworker ratings' })
    if (input.type === RATING_TYPES.CUSTOMER && req.user!.role !== ROLES.CUSTOMER) return res.status(403).json({ error: 'Only customers can submit customer ratings' })
    if (input.type === RATING_TYPES.MANAGER) return res.status(400).json({ error: 'Use the manager rating endpoint for manager feedback' })
    const employee = await prisma.employee.findUnique({ where: { id: input.targetEmployeeId }, include: { employments: true } })
    if (!employee) return res.status(404).json({ error: 'Employee not found' })
    const activeAtRestaurant = (employee.employments as EmploymentLike[]).some((employment: EmploymentLike) => employment.restaurantId === input.restaurantId && employment.status === EMPLOYMENT_STATUSES.ACTIVE)
    if (!activeAtRestaurant) return res.status(400).json({ error: 'Employee is not active at this restaurant' })
    const duplicate = await prisma.rating.findFirst({ where: { raterId: req.user!.id, targetEmployeeId: input.targetEmployeeId, type: input.type, createdAt: { gt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } })
    if (duplicate) return res.status(429).json({ error: 'You have already rated this employee recently' })
    const rating = await prisma.rating.create({ data: { ...input, raterId: req.user!.id, moderation: 'PENDING', verified: false } })
    res.status(201).json(rating)
  } catch (error) { next(error) }
})

app.post('/api/reviews', requireAuth, requireRole(ROLES.CUSTOMER), async (req: AuthRequest, res, next) => {
  try {
    const input = reviewSchema.parse(req.body)
    const employee = await prisma.employee.findUnique({ where: { id: input.employeeId }, include: { employments: true } })
    if (!employee || !(employee.employments as EmploymentLike[]).some((item: EmploymentLike) => item.restaurantId === input.restaurantId && item.status === EMPLOYMENT_STATUSES.ACTIVE)) return res.status(400).json({ error: 'Employee is not active at this restaurant' })
    const recent = await prisma.review.findFirst({ where: { authorId: req.user!.id, employeeId: input.employeeId, createdAt: { gt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } })
    if (recent) return res.status(429).json({ error: 'You have already reviewed this employee recently' })
    const review = await prisma.review.create({ data: { ...input, authorId: req.user!.id, status: 'PENDING' } })
    res.status(201).json(review)
  } catch (error) { next(error) }
})

app.post('/api/manager-ratings', requireAuth, requireRole(ROLES.EMPLOYEE), async (req: AuthRequest, res, next) => {
  try {
    const input = managerRatingSchema.parse(req.body)
    const employee = await prisma.employee.findUnique({ where: { userId: req.user!.id }, include: { employments: true } })
    const manager = await prisma.manager.findUnique({ where: { id: input.managerId } })
    if (!employee || !manager || manager.restaurantId !== input.restaurantId || !(employee.employments as EmploymentLike[]).some((item: EmploymentLike) => item.restaurantId === input.restaurantId && item.status === EMPLOYMENT_STATUSES.ACTIVE)) return res.status(403).json({ error: 'You must be an active employee at this workplace' })
    const rating = await prisma.managerRating.create({ data: { ...input, authorEmployeeId: employee.id } })
    res.status(201).json({ ...rating, authorEmployeeId: undefined })
  } catch (error) { next(error) }
})

app.post('/api/reports', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const input = reportSchema.parse(req.body)
    const report = await prisma.report.create({ data: { ...input, reporterId: req.user!.id } })
    res.status(201).json(report)
  } catch (error) { next(error) }
})

app.post('/api/jobs/:id/applications', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const input = applicationSchema.parse({ jobId: req.params.id })
    const job = await prisma.job.findUnique({ where: { id: input.jobId } })
    if (!job) return res.status(404).json({ error: 'Job not found' })
    const application = await prisma.jobApplication.create({ data: { jobId: input.jobId, userId: req.user!.id } })
    res.status(201).json(application)
  } catch (error) { next(error) }
})

app.get('/api/rankings', async (req, res, next) => {
  try {
    const city = typeof req.query.city === 'string' ? req.query.city : undefined
    const employees = await prisma.employee.findMany({ where: city ? { user: { city } } : undefined, include: { user: true, ratings: { where: { moderation: 'APPROVED' } }, employments: { where: { status: 'ACTIVE' }, include: { restaurant: true } } } })
    const ranked = (employees as RankingEmployee[]).map((employee: RankingEmployee) => {
      const customer = employee.ratings.filter((rating: RatingLike) => rating.type === RATING_TYPES.CUSTOMER)
      const coworkers = employee.ratings.filter((rating: RatingLike) => rating.type === RATING_TYPES.COWORKER)
      const raw = (customer.reduce((sum: number, rating: RatingLike) => sum + rating.score, 0) / (customer.length || 1)) * 0.65 + (coworkers.reduce((sum: number, rating: RatingLike) => sum + rating.score, 0) / (coworkers.length || 1)) * 0.35
      const count = customer.length + coworkers.length
      const score = (4.3 * 25 + raw * count) / (25 + count)
      return { id: employee.id, name: `${employee.user.firstName} ${employee.user.lastName}`, position: employee.position, restaurant: employee.employments[0]?.restaurant.name || null, rating: Number(score.toFixed(2)), ratingCount: count }
    }).sort((a: { rating: number; ratingCount: number }, b: { rating: number; ratingCount: number }) => b.rating - a.rating || b.ratingCount - a.ratingCount).map((employee: { id: string; name: string; position: string; restaurant: string | null; rating: number; ratingCount: number }, index: number) => ({ rank: index + 1, ...employee }))
    res.json(ranked)
  } catch (error) { next(error) }
})

app.get('/api/employees/:id', async (req, res, next) => {
  try {
    const employee = await prisma.employee.findUnique({ where: { id: req.params.id }, include: { user: true, badges: { include: { badge: true } }, employments: { where: { status: EMPLOYMENT_STATUSES.ACTIVE }, include: { restaurant: true } }, ratings: { where: { moderation: 'APPROVED' }, select: { type: true, score: true, comment: true, createdAt: true } }, reviews: { where: { status: 'APPROVED' }, select: { score: true, comment: true, createdAt: true } } } }) as ProfileEmployee | null
    if (!employee) return res.status(404).json({ error: 'Employee not found' })
    const customerRatings = employee.ratings.filter((rating: RatingLike) => rating.type === RATING_TYPES.CUSTOMER)
    const coworkerRatings = employee.ratings.filter((rating: RatingLike) => rating.type === RATING_TYPES.COWORKER)
    res.json({ id: employee.id, name: `${employee.user.firstName} ${employee.user.lastName}`, city: employee.user.city, position: employee.position, workplaces: employee.employments.map((item: { restaurant: { id: string; name: string; city: string } }) => ({ id: item.restaurant.id, name: item.restaurant.name, city: item.restaurant.city })), badges: employee.badges.map((item) => item.badge), customerRating: average(customerRatings.map((item: RatingLike) => item.score)), coworkerRating: average(coworkerRatings.map((item: RatingLike) => item.score)), totalRatings: employee.ratings.length, reviews: employee.reviews })
  } catch (error) { next(error) }
})

app.post('/api/employments/request', requireAuth, requireRole(ROLES.EMPLOYEE), async (req: AuthRequest, res, next) => {
  try {
    const input = z.object({ restaurantId: z.string(), position: z.string().min(2) }).parse(req.body)
    const employee = await prisma.employee.findUnique({ where: { userId: req.user!.id } })
    if (!employee) return res.status(404).json({ error: 'Employee profile not found' })
    const request = await prisma.employment.create({ data: { employeeId: employee.id, restaurantId: input.restaurantId, position: input.position, status: EMPLOYMENT_STATUSES.PENDING } })
    res.status(201).json(request)
  } catch (error) { next(error) }
})

app.patch('/api/employments/:id', requireAuth, requireRole(ROLES.MANAGER), async (req: AuthRequest, res, next) => {
  try {
    const input = z.object({ status: z.enum(['ACTIVE', 'REJECTED']) }).parse(req.body)
    const manager = await prisma.manager.findUnique({ where: { userId: req.user!.id } })
    const request = await prisma.employment.findUnique({ where: { id: String(req.params.id) } })
    if (!manager || !request || manager.restaurantId !== request.restaurantId) return res.status(404).json({ error: 'Employment request not found' })
    const employment = await prisma.employment.update({ where: { id: request.id }, data: { status: input.status, startedAt: input.status === 'ACTIVE' ? new Date() : null } })
    res.json(employment)
  } catch (error) { next(error) }
})

app.post('/api/manager/jobs', requireAuth, requireRole(ROLES.MANAGER), async (req: AuthRequest, res, next) => {
  try {
    const input = z.object({ title: z.string().min(2), description: z.string().min(10), requirements: z.string().min(2), salary: z.string().optional(), type: z.nativeEnum(JOB_TYPES), city: z.string().min(2) }).parse(req.body)
    const manager = await prisma.manager.findUnique({ where: { userId: req.user!.id } })
    if (!manager) return res.status(403).json({ error: 'Manager profile is not verified' })
    const job = await prisma.job.create({ data: { ...input, restaurantId: manager.restaurantId } })
    res.status(201).json(job)
  } catch (error) { next(error) }
})

app.patch('/api/admin/reviews/:id', requireAuth, requireRole(ROLES.ADMIN), async (req: AuthRequest, res, next) => {
  try {
    const input = z.object({ status: z.enum(['APPROVED', 'REJECTED']) }).parse(req.body)
    const review = await prisma.review.update({ where: { id: String(req.params.id) }, data: { status: input.status } })
    res.json(review)
  } catch (error) { next(error) }
})

app.patch('/api/admin/users/:id/suspension', requireAuth, requireRole(ROLES.ADMIN), async (req: AuthRequest, res, next) => {
  try {
    const input = z.object({ suspended: z.boolean() }).parse(req.body)
    const user = await prisma.user.update({ where: { id: String(req.params.id) }, data: { isSuspended: input.suspended } })
    res.json({ id: user.id, isSuspended: user.isSuspended })
  } catch (error) { next(error) }
})

app.post('/api/employee/qr', requireAuth, requireRole(ROLES.EMPLOYEE), async (req: AuthRequest, res, next) => {
  try {
    const employee = await prisma.employee.findUnique({ where: { userId: req.user!.id } })
    if (!employee) return res.status(404).json({ error: 'Employee profile not found' })
    await prisma.qrToken.updateMany({ where: { employeeId: employee.id, revokedAt: null }, data: { revokedAt: new Date() } })
    const rawToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
    await prisma.qrToken.create({ data: { employeeId: employee.id, tokenHash } })
    const url = `${process.env.CLIENT_ORIGIN || 'http://localhost:5173'}/rate/employee/${rawToken}`
    res.status(201).json({ url, image: await QRCode.toDataURL(url) })
  } catch (error) { next(error) }
})

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid request', details: error.flatten() })
  console.error(error)
  return res.status(500).json({ error: 'Unexpected server error' })
})

const port = Number(process.env.PORT || 4000)
app.listen(port, () => console.log(`Floorstaff API listening on http://localhost:${port}`))

function average(values: number[]) {
  return values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : null
}
