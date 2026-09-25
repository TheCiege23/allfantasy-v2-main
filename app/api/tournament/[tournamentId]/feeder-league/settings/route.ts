/**
 * PATCH /api/tournament/[tournamentId]/feeder-league/settings
 * 
 * Update settings for a feeder league within a tournament. 
 * Sends notifications to all league participants about the change.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createPlatformNotification } from '@/lib/platform/notification-service'
import { leagueChatThreadLinkRefusalInPatch } from '@/lib/league/leagueChatThreadLink'

type EditableFeederLeagueSettings = {
  scoring: string
  rosterSize: number
  benchSize: number
  waiverType: string
  faabBudget: number
  faabResetByRound: boolean
  tradeDeadlineWeek: number
  tradeLockHours: number
}

function normalizeEditableLeagueSettings(raw: unknown): EditableFeederLeagueSettings {
  const settings = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {}

  const asNumber = (value: unknown, fallback: number): number => {
    const numberValue = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(numberValue) ? Math.floor(numberValue) : fallback
  }

  return {
    scoring: typeof settings.scoring === 'string' ? settings.scoring : 'PPR',
    rosterSize: asNumber(settings.rosterSize, 15),
    benchSize: asNumber(settings.benchSize, 7),
    waiverType: typeof settings.waiverType === 'string' ? settings.waiverType : 'FAAB',
    faabBudget: asNumber(settings.faabBudget, 100),
    faabResetByRound: settings.faabResetByRound !== false,
    tradeDeadlineWeek: asNumber(settings.tradeDeadlineWeek, 12),
    tradeLockHours: asNumber(settings.tradeLockHours, 0),
  }
}

async function resolveTournamentOwnerId(tournamentId: string): Promise<string | null> {
  const [legacy, shell] = await Promise.all([
    prisma.legacyTournament.findUnique({
      where: { id: tournamentId },
      select: { creatorId: true },
    }),
    (prisma as any).tournamentShell
      ?.findUnique?.({ where: { id: tournamentId }, select: { commissionerId: true, createdBy: true } })
      .catch(() => null),
  ])

  return legacy?.creatorId ?? shell?.commissionerId ?? shell?.createdBy ?? null
}

async function loadLeagueForTournament(tournamentId: string, leagueId: string) {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      settings: true,
      name: true,
      teams: { select: { claimedByUserId: true } },
    },
  })

  if (!league) {
    return {
      league: null,
      error: NextResponse.json({ error: 'League not found' }, { status: 404 }),
    }
  }

  const leagueInTournament = await prisma.legacyTournamentLeague.findFirst({
    where: { tournamentId, leagueId },
  })

  if (!leagueInTournament) {
    return {
      league: null,
      error: NextResponse.json({ error: 'League is not part of this tournament' }, { status: 403 }),
    }
  }

  return { league, error: null }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ tournamentId: string }> }
) {
  const { tournamentId } = await params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const leagueId = url.searchParams.get('leagueId')
  if (!leagueId) {
    return NextResponse.json({ error: 'Missing or invalid leagueId' }, { status: 400 })
  }

  try {
    const ownerId = await resolveTournamentOwnerId(tournamentId)
    if (!ownerId || ownerId !== userId) {
      return NextResponse.json({ error: 'Not authorized as tournament commissioner' }, { status: 403 })
    }

    const { league, error } = await loadLeagueForTournament(tournamentId, leagueId)
    if (error) return error

    return NextResponse.json({
      success: true,
      leagueId,
      settings: normalizeEditableLeagueSettings(league.settings),
    })
  } catch (err) {
    console.error('[tournament-feeder-league-settings:get]', err)
    return NextResponse.json(
      { error: 'Failed to load league settings' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ tournamentId: string }> }
) {
  const { tournamentId } = await params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { leagueId, changes } = body

  if (!leagueId || typeof leagueId !== 'string') {
    return NextResponse.json({ error: 'Missing or invalid leagueId' }, { status: 400 })
  }

  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    return NextResponse.json({ error: 'Missing or invalid changes' }, { status: 400 })
  }

  try {
    const ownerId = await resolveTournamentOwnerId(tournamentId)
    if (!ownerId || ownerId !== userId) {
      return NextResponse.json({ error: 'Not authorized as tournament commissioner' }, { status: 403 })
    }

    const { league, error } = await loadLeagueForTournament(tournamentId, leagueId)
    if (error) return error

    // `changes` is merged into `settings` key by key, so it can carry the chat link. Only this
    // league's own chat may be linked (lib/league/leagueChatThreadLink.ts).
    const chatLinkRefusal = leagueChatThreadLinkRefusalInPatch(leagueId, changes)
    if (chatLinkRefusal) return NextResponse.json({ error: chatLinkRefusal }, { status: 400 })

    // Prepare old state for audit log
    const oldSettings = league.settings && typeof league.settings === 'object' ? league.settings : {}
    const oldState = normalizeEditableLeagueSettings(oldSettings)

    // Build new settings
    const newSettings = {
      ...oldSettings,
      ...changes,
    }

    // Update league
    await prisma.league.update({
      where: { id: leagueId },
      data: { settings: newSettings },
    })

    // Create audit log entry
    const auditEntry = {
      tournamentId,
      leagueId,
      changedBy: userId,
      changeType: 'settings_update',
      description: `Commissioner updated league settings`,
      oldState: JSON.stringify(oldState),
      newState: JSON.stringify(changes),
      createdAt: new Date(),
    }

    // Log to a table if available (optional - can be extended)
    console.log('[tournament-settings-audit]', auditEntry)

    // Format notification message for league members
    const notificationMessage = formatSettingsChangeNotification(
      league.name ?? 'League',
      oldState,
      changes
    )

    // TODO: Send notifications to all league members via chat/notifications API
    // Notification system will be integrated with league chat and notification service
    console.log(
      `[tournament-league-notification] Settings changed:`,
      notificationMessage
    )

    const recipientIds = Array.from(
      new Set(
        league.teams
          .map((t) => t.claimedByUserId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      )
    )

    if (recipientIds.length > 0) {
      const changesSummary = Object.entries(changes)
        .map(([key, value]) => {
          const prev = (oldState as any)[key]
          return `${formatFieldName(key)}: ${String(prev)} -> ${String(value)}`
        })
        .join(' | ')

      await Promise.allSettled(
        recipientIds.map((recipientId) =>
          createPlatformNotification({
            userId: recipientId,
            productType: 'shared',
            type: 'tournament_league_settings_updated',
            title: `${league.name ?? 'League'} settings updated`,
            body: changesSummary,
            severity: 'low',
            meta: {
              tournamentId,
              leagueId,
              changedBy: userId,
              before: oldState,
              after: changes,
            },
          })
        )
      )
    }

    return NextResponse.json({
      success: true,
      leagueId,
      changedFields: Object.keys(changes),
      notificationsSent: recipientIds.length,
      message: 'League settings updated successfully. Notifications will be sent to all league members.',
    })
  } catch (err) {
    console.error('[tournament-feeder-league-settings]', err)
    return NextResponse.json(
      { error: 'Failed to update league settings' },
      { status: 500 }
    )
  }
}

function formatSettingsChangeNotification(
  leagueName: string,
  oldState: Record<string, any>,
  changes: Record<string, any>
): string {
  const lines: string[] = [
    `🏆 **League Settings Updated** — ${leagueName}`,
    '',
  ]

  for (const [key, newValue] of Object.entries(changes)) {
    const oldValue = oldState[key]
    if (oldValue !== newValue) {
      const fieldName = formatFieldName(key)
      lines.push(`• ${fieldName}: ${oldValue} → ${newValue}`)
    }
  }

  lines.push('')
  lines.push('*Settings were updated by the tournament commissioner.*')
  return lines.join('\n')
}

function formatFieldName(key: string): string {
  const names: Record<string, string> = {
    scoring: 'Scoring',
    rosterSize: 'Roster Size',
    benchSize: 'Bench Spots',
    waiverType: 'Waiver Type',
    faabBudget: 'FAAB Budget',
    faabResetByRound: 'Reset FAAB per Round',
    tradeDeadlineWeek: 'Trade Deadline',
    tradeLockHours: 'Trade Lock Hours',
  }
  return names[key] || key
}
