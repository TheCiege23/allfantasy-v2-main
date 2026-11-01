'use client'

import { useCallback, useEffect, useState } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { getAppIntlLocale } from '@/lib/i18n/appLocale'
import { survivorGovernanceMessages } from '@/lib/survivor/survivorGovernanceUiMessages'

type Payload = {
  rules: { tradeRulesEnabled: boolean; strikeLimit: number; alliancesEnabled: boolean; allianceMaxSize: number }
  tradeWindow: { crossTribeOpen: boolean; crossTribeClosesAt: string | null; frozen: boolean } | null
  me: { playerState: string; canFormAlliance: boolean } | null
  myStrikes: { id: string; reason: string }[]
  alliances: { channelId: string; name: string; hostReads: boolean; readOnly: boolean; members: { userId: string; displayName: string; canPost: boolean }[] }[]
  inviteable: { userId: string; displayName: string }[]
}

function isPayload(value: unknown): value is Payload {
  const v = value as Payload | null
  return Boolean(v && typeof v === 'object' && v.rules && Array.isArray(v.myStrikes) && Array.isArray(v.alliances) && Array.isArray(v.inviteable))
}

/**
 * The castaway's own governance card on the island home: today's trade window, THEIR OWN conduct
 * strikes, and their alliances with a form to start one. Renders nothing when the league uses none
 * of these and the castaway has no strikes, so a league that never turns them on looks unchanged.
 */
export function SurvivorGovernanceCard({ leagueId }: { leagueId: string }) {
  const m = useMessages(survivorGovernanceMessages)
  const [data, setData] = useState<Payload | null>(null)
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/survivor/governance?leagueId=${encodeURIComponent(leagueId)}`, { cache: 'no-store' })
      if (!res.ok) return
      const body: unknown = await res.json()
      if (isPayload(body)) setData(body)
    } catch {
      // The card is optional; the island works without it.
    }
  }, [leagueId])

  useEffect(() => { void load() }, [load])

  async function post(payload: Record<string, unknown>) {
    setBusy(true)
    setStatus(null)
    try {
      const res = await fetch('/api/survivor/governance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leagueId, ...payload }) })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) { setStatus(body.error ?? m.saveFailed); return false }
      await load()
      return true
    } finally {
      setBusy(false)
    }
  }

  if (!data) return null
  const r = data.rules
  if (!r.tradeRulesEnabled && !r.alliancesEnabled && data.myStrikes.length === 0) return null
  const tw = data.tradeWindow
  const closes = tw?.crossTribeClosesAt ? new Date(tw.crossTribeClosesAt).toLocaleString(getAppIntlLocale(), { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : null
  const maxInvites = Math.max(1, r.allianceMaxSize - 1)

  return (
    <div className="svh-card svh-pad" data-testid="survivor-governance-card">
      <span className="svh-lbl">{m.cardTitle}</span>
      {r.tradeRulesEnabled && tw && data.me?.playerState === 'active' && (
        <p className="svh-sub svh-sm" data-testid="survivor-governance-card-trades">
          {tw.frozen ? m.tradeFrozen : closes ? m.tradeWindowOpen(closes) : tw.crossTribeOpen ? m.crossAllowed : m.tradeWindowClosed}
        </p>
      )}
      <p className="svh-sub svh-sm" data-testid="survivor-governance-card-strikes">
        {data.myStrikes.length ? m.myStrikes(data.myStrikes.length, r.strikeLimit) : m.myStrikesNone}
      </p>
      {data.myStrikes.length > 0 && <ul className="svh-sm">{data.myStrikes.map((s) => <li key={s.id}>{s.reason}</li>)}</ul>}
      {r.alliancesEnabled && (
        <div data-testid="survivor-governance-card-alliances">
          <span className="svh-lbl">{m.myAlliances}</span>
          {data.alliances.length === 0 ? <p className="svh-faint svh-sm">{m.noAlliances}</p> : (
            <ul className="svh-sm">
              {data.alliances.map((a) => (
                <li key={a.channelId}>
                  <strong>{a.name}</strong>: {a.members.map((x) => `${x.displayName}${x.canPost ? '' : ` (${m.readOnlyMember})`}`).join(', ')}
                  {a.hostReads && <span className="svh-faint"> · {m.allianceHostReads}</span>}
                  {!a.readOnly && <button type="button" className="svh-btn" disabled={busy} onClick={() => void post({ action: 'alliance_leave', channelId: a.channelId })}>{m.leaveAlliance}</button>}
                </li>
              ))}
            </ul>
          )}
          {data.me?.canFormAlliance && data.inviteable.length > 0 && (
            <form
              className="svh-sm"
              onSubmit={(e) => {
                e.preventDefault()
                void post({ action: 'alliance_create', name, memberUserIds: picked }).then((ok) => { if (ok) { setName(''); setPicked([]) } })
              }}
            >
              <span className="svh-lbl">{m.formAlliance}</span>
              <input aria-label={m.allianceName} placeholder={m.allianceName} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
              <fieldset>
                <legend>{m.allianceMembers(r.allianceMaxSize)}</legend>
                {data.inviteable.map((c) => {
                  const on = picked.includes(c.userId)
                  return (
                    <label key={c.userId}>
                      <input type="checkbox" checked={on} disabled={!on && picked.length >= maxInvites}
                        onChange={() => setPicked((p) => (on ? p.filter((id) => id !== c.userId) : [...p, c.userId]))} />
                      {c.displayName}
                    </label>
                  )
                })}
              </fieldset>
              <button type="submit" className="svh-btn svh-btn-gold" disabled={busy || name.trim().length < 2 || picked.length === 0} data-testid="survivor-governance-create-alliance">{m.createAlliance}</button>
            </form>
          )}
        </div>
      )}
      {status && <p role="status" className="svh-sm">{status}</p>}
    </div>
  )
}
