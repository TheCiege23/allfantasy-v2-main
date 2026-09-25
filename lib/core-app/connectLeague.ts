/**
 * Whether the /core home should lead with "connect your league", and which version of it.
 *
 * Owner's call 2026-09-25 ("get people connected"). Measured that day: 110 users, 77 without a
 * claimed team in a 2026 league — 75 of them had imported nothing, 2 had a league but no team — and
 * 40 of the 77 were unverified, which matters because the import refuses an unverified account.
 * Meanwhile the home told a user with no leagues "Nothing is waiting on you."
 *
 * Everything Chimmy does for a manager — the lineup check, the waiver check, advice about "my team"
 * — needs a CLAIMED team. So the question is not "do you have leagues" but "do we know your team".
 *
 * Pure: the reads live in connectLeagueReads.ts; the card in components/core-app/home.
 */

export type ConnectLeagueStep =
  /** We know their team. Say nothing. */
  | 'none'
  /** The import refuses an unverified account, so this comes first. */
  | 'verify'
  /** No league at all. */
  | 'connect'
  /** Leagues here, none of them linked to their team. */
  | 'claim'

export type ConnectLeagueFacts = {
  /** Teams claimed by this user in a league of the current fantasy season or later. */
  claimedTeams: number
  /** Leagues the home can see for this user (owned, member, claimed, rostered). */
  leagueCount: number
  /** Email or phone verified — `isUserVerified`'s rule. */
  verified: boolean
}

export function connectLeagueStep(f: ConnectLeagueFacts): ConnectLeagueStep {
  if (f.claimedTeams > 0) return 'none'
  if (!f.verified) return 'verify'
  return f.leagueCount > 0 ? 'claim' : 'connect'
}

/**
 * The season a "current team" belongs to. Fantasy football's 2026 season runs into February 2027,
 * so January and February still belong to the year before.
 */
export function currentFantasySeason(now: Date): number {
  const y = now.getUTCFullYear()
  return now.getUTCMonth() < 2 ? y - 1 : y
}

/**
 * Where "connect" goes. A Sleeper account already linked on the profile means the import can find
 * their leagues with no typing at all (ImportV4 discovers on load for `provider=sleeper`).
 */
export function connectLeagueHref(opts: { sleeperLinked: boolean }): string {
  return opts.sleeperLinked ? '/import?provider=sleeper' : '/import'
}

export type ConnectLeagueCopy = { title: string; body: string; cta: string }

export function connectLeagueCopy(step: Exclude<ConnectLeagueStep, 'none'>): ConnectLeagueCopy {
  switch (step) {
    case 'verify':
      return {
        title: 'Verify your email, then bring your league in',
        body: "Connecting a league needs a verified account. Tap the link we emailed you — or get a fresh one here — and you'll be back in a minute.",
        cta: 'Send the link again',
      }
    case 'claim':
      return {
        title: "Chimmy doesn't know which team is yours yet",
        body: "Your leagues are here, but none is linked to your team, so I can't check your lineup or your waiver wire. Connect the account you play on and I'll match you to your team.",
        cta: 'Connect your account',
      }
    case 'connect':
      return {
        title: 'Connect your league. It takes about a minute.',
        body: "Sleeper, ESPN, Fantrax, MFL or Fleaflicker. Once I can see your team I'll check your lineup before kickoff and flag the best pickup on your wire every Tuesday. Read-only: nothing changes on your platform.",
        cta: 'Connect a league',
      }
  }
}

/** What the import's success screen asks Chimmy on the manager's behalf — one tap to send. */
export const POST_IMPORT_CHIMMY_PROMPT = 'Check my lineup for this week. Anything I should change?'

/**
 * The first useful thing to do with a league you just connected: have Chimmy look at your lineup in
 * it. Opens Chimmy in that league with the question typed; nothing is sent until they tap.
 */
export function postImportChimmyHref(leagueId: string, sport?: string | null): string {
  const q = new URLSearchParams({ prompt: POST_IMPORT_CHIMMY_PROMPT, leagueId })
  if (sport && /^[A-Za-z]{2,12}$/.test(sport)) q.set('sport', sport.toUpperCase())
  return `/chimmy/chat?${q.toString()}`
}

