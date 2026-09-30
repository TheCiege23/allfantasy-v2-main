import type { PickedAsset } from '@/components/core-app/screens/TradeAssetPicker'
import type { LeagueRoster } from '@/components/core-app/screens/useLeagueRosters'
import type { OfferRead, ReadAsset, ReadTeam } from './offerRead'

/**
 * A screenshot's offer, placed onto this league's real rosters — which side is the viewer's, who the
 * other manager is, and each asset as the builder's own `PickedAsset`.
 *
 * 🛑 PLAYERS DECIDE THE SIDES, NOT THE TEAM LABELS. Before the trade, every player sits on exactly one
 * roster. A team that RECEIVES a player the viewer owns is the other manager; a team that receives a
 * player someone else owns is the viewer, and that someone is the partner. Team labels on a phone
 * screen are usernames, nicknames or cut off, so they only break a tie the players could not.
 *
 * 🛑 NOTHING IS GUESSED. A name that matches no player on the roster it has to come from is listed in
 * `unmatched` for the manager to add by hand; it is never swapped for a similar-sounding player. A
 * shorter deal grades as a different deal, so the builder says what is missing before anyone
 * analyses it.
 *
 * PURE and client-safe: it runs in the Trade Center on the rosters it already loaded.
 */

export type OfferMatch =
  | {
      ok: true
      partnerRosterId: string | null
      /** What the viewer sends. */
      give: PickedAsset[]
      /** What the viewer receives. */
      get: PickedAsset[]
      /** What the screenshot showed that could not be placed on a roster. */
      unmatched: string[]
    }
  | { ok: false; reason: string }

/** Lowercase, no punctuation, no generational suffix — "Tyrone Tracy, Jr." and "Tyrone Tracy" meet. */
export function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,'’`-]/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The one player on `roster` a read name means, or null. Full name first; then "J. Herbert" /
 * "J Herbert" as first initial + surname — accepted only when exactly one player fits.
 */
export function findRosterPlayer(roster: LeagueRoster | null | undefined, name: string) {
  if (!roster) return null
  const want = normalizePlayerName(name)
  if (!want) return null
  const exact = roster.players.filter((p) => normalizePlayerName(p.name) === want)
  if (exact.length === 1) return exact[0]!
  if (exact.length > 1) return null
  const parts = want.split(' ')
  if (parts.length >= 2 && parts[0]!.length === 1) {
    const initial = parts[0]!
    const surname = parts.slice(1).join(' ')
    const byInitial = roster.players.filter((p) => {
      const n = normalizePlayerName(p.name).split(' ')
      return n[0]?.startsWith(initial) && n.slice(1).join(' ') === surname
    })
    if (byInitial.length === 1) return byInitial[0]!
  }
  return null
}

function ownersOf(rosters: readonly LeagueRoster[], name: string): LeagueRoster[] {
  return rosters.filter((r) => findRosterPlayer(r, name) != null)
}

/** Manager labels compare on letters and digits only: "@TheCiege24", "The Ciege 24" and "theciege24" meet. */
function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizePlayerName(a ?? '').replace(/[^a-z0-9]/g, '')
  const y = normalizePlayerName(b ?? '').replace(/[^a-z0-9]/g, '')
  return x.length > 0 && x === y
}

/** A screenshot's label against every name the roster's manager goes by. */
function rosterIsNamed(r: LeagueRoster, label: string | null | undefined): boolean {
  return [r.ownerName, ...(r.ownerHandles ?? [])].some((n) => sameName(n, label))
}

function describe(a: ReadAsset): string {
  if (a.type === 'player') return a.name
  if (a.type === 'faab') return `$${a.amount} FAAB`
  return `${a.year ?? 'unknown year'} round ${a.round ?? '?'} pick`
}

/**
 * Place a read offer on the league. `rosters` is every roster in the league; `viewerRosterId` is the
 * viewer's TEAM (`LeagueRostersData.viewerTeamRosterId`).
 */
