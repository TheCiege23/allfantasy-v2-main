import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/** Re-read deterministic workflow receipts after serialization or concurrent receipt insertion. */
export async function combatTransaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>, timeout = 15_000): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await prisma.$transaction(run, { isolationLevel: 'Serializable', timeout }) }
    catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && (['P2034', 'P2002'].includes(error.code) ||
        (error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code))))
      if (attempt >= 2 || !retryable) throw error
    }
  }
}
