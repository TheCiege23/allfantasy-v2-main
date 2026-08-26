import { NextRequest, NextResponse } from 'next/server'
import { ensureMatchupThreadsForUser } from '@/lib/chat-core/matchupThreads'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import { createPlatformThread, getPlatformChatThreads } from '@/lib/platform/chat-service'
import { resolveConversationSafetyForUser } from '@/lib/moderation'
import { prisma } from '@/lib/prisma'

/**
 * The season and week matchup rooms should be created for.
 *
 * Returns null rather than guessing: creating rooms for the wrong week would
 * put two people in a conversation about a game they are not playing.
 */
async function getNflStateForMatchupRooms(): Promise<{ season: number; week: number } | null> {
  try {
    const { getNflState } = await import('@/lib/sleeper-client')
    const state = await getNflState()
    const season = Number(state?.season)
    const week = Number(state?.week)
    if (!Number.isFinite(season) || !Number.isFinite(week) || week < 1) return null
    return { season, week }
  } catch {
    return null
  }
}

export async function GET() {
  const user = await resolvePlatformUser()
  if (!user.appUserId) {
    return NextResponse.json({ status: 'ok', threads: [] })
  }

  /*
   * Make sure this week's matchup rooms exist before listing. Folded into the
   * read the drawer already makes rather than given a cron: it is idempotent
   * through its own index, and it never throws.
   *
   * The week comes from the NFL state the app already tracks; a wrong week would
   * silently create rooms nobody is playing in.
   */
  const state = await getNflStateForMatchupRooms()
  if (state) {
    await ensureMatchupThreadsForUser(user.appUserId, state)
  }

  const threads = await getPlatformChatThreads(user.appUserId)
  const resolved = await resolveConversationSafetyForUser(user.appUserId, threads)
  return NextResponse.json({ status: 'ok', threads: resolved.threads })
}

export async function POST(req: NextRequest) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const threadType = String(body?.threadType || '') as 'dm' | 'group' | 'ai'

  if (!['dm', 'group', 'ai'].includes(threadType)) {
    return NextResponse.json({ error: 'Unsupported threadType' }, { status: 400 })
  }

  let memberUserIds: string[] = []
  let resolvedFromUsernames = 0

  /*
   * Usernames resolve for DMs too, not just groups.
   *
   * `createPlatformThread` takes member USER IDS, and a UI that lets you start a
   * conversation has a username — nobody types a uuid. Group already resolved
   * them; DM did not, so "message this person" was unreachable from any surface
   * without a people-picker that hands over an id. The dedupe inside
   * `createPlatformThread` still applies, so resolving a username you already
   * have a thread with reopens it rather than creating a second one.
   */
  if ((threadType === 'group' || threadType === 'dm') && Array.isArray(body?.usernames)) {
    const usernames = (body.usernames as unknown[]).map((u) => String(u).trim()).filter(Boolean)
    if (usernames.length > 0) {
      const users = await prisma.appUser.findMany({
        where: {
          OR: usernames.map((username) => ({
            username: { equals: username, mode: 'insensitive' as const },
          })),
        },
        select: { id: true },
      })
      memberUserIds = users.map((u) => u.id).filter((id) => id !== user.appUserId)
      resolvedFromUsernames = memberUserIds.length
    }
  }

  if (memberUserIds.length === 0 && Array.isArray(body?.memberUserIds)) {
    memberUserIds = body.memberUserIds.map((v: unknown) => String(v)).filter(Boolean)
  }

  if (threadType === 'group' || threadType === 'dm') {
    const uniqueMembers = Array.from(new Set(memberUserIds.filter(Boolean))).filter((id) => id !== user.appUserId)
    if (Array.isArray(body?.usernames) && body.usernames.length > 0 && resolvedFromUsernames === 0) {
      return NextResponse.json({ error: 'No valid participants found for those usernames' }, { status: 400 })
    }
    if (uniqueMembers.length === 0) {
      return NextResponse.json(
        {
          error:
            threadType === 'dm'
              ? 'A direct message needs one other person'
              : 'At least one participant is required to create a group',
        },
        { status: 400 },
      )
    }
    /*
     * A DM is exactly two people. `createPlatformThread` returns null for any
     * other count, which would surface as a bare "Unable to create thread"; say
     * what is wrong instead.
     */
    if (threadType === 'dm' && uniqueMembers.length > 1) {
      return NextResponse.json(
        { error: 'A direct message is one-to-one. Start a group for more than two people.' },
        { status: 400 },
      )
    }
    memberUserIds = uniqueMembers
  }

  const created = await createPlatformThread({
    creatorUserId: user.appUserId,
    threadType,
    productType: (body?.productType || 'shared') as 'shared' | 'app' | 'bracket' | 'legacy',
    title: body?.title ? String(body.title).trim().slice(0, 100) : undefined,
    memberUserIds,
  })

  if (!created) {
    return NextResponse.json({ error: 'Unable to create thread' }, { status: 400 })
  }

  return NextResponse.json({ status: 'ok', thread: created })
}