export function matchOfferToRosters(args: {
  read: OfferRead
  rosters: readonly LeagueRoster[]
  viewerRosterId: string | null
}): OfferMatch {
  const { read, rosters } = args
  if (read.kind === 'not_a_trade') {
    return { ok: false, reason: 'That screenshot does not look like a trade offer. Open the offer in Sleeper and screenshot the screen that lists both sides.' }
  }
  if (read.kind === 'unparseable') {
    return { ok: false, reason: 'We could not read that screenshot. Try a sharper one that shows both sides of the offer, or enter it by hand.' }
  }
  const viewer = rosters.find((r) => r.rosterId === args.viewerRosterId) ?? null
  if (!viewer) {
    return { ok: false, reason: 'We could not tell which team in this league is yours, so we cannot tell what you send from what you get. Enter the offer by hand.' }
  }
  const teams = read.teams.filter((t) => t.receives.length > 0 || t.name)
  if (teams.length !== 2) {
    return {
      ok: false,
      reason:
        teams.length > 2
          ? 'That offer involves more than two teams. Only two-team trades can be graded — enter your side by hand.'
          : 'We could only read one side of that offer. Screenshot the screen that shows both teams, or enter it by hand.',
    }
  }
  const others = rosters.filter((r) => r.rosterId !== viewer.rosterId)

  /*
   * Votes from the players. For team i: receiving a viewer-owned player says "i is the partner side";
   * receiving a player owned by roster X says "i is the viewer side, and X is the partner".
   */
  let votes0 = 0
  let votes1 = 0
  const voteViewerSide = (idx: number) => (idx === 0 ? (votes0 += 1) : (votes1 += 1))
  const partnerVotes = new Map<string, number>()
  teams.forEach((team, i) => {
    for (const a of team.receives) {
      if (a.type !== 'player') continue
      const owners = ownersOf(rosters, a.name)
      if (owners.length !== 1) continue
      const owner = owners[0]!
      if (owner.rosterId === viewer.rosterId) {
        voteViewerSide(1 - i)
      } else {
        voteViewerSide(i)
        partnerVotes.set(owner.rosterId, (partnerVotes.get(owner.rosterId) ?? 0) + 1)
      }
    }
  })

  let viewerIdx: 0 | 1 | null =
    votes0 > votes1 ? 0 : votes1 > votes0 ? 1 : null
  // A tie (or no players at all) falls to the team labels.
  if (viewerIdx == null) {
    const a = rosterIsNamed(viewer, teams[0]!.name)
    const b = rosterIsNamed(viewer, teams[1]!.name)
    if (a !== b) viewerIdx = a ? 0 : 1
  }
  if (viewerIdx == null) {
    return { ok: false, reason: 'We could not tell which side of that offer is yours. Enter it by hand, or screenshot the screen that shows both team names.' }
  }
  const viewerTeam: ReadTeam = teams[viewerIdx]!
  const partnerTeam: ReadTeam = teams[1 - viewerIdx]!

  const byVotes = [...partnerVotes.entries()].sort((x, y) => y[1] - x[1])
  /*
   * With no player of theirs to vote, a pick the viewer RECEIVES names its original owner
   * ("2028 2nd Rd (JeffersonTD)") — who is, for an offer's own pick, the other manager. Accepted only
   * when every such pick names the same roster. Then the partner side's label.
   */
  const ownerRosters = new Set(
    viewerTeam.receives.flatMap((a) =>
      a.type === 'pick' && a.originalOwner ? others.filter((r) => rosterIsNamed(r, a.originalOwner)).map((r) => r.rosterId) : [],
    ),
  )
  const partner =
    (byVotes.length > 0 && (byVotes.length === 1 || byVotes[0]![1] > byVotes[1]![1])
      ? others.find((r) => r.rosterId === byVotes[0]![0])
      : null) ??
    (ownerRosters.size === 1 ? others.find((r) => ownerRosters.has(r.rosterId)) : null) ??
    others.find((r) => rosterIsNamed(r, partnerTeam.name?.replace(/^@/, ''))) ??
    null

  const unmatched: string[] = [...read.unreadable]

  /* The partner side RECEIVES what the viewer sends, from the viewer's roster; and the reverse. */
  const convert = (from: LeagueRoster | null, list: ReadAsset[], usedPicks: Set<string>): PickedAsset[] =>
    list.flatMap((a): PickedAsset[] => {
      if (a.type === 'faab') return [{ kind: 'faab', amount: a.amount }]
      if (a.type === 'pick') {
        if (a.year == null || a.round == null) {
          unmatched.push(describe(a))
          return []
        }
        const onRoster = from?.picks.find(
          (p) => p.season === a.year && p.round === a.round && !usedPicks.has(p.pickId),
        )
        if (onRoster) {
          usedPicks.add(onRoster.pickId)
          return [{
            kind: 'pick',
            year: a.year,
            round: a.round,
            label: onRoster.label,
            pickId: onRoster.proposable === false ? null : onRoster.pickId,
            itemType: onRoster.itemType,
            value: onRoster.value,
            proposable: onRoster.proposable !== false,
          }]
        }
        // Not in the roster's pick list (an imported league may not carry it): typed by hand, still priced.
        return [{ kind: 'pick', year: a.year, round: a.round, label: `${a.year} Round ${a.round}`, pickId: null, value: null }]
      }
      const p = findRosterPlayer(from, a.name)
      if (!p) {
        unmatched.push(from ? `${a.name} (not on ${from.ownerName ?? 'that'} roster)` : a.name)
        return []
      }
      return [{
        kind: 'player',
        playerId: p.id,
        name: p.name,
        position: p.position,
        team: p.team,
        value: p.value,
        imageUrl: p.imageUrl,
        stock: p.stock ?? null,
        stockDelta: p.stockDelta ?? null,
        unpricedReason: p.unpricedReason ?? null,
      }]
    })

  const give = convert(viewer, partnerTeam.receives, new Set())
  const get = partner ? convert(partner, viewerTeam.receives, new Set()) : []
  if (!partner) {
    for (const a of viewerTeam.receives) unmatched.push(describe(a))
  }
  return { ok: true, partnerRosterId: partner?.rosterId ?? null, give, get, unmatched }
}

/** The line the builder shows after a screenshot loads: what to check, and what is still missing. */
export function screenshotDraftNote(m: Extract<OfferMatch, { ok: true }>): string {
  const parts = ['Read from your screenshot — check every asset against the offer in Sleeper, then analyze.']
  if (!m.partnerRosterId) parts.push('Pick the manager who sent it.')
  if (m.unmatched.length > 0) {
    parts.push(`Not placed on a roster, so add by hand before you analyze: ${m.unmatched.join(', ')}.`)
  }
  return parts.join(' ')
}

/** The confirmation beside the upload button: what loaded, and where to look. */
export function screenshotLoadedLine(m: Extract<OfferMatch, { ok: true }>): string {
  const n = (k: number) => `${k} ${k === 1 ? 'asset' : 'assets'}`
  const missing = m.unmatched.length > 0 ? ` ${m.unmatched.length} still to add by hand.` : ''
  return `Loaded into the trade builder: you send ${n(m.give.length)}, you get ${n(m.get.length)}.${missing} Check them against Sleeper, then Analyze.`
}
