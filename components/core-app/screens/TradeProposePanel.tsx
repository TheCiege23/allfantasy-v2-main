'use client'

import { useCallback, useMemo, useState } from 'react'
import type { PickedAsset } from '@/components/core-app/screens/TradeAssetPicker'
import type { LeagueRoster, RosterPlayer } from '@/components/core-app/screens/useLeagueRosters'

/**
 * Phase 4 — send the deal on the board as a real proposal.
 *
 * This is the first write in the Trade Center, and it is deliberately the
 * smallest honest one.
 *
 * ⚠ IT CANNOT GO TO SLEEPER, AND THAT IS NOT A GAP WE CAN CLOSE. Sleeper's
 * public API has no write endpoint at all — reading pending offers works,
 * creating one does not exist. So "propose" here writes an ALLFANTASY-native
 * proposal, and it only reaches someone who has an AllFantasy account holding
 * that roster. On an imported league nobody does, and the panel says so rather
 * than writing a row into a table the counterparty will never open.
 *
 * ⚠ THE BOARD AND THE PROPOSABLE DEAL ARE DIFFERENT SETS. The builder searches
 * a market feed; the trade engine validates against actual rosters — a player
 * must be ON the sending roster by id, a pick must be owned by pick id. So the
 * panel reconciles the two and refuses to send a PARTIAL deal. Sending the
 * subset that happened to map would propose a trade nobody built.
 *
 * ⚠ NO OPTIMISTIC SUCCESS. The button reports what the server said, including
 * the server's own refusal text. A write that silently fails is worse than a
 * button that is not there.
 *
 * ⚠ NO NEW API ROUTE. Posts to `/api/leagues/<id>/trades`, already live behind
 * the `[section]` dispatcher. The rosters it reasons about are fetched once by
 * the screen and passed in, because the picker and the counterparty selector
 * need the same answer.
 */

/** One asset in the shape `TradeAssetInput` accepts. */
export type ProposalAsset = {
  itemType: 'player' | 'faab' | 'rookie_pick' | 'future_pick'
  itemReference?: string | null
  fromRosterId: string
  toRosterId: string
  faabAmount?: number
}

/**
 * Loose enough to survive punctuation and a suffix, strict enough that two
 * different players do not collide.
 */
export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/[-]/g, ' ')
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Turn the board into a proposal, and name everything that cannot go.
 *
 * ⚠ AN AMBIGUOUS NAME IS A REFUSAL, NOT A GUESS. Two players on one roster can
 * share a name, and picking the first would send away a player the manager
 * never chose. Losing the wrong asset is not recoverable by undo.
 */
export function reconcileProposal(args: {
  give: PickedAsset[]
  get: PickedAsset[]
  myRosterId: string
  theirRosterId: string
  myPlayers: RosterPlayer[]
  theirPlayers: RosterPlayer[]
}): { assets: ProposalAsset[]; blocked: string[] } {
  const assets: ProposalAsset[] = []
  const blocked: string[] = []

  const match = (players: RosterPlayer[], name: string): RosterPlayer | 'ambiguous' | null => {
    const target = normalizeName(name)
    const hits = players.filter((p) => normalizeName(p.name) === target)
    if (hits.length === 1) return hits[0]!
    if (hits.length > 1) return 'ambiguous'
    return null
  }

  const walk = (
    side: PickedAsset[],
    fromRosterId: string,
    toRosterId: string,
    fromPlayers: RosterPlayer[],
    whose: string,
  ) => {
    for (const a of side) {
      if (a.kind === 'faab') {
        assets.push({ itemType: 'faab', fromRosterId, toRosterId, faabAmount: a.amount })
        continue
      }
      if (a.kind === 'pick') {
        /*
         * A pick picked off a roster carries the id the engine matches on. A
         * hand-typed year and round does not, and no reference can be invented
         * for it — the league only recognises a pick it already holds.
         */
        if (a.pickId) {
          assets.push({
            itemType: a.itemType ?? 'rookie_pick',
            itemReference: a.pickId,
            fromRosterId,
            toRosterId,
          })
        } else {
          blocked.push(`${a.label} — typed by hand, so the league has no pick to match it to`)
        }
        continue
      }
      const hit = match(fromPlayers, a.name)
      if (hit === 'ambiguous') {
        blocked.push(`${a.name} — more than one player by that name on ${whose} roster`)
        continue
      }
      if (!hit) {
        blocked.push(`${a.name} — not on ${whose} roster`)
        continue
      }
      assets.push({ itemType: 'player', itemReference: hit.id, fromRosterId, toRosterId })
    }
  }

  walk(args.give, args.myRosterId, args.theirRosterId, args.myPlayers, 'your')
  walk(args.get, args.theirRosterId, args.myRosterId, args.theirPlayers, 'their')

  return { assets, blocked }
}

