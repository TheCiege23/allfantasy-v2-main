import { Prisma } from '@prisma/client'

/** Serialize hold state changes and purchase reversals before locking wallet/reservation rows. */
export async function lockTokenWallet(tx: Pick<Prisma.TransactionClient, '$queryRaw'>, userId: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`token_wallet:${userId}`}, 0))::text`)
}
