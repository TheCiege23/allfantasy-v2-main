'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Briefcase, GraduationCap, Loader2, CheckCircle2 } from 'lucide-react'
import {
  IMPORT_PROVIDERS,
  type ImportProvider,
  type C2CImportSide,
} from '@/lib/league-import/types'

const PRO_PROVIDERS: ImportProvider[] = ['sleeper', 'espn', 'yahoo', 'fleaflicker', 'mfl']
const COLLEGE_PROVIDERS: ImportProvider[] = ['fantrax']

type Depth = 'all' | number

interface SourceFormState {
  provider: ImportProvider
  sourceId: string
  depth: Depth
}

interface MergedPlayerInfoClient {
  playerId: string
  name: string
  position: string
  team: string
}

interface PreviewResult {
  merged: Array<{
    mergedKey: string
    displayName: string
    proTeamName: string | null
    collegeTeamName: string | null
    proPlayers: MergedPlayerInfoClient[]
    collegePlayers: MergedPlayerInfoClient[]
  }>
  unmatched: {
    pro: Array<{ source_team_id: string; owner_name: string; team_name: string }>
    college: Array<{ source_team_id: string; owner_name: string; team_name: string }>
  }
  summary: {
    proManagers: number
    collegeManagers: number
    merged: number
    unmatchedPro: number
    unmatchedCollege: number
  }
}

