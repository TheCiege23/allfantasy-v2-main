// FIXTURE — deliberate violation. Not compiled, not shipped, not linted by
// `next lint` (see .eslintignore). Exists so T-005's rules are proven to FIRE
// rather than merely configured.
import { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export const a = PrismaClient
export const b = prisma
