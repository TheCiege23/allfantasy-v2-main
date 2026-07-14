import { Prisma } from '@prisma/client'
import { createNextSeason } from './createNextSeason'
import type { CreateNextSeasonInput, CreateNextSeasonResult } from './nextSeasonContract'

/**
 * Prisma's documented error code for "Transaction failed due to a write
 * conflict or a deadlock" (Postgres SQLSTATE 40001, serialization failure)
 * is P2034: https://www.prisma.io/docs/orm/reference/error-reference#p2034
 * — physically confirmed: this program's own N1 concurrency test threw
 * exactly this shape against a real disposable database.
 */
export function isSerializationConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return true
  // Defensive fallback: some Prisma/driver versions surface the same real
  // Postgres condition as an unknown-request error with the message intact
  // rather than the typed P2034 code — match on the verified real message
  // text rather than guessing at other error shapes.
  if (error instanceof Error && /write conflict or a deadlock/i.test(error.message)) return true
  return false
}

export type ConflictHandlingOutcome =
  | { kind: 'result'; result: CreateNextSeasonResult }
  | { kind: 'retryable_conflict' }

/**
 * Runs `createNextSeason`, and on exactly one verified serialization
 * conflict, retries it once with the identical input. The retry naturally
 * resolves correctly either way: if a concurrent winner already committed a
 * destination for this source/target, `createNextSeason`'s own pre-existing
 * `already_created` check (by completion idempotency key, or by the
 * freshly-re-read `LeagueRenewal.nextSeasonId` inside the transaction) picks
 * it up and returns a stable result — no separate re-read logic needed. If
 * the retry itself also hits a serialization conflict, this returns a
 * genuine retryable-conflict outcome rather than retrying indefinitely.
 */
export async function createNextSeasonWithConflictHandling(input: CreateNextSeasonInput): Promise<ConflictHandlingOutcome> {
  try {
    return { kind: 'result', result: await createNextSeason(input) }
  } catch (error) {
    if (!isSerializationConflict(error)) throw error
    try {
      return { kind: 'result', result: await createNextSeason(input) }
    } catch (retryError) {
      if (!isSerializationConflict(retryError)) throw retryError
      return { kind: 'retryable_conflict' }
    }
  }
}