function SourceCard({
  side,
  state,
  onChange,
  allowedProviders,
}: {
  side: C2CImportSide
  state: SourceFormState
  onChange: (next: SourceFormState) => void
  allowedProviders: ImportProvider[]
}) {
  const Icon = side === 'pro' ? Briefcase : GraduationCap
  const accent = side === 'pro' ? 'border-amber-500/40 bg-amber-500/[0.06]' : 'border-emerald-500/40 bg-emerald-500/[0.06]'
  const label = side === 'pro' ? 'Pro source (NFL / NBA)' : 'College source (NCAAF / NCAAB)'
  return (
    <div className={`rounded-2xl border p-4 ${accent}`}>
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-5 w-5" />
        <p className="text-sm font-semibold uppercase tracking-[0.14em]">{label}</p>
      </div>
      <label className="block text-[12px]">
        <span className="text-white/55">Provider</span>
        <select
          className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-white"
          value={state.provider}
          onChange={(e) => onChange({ ...state, provider: e.target.value as ImportProvider })}
        >
          {allowedProviders.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <label className="mt-3 block text-[12px]">
        <span className="text-white/55">Source league id</span>
        <input
          type="text"
          placeholder="e.g. 1234567890"
          value={state.sourceId}
          onChange={(e) => onChange({ ...state, sourceId: e.target.value })}
          className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-white"
        />
      </label>
      <div className="mt-3 block text-[12px]">
        <span className="text-white/55">Roster depth</span>
        <div className="mt-1 flex items-center gap-2">
          <label className="inline-flex items-center gap-1">
            <input
              type="radio"
              checked={state.depth === 'all'}
              onChange={() => onChange({ ...state, depth: 'all' })}
            />
            <span>All</span>
          </label>
          <label className="inline-flex items-center gap-1">
            <input
              type="radio"
              checked={state.depth !== 'all'}
              onChange={() => onChange({ ...state, depth: 15 })}
            />
            <span>First</span>
          </label>
          <input
            type="number"
            min={1}
            max={60}
            disabled={state.depth === 'all'}
            value={state.depth === 'all' ? '' : state.depth}
            onChange={(e) => onChange({ ...state, depth: Math.max(1, Number(e.target.value) || 1) })}
            className="w-16 rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-center text-white disabled:opacity-40"
          />
          <span className="text-white/45">spots per team</span>
        </div>
      </div>
    </div>
  )
}

type CommitSport = 'NFL' | 'NBA'
type CommitDraftType = 'c2c_snake' | 'c2c_linear' | 'c2c_auction'

export function C2CImportClient() {
  const router = useRouter()
  const [pro, setPro] = useState<SourceFormState>({ provider: 'sleeper', sourceId: '', depth: 'all' })
  const [college, setCollege] = useState<SourceFormState>({
    provider: 'fantrax',
    sourceId: '',
    depth: 'all',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [manualMap, setManualMap] = useState<Record<string, string>>({})
  const [leagueName, setLeagueName] = useState('')
  const [sport, setSport] = useState<CommitSport>('NFL')
  const [draftType, setDraftType] = useState<CommitDraftType>('c2c_snake')
  const [committing, setCommitting] = useState(false)
  const [committed, setCommitted] = useState<{
    leagueId: string
    rostersCreated: number
    joinCode: string | null
    joinUrl: string | null
  } | null>(null)
  const [copied, setCopied] = useState(false)

  const canSubmit = pro.sourceId.trim() && college.sourceId.trim() && !loading

  const buildSources = () => [
    { side: 'pro' as const, provider: pro.provider, sourceId: pro.sourceId.trim(), rosterDepth: pro.depth },
    {
      side: 'college' as const,
      provider: college.provider,
      sourceId: college.sourceId.trim(),
      rosterDepth: college.depth,
    },
  ]

  const submit = async () => {
    setLoading(true)
    setError(null)
    setPreview(null)
    setCommitted(null)
    setManualMap({})
    try {
      const res = await fetch('/api/leagues/import/c2c-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sources: buildSources() }),
      })
      const body = (await res.json().catch(() => ({}))) as PreviewResult & { error?: string }
      if (!res.ok) {
        setError(body.error ?? 'Preview failed')
      } else {
        setPreview(body)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed')
    } finally {
      setLoading(false)
    }
  }

  const remap = async () => {
    if (!preview) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/leagues/import/c2c-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sources: buildSources(), manualManagerMap: manualMap }),
      })
      const body = (await res.json().catch(() => ({}))) as PreviewResult & { error?: string }
      if (!res.ok) setError(body.error ?? 'Re-preview failed')
      else setPreview(body)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Re-preview failed')
    } finally {
      setLoading(false)
    }
  }

  const commit = async () => {
    if (!preview || preview.merged.length === 0) return
    if (!leagueName.trim()) {
      setError('League name is required before commit.')
      return
    }
    setCommitting(true)
    setError(null)
    try {
      const res = await fetch('/api/leagues/import/c2c-commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          sources: buildSources(),
          manualManagerMap: manualMap,
          leagueName: leagueName.trim(),
          sport,
          draftType,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        leagueId?: string
        rostersCreated?: number
        joinCode?: string | null
        joinUrl?: string | null
        error?: string
      }
      if (!res.ok || !body.leagueId) {
        setError(body.error ?? 'Commit failed')
      } else {
        setCommitted({
          leagueId: body.leagueId,
          rostersCreated: body.rostersCreated ?? 0,
          joinCode: body.joinCode ?? null,
          joinUrl: body.joinUrl ?? null,
        })
        // Don't auto-redirect — commissioner needs the invite link first.
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Commit failed')
    } finally {
      setCommitting(false)
    }
  }

  const validProviders = IMPORT_PROVIDERS

  return (
    <div className="min-h-screen bg-[#040915] px-4 py-8 text-white">
      <div className="mx-auto max-w-4xl space-y-6">
        <header>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-200/80">
            C2C Import · Multi-source
          </p>
          <h1 className="mt-1 text-2xl font-black">Import a Campus to Canton league</h1>
          <p className="mt-2 max-w-2xl text-sm text-white/60">
            Import pro rosters from one platform (Sleeper, ESPN, Yahoo…) and college rosters from
            another (Fantrax). We match managers by email and display name. You can cap how many
            roster spots to bring in from each side before committing.
          </p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          <SourceCard side="pro" state={pro} onChange={setPro} allowedProviders={PRO_PROVIDERS.filter((p) => validProviders.includes(p))} />
          <SourceCard
            side="college"
            state={college}
            onChange={setCollege}
            allowedProviders={COLLEGE_PROVIDERS.filter((p) => validProviders.includes(p))}
          />
        </div>

        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit}
          className="inline-flex items-center gap-2 rounded-full bg-sky-500 px-5 py-2 text-sm font-semibold text-white shadow disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Preview merge
        </button>

        {error && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        )}

        {preview && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                ['Pro managers', preview.summary.proManagers],
                ['College managers', preview.summary.collegeManagers],
                ['Merged', preview.summary.merged],
                ['Unmatched pro', preview.summary.unmatchedPro],
                ['Unmatched college', preview.summary.unmatchedCollege],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-white/50">{label}</p>
                  <p className="mt-1 text-xl font-black">{value}</p>
                </div>
              ))}
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold">Merged managers</p>
              <div className="space-y-2">
                {preview.merged.map((m) => (
                  <div
                    key={m.mergedKey}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm"
                  >
                    <span className="font-semibold text-white">{m.displayName}</span>
                    <span className="text-xs text-white/55">
                      {m.proTeamName ?? '—'} ({m.proPlayers.length}) ·{' '}
                      {m.collegeTeamName ?? '—'} ({m.collegePlayers.length})
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {preview.unmatched.pro.length > 0 && preview.unmatched.college.length > 0 && (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.04] p-4">
                <p className="mb-2 text-sm font-semibold text-amber-200">
                  Manual mapping — pair unmatched pro managers to their college counterparts
                </p>
                <p className="mb-3 text-[11px] text-amber-100/70">
                  Name match didn’t pick these up. Pair them here, then click “Re-preview” to roll
                  the overrides into the merge before committing.
                </p>
                <div className="space-y-2">
                  {preview.unmatched.pro.map((p) => (
                    <div
                      key={`map-${p.source_team_id}`}
                      className="flex flex-wrap items-center gap-2 text-[12px]"
                    >
                      <span className="min-w-[180px] text-white/85">
                        {p.owner_name}{' '}
                        <span className="text-white/45">({p.team_name})</span>
                      </span>
                      <span className="text-white/45">→</span>
                      <select
                        value={manualMap[p.source_team_id] ?? ''}
                        onChange={(e) =>
                          setManualMap((prev) => {
                            const next = { ...prev }
                            if (e.target.value) next[p.source_team_id] = e.target.value
                            else delete next[p.source_team_id]
                            return next
                          })
                        }
                        className="rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-white"
                      >
                        <option value="">— unmapped —</option>
                        {preview.unmatched.college.map((c) => (
                          <option key={c.source_team_id} value={c.source_team_id}>
                            {c.owner_name} ({c.team_name})
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => void remap()}
                  disabled={loading || Object.keys(manualMap).length === 0}
                  className="mt-3 inline-flex items-center gap-2 rounded-full border border-amber-400/50 bg-amber-400/10 px-4 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-400/20 disabled:opacity-40"
                >
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Re-preview with mappings
                </button>
              </div>
            )}

            {preview.merged.length > 0 && (
              <div className="rounded-2xl border border-sky-500/30 bg-sky-500/[0.04] p-4">
                <p className="mb-3 text-sm font-semibold text-sky-200">Commit to a new C2C league</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-[12px]">
                    <span className="text-white/55">League name</span>
                    <input
                      type="text"
                      value={leagueName}
                      onChange={(e) => setLeagueName(e.target.value)}
                      placeholder="e.g. Campus to Canton Dynasty"
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-white"
                    />
                  </label>
                  <label className="block text-[12px]">
                    <span className="text-white/55">Primary sport</span>
                    <select
                      value={sport}
                      onChange={(e) => setSport(e.target.value as CommitSport)}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-white"
                    >
                      <option value="NFL">NFL (+ NCAAF)</option>
                      <option value="NBA">NBA (+ NCAAB)</option>
                    </select>
                  </label>
                  <label className="block text-[12px]">
                    <span className="text-white/55">Startup draft type</span>
                    <select
                      value={draftType}
                      onChange={(e) => setDraftType(e.target.value as CommitDraftType)}
                      className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-white"
                    >
                      <option value="c2c_snake">Snake</option>
                      <option value="c2c_linear">Linear</option>
                      <option value="c2c_auction">Auction</option>
                    </select>
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => void commit()}
                  disabled={committing || !leagueName.trim() || preview.merged.length === 0}
                  className="mt-4 inline-flex items-center gap-2 rounded-full bg-sky-500 px-5 py-2 text-sm font-semibold text-white shadow disabled:opacity-40"
                >
                  {committing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Commit {preview.merged.length} manager{preview.merged.length === 1 ? '' : 's'}
                </button>
              </div>
            )}

            {committed && (
              <div className="space-y-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/[0.06] p-4 text-sm text-emerald-100">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>
                    League created with {committed.rostersCreated} placeholder roster
                    {committed.rostersCreated === 1 ? '' : 's'}.
                  </span>
                </div>
                {committed.joinUrl && (
                  <div className="space-y-2 rounded-xl border border-emerald-400/30 bg-black/20 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-200/80">
                      Share this invite link — managers claim their imported rosters by joining
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 truncate rounded bg-black/40 px-2 py-1 font-mono text-[12px] text-white">
                        {committed.joinUrl}
                      </code>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(committed.joinUrl!)
                          setCopied(true)
                          setTimeout(() => setCopied(false), 1500)
                        }}
                        className="shrink-0 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-100 hover:bg-emerald-400/20"
                      >
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    {committed.joinCode && (
                      <p className="text-[11px] text-emerald-100/70">
                        Code: <span className="font-mono text-white">{committed.joinCode}</span>
                      </p>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => router.push(`/league/${encodeURIComponent(committed.leagueId)}`)}
                  className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-white shadow hover:bg-emerald-400"
                >
                  Open league →
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
