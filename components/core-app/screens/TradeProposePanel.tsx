'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PickedAsset } from '@/components/core-app/screens/TradeAssetPicker'

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
 * ⚠ NO NEW API ROUTE. Reads `/api/leagues/<id>/trades/rosters` and posts to
 * `/api/leagues/<id>/trades`, both already live behind the `[section]`
 * dispatcher.
 */

type RosterPlayer = { id: string; name: string; position: string | null }

export type TradeableRoster = {
  rosterId: string
  platformUserId: string
  players: RosterPlayer[]
  ownerName: string | null
  canReceiveProposal: boolean
}

type RostersResponse = {
  rosters?: TradeableRoster[]
  viewerRosterId?: string | null
  error?: string
}

/** One asset in the shape `TradeAssetInput` accepts. */
export type ProposalAsset = {
  itemType: 'player' | 'faab'
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
         * The engine validates a pick by PICK ID against the sending roster's
         * own pick list. The builder only ever knows a year and a round, so
         * there is no id to send and no way to prove ownership. Naming it is
         * the honest outcome; inventing a reference is not.
         */
        blocked.push(`${a.label} — picks can be analysed here but not proposed yet`)
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
}) {
  const { leagueId, give, get } = props

  const [data, setData] = useState<RostersResponse | null>(null)
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'failed'>('idle')
  const [partnerId, setPartnerId] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null)

  const hasDeal = give.length + get.length > 0

  useEffect(() => {
    /*
     * Lazy on purpose. Enriching every roster in the league is an expensive
     * read, and there is nothing to propose until something is on the board.
     */
    if (!leagueId || !hasDeal || data != null || loadState === 'loading') return
    let cancelled = false
    setLoadState('loading')
    void (async () => {
      try {
        const r = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/trades/rosters`)
        const j = (await r.json().catch(() => ({}))) as RostersResponse
        if (cancelled) return
        if (!r.ok) {
          setLoadState('failed')
          return
        }
        setData(j)
        setLoadState('idle')
      } catch {
        if (!cancelled) setLoadState('failed')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [leagueId, hasDeal, data, loadState])

  const rosters = data?.rosters ?? []
  const myRosterId = data?.viewerRosterId ?? null
  const mine = rosters.find((r) => r.rosterId === myRosterId) ?? null
  const partners = rosters.filter((r) => r.rosterId !== myRosterId)
  const reachable = partners.filter((r) => r.canReceiveProposal)
  const partner = partners.find((r) => r.rosterId === partnerId) ?? null

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

      {loadState === 'loading' && data == null ? (
        <p className="af-tc-row-sub">Checking who can receive it&hellip;</p>
      ) : null}

      {loadState === 'failed' ? (
        <p className="af-tc-row-sub">
          We couldn&rsquo;t read this league&rsquo;s rosters, so there is nothing to send a proposal
          against.
        </p>
      ) : null}

      {/*
        ⚠ THREE REFUSALS, THREE DIFFERENT ANSWERS. "You do not hold a roster
        here", "nobody here has an account", and "this deal has an asset we
        cannot send" are not the same problem and only one of them is about the
        deal on the board.
      */}
      {data != null && !mine ? (
        <p className="af-tc-row-sub">
          A proposal has to come from a roster you hold in AllFantasy, and none here is registered
          to your account. On an imported league that is normal &mdash; the rosters belong to the
          platform, so trades are made there.
        </p>
      ) : null}

      {data != null && mine && reachable.length === 0 ? (
        <p className="af-tc-row-sub">
          Nobody else in this league has an AllFantasy account yet, so a proposal sent from here
          would sit where they cannot see it. Build the deal, then send it to them where they
          play.
        </p>
      ) : null}

      {data != null && mine && reachable.length > 0 ? (
        <>
          <div className="af-tc-propose-partners">
            {reachable.map((r) => (
              <button
                key={r.rosterId}
                type="button"
                className="af-tc-chip af-tc-propose-partner"
                data-on={partnerId === r.rosterId}
                onClick={() => {
                  setPartnerId(r.rosterId)
                  setOutcome(null)
                }}
              >
                {r.ownerName ?? 'Another manager'}
              </button>
            ))}
          </div>

          {/*
            Managers we CAN see but cannot reach are named rather than hidden.
            A manager who knows there are eleven other teams and sees three
            buttons is owed the reason.
          */}
          {partners.length > reachable.length ? (
            <p className="af-tc-row-sub">
              {partners.length - reachable.length} other{' '}
              {partners.length - reachable.length === 1 ? 'manager is' : 'managers are'} not on
              AllFantasy yet, so a proposal cannot reach them.
            </p>
          ) : null}

          {partner && reconciled ? (
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
