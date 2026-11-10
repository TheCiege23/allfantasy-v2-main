'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Copy, ChevronLeft, RefreshCw, MessageSquare, Sparkles, Lock, Palette, Scale, FileText, ChevronDown, Trophy, ArrowRight, AlertTriangle } from 'lucide-react'
import { useUserTimezone } from '@/hooks/useUserTimezone'
import { BubbleResolutionModal } from '@/components/tournament/BubbleResolutionModal'

interface LeagueRow {
  tournamentLeagueId: string
  leagueId: string
  leagueName: string
  conferenceName: string
  roundIndex: number
  phase: string
  inviteCode: string | null
  joinUrl: string | null
  leagueSize: number | null
  rosterCount?: number
  fillStatus?: 'full' | 'partial' | 'empty'
}

interface ControlData {
  tournamentId: string
  tournamentName: string
  leagues: LeagueRow[]
}

const AI_TYPES = [
  { value: 'weekly_recap', label: 'Weekly recap' },
  { value: 'standings_analysis', label: 'Standings analysis' },
  { value: 'bubble_watch', label: 'Bubble watch' },
  { value: 'draft_prep', label: 'Draft prep' },
  { value: 'commissioner_assistant', label: 'Commissioner assistant' },
  { value: 'bracket_preview', label: 'Bracket preview' },
] as const

