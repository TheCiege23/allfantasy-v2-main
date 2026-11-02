import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/** Re-read deterministic workflow receipts after serialization or concurrent receipt insertion. */
export async function combatTransaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await prisma.$transaction(run, { isolationLevel: 'Serializable', timeout: 15_000 }) }
    catch (error) {
      if (attempt >= 2 || !(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2034', 'P2002'].includes(error.code)) throw error
    }
  }
}
