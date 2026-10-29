import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getLeagueRole } from '@/lib/league/permissions'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { prisma } from '@/lib/prisma'
import { parseSettingsPatch } from '@/lib/storyline-studio/storylineSettings'
import {
  postStoryline,
  readStudioView,
  saveStudioSettings,
  storylineEntitled,
  storylineUpgradePath,
} from '@/lib/storyline-studio/storylineService'
import type { HookLanguage, StoryHook } from '@/lib/storyline-studio/types'

export const dynamic = 'force-dynamic'

/**
 * /api/leagues/[leagueId]/storylines — the Commissioner Hub's Storyline Studio.
 *
 *   GET            this week's hooks per matchup, and the auto-post switches
 *   PUT            { autoPost?, includePoll?, weekday?, hour?, timeZone? }
 *   POST           { action: 'post', hookId?, text, includePoll? } — post to the league chat
 *
 * Commissioner and co-commissioner only, AF Commissioner plan only (`commissioner_automation`);
 * without the plan GET answers `entitled: false` with the upgrade path and no hooks, and the writes
 * answer 402. "Post" and turning auto-post on are refused for an imported league — its chat is not
 * ours to write to (Copy is the whole feature there).
 *
 * ⚠ THE HOOK IS RE-BUILT HERE, NEVER TAKEN FROM THE CLIENT. A post names a hook by id; the facts it
 * carries and the matchup its poll belongs to come from the server's own read, so a client cannot
 * attach facts or a matchup the data does not have. The TEXT is the commissioner's — they may edit
 * it before posting, and it is posted as theirs.
 */

type Ctx = { params: Promise<{ leagueId: string }> }

async function gate(ctx: Ctx) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  const { leagueId } = await ctx.params
  if (!leagueId) return { error: NextResponse.json({ error: 'Missing leagueId' }, { status: 400 }) } as const
  const role = await getLeagueRole(leagueId, userId)
  if (role === null) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) } as const
  if (role !== 'commissioner' && role !== 'co_commissioner') {
    return { error: NextResponse.json({ error: 'Commissioner only' }, { status: 403 }) } as const
  }
  return { leagueId, userId } as const
}

function langOf(raw: unknown): HookLanguage {
  return raw === 'es' ? 'es' : 'en'
}

async function upsell(leagueId: string, userId: string) {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true } })
  return {
    entitled: false as const,
    native: isNativePlatform(league?.platform),
    platform: String(league?.platform ?? ''),
    upgradePath: await storylineUpgradePath(userId),
  }
}

export async function GET(req: Request, ctx: Ctx) {
  const g = await gate(ctx)
  if ('error' in g) return g.error
  if (!(await storylineEntitled(g.userId))) return NextResponse.json(await upsell(g.leagueId, g.userId))
  const lang = langOf(new URL(req.url).searchParams.get('lang'))
  const view = await readStudioView(g.leagueId, g.userId, lang)
  if (!view) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ entitled: true, ...view })
}

const SAVE_STATUS = { not_found: 404, imported: 409, not_entitled: 402 } as const

export async function PUT(req: Request, ctx: Ctx) {
  const g = await gate(ctx)
  if ('error' in g) return g.error
  const parsed = parseSettingsPatch(await req.json().catch(() => null))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  // Switching OFF is always allowed — a lapsed plan must still be able to stop its own posts.
  const turningOff = parsed.patch.autoPost === false && Object.keys(parsed.patch).length === 1
  if (!turningOff && !(await storylineEntitled(g.userId))) {
    return NextResponse.json({ error: 'not_entitled' }, { status: 402 })
  }
  const result = await saveStudioSettings(g.leagueId, g.userId, parsed.patch)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: SAVE_STATUS[result.error] })
  const { enabledByUserId, ...rest } = result.settings
  return NextResponse.json({ settings: { ...rest, enabledByYou: enabledByUserId === g.userId } })
}

const POST_STATUS = { imported: 409, forbidden: 403, empty: 400, too_long: 400, not_found: 404, failed: 500 } as const

export async function POST(req: Request, ctx: Ctx) {
  const g = await gate(ctx)
  if ('error' in g) return g.error
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  if (body.action !== 'post') return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
  if (!(await storylineEntitled(g.userId))) return NextResponse.json({ error: 'not_entitled' }, { status: 402 })

  let hook: StoryHook | null = null
  if (typeof body.hookId === 'string' && body.hookId) {
    const view = await readStudioView(g.leagueId, g.userId, langOf(body.lang))
    if (!view) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    if (!view.native) return NextResponse.json({ error: 'imported' }, { status: 409 })
    hook = [...view.hooks.byMatchup.flatMap((m) => m.hooks), ...view.hooks.league].find((h) => h.id === body.hookId) ?? null
    if (!hook) return NextResponse.json({ error: 'hook_not_found' }, { status: 404 })
  }

  const result = await postStoryline({
    leagueId: g.leagueId,
    userId: g.userId,
    text: typeof body.text === 'string' ? body.text : hook?.text ?? '',
    hook,
    matchupId: hook?.matchup?.matchupId ?? null,
    includePoll: body.includePoll === true,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: POST_STATUS[result.error] })
  return NextResponse.json(result)
}
