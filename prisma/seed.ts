import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { ROLES } from '../server/roles.js'
import { EMPLOYMENT_STATUSES, JOB_TYPES } from '../server/domain.js'

const prisma = new PrismaClient()

async function main() {
  const passwordHash = await bcrypt.hash('DemoPassword123!', 12)
  const managerUser = await prisma.user.upsert({ where: { email: 'manager@floorstaff.local' }, update: {}, create: { email: 'manager@floorstaff.local', passwordHash, firstName: 'Ana', lastName: 'Manager', role: ROLES.MANAGER, city: 'Tbilisi', country: 'Georgia' } })
  const employeeUser = await prisma.user.upsert({ where: { email: 'employee@floorstaff.local' }, update: {}, create: { email: 'employee@floorstaff.local', passwordHash, firstName: 'Nino', lastName: 'Beridze', role: ROLES.EMPLOYEE, city: 'Tbilisi', country: 'Georgia', employeeProfile: { create: { position: 'Head Waiter' } } } })
  await prisma.user.upsert({ where: { email: 'customer@floorstaff.local' }, update: {}, create: { email: 'customer@floorstaff.local', passwordHash, firstName: 'Demo', lastName: 'Customer', role: ROLES.CUSTOMER, city: 'Tbilisi', country: 'Georgia' } })
  const restaurant = await prisma.restaurant.upsert({ where: { slug: 'mziuri-kitchen' }, update: {}, create: { name: 'Mziuri Kitchen', slug: 'mziuri-kitchen', description: 'A warm neighborhood table where Georgian tradition meets a bright, contemporary room.', cuisine: 'Georgian', category: 'Neighborhood restaurant', priceRange: '$$', country: 'Georgia', city: 'Tbilisi', neighborhood: 'Vera', address: '14 Merab Kostava Street', openingHours: '12:00–00:00', verified: true } })
  await prisma.manager.upsert({ where: { userId: managerUser.id }, update: {}, create: { userId: managerUser.id, restaurantId: restaurant.id, verified: true } })
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: employeeUser.id } })
  await prisma.employment.upsert({ where: { employeeId_restaurantId_status: { employeeId: employee.id, restaurantId: restaurant.id, status: EMPLOYMENT_STATUSES.ACTIVE } }, update: {}, create: { employeeId: employee.id, restaurantId: restaurant.id, position: 'Head Waiter', status: EMPLOYMENT_STATUSES.ACTIVE, startedAt: new Date() } })
  await prisma.job.upsert({ where: { id: 'seed-senior-waiter' }, update: {}, create: { id: 'seed-senior-waiter', restaurantId: restaurant.id, title: 'Senior Waiter', description: 'Lead service with a warm, detail-oriented team.', requirements: 'Two years of guest-facing experience.', salary: '1,800–2,200 GEL', type: JOB_TYPES.FULL_TIME, city: 'Tbilisi' } })
  for (const badge of [{ name: 'Customer Favorite', icon: '★', description: 'Sustained high customer ratings.', requirement: 'Customer rating above 4.7' }, { name: '100 Ratings', icon: '✦', description: 'Received at least 100 ratings.', requirement: '100 verified ratings' }]) await prisma.badge.upsert({ where: { name: badge.name }, update: badge, create: badge })
  console.log('Seed complete. Demo password: DemoPassword123!')
}

main().finally(() => prisma.$disconnect())
