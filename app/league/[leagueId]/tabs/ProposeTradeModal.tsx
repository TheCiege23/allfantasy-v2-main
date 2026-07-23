'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import {
  saveActionLabel,
  shadowDisclosure,
  sourcePlatformLabel,
  writeAuthorityCopy,
} from '@/lib/league/write-authority'
import { AppModal } from '@/components/ui/AppModal'
import type { LeagueTeamSlot } from '@/app/dashboard/types'
import type { TradeableRoster, TradeableRosterPlayer } from '@/app/api/leagues/[leagueId]/trades/rosters/route'

export type ProposeTradeModalProps = {
  open: boolean
  onClose: () => void
  leagueId: string
  teams: LeagueTeamSlot[]
  onSubmitted: () => void
  /**
   * `League.platform`. Drives Write Authority: on an imported (SHADOW) league this builder
   * creates a proposal that exists only in AllFantasy — the trade partner, who plays on
   * ESPN/Yahoo/Sleeper, will never receive it. Omitted/native leagues send a real offer.
   */
  platform?: string | null
}

/**
 * Native AllFantasy trade builder for NFL redraft leagues: partner picker, real roster asset
 * checkboxes on both sides, submits to the real `AfLeagueTrade` engine
 * (`POST /api/leagues/[leagueId]/trades`) — the same engine verified end-to-end (create, accept,
 * commissioner review, roster sync) — not the Sleeper-deeplink / simulation-only trade finder.
 */
