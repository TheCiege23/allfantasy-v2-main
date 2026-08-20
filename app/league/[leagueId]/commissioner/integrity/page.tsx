'use client'

/**
 * 11c — `/league/[leagueId]/commissioner/integrity`.
 *
 * Rebuilt in place against the existing, already-live API. `GET` on this route
 * has always returned `{ settings, openFlags, recentDismissed, stats }` and this
 * page previously used two of those four keys: it dropped `settings` entirely
 * (so the right rail did not exist) and dropped `evidenceJson` from each flag
 * (so a commissioner was asked to rule on an accusation with the evidence
 * withheld). Both are now rendered. No new endpoint, no new route.
 *
 * ⚠ THE DISCLOSURE BANNER HAS NO DISMISS AND MUST NOT GET ONE. Handoff build
 * rule 1. "Chat is never read" is the claim this entire feature's credibility
 * rests on, and a one-time tooltip is not where you put the sentence that stops
 * a league revolt. It is also true: both engines open with an explicit privacy
 * comment and read only trades, lineup snapshots and standings.
 *
 * ⚠ THE PAGE RELOADS AFTER EVERY WRITE. Dismissals and escalations move a flag
 * between the two tabs and change the header counts; re-fetching is cheaper than
 * keeping three derived lists in sync locally, and it means the counts can never
 * disagree with the list under them.
 */

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { useEntitlement } from '@/hooks/useEntitlement'
import IntegrityFlagCard, { type IntegrityFlagRow } from '@/components/commish/IntegrityFlagCard'
import IntegritySettings, { type IntegritySettingsValue } from '@/components/commish/IntegritySettings'
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-commish.css'

type IntegrityPayload = {
  settings?: IntegritySettingsValue
  openFlags?: IntegrityFlagRow[]
  recentDismissed?: IntegrityFlagRow[]
  stats?: {
    totalFlagsAllTime?: number
    openCollusion?: number
    openTanking?: number
    lastCollusionScanAt?: string | null
    lastTankingScanAt?: string | null
  }
  error?: string
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }

/**
 * Most severe first, then most recent. Matches the ranking principle 11a uses
 * for the cross-league queue: what a commissioner should look at next is decided
 * by severity, never by insertion order.
 */
function rankFlags(rows: IntegrityFlagRow[]): IntegrityFlagRow[] {
  return [...rows].sort((a, b) => {
    const sa = SEVERITY_RANK[a.severity?.trim().toLowerCase() ?? ''] ?? 2
    const sb = SEVERITY_RANK[b.severity?.trim().toLowerCase() ?? ''] ?? 2
    if (sa !== sb) return sa - sb
    return Date.parse(b.createdAt) - Date.parse(a.createdAt)
  })
}

