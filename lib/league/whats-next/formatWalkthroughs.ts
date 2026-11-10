/**
 * The short "how this format runs" walkthrough a commissioner sees the first time they create a
 * league in a format, and anyone can reopen from the "?" on the What's next? banner.
 *
 * 3–5 steps each, in the order a season actually happens. Every rule here is one the engine
 * enforces (see the phase config beside this file); nothing describes a feature that is not built.
 *
 * Seen-state is per user AND per format, not per league: the point is a commissioner's FIRST
 * Big Brother league, so their second one opens without it.
 *
 * It lives on the ACCOUNT (walkthroughSeenStore.ts, via /api/user/format-walkthroughs), so it follows
 * the commissioner to a new phone. The browser flag below is only a fast path that saves the request.
 */
import type { WhatsNextFormatId } from './types'

export type WalkthroughStep = { title: string; body: string }
export type FormatWalkthrough = { format: WhatsNextFormatId; title: string; steps: readonly WalkthroughStep[] }

const W = (format: WhatsNextFormatId, title: string, steps: WalkthroughStep[]): FormatWalkthrough => ({ format, title, steps })

export const FORMAT_WALKTHROUGHS: Partial<Record<WhatsNextFormatId, FormatWalkthrough>> = {
  big_brother: W('big_brother', 'How Big Brother runs', [
    {
      title: 'Every week is one eviction',
      body: 'After the draft, each week runs the same loop: Head of Household, nominations, the Power of Veto, then an eviction vote. The banner on League Home always says which step you are on.',
    },
    {
      title: 'The HOH nominates',
      body: 'The HOH competition is decided automatically. The winner names two houseguests for eviction before the nomination deadline — if they miss it, the league’s fallback rule nominates for them.',
    },
    {
      title: 'The veto can change the block',
      body: 'Veto players are drawn automatically and the competition resolves at its deadline. The winner decides whether to save a nominee; if they do, the HOH names a replacement.',
    },
    {
      title: 'The house votes someone out',
      body: 'The rest of the house votes to evict one nominee (your settings decide whether the HOH votes or only breaks ties). Evicted houseguests’ players are released, and later evictees join the jury.',
    },
    {
      title: 'Your job as commissioner',
      body: 'Start Week 1 from Big Brother command after the draft. The weeks then run on the schedule in settings — you only step in to pause, force a step forward, or settle something by hand.',
    },
  ]),
  survivor: W('survivor', 'How Survivor runs', [
    {
      title: 'Tribes first',
      body: 'After the draft, managers are split into tribes. Week 1 starts once the tribes are formed from Survivor command.',
    },
    {
      title: 'Immunity is won on the field',
      body: 'Each week’s scores and challenges decide which tribe — and later which castaway — is safe. Everyone else is headed to Tribal Council.',
    },
    {
      title: 'Tribal Council votes someone out',
      body: 'The tribe at Tribal Council votes privately before the deadline. Ties follow the league’s tie rule, and idols can change the outcome.',
    },
    {
      title: 'Merge, jury and finale',
      body: 'At the merge it is every castaway for themselves. Voted-out castaways join the jury, and the jury picks the Sole Survivor at the finale.',
    },
  ]),
  zombie: W('zombie', 'How Zombie runs', [
    {
      title: 'One Whisperer, everyone else human',
      body: 'The season starts with a single Whisperer. Every other team is a Survivor.',
    },
    {
      title: 'Lose to a zombie and you turn',
      body: 'When a Survivor loses to the Whisperer or a Zombie, that Survivor becomes a Zombie. Results resolve automatically once scores are final.',
    },
    {
      title: 'Last humans standing win',
      body: 'Survivors try to stay human all season; Zombies and the Whisperer try to infect them. The banner shows how many survivors are left.',
    },
  ]),
  guillotine: W('guillotine', 'How Guillotine runs', [
    { title: 'Score or get chopped', body: 'Once chops begin, the lowest-scoring team each week is eliminated.' },
    { title: 'Their players hit waivers', body: 'A chopped team’s roster is released, so everyone still alive can bid on it.' },
    { title: 'Last team standing wins', body: 'There are no playoffs — the season ends when one team is left. The chop line on League Home shows who is in danger.' },
  ]),
  pirate: W('pirate', 'How Pirate runs', [
    { title: 'Protect before lock', body: 'Each week, choose the players you protect before protections lock.' },
    { title: 'Winners plunder', body: 'Win your matchup and you claim one unprotected player from the team you beat.' },
    { title: 'Your job as commissioner', body: 'Claims and transfers run on their own. You only rule on a claim the engine flags for review.' },
  ]),
  tournament: W('tournament', 'How a tournament runs', [
    { title: 'Many leagues, one bracket', body: 'Managers are split into leagues that each draft and play on their own.' },
    { title: 'Standings decide who advances', body: 'At the end of each round, the top teams in every league move on to the next round.' },
    { title: 'Down to a champion', body: 'Rounds repeat until the finals crown one champion across the whole tournament.' },
  ]),
  best_ball: W('best_ball', 'How Best Ball runs', [
    { title: 'Draft, then relax', body: 'Your roster is set at the draft. There are no lineups to manage.' },
    { title: 'Your best lineup scores itself', body: 'Each week your highest-scoring players are counted automatically.' },
    { title: 'Depth wins', body: 'Because your best players always count, a deep roster beats a thin one.' },
  ]),
  dynasty: W('dynasty', 'How Dynasty runs', [
    { title: 'Rosters carry over', body: 'Every team keeps its whole roster from season to season.' },
    { title: 'Rookies come through the draft', body: 'After the startup draft, each offseason adds a rookie draft. Picks can be traded.' },
    { title: 'Your job as commissioner', body: 'Renew the league each offseason and set the rookie draft. The banner tells you when.' },
  ]),
  keeper: W('keeper', 'How Keeper runs', [
    { title: 'Play a normal season', body: 'The season runs like redraft: lineups, waivers, trades and playoffs.' },
    { title: 'Keep a few players', body: 'In the offseason, each team chooses the players it keeps under the league’s keeper rules.' },
    { title: 'Your job as commissioner', body: 'Renew the league and open keeper selection before the next draft.' },
  ]),
  devy: W('devy', 'How Devy runs', [
    { title: 'Pro roster plus college stash', body: 'Alongside your pro roster you hold college players who do not score yet.' },
    { title: 'Prospects graduate', body: 'When a college player turns pro, he moves up to your pro roster.' },
    { title: 'Plan years ahead', body: 'Devy rewards scouting: the prospects you stash now are your starters later.' },
  ]),
  c2c: W('c2c', 'How Campus to Canton runs', [
    { title: 'Two rosters, one team', body: 'You manage a college (campus) roster and a pro (canton) roster.' },
    { title: 'Both halves score', body: 'Your campus and canton starters both count toward your weekly score, weighted by the league’s settings.' },
    { title: 'Players move up', body: 'College players who turn pro carry over to your canton roster.' },
  ]),
  salary_cap: W('salary_cap', 'How Salary Cap runs', [
    { title: 'Every player has a contract', body: 'Players cost cap space and their contracts run for years.' },
    { title: 'Stay under the cap', body: 'Trades and signings must keep your team under the league’s cap.' },
    { title: 'Contracts roll over', body: 'Each offseason contracts carry forward, so today’s deals shape next season.' },
  ]),
  idp: W('idp', 'How IDP runs', [
    { title: 'Defenders are players too', body: 'Instead of a team defense, you start individual defensive players.' },
    { title: 'Tackles, sacks and turnovers score', body: 'Defensive stats score under the league’s IDP scoring settings.' },
    { title: 'Draft deeper', body: 'Your roster needs defensive starters as well as offense, so rosters run deeper.' },
  ]),
}