export function ProposeTradeModal({
  open,
  onClose,
  leagueId,
  teams,
  onSubmitted,
  platform,
}: ProposeTradeModalProps) {
  const { data: session } = useSession()
  const myUserId = session?.user?.id ?? null
  const tradeCopy = useMemo(() => writeAuthorityCopy('trade', platform), [platform])
  const submitLabel = useMemo(() => saveActionLabel('trade', platform), [platform])
  const shadowNotice = useMemo(() => shadowDisclosure(platform), [platform])
  const sourceLabel = useMemo(() => sourcePlatformLabel(platform), [platform])

  const [rosters, setRosters] = useState<TradeableRoster[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [partnerUserId, setPartnerUserId] = useState<string | null>(null)
  const [givePlayerIds, setGivePlayerIds] = useState<Set<string>>(new Set())
  const [getPlayerIds, setGetPlayerIds] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setLoading(true)
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/trades/rosters`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Failed to load rosters'))))
      .then((data: { rosters?: TradeableRoster[] }) => setRosters(Array.isArray(data.rosters) ? data.rosters : []))
      .catch(() => setError('Could not load rosters for this league.'))
      .finally(() => setLoading(false))
  }, [open, leagueId])

  useEffect(() => {
    if (!open) {
      setPartnerUserId(null)
      setGivePlayerIds(new Set())
      setGetPlayerIds(new Set())
      setError(null)
    }
  }, [open])

  const partnerTeams = useMemo(
    () => teams.filter((t) => t.platformUserId && t.platformUserId !== myUserId),
    [teams, myUserId],
  )

  const myRoster = useMemo(
    () => rosters?.find((r) => r.platformUserId === myUserId) ?? null,
    [rosters, myUserId],
  )
  const partnerRoster = useMemo(
    () => (partnerUserId ? (rosters?.find((r) => r.platformUserId === partnerUserId) ?? null) : null),
    [rosters, partnerUserId],
  )

  function toggle(set: Set<string>, setSet: (next: Set<string>) => void, id: string) {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSet(next)
  }

  const canSubmit = Boolean(myRoster && partnerRoster && (givePlayerIds.size > 0 || getPlayerIds.size > 0) && !submitting)

  async function handleSubmit() {
    if (!myRoster || !partnerRoster) return
    setSubmitting(true)
    setError(null)
    try {
      const findPlayer = (roster: TradeableRoster, id: string): TradeableRosterPlayer | undefined =>
        roster.players.find((p) => p.id === id)
      const assets = [
        ...[...givePlayerIds].map((id) => {
          const player = findPlayer(myRoster, id)
          return {
            itemType: 'player' as const,
            itemReference: id,
            fromRosterId: myRoster.rosterId,
            toRosterId: partnerRoster.rosterId,
            metadata: { playerName: player?.name ?? id, position: player?.position ?? null },
          }
        }),
        ...[...getPlayerIds].map((id) => {
          const player = findPlayer(partnerRoster, id)
          return {
            itemType: 'player' as const,
            itemReference: id,
            fromRosterId: partnerRoster.rosterId,
            toRosterId: myRoster.rosterId,
            metadata: { playerName: player?.name ?? id, position: player?.position ?? null },
          }
        }),
      ]

      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/trades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposerRosterId: myRoster.rosterId,
          receiverRosterId: partnerRoster.rosterId,
          assets,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        writeAuthority?: { copy?: { title?: string; detail?: string } }
      }
      if (!res.ok) {
        setError(data.error ?? 'Failed to submit trade.')
        return
      }
      // Server envelope is authoritative; the local builder is the fallback. On a SHADOW league
      // this says "Shadow trade created — send this offer in ESPN to make it real", never
      // "Trade offer sent", which would imply the partner was notified on their platform.
      const created = data.writeAuthority?.copy ?? tradeCopy
      toast.success(created.title ?? tradeCopy.title, { description: created.detail || undefined })
      onSubmitted()
      onClose()
    } catch {
      setError('Failed to submit trade.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AppModal
      open={open}
      onClose={onClose}
      title={shadowNotice ? 'Build a Shadow Trade' : 'Propose a Trade'}
      size="lg"
    >
      <div className="space-y-4 text-[13px] text-white/80">
        {/*
          Shown before any selection is made. A manager building a trade for an imported league
          needs to know up front that the offer stops at AllFantasy — discovering it in the
          success toast is too late to be honest about it.
        */}
        {shadowNotice ? (
          <p
            data-testid="shadow-league-trade-notice"
            className="rounded-lg border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-[11px] text-sky-100/90"
          >
            This proposal stays inside AllFantasy — {sourceLabel ?? 'your host platform'} is not notified.
            Use it as a plan, then send the offer in {sourceLabel ?? 'your host platform'}.
          </p>
        ) : null}
        {loading ? (
          <p className="text-white/50">Loading rosters…</p>
        ) : (
          <>
            <label className="block text-[11px] font-bold uppercase tracking-wide text-white/40">
              Trade partner
              <select
                value={partnerUserId ?? ''}
                onChange={(e) => {
                  setPartnerUserId(e.target.value || null)
                  setGetPlayerIds(new Set())
                }}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#0a1220] px-3 py-2 text-[13px] text-white/90"
                data-testid="propose-trade-partner-select"
              >
                <option value="">Select a manager…</option>
                {partnerTeams.map((t) => (
                  <option key={t.id} value={t.platformUserId ?? ''}>
                    {t.teamName || t.ownerName}
                  </option>
                ))}
              </select>
            </label>

            {error ? <p className="text-[12px] text-rose-300">{error}</p> : null}

            {myRoster && partnerRoster ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-white/40">You send</p>
                  <ul className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-white/10 bg-white/[0.02] p-2">
                    {myRoster.players.map((p) => (
                      <li key={p.id}>
                        <label className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-white/[0.04]">
                          <input
                            type="checkbox"
                            checked={givePlayerIds.has(p.id)}
                            onChange={() => toggle(givePlayerIds, setGivePlayerIds, p.id)}
                          />
                          <span className="truncate">{p.name}</span>
                          {p.position ? <span className="text-white/35">{p.position}</span> : null}
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-white/40">You receive</p>
                  <ul className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-white/10 bg-white/[0.02] p-2">
                    {partnerRoster.players.map((p) => (
                      <li key={p.id}>
                        <label className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-white/[0.04]">
                          <input
                            type="checkbox"
                            checked={getPlayerIds.has(p.id)}
                            onChange={() => toggle(getPlayerIds, setGetPlayerIds, p.id)}
                          />
                          <span className="truncate">{p.name}</span>
                          {p.position ? <span className="text-white/35">{p.position}</span> : null}
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : partnerUserId ? (
              <p className="text-white/45">This manager has no tradeable roster yet.</p>
            ) : null}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-white/15 px-3 py-2 text-[12px] font-semibold text-white/70"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={!canSubmit}
                className="rounded-lg bg-cyan-500/85 px-3 py-2 text-[12px] font-semibold text-black disabled:opacity-50"
                data-testid="propose-trade-submit"
              >
                {submitting ? 'Saving…' : submitLabel}
              </button>
            </div>
          </>
        )}
      </div>
    </AppModal>
  )
}
