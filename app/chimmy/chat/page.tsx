import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { readProactiveFrom } from '@/lib/chimmy-alerts/proactiveLinks'
import { recordProactiveOpen } from '@/lib/chimmy-alerts/recordProactiveOpen'
import { getDashboardLeagueListForUser } from '@/lib/dashboard/get-dashboard-league-list'
import { toPlayedLeagues } from '@/lib/core-app/playedLeagues'
import { getTokenSpendRuleMatrixEntry } from '@/lib/tokens/pricing-matrix'
import { planAllowanceMeta, readChimmyPlanAllowance } from '@/lib/chimmy/planAllowance'
import { readChatPageSport, toChatPageLeagues } from '@/lib/chimmy/chatPage'
import { ChimmyChatPageClient } from './ChimmyChatPageClient'

function firstParam(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0]
  return v
}

/**
 * `/chimmy/chat` — the chat drawer's Chimmy tab, full screen. See ChimmyChatPageClient.
 *
 * ⚠ NO GLOBAL APP SHELL. This route used to sit inside `ProductShellLayout`, whose right rail
 * ("AI Quick Ask", "AI Hub", "AI Status", "Wallet Summary"), shortcut popup and floating buttons
 * crowded a chat that needs the whole screen — and none of them exists in the drawer this page now
 * matches. The landing at `/chimmy` keeps that shell; it wraps its own page now instead of the
 * whole folder (see app/chimmy/page.tsx).
 *
 * URL parameters:
 *   prompt    typed into the composer, never sent
 *   leagueId  the scope the chat opens in, when it is one of the viewer's leagues
 *   sport     context for a question asked with no league in scope (validated)
 *   from      a weekly Chimmy message's tag — the open is counted (proactiveLinks.ts)
 *   teamId, week, strategyMode — read by the old page, NOT by this one. The panel has no
 *             equivalent: the league scope already names the viewer's team, the route resolves the
 *             week itself, and Fast/Deep is the answer mode (the route ranks `assistantMode` above
 *             `strategyMode`, so a URL value could never have applied alongside it).
 */
export default async function ChimmyChatPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = searchParams ? await searchParams : {}

  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string; email?: string | null }
  } | null
  const userId = session?.user?.id

  /*
   * Signed out: Chimmy answers only a signed-in account (`/api/chat/chimmy` returns 401), and the
   * panel is built from the viewer's leagues. Sign in, then come straight back with the question
   * and league still in the URL — `from` included, so a weekly message's open is counted once the
   * session exists to count it against.
   */
  if (!userId) {
    const carried = new URLSearchParams()
    for (const [key, value] of Object.entries(sp)) {
      if (typeof value === 'string') carried.set(key, value)
    }
    const query = carried.toString()
    redirect(`/login?callbackUrl=${encodeURIComponent(`/chimmy/chat${query ? `?${query}` : ''}`)}`)
  }

  /*
   * Opened from a weekly Chimmy message (lineup / waiver check) — count the open, so we can tell
   * whether those messages bring anyone in. Only a known tag is recorded; see proactiveLinks.ts.
   *
   * Awaited, because it reads the session and a request-scoped read is only safe inside the render
   * on Next 14 (no `after()`). Bounded, because a count must never hold up the page: past 1.5s the
   * page renders and the write finishes on its own. It never throws.
   */
  const from = readProactiveFrom(firstParam(sp.from))
  if (from) {
    await Promise.race([
      recordProactiveOpen({ from, leagueId: firstParam(sp.leagueId) ?? null }),
      new Promise<void>((resolve) => setTimeout(resolve, 1500)),
    ])
  }

  /*
   * The same three reads /core makes for its drawer: the leagues the scope picker offers (played
   * leagues only — AF Legacy board snapshots have nothing to ask about), the token price quoted
   * before a send, and the plan's included answers. Each fails soft: no leagues still leaves
   * "All leagues", and no plan read shows the token price exactly as the drawer would.
   */
  const [leaguePayload, planState] = await Promise.all([
    getDashboardLeagueListForUser(userId).catch(() => null),
    readChimmyPlanAllowance({ userId, email: session?.user?.email ?? null }).catch(() => null),
  ])
  const leagues = toChatPageLeagues(toPlayedLeagues(leaguePayload?.leagues ?? []))
  const tokenCost = getTokenSpendRuleMatrixEntry('ai_chimmy_chat_message')?.tokenCost ?? null
  const planAllowance = planState ? planAllowanceMeta(planState, planState.remaining > 0) : null

  return (
    <ChimmyChatPageClient
      userId={userId}
      leagues={leagues}
      tokenCost={tokenCost}
      planAllowance={planAllowance}
      prompt={firstParam(sp.prompt) ?? null}
      leagueId={firstParam(sp.leagueId) ?? null}
      sport={readChatPageSport(firstParam(sp.sport))}
    />
  )
}
