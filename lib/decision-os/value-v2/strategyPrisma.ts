import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createStrategyPrismaPort } from './strategyPrismaPort'

export const strategyPrismaPort = createStrategyPrismaPort(prisma, Prisma.DbNull)