export default function CommissionerIntegrityPage() {
  const params = useParams<{ leagueId: string }>() ?? ({} as { leagueId: string })
  const leagueId = params.leagueId
  const router = useRouter()
  const { hasAccess, loading: entLoading, upgradePath } = useEntitlement('commissioner_integrity_monitoring')
  const ok = hasAccess('commissioner_integrity_monitoring')

  const [tab, setTab] = useState<'open' | 'dismissed'>('open')
  const [payload, setPayload] = useState<IntegrityPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!ok) return
    setLoading(true)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/integrity`, { cache: 'no-store' })
      const json = (await res.json().catch(() => ({}))) as IntegrityPayload
      if (!res.ok) throw new Error(json.error ?? 'Failed to load')
      setPayload(json)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }, [leagueId, ok])

  useEffect(() => {
    void load()
  }, [load])

  const patchFlag = async (flag: IntegrityFlagRow, status: 'dismissed' | 'escalated') => {
    setBusy(true)
    try {
      const res = await fetch(
        `/api/leagues/${encodeURIComponent(leagueId)}/integrity/flags/${encodeURIComponent(flag.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        },
      )
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Update failed')
      toast.success(status === 'dismissed' ? 'Dismissed — written to the audit log.' : 'Escalated.')
      await load()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  const saveSettings = async (next: Record<string, unknown>) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/integrity`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      const json = (await res.json().catch(() => ({}))) as { settings?: IntegritySettingsValue; error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      if (json.settings) setPayload((p) => (p ? { ...p, settings: json.settings } : p))
      toast.success('Integrity settings saved.')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const openFlags = useMemo(() => rankFlags(payload?.openFlags ?? []), [payload])
  const dismissed = useMemo(() => rankFlags(payload?.recentDismissed ?? []), [payload])
  const list = tab === 'open' ? openFlags : dismissed

  const openCollusion = payload?.stats?.openCollusion ?? 0
  const openTanking = payload?.stats?.openTanking ?? 0

  if (entLoading) {
    return (
      <div className="af-core af-cm-shell">
        <div className="af-cm">
          <p className="af-cm-sub">Loading…</p>
        </div>
      </div>
    )
  }

  if (!ok) {
    return (
      <div className="af-core af-cm-shell">
        <div className="af-cm" style={{ maxWidth: 520 }}>
          <h1 className="af-cm-title">Integrity</h1>
          <p className="af-cm-sub" style={{ marginTop: 8 }}>
            Requires AF Commissioner — integrity monitoring entitlement.
          </p>
          <Link href={upgradePath} className="af-cm-foot-link" style={{ display: 'inline-block', marginTop: 14 }}>
            Upgrade →
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="af-core af-cm-shell">
      <div className="af-cm">
        <header className="af-cm-head">
          <div className="af-cm-head-titles">
            <h1 className="af-cm-title">Integrity</h1>
            <span className="af-cm-sub">League integrity monitor</span>
          </div>
          <div className="af-cm-head-actions">
            {/*
              The aggregate chip is the one place `--bad` is allowed on this page:
              the per-flag cards stay neutral at medium severity, but "there are
              three unresolved integrity questions in your league" is a single
              fact and it should be impossible to walk past.
            */}
            {openCollusion + openTanking > 0 ? (
              <span className="af-cm-headchip af-num" data-tone="bad">
                {openCollusion} open collusion &middot; {openTanking} open tanking
              </span>
            ) : (
              <span className="af-cm-headchip af-num" data-tone="good">
                <span className="af-cm-headchip-dot" aria-hidden />
                No open flags
              </span>
            )}
            <Link href={`/league/${leagueId}`} className="af-cm-sub">
              ← Back to league
            </Link>
          </div>
        </header>

        <div className="af-cm-body">
          <main>
            {/* Permanent. See the header note. */}
            <div className="af-cm-disclosure">
              <span className="af-cm-disclosure-mark" aria-hidden>
                ◆
              </span>
              <span>
                Signals come from trade values, lineup cards, waivers and on-field data. Chat is never read.
              </span>
              <button
                type="button"
                className="af-cm-help"
                style={{ marginLeft: 'auto' }}
                title="Detection reads trades, weekly lineup snapshots and standings only. Neither engine has access to league chat or direct messages."
                aria-label="How integrity detection works"
              >
                ?
              </button>
            </div>

            <div className="af-cm-flagcard-tags" style={{ marginBottom: 14 }}>
              <button
                type="button"
                className="af-cm-seg-btn"
                aria-pressed={tab === 'open'}
                onClick={() => setTab('open')}
              >
                Open flags ({openFlags.length})
              </button>
              <button
                type="button"
                className="af-cm-seg-btn"
                aria-pressed={tab === 'dismissed'}
                onClick={() => setTab('dismissed')}
              >
                Dismissed ({dismissed.length})
              </button>
            </div>

            {loading ? (
              <p className="af-cm-sub">Loading flags…</p>
            ) : list.length === 0 ? (
              <p className="af-cm-empty">
                {tab === 'open'
                  ? 'No open flags. The engines scan trades as they are accepted and lineups once a week.'
                  : 'Nothing dismissed recently.'}
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {list.map((f) => (
                  <IntegrityFlagCard
                    key={f.id}
                    flag={f}
                    busy={busy}
                    onEscalate={tab === 'open' ? (flag) => void patchFlag(flag, 'escalated') : undefined}
                    onDismiss={tab === 'open' ? (flag) => void patchFlag(flag, 'dismissed') : undefined}
                    /*
                     * Messaging is the league chat's job, not a second composer
                     * built here. Routing to it keeps one send path — the same
                     * reason 11a's "Send @everyone" is an entry point into the
                     * broadcast flow rather than a reimplementation of it.
                     *
                     * Deep-links straight to the chat tab. `/app/league/*` is now
                     * only a redirect shim to `/league/*`, so pointing there cost
                     * an extra hop and landed on the league home rather than the
                     * conversation the commissioner was told to start.
                     */
                    onMessage={
                      tab === 'open'
                        ? () => router.push(`/league/${encodeURIComponent(leagueId)}?view=league_chat`)
                        : undefined
                    }
                  />
                ))}
              </div>
            )}
          </main>

          <aside className="af-cm-rail">
            {payload?.settings ? (
              <IntegritySettings value={payload.settings} saving={saving} onSave={saveSettings} />
            ) : loading ? (
              <p className="af-cm-sub">Loading settings…</p>
            ) : (
              <p className="af-cm-empty">Settings unavailable.</p>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}
