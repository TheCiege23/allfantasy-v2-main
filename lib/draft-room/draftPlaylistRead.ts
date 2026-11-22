import 'server-only'
import { prisma } from '@/lib/prisma'
import { DRAFT_PLAYLIST_SETTINGS_KEY, readDraftPlaylist, type DraftPlaylist } from '@/lib/draft-room/draftPlaylist'

/**
 * A league's draft playlist, reading ONE key of League.settings rather than the whole blob — the draft settings
 * response carries it on every member's settings poll (2026-11-17), and settings holds ~150 other keys.
 * null when there is none, or the league does not exist.
 */
export async function readLeagueDraftPlaylist(leagueId: string): Promise<DraftPlaylist | null> {
  const rows = await prisma.$queryRaw<Array<{ playlist: unknown }>>`
    SELECT settings -> ${DRAFT_PLAYLIST_SETTINGS_KEY}::text AS playlist FROM leagues WHERE id = ${leagueId}`
  return readDraftPlaylist({ [DRAFT_PLAYLIST_SETTINGS_KEY]: rows[0]?.playlist ?? null })
}