export function walkthroughFor(format: WhatsNextFormatId): FormatWalkthrough | null {
  return FORMAT_WALKTHROUGHS[format] ?? null
}

const SEEN_PREFIX = 'af-format-walkthrough-seen:'

export function walkthroughSeenKey(userId: string | null | undefined, format: WhatsNextFormatId): string {
  return `${SEEN_PREFIX}${userId ?? 'anon'}:${format}`
}

/** localStorage can throw (private mode, blocked storage); a failure reads as "not seen" only for writes. */
export function hasSeenWalkthrough(userId: string | null | undefined, format: WhatsNextFormatId): boolean {
  try {
    return window.localStorage.getItem(walkthroughSeenKey(userId, format)) === '1'
  } catch {
    // Unreadable storage: treat as seen, so a blocked browser is not shown the tour on every visit.
    return true
  }
}

export const WALKTHROUGH_SEEN_ENDPOINT = '/api/user/format-walkthroughs'

/**
 * The account's answer: `true` seen, `false` not seen, `null` unknown (signed out, offline, a failed
 * read). Unknown is NOT "not seen" for the caller to decide — the panel opens on `false` or `null`,
 * exactly as it did before the account knew anything.
 */
export async function fetchAccountWalkthroughSeen(format: WhatsNextFormatId, fetchImpl: typeof fetch = fetch): Promise<boolean | null> {
  try {
    const res = await fetchImpl(WALKTHROUGH_SEEN_ENDPOINT, { cache: 'no-store', credentials: 'include' })
    if (!res.ok) return null
    const body = (await res.json()) as { seen?: Record<string, unknown> } | null
    if (!body?.seen || typeof body.seen !== 'object') return null
    return typeof body.seen[format] === 'string'
  } catch {
    return null
  }
}

/** Fire and forget: the browser flag is already set, so a failed save costs one more showing at most. */
export async function saveAccountWalkthroughSeen(format: WhatsNextFormatId, fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    await fetchImpl(WALKTHROUGH_SEEN_ENDPOINT, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format }),
    })
  } catch {
    /* offline or signed out — the browser flag still holds on this device */
  }
}

export function markWalkthroughSeen(userId: string | null | undefined, format: WhatsNextFormatId): void {
  try {
    window.localStorage.setItem(walkthroughSeenKey(userId, format), '1')
  } catch {
    /* storage unavailable — nothing to remember */
  }
}