export function TradeProposePanel(props: {
  leagueId: string | null
  /** Leaves the viewer's roster. */
  give: PickedAsset[]
  /** Arrives on the viewer's roster. */
  get: PickedAsset[]
  /** Fetched once by the screen — null until it has loaded. */
  rosters: LeagueRoster[] | null
  viewerRosterId: string | null
  /** The counterparty chosen in the builder. One selection, one meaning. */
  partnerRosterId: string | null
  onChoosePartner: (rosterId: string) => void
}) {
  const { leagueId, give, get } = props

  const [sending, setSending] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null)

  const hasDeal = give.length + get.length > 0

  const rosters = props.rosters ?? []
  const myRosterId = props.viewerRosterId
  const mine = rosters.find((r) => r.rosterId === myRosterId) ?? null
  const partners = rosters.filter((r) => r.rosterId !== myRosterId)
  const reachable = partners.filter((r) => r.canReceiveProposal)
  const partner = partners.find((r) => r.rosterId === props.partnerRosterId) ?? null

  const reconciled = useMemo(() => {
    if (!mine || !partner) return null
    return reconcileProposal({
      give,
      get,
      myRosterId: mine.rosterId,
      theirRosterId: partner.rosterId,
      myPlayers: mine.players,
      theirPlayers: partner.players,
    })
  }, [mine, partner, give, get])

  const propose = useCallback(async () => {
    if (!leagueId || !mine || !partner || !reconciled || reconciled.blocked.length > 0) return
    setSending(true)
    setOutcome(null)
    try {
      const r = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/trades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposerRosterId: mine.rosterId,
          receiverRosterId: partner.rosterId,
          assets: reconciled.assets,
        }),
      })
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!r.ok || !j.ok) {
        /*
         * The engine's own message, verbatim. It says things like "Trade
         * deadline has passed" and "Player is not on the sending roster" —
         * paraphrasing those into "something went wrong" throws away the only
         * useful part of the failure.
         */
        setOutcome({ ok: false, message: j.error ?? 'The league refused this proposal.' })
        return
      }
      setOutcome({
        ok: true,
        message: `Sent to ${partner.ownerName ?? 'them'}. It is pending until they answer, and it expires in 48 hours.`,
      })
    } catch {
      setOutcome({ ok: false, message: 'The proposal did not reach the league.' })
    } finally {
      setSending(false)
    }
  }, [leagueId, mine, partner, reconciled])

  if (!leagueId || !hasDeal) return null

  return (
    <section className="af-tc-propose">
      <div className="af-label">Send this as a proposal</div>

      {props.rosters == null ? (
        <p className="af-tc-row-sub">Checking who can receive it&hellip;</p>
      ) : null}

      {/*
        ⚠ THREE REFUSALS, THREE DIFFERENT ANSWERS. "You do not hold a roster
        here", "nobody here has an account", and "this deal has an asset we
        cannot send" are not the same problem and only one of them is about the
        deal on the board.
      */}
      {props.rosters != null && !mine ? (
        <p className="af-tc-row-sub">
          A proposal has to come from a roster you hold in AllFantasy, and none here is registered
          to your account. On an imported league that is normal &mdash; the rosters belong to the
          platform, so trades are made there.
        </p>
      ) : null}

      {props.rosters != null && mine && reachable.length === 0 ? (
        <p className="af-tc-row-sub">
          Nobody else in this league has an AllFantasy account yet, so a proposal sent from here
          would sit where they cannot see it. Build the deal, then send it to them where they
          play.
        </p>
      ) : null}

      {props.rosters != null && mine && reachable.length > 0 ? (
        <>
          {/*
            ⚠ ONE COUNTERPARTY SELECTION FOR THE WHOLE SCREEN. The builder above
            already asks who this deal is with, and that same choice drives the
            verdict's counterparty layer. A second picker here could disagree
            with it, and then the deal being analysed and the deal being sent
            would be to two different managers.
          */}
          {!partner ? (
            <p className="af-tc-row-sub">
              Choose who you are trading with above, and this can go to them.
            </p>
          ) : !partner.canReceiveProposal ? (
            <p className="af-tc-row-sub">
              {partner.ownerName ?? 'That manager'} is not on AllFantasy, so a proposal sent from
              here would sit where they cannot see it. Send it to them where they play.{' '}
              {reachable.length > 0 ? (
                <button
                  type="button"
                  className="af-tc-linklike"
                  onClick={() => {
                    props.onChoosePartner(reachable[0]!.rosterId)
                    setOutcome(null)
                  }}
                >
                  {reachable.length === 1
                    ? `${reachable[0]!.ownerName ?? 'One manager'} can receive one.`
                    : `${reachable.length} managers here can receive one.`}
                </button>
              ) : null}
            </p>
          ) : null}

          {/*
            Managers we CAN see but cannot reach are counted rather than hidden.
            A manager who knows there are eleven other teams is owed the reason
            only three of them can be sent anything.
          */}
          {partners.length > reachable.length ? (
            <p className="af-tc-row-sub">
              {partners.length - reachable.length} other{' '}
              {partners.length - reachable.length === 1 ? 'manager is' : 'managers are'} not on
              AllFantasy yet, so a proposal cannot reach them.
            </p>
          ) : null}

          {partner?.canReceiveProposal && reconciled ? (
            reconciled.blocked.length > 0 ? (
              <>
                <p className="af-tc-row-sub">
                  This deal can&rsquo;t be sent as it stands:
                </p>
                <ul className="af-tc-list">
                  {reconciled.blocked.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
                <p className="af-tc-row-sub">
                  Nothing partial gets sent &mdash; a trade missing a piece is a different trade.
                </p>
              </>
            ) : (
              <p className="af-tc-row-sub">
                {reconciled.assets.length}{' '}
                {reconciled.assets.length === 1 ? 'asset' : 'assets'} ready to send to{' '}
                {partner.ownerName ?? 'them'}. They answer it in AllFantasy.
              </p>
            )
          ) : null}

          {outcome ? (
            <p className={outcome.ok ? 'af-tc-row-sub' : 'af-tc-nosignal'}>{outcome.message}</p>
          ) : null}

          <button
            type="button"
            className="af-btn"
            onClick={propose}
            disabled={
              sending ||
              !partner ||
              !partner.canReceiveProposal ||
              !reconciled ||
              reconciled.blocked.length > 0 ||
              reconciled.assets.length === 0 ||
              outcome?.ok === true
            }
          >
            {sending ? 'Sending…' : outcome?.ok ? 'Sent' : 'Propose this trade'}
          </button>
        </>
      ) : null}
    </section>
  )
}
