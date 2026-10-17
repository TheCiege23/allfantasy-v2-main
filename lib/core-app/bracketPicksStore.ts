import 'server-only'

import { prisma } from '@/lib/prisma'
import type { BracketPickInput, SavedBracketPick } from './bracketPicks'

/**
 * Reads and writes `core_bracket_picks` (Prisma `CoreBracketPick`) for the /core
 * Bracket Challenge. Only /api/core/bracket-picks calls this.
 *
 * ⚠ THE CODE SHIPS AHEAD OF ITS MIGRATION. Until `20261006120000_core_bracket_picks`
 * is applied, every query here raises P2021 (table missing) — or P2022 (column
 * missing) against a half-applied table. Both come back as `'unavailable'`,
 * never as a throw, so the route answers "saving unavailable" and the screen
 * keeps its preview behaviour instead of a 500. Any OTHER error still throws:
 * a lock timeout or a dropped connection is a failed save, and the screen must
 * say "not saved", not pretend the feature is off.
 */

export type Unavailable = 'unavailable'

/** The CODE only, never the message — a Prisma "invalid invocation" message can mention anything. */
export function isMissingSchemaError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return code === 'P2021' || code === 'P2022'
}

type Row = { championTeamId: string | null; finalLength: number | null; updatedAt: Date }

function toSaved(row: Row): SavedBracketPick {
  return {
    championTeamId: row.championTeamId,
    finalLength: row.finalLength,
    updatedAt: row.updatedAt.toISOString(),
  }
}

const SELECT = { championTeamId: true, finalLength: true, updatedAt: true } as const

export async function readBracketPick(
  userId: string,
  sport: string,
  seasonYear: number,
): Promise<SavedBracketPick | null | Unavailable> {
  try {
    const row = await prisma.coreBracketPick.findUnique({
      where: { userId_sport_seasonYear: { userId, sport, seasonYear } },
      select: SELECT,
    })
    return row ? toSaved(row) : null
  } catch (error) {
    if (isMissingSchemaError(error)) return 'unavailable'
    throw error
  }
}

export async function saveBracketPick(
  userId: string,
  input: BracketPickInput,
  seasonYear: number,
): Promise<SavedBracketPick | Unavailable> {
  try {
    const row = await prisma.coreBracketPick.upsert({
      where: { userId_sport_seasonYear: { userId, sport: input.sport, seasonYear } },
      create: {
        userId,
        sport: input.sport,
        seasonYear,
        championTeamId: input.championTeamId,
        finalLength: input.finalLength,
      },
      update: { championTeamId: input.championTeamId, finalLength: input.finalLength },
      select: SELECT,
    })
    return toSaved(row)
  } catch (error) {
    if (isMissingSchemaError(error)) return 'unavailable'
    throw error
  }
}