export function TournamentControlDashboard({
  tournamentId,
  hideLocalBackLink = false,
}: {
  tournamentId: string
  /** When embedded in Tournament Commissioner Dashboard, skip duplicate nav to tournament hub. */
  hideLocalBackLink?: boolean
}) {
  const { formatInTimezone } = useUserTimezone()
  const [data, setData] = useState<ControlData | null>(null)
  const [loading, setLoading] = useState(true)
  const [regenerating, setRegenerating] = useState<string | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiType, setAiType] = useState<string>('standings_analysis')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiText, setAiText] = useState('')
  const [posting, setPosting] = useState(false)
  const [locking, setLocking] = useState(false)
  const [rebalancing, setRebalancing] = useState(false)
  const [auditLogs, setAuditLogs] = useState<Array<{ id: string; action: string; actorId: string | null; createdAt: string; metadata?: unknown }>>([])
  const [auditOpen, setAuditOpen] = useState(false)
  const [themeOpen, setThemeOpen] = useState(false)
  const [themeBannerUrl, setThemeBannerUrl] = useState('')
  const [themePack, setThemePack] = useState('default')
  const [themeSaving, setThemeSaving] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [bubbleOpen, setBubbleOpen] = useState(false)
  const [condensing, setCondensing] = useState(false)
  const [condenseResult, setCondenseResult] = useState<string | null>(null)
  const [crowning, setCrowning] = useState(false)
  const [crownResult, setCrownResult] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/tournament/${encodeURIComponent(tournamentId)}/control`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to load')
      const json = await res.json()
      setData(json)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [tournamentId])

  useEffect(() => {
    void load()
  }, [load])

  async function regenerateInvite(leagueId: string) {
    setRegenerating(leagueId)
    try {
      const res = await fetch(`/api/tournament/${encodeURIComponent(tournamentId)}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId }),
      })
      const json = await res.json()
      if (res.ok && data) {
        setData({
          ...data,
          leagues: data.leagues.map((l) =>
            l.leagueId === leagueId
              ? { ...l, inviteCode: json.inviteCode, joinUrl: json.joinUrl }
              : l
          ),
        })
      }
    } finally {
      setRegenerating(null)
    }
  }

  function copyUrl(url: string | null) {
    if (!url) return
    navigator.clipboard.writeText(url)
    // Could add toast
  }

  if (loading || !data) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center text-white/60">
        Loading…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {!hideLocalBackLink ? (
        <div className="mb-6 flex flex-wrap items-center gap-4">
          <Link
            href={`/tournament/${tournamentId}`}
            className="inline-flex items-center gap-2 text-sm text-white/70 hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" /> Tournament
          </Link>
        </div>
      ) : null}

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">Invite links</h2>
        <p className="mb-4 text-sm text-white/60">
          Share the join link for each league. Regenerate to create a new invite code.
        </p>
        <div className="space-y-3">
          {data.leagues.map((row) => (
            <div
              key={row.tournamentLeagueId}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3"
            >
              {/* The name keeps at least 14rem: at 820 the three actions beside it squeezed "Gridiron South of the
                  Mississippi" onto three lines. Now the actions wrap below instead (tournament gaps audit item 6). */}
              <div className="min-w-0 flex-1 basis-56">
                <div className="font-medium text-white">{row.leagueName}</div>
                <div className="text-xs text-white/50">
                  {/* roundIndex is 0-based; people count rounds from 1 ("Round 0" was the first round). */}
                  {row.conferenceName} · Round {row.roundIndex + 1}
                  {row.rosterCount != null && row.leagueSize != null && (
                    <span className="ml-2">
                      Fill: {row.rosterCount}/{row.leagueSize}
                      {row.fillStatus === 'full' && <span className="text-emerald-400"> · Full</span>}
                      {row.fillStatus === 'partial' && <span className="text-amber-400"> · Partial</span>}
                      {row.fillStatus === 'empty' && <span className="text-white/50"> · Empty</span>}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {row.joinUrl ? (
                  <>
                    <button
                      type="button"
                      onClick={() => copyUrl(row.joinUrl)}
                      className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white/80 hover:bg-white/10"
                    >
                      <Copy className="h-3.5 w-3.5" /> Copy link
                    </button>
                    <button
                      type="button"
                      onClick={() => regenerateInvite(row.leagueId)}
                      disabled={regenerating === row.leagueId}
                      className="inline-flex items-center gap-1 rounded-lg border border-amber-500/20 bg-amber-950/20 px-2.5 py-1.5 text-xs text-amber-200 hover:bg-amber-950/40 disabled:opacity-50"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${regenerating === row.leagueId ? 'animate-spin' : ''}`} /> Regenerate
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => regenerateInvite(row.leagueId)}
                    disabled={regenerating === row.leagueId}
                    className="inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-600/20 px-2.5 py-1.5 text-xs text-amber-200"
                  >
                    Generate invite
                  </button>
                )}
              </div>
              <Link
                href={`/league/${row.leagueId}`}
                className="text-xs text-amber-400 hover:text-amber-300"
              >
                Open league →
              </Link>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-white">
          <MessageSquare className="h-5 w-5 text-amber-400" /> Announcements
        </h2>
        <p className="mb-4 text-sm text-white/60">
          Create hub announcements. Use AI to generate copy from current standings and rules, then post.
        </p>
        <button
          type="button"
          onClick={() => { setAiOpen(true); setAiText('') }}
          className="inline-flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-2.5 text-sm font-medium text-amber-200 hover:bg-amber-950/40"
        >
          <Sparkles className="h-4 w-4" /> Generate with AI
        </button>
        <Link
          href={`/tournament/${tournamentId}`}
          className="ml-3 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white/80 hover:bg-white/10"
        >
          View hub announcements
        </Link>

        {aiOpen && (
          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <select
                value={aiType}
                onChange={(e) => setAiType(e.target.value)}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
              >
                {AI_TYPES.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <button
                type="button"
                disabled={aiLoading}
                onClick={async () => {
                  setAiLoading(true)
                  setAiText('')
                  try {
                    const res = await fetch(`/api/tournament/${encodeURIComponent(tournamentId)}/ai`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ type: aiType }),
                    })
                    const json = await res.json()
                    if (res.ok && json.text) setAiText(json.text)
                    else setAiText(json.error ?? 'Generation failed')
                  } catch {
                    setAiText('Request failed')
                  } finally {
                    setAiLoading(false)
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-950/30 px-3 py-2 text-sm text-amber-200 disabled:opacity-50"
              >
                {aiLoading ? 'Generating…' : 'Generate'}
              </button>
              <button
                type="button"
                onClick={() => setAiOpen(false)}
                className="rounded-lg border border-white/10 px-3 py-2 text-sm text-white/70 hover:bg-white/10"
              >
                Close
              </button>
            </div>
            {aiText && (
              <>
                <textarea
                  readOnly
                  value={aiText}
                  rows={6}
                  className="mb-2 w-full rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/90"
                />
                <button
                  type="button"
                  disabled={posting}
                  onClick={async () => {
                    setPosting(true)
                    try {
                      const res = await fetch(`/api/tournament/${encodeURIComponent(tournamentId)}/announcements`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ body: aiText, type: 'general' }),
                      })
                      if (res.ok) {
                        setAiText('')
                        setAiOpen(false)
                      }
                    } finally {
                      setPosting(false)
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-600/30 px-3 py-2 text-sm text-amber-200 disabled:opacity-50"
                >
                  {posting ? 'Posting…' : 'Post as announcement'}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-white">
          <Lock className="h-5 w-5 text-amber-400" /> Admin &amp; safety
        </h2>
        <p className="mb-4 text-sm text-white/60">
          Lock tournament when competition starts (no rebalance after). Rebalance before lock if needed. Set theme/banner for hub and child leagues.
        </p>
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={locking}
            onClick={async () => {
              if (!confirm('Lock tournament? No rebalance or invite changes after this.')) return
              setLocking(true)
              try {
                const res = await fetch(`/api/tournament/${encodeURIComponent(tournamentId)}/lock`, { method: 'POST' })
                const json = await res.json()
                if (res.ok) alert('Tournament locked.')
                else alert(json.error ?? 'Failed')
              } finally {
                setLocking(false)
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-950/30 px-4 py-2.5 text-sm font-medium text-amber-200 disabled:opacity-50"
          >
            <Lock className="h-4 w-4" /> Lock tournament
          </button>
          <button
            type="button"
            disabled={rebalancing}
            onClick={async () => {
              setRebalancing(true)
              try {
                const res = await fetch(`/api/tournament/${encodeURIComponent(tournamentId)}/rebalance`, { method: 'POST' })
                const json = await res.json()
                if (res.ok) {
                  alert(`Rebalance recorded. Fill status: ${JSON.stringify(json.fillStatus?.length ?? 0)} leagues.`)
                  load()
                } else alert(json.error ?? 'Failed')
              } finally {
                setRebalancing(false)
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm text-white/90 hover:bg-white/10 disabled:opacity-50"
          >
            <Scale className="h-4 w-4" /> Rebalance check
          </button>
          <button
            type="button"
            onClick={() => { setThemeOpen(!themeOpen); if (!themeOpen) fetch(`/api/tournament/${encodeURIComponent(tournamentId)}/theme`).then(r => r.json()).then(d => { setThemeBannerUrl(d.theme?.bannerUrl ?? ''); setThemePack(d.theme?.themePack ?? 'default') }) }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm text-white/90 hover:bg-white/10"
          >
            <Palette className="h-4 w-4" /> Theme &amp; banner
          </button>
          <button
            type="button"
            onClick={async () => {
              setAuditOpen(!auditOpen)
              if (!auditOpen && auditLogs.length === 0) {
                const res = await fetch(`/api/tournament/${encodeURIComponent(tournamentId)}/audit?limit=50`)
                const json = await res.json()
                if (res.ok) setAuditLogs(json.logs ?? [])
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm text-white/90 hover:bg-white/10"
          >
            <FileText className="h-4 w-4" /> View audit log
          </button>
        </div>

        {themeOpen && (
          <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <label className="mb-2 block text-sm text-white/70">Banner URL</label>
            <input
              type="url"
              value={themeBannerUrl}
              onChange={(e) => setThemeBannerUrl(e.target.value)}
              className="mb-3 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
              placeholder="https://..."
            />
            <label className="mb-2 block text-sm text-white/70">Theme pack</label>
            <select
              value={themePack}
              onChange={(e) => setThemePack(e.target.value)}
              className="mb-3 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
            >
              <option value="default">Default</option>
              <option value="tribal">Tribal</option>
              <option value="jungle">Jungle</option>
              <option value="torch">Torch</option>
              <option value="sand">Sand</option>
              <option value="battle">Battle</option>
            </select>
            <button
              type="button"
              disabled={themeSaving}
              onClick={async () => {
                setThemeSaving(true)
                try {
                  const res = await fetch(`/api/tournament/${encodeURIComponent(tournamentId)}/theme`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ bannerUrl: themeBannerUrl || undefined, themePack }),
                  })
                  if (res.ok) setThemeOpen(false)
                  else alert((await res.json()).error ?? 'Failed')
                } finally {
                  setThemeSaving(false)
                }
              }}
              className="rounded-lg border border-amber-500/40 bg-amber-600/30 px-4 py-2 text-sm text-amber-200 disabled:opacity-50"
            >
              {themeSaving ? 'Saving…' : 'Save theme'}
            </button>
          </div>
        )}

        {auditOpen && (
          <div className="mb-4 max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <h3 className="mb-2 text-sm font-medium text-white/90">Audit log</h3>
            {auditLogs.length === 0 && <p className="text-xs text-white/50">No entries or loading…</p>}
            <ul className="space-y-1.5 text-xs">
              {auditLogs.map((log) => (
                <li key={log.id} className="flex flex-wrap gap-2 rounded border border-white/5 px-2 py-1.5 text-white/80">
                  <span className="font-medium">{log.action}</span>
                  <span className="text-white/50">{formatInTimezone(log.createdAt)}</span>
                  {log.actorId && <span className="text-white/40">by {log.actorId.slice(0, 8)}…</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <button
          type="button"
          onClick={() => setAdvancedOpen(!advancedOpen)}
          className="inline-flex items-center gap-2 text-sm text-white/70 hover:text-white"
        >
          <ChevronDown className={`h-4 w-4 transition ${advancedOpen ? 'rotate-180' : ''}`} /> Advanced tools
        </button>
        {advancedOpen && (
          <ul className="mt-2 space-y-1 text-sm text-white/70">
            <li><Link href={`/app/tournament/${tournamentId}/control?action=force-advance`} className="hover:text-amber-400">Force advance participant</Link> (API: POST /api/tournament/[id]/force-advance)</li>
            <li><Link href={`/app/tournament/${tournamentId}/control?action=tie-resolution`} className="hover:text-amber-400">Manual tie resolution</Link> (API: POST /api/tournament/[id]/tie-resolution)</li>
            <li><Link href={`/app/tournament/${tournamentId}/control?action=archive-round`} className="hover:text-amber-400">Archive round</Link> (API: POST /api/tournament/[id]/archive-round)</li>
            <li><Link href={`/tournament/${tournamentId}`} className="hover:text-amber-400">Champion path</Link> (API: GET /api/tournament/[id]/champion-path)</li>
            <li><Link href={`/app/tournament/${tournamentId}/control?action=resolve-state`} className="hover:text-amber-400">Resolve invalid state</Link> (API: POST /api/tournament/[id]/resolve-state)</li>
            <li>Redraft regenerate (API: POST /api/tournament/[id]/redraft/regenerate)</li>
            <li>Draft reopen (API: POST /api/tournament/[id]/draft/reopen)</li>
            <li>Bulk update names/theme (API: POST /api/tournament/[id]/bulk-update)</li>
            <li>Create missing league (API: POST /api/tournament/[id]/create-missing-league)</li>
          </ul>
        )}
      </div>

      {/* Round progression controls */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-white">
          <ArrowRight className="h-5 w-5 text-cyan-400" /> Round Progression
        </h2>
        <p className="mb-4 text-sm text-white/60">
          Advance the tournament to the next round. This condenses surviving teams into fewer leagues, triggers a redraft, resets FAAB, and adjusts bench spots.
        </p>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setBubbleOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-2.5 text-sm font-medium text-amber-200 hover:bg-amber-950/40"
          >
            <AlertTriangle className="h-4 w-4" /> Resolve bubble
          </button>

          <button
            type="button"
            disabled={condensing}
            onClick={async () => {
              const perLeague = prompt('How many teams advance per league this round?', '4')
              if (!perLeague) return
              const count = parseInt(perLeague, 10)
              if (isNaN(count) || count < 1) { alert('Invalid number'); return }
              if (!confirm(`Advance top ${count} per league to the next round? This creates new leagues and schedules redrafts.`)) return
              setCondensing(true)
              setCondenseResult(null)
              try {
                const res = await fetch(`/api/tournament/${encodeURIComponent(tournamentId)}/advance`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ advancementPerLeague: count }),
                })
                const json = await res.json()
                if (res.ok) {
                  setCondenseResult(`Round ${json.newRoundIndex} created (${json.phase}). ${json.advanced} advanced, ${json.eliminated} eliminated. ${json.leagueIds?.length ?? 0} new league(s).`)
                  load()
                } else {
                  setCondenseResult(`Error: ${json.error ?? 'Failed'}`)
                }
              } catch (e) {
                setCondenseResult(`Error: ${e instanceof Error ? e.message : 'Request failed'}`)
              } finally {
                setCondensing(false)
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-500/30 bg-cyan-950/20 px-4 py-2.5 text-sm font-medium text-cyan-200 hover:bg-cyan-950/40 disabled:opacity-50"
          >
            {condensing ? 'Advancing...' : <><ArrowRight className="h-4 w-4" /> Advance round</>}
          </button>

          <button
            type="button"
            disabled={crowning}
            onClick={async () => {
              if (!confirm('Crown the champion? This locks the tournament permanently. Only do this when the championship league season is complete.')) return
              setCrowning(true)
              setCrownResult(null)
              try {
                const res = await fetch(`/api/tournament/${encodeURIComponent(tournamentId)}/crown`, {
                  method: 'POST',
                })
                const json = await res.json()
                if (res.ok) {
                  setCrownResult(`${json.championTeamName} is the champion of ${json.tournamentName}!`)
                  load()
                } else {
                  setCrownResult(`Error: ${json.error ?? 'Failed'}`)
                }
              } catch (e) {
                setCrownResult(`Error: ${e instanceof Error ? e.message : 'Request failed'}`)
              } finally {
                setCrowning(false)
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-yellow-500/40 bg-yellow-950/20 px-4 py-2.5 text-sm font-medium text-yellow-200 hover:bg-yellow-950/40 disabled:opacity-50"
          >
            {crowning ? 'Crowning...' : <><Trophy className="h-4 w-4" /> Crown champion</>}
          </button>
        </div>

        {condenseResult && (
          <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${condenseResult.startsWith('Error') ? 'border-red-500/20 bg-red-950/30 text-red-300' : 'border-emerald-500/20 bg-emerald-950/30 text-emerald-300'}`}>
            {condenseResult}
          </div>
        )}
        {crownResult && (
          <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${crownResult.startsWith('Error') ? 'border-red-500/20 bg-red-950/30 text-red-300' : 'border-yellow-500/20 bg-yellow-950/30 text-yellow-200'}`}>
            {crownResult.startsWith('Error') ? crownResult : `🏆 ${crownResult}`}
          </div>
        )}
      </div>

      <BubbleResolutionModal
        tournamentId={tournamentId}
        open={bubbleOpen}
        onClose={() => setBubbleOpen(false)}
        onResolved={() => load()}
      />
    </div>
  )
}
