/**
 * Coherent draft-room live sync — one round-trip for session + optional queue + chat.
 * Session is only rebuilt when `since` is older than the row's `updatedAt` (same contract as /draft/events).
 */

import { prisma } from '@/lib/prisma'
import { getProviderStatus } from '@/lib/provider-config'
import { getOrphanRosterIdsForLeague } from '@/lib/orphan-ai-manager/orphanRosterResolver'
import { getDraftUISettingsForLeague } from '@/lib/draft-defaults/DraftUISettingsResolver'
import { buildSessionSnapshot } from '@/lib/live-draft-engine/DraftSessionService'
import { getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import {
  repairDraftCompletionIfBoardFull,
  syncPostDraftArtifactsIfCompletedThrottled,
} from '@/lib/live-draft-engine/postDraftFinalizeArtifacts'
import { loadDraftQueueForUser } from '@/lib/draft-room/loadDraftQueueForUser'
import { loadDraftChatWireMessages } from '@/lib/draft-room/draftRoomChatWireLoad'

export type DraftLiveSyncWire = {
  leagueId: string
  updated: boolean
  updatedAt: string | null
  session: Record<string, unknown> | null
  queue?: unknown[]
  syncActive?: boolean
  messages?: unknown[]
}

export async function buildDraftLiveSyncPayload(
  leagueId: string,
  userId: string,
  opts: {
    since?: string | null
    includeQueue: boolean
    includeChat: boolean
    chatLimit?: number
  },
): Promise<DraftLiveSyncWire> {
  /** Heal stuck "full board but not completed" even when client `since` matches `updatedAt`. */
  await repairDraftCompletionIfBoardFull(leagueId).catch((e) => {
    console.error('[buildDraftLiveSyncPayload] repairDraftCompletionIfBoardFull', leagueId, e)
  })
  await syncPostDraftArtifactsIfCompletedThrottled(leagueId)

  const draftSessionRow = await prisma.draftSession.findUnique({
    where: { leagueId },
    select: { updatedAt: true },
  })

  if (!draftSessionRow) {
    return { leagueId, updated: false, updatedAt: null, session: null }
  }

  const updatedAt = draftSessionRow.updatedAt.toISOString()
  const sinceParsed = opts.since ? new Date(opts.since).getTime() : NaN
  const sinceMs = Number.isFinite(sinceParsed) ? sinceParsed : null
  const sessionNeedsRefresh =
    sinceMs === null || draftSessionRow.updatedAt.getTime() > sinceMs

  let sessionPayload: Record<string, unknown> | null = null

  if (sessionNeedsRefresh) {
    const [snapshot, uiSettings, orphanRosterIds] = await Promise.all([
      buildSessionSnapshot(leagueId, new Date(), userId),
      getDraftUISettingsForLeague(leagueId),
      getOrphanRosterIdsForLeague(leagueId),
    ])
    const providerStatus = getProviderStatus()
    const currentUserRosterId = await getCurrentUserRosterIdForLeague(leagueId, userId)

    sessionPayload =
      snapshot != null
        ? ({
            ...snapshot,
            currentUserRosterId: currentUserRosterId ?? undefined,
            orphanRosterIds,
            aiManagerEnabled: uiSettings.orphanTeamAiManagerEnabled,
            orphanDrafterMode: uiSettings.orphanDrafterMode,
            orphanAiProviderAvailable: providerStatus.anyAi,
            orphanDrafterEffectiveMode:
              uiSettings.orphanDrafterMode === 'ai' && !providerStatus.anyAi
                ? 'cpu'
                : uiSettings.orphanDrafterMode,
          } as Record<string, unknown>)
        : null
  }

  const secondary: Promise<unknown>[] = []
  if (opts.includeQueue) secondary.push(loadDraftQueueForUser(leagueId, userId))
  if (opts.includeChat) secondary.push(loadDraftChatWireMessages(leagueId, userId, { limit: opts.chatLimit ?? 80 }))

  const loaded = secondary.length ? await Promise.all(secondary) : []

  let queue: unknown[] | undefined
  let messages: unknown[] | undefined
  let syncActive: boolean | undefined
  let idx = 0
  if (opts.includeQueue) {
    const q = loaded[idx++] as { queue: unknown[] }
    queue = q.queue
  }
  if (opts.includeChat) {
    const c = loaded[idx++] as { messages: unknown[]; syncActive: boolean }
    messages = c.messages
    syncActive = c.syncActive
  }

  return {
    leagueId,
    updated: sessionNeedsRefresh,
    updatedAt,
    session: sessionPayload,
    ...(queue !== undefined ? { queue } : {}),
    ...(messages !== undefined ? { messages, syncActive } : {}),
  }
}
