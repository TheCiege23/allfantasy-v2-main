'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bot, CheckCircle2, Loader2, Lock, Search, UserPlus, Users } from 'lucide-react'
import { toast } from 'sonner'
import { SubscriptionGateBadge } from '@/components/subscription/SubscriptionGateBadge'
import { SubscriptionGateModal } from '@/components/subscription/SubscriptionGateModal'
import type { SubscriptionFeatureId } from '@/lib/subscription/types'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
import { useEntitlements } from '@/hooks/useEntitlements'
import { useSubscriptionGateOptional } from '@/hooks/useSubscriptionGate'

type OrphanTeamCard = {
  id: string
  leagueId: string
  rosterId: string
  teamName: string
  leagueName: string
  leagueType: string
  sport: string
  record: { wins: number; losses: number; ties: number }
  scoringFormat: string
  rosterPreview: string[]
  draftPicksOwned: string[]
  commissionerApprovalRequired: boolean
  commissionerName: string
  memberCount: number
  aiEvaluationPreview: string
  myRequestStatus: 'pending' | 'approved' | 'rejected' | null
}

type OrphanDiscoverResponse = {
  ok?: boolean
  cards?: OrphanTeamCard[]
  pagination?: {
    page: number
    limit: number
    total: number
    hasMore: boolean
  }
  error?: string
}

function buildStatusBadge(status: OrphanTeamCard['myRequestStatus']) {
  if (status === 'pending') return { label: 'Request pending', className: 'bg-amber-500/20 text-amber-200' }
  if (status === 'approved') return { label: 'Approved', className: 'bg-emerald-500/20 text-emerald-200' }
  if (status === 'rejected') return { label: 'Declined', className: 'bg-red-500/20 text-red-200' }
  return null
}

type OrphanedTeamsApiResponse = {
  orphanedTeams: {
    rosterId: string
    teamName: string
    playerCount: number
    draftPickCount: number
    faabRemaining: number
  }[]
  orphanCount: number
  hasActiveDispersalDraft: boolean
  activeDispersalDraftId: string | null
  canAdvertise: boolean
  canAssignAI: boolean
  canRunDispersalDraft: boolean
  dispersalDraftGated: boolean
}

function CommissionerLeagueOrphanPanel({ leagueId }: { leagueId: string }) {
  const router = useRouter()
  const { hasCommissioner } = useEntitlements()
  const gateCtx = useSubscriptionGateOptional()

  const [data, setData] = useState<OrphanedTeamsApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [advertiseIds, setAdvertiseIds] = useState<Set<string>>(new Set())
  const [aiIds, setAiIds] = useState<Set<string>>(new Set())
  const [aiType, setAiType] = useState<'season_long' | 'until_claimed'>('season_long')
  const [busy, setBusy] = useState<string | null>(null)
  const [localGate, setLocalGate] = useState<SubscriptionFeatureId | null>(null)

  const openGate = (featureId: SubscriptionFeatureId) => {
    gateCtx?.gate(featureId) ?? setLocalGate(featureId)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/orphaned-teams`, { cache: 'no-store' })
      const json = (await res.json().catch(() => ({}))) as OrphanedTeamsApiResponse & { error?: string }
      if (!res.ok) throw new Error(json?.error ?? 'Could not load orphaned teams.')
      setData(json)
      const all = new Set(json.orphanedTeams.map((t) => t.rosterId))
      setAdvertiseIds(all)
      setAiIds(all)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not load orphaned teams.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    void load()
  }, [load])

  const postAdvertise = async () => {
    const rosterIds = [...advertiseIds]
    if (rosterIds.length === 0) {
      toast.error('Select at least one team.')
      return
    }
    setBusy('advertise')
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/orphaned-teams/advertise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rosterIds }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((json as { error?: string }).error ?? 'Advertise failed')
      toast.success('Teams posted to Find-a-League.')
      await load()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Advertise failed')
    } finally {
      setBusy(null)
    }
  }

  const postAi = async () => {
    const rosterIds = [...aiIds]
    if (rosterIds.length === 0) {
      toast.error('Select at least one team.')
      return
    }
    setBusy('ai')
    try {
      for (const rosterId of rosterIds) {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/orphaned-teams/assign-ai`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rosterId, aiManagerType: aiType }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error((json as { error?: string }).error ?? 'AI assign failed')
      }
      toast.success('AI manager assigned.')
      await load()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'AI assign failed')
    } finally {
      setBusy(null)
    }
  }

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-[#080f1f] px-4 py-8 text-sm text-white/60">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading league orphaned teams…
      </div>
    )
  }

  if (!data) return null

  const orphanCount = data.orphanCount
  const isDisabled = orphanCount < 2
  const isGated = data.dispersalDraftGated || !hasCommissioner
  const canLaunchDispersalDraft = !isGated && data.canRunDispersalDraft

  const toggle = (set: Dispatch<SetStateAction<Set<string>>>, id: string) => {
    set((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-4" data-testid="commissioner-orphan-league-panel">
      {localGate && !gateCtx ? (
        <SubscriptionGateModal
          isOpen={Boolean(localGate)}
          onClose={() => setLocalGate(null)}
          featureId={localGate}
        />
      ) : null}

      <div className="rounded-2xl border border-amber-500/15 bg-[#081226] p-4 sm:p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-200/70">Commissioner</p>
        <h2 className="mt-1 text-lg font-semibold text-white">League {leagueId}</h2>
      </div>

      {orphanCount >= 1 ? (
        <div className="rounded-2xl border border-white/10 bg-[#0a1228] p-4 sm:p-5">
          <div className="flex items-start gap-2 border-b border-white/[0.06] pb-4">
            <span className="text-xl" aria-hidden>
              ⚠️
            </span>
            <div>
              <h3 className="text-base font-bold text-white">
                {orphanCount} Orphaned Team{orphanCount === 1 ? '' : 's'} Detected
              </h3>
              <p className="mt-1 text-sm text-white/55">The following teams no longer have managers:</p>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {data.orphanedTeams.map((t) => (
              <div
                key={t.rosterId}
                className="rounded-xl border border-white/[0.08] bg-black/25 px-3 py-3 text-xs text-white/85"
              >
                <p className="font-semibold text-white">{t.teamName}</p>
                <p className="mt-1 text-white/50">
                  {t.playerCount} players · {t.draftPickCount} picks
                  {t.faabRemaining > 0 ? ` · $${t.faabRemaining} FAAB` : ''}
                </p>
              </div>
            ))}
          </div>

          <p className="mt-6 text-sm font-medium text-white/90">Choose how to handle these teams:</p>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-[#080f1f] p-4">
              <h4 className="text-sm font-semibold text-white">📢 Advertise to Find-a-League</h4>
              <p className="mt-2 text-[11px] leading-relaxed text-white/50">
                Post these teams to the league finder so new managers can claim them.
              </p>
              <div className="mt-3 max-h-40 space-y-2 overflow-y-auto">
                {data.orphanedTeams.map((t) => (
                  <label key={t.rosterId} className="flex items-center gap-2 text-xs text-white/80">
                    <input
                      type="checkbox"
                      className="rounded border-white/20"
                      checked={advertiseIds.has(t.rosterId)}
                      disabled={!data.canAdvertise}
                      onChange={() => toggle(setAdvertiseIds, t.rosterId)}
                    />
                    {t.teamName}
                  </label>
                ))}
              </div>
              <button
                type="button"
                disabled={busy !== null || !data.canAdvertise || advertiseIds.size === 0}
                onClick={() => void postAdvertise()}
                className="mt-4 w-full rounded-lg border border-cyan-400/35 bg-cyan-500/15 py-2 text-xs font-bold text-cyan-100 disabled:opacity-40"
              >
                {busy === 'advertise' ? 'Posting…' : 'Post to Find-a-League'}
              </button>
            </div>

            <div className="rounded-xl border border-white/10 bg-[#080f1f] p-4">
              <h4 className="text-sm font-semibold text-white">🤖 Assign AI Manager</h4>
              <p className="mt-2 text-[11px] leading-relaxed text-white/50">
                An AI will manage this team until a human takes over, or for the full season.
              </p>
              <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-white/70">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="ai-type"
                    checked={aiType === 'season_long'}
                    onChange={() => setAiType('season_long')}
                  />
                  For season
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="ai-type"
                    checked={aiType === 'until_claimed'}
                    onChange={() => setAiType('until_claimed')}
                  />
                  Until claimed
                </label>
              </div>
              <div className="mt-3 max-h-36 space-y-2 overflow-y-auto">
                {data.orphanedTeams.map((t) => (
                  <label key={t.rosterId} className="flex items-center gap-2 text-xs text-white/80">
                    <input
                      type="checkbox"
                      className="rounded border-white/20"
                      checked={aiIds.has(t.rosterId)}
                      disabled={!data.canAssignAI}
                      onChange={() => toggle(setAiIds, t.rosterId)}
                    />
                    {t.teamName}
                  </label>
                ))}
              </div>
              <button
                type="button"
                disabled={busy !== null || !data.canAssignAI || aiIds.size === 0}
                onClick={() => void postAi()}
                className="mt-4 w-full rounded-lg border border-violet-400/35 bg-violet-500/15 py-2 text-xs font-bold text-violet-100 disabled:opacity-40"
              >
                {busy === 'ai' ? 'Assigning…' : 'Assign AI Manager'}
              </button>
            </div>

            <div className="rounded-xl border border-white/10 bg-[#080f1f] p-4">
              <h4 className="text-sm font-semibold text-white">🏈 Dispersal Draft</h4>
              <p className="mt-2 text-[11px] leading-relaxed text-white/50">
                Pool all orphaned team assets and draft them among remaining managers.
              </p>

              {data.hasActiveDispersalDraft && data.activeDispersalDraftId ? (
                <div className="mt-4 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] p-3">
                  <p className="text-xs font-semibold text-emerald-100">A dispersal draft is in progress.</p>
                  <Link
                    href={`/league/${leagueId}/dispersal-draft/${data.activeDispersalDraftId}`}
                    className="mt-2 inline-flex rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-3 py-2 text-xs font-bold text-emerald-100"
                  >
                    Resume draft →
                  </Link>
                </div>
              ) : (
                <div className={`mt-4 ${isDisabled ? 'opacity-40' : ''}`}>
                  {isGated ? (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <button
                        type="button"
                        onClick={() => openGate('commissioner_dispersal_draft')}
                        className="rounded-lg border border-white/15 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/90 hover:bg-white/[0.07]"
                      >
                        🏈 Dispersal Draft
                      </button>
                      <SubscriptionGateBadge
                        featureId="commissioner_dispersal_draft"
                        onClick={() => openGate('commissioner_dispersal_draft')}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={isDisabled || !canLaunchDispersalDraft}
                      onClick={() => router.push(`/league/${leagueId}/dispersal-draft/setup`)}
                      className="w-full rounded-lg border border-cyan-400/35 bg-cyan-500/15 px-3 py-2 text-xs font-bold text-cyan-100 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      🏈 Run Dispersal Draft →
                    </button>
                  )}
                  {isDisabled ? (
                    <p className="text-xs text-white/40 mt-2">Requires 2+ orphaned teams</p>
                  ) : null}
                  {isGated && !isDisabled ? (
                    <p className="mt-2 text-[11px] text-amber-200/70">
                      AF Commissioner subscription required to run dispersal drafts.
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <p className="rounded-2xl border border-white/10 bg-[#0a1328] px-4 py-6 text-center text-sm text-white/55">
          No orphaned teams in this league.
        </p>
      )}
    </div>
  )
}

export default function OrphanTeamsClient({ leagueId }: { leagueId?: string }) {
  const [cards, setCards] = useState<OrphanTeamCard[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [query, setQuery] = useState('')
  const [sport, setSport] = useState('')
  const [leagueType, setLeagueType] = useState('')
  const [requestingCardId, setRequestingCardId] = useState<string | null>(null)

  const fetchCards = useCallback(async (nextPage: number) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('page', String(nextPage))
      params.set('limit', '12')
      if (query.trim()) params.set('q', query.trim())
      if (sport) params.set('sport', sport)
      if (leagueType.trim()) params.set('leagueType', leagueType.trim())

      const res = await fetch(`/api/discover/orphan-teams?${params.toString()}`, { cache: 'no-store' })
      const data = (await res.json().catch(() => ({}))) as OrphanDiscoverResponse
      if (!res.ok) throw new Error(data?.error || 'Failed to load orphan teams.')

      setCards(Array.isArray(data.cards) ? data.cards : [])
      setTotal(Number(data.pagination?.total ?? 0))
      setHasMore(Boolean(data.pagination?.hasMore))
    } catch (error: unknown) {
      setCards([])
      setTotal(0)
      setHasMore(false)
      toast.error(error instanceof Error ? error.message : 'Failed to load orphan teams.')
    } finally {
      setLoading(false)
    }
  }, [leagueType, query, sport])

  useEffect(() => {
    void fetchCards(page)
  }, [fetchCards, page])

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPage(1)
    void fetchCards(1)
  }

  const totalPages = useMemo(() => {
    if (total <= 0) return 1
    return Math.max(1, Math.ceil(total / 12))
  }, [total])

  const requestAdoption = async (card: OrphanTeamCard) => {
    setRequestingCardId(card.id)
    try {
      const res = await fetch('/api/orphan-teams/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId: card.leagueId, rosterId: card.rosterId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Could not submit adoption request.')

      setCards((prev) =>
        prev.map((row) =>
          row.id === card.id
            ? {
                ...row,
                myRequestStatus: 'pending',
              }
            : row
        )
      )
      toast.success('Request sent to commissioner for approval.')
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Could not submit adoption request.')
    } finally {
      setRequestingCardId(null)
    }
  }

  return (
    <section className="space-y-6">
      {leagueId ? <CommissionerLeagueOrphanPanel leagueId={leagueId} /> : null}

      <div className="rounded-2xl border border-white/10 bg-[#081226] p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-white sm:text-2xl">
              {leagueId ? 'Find-a-League marketplace' : 'Orphan Team Marketplace'}
            </h1>
            <p className="mt-1 text-sm text-white/65">
              Adopt orphan teams from active leagues. All requests require commissioner approval.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/35 bg-cyan-500/15 px-3 py-1 text-[11px] font-medium text-cyan-200">
            <Lock className="h-3.5 w-3.5" />
            Commissioner approval required
          </span>
        </div>
      </div>

      <form
        onSubmit={handleSearchSubmit}
        className="rounded-2xl border border-white/10 bg-[#0a1328] p-3 sm:p-4"
        data-testid="orphan-teams-filters"
      >
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/45" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search team or league"
              className="h-10 w-full rounded-lg border border-white/15 bg-black/30 pl-9 pr-3 text-sm text-white placeholder:text-white/40"
              data-testid="orphan-teams-search-input"
            />
          </div>
          <select
            value={sport}
            onChange={(event) => {
              setSport(event.target.value)
              setPage(1)
            }}
            className="h-10 rounded-lg border border-white/15 bg-black/30 px-3 text-sm text-white"
            data-testid="orphan-teams-sport-filter"
          >
            <option value="">All sports</option>
            {SUPPORTED_SPORTS.map((supportedSport) => (
              <option key={supportedSport} value={supportedSport}>
                {supportedSport}
              </option>
            ))}
          </select>
          <input
            value={leagueType}
            onChange={(event) => {
              setLeagueType(event.target.value)
              setPage(1)
            }}
            placeholder="League type"
            className="h-10 rounded-lg border border-white/15 bg-black/30 px-3 text-sm text-white placeholder:text-white/40"
            data-testid="orphan-teams-league-type-filter"
          />
          <button
            type="submit"
            className="h-10 rounded-lg border border-cyan-400/35 bg-cyan-500/15 px-4 text-sm font-medium text-cyan-100 hover:bg-cyan-500/25"
            data-testid="orphan-teams-search-submit"
          >
            Search
          </button>
        </div>
      </form>

      {loading ? (
        <div className="rounded-2xl border border-white/10 bg-[#080f1f] px-4 py-10 text-center text-sm text-white/60">
          Loading orphan teams...
        </div>
      ) : cards.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-[#080f1f] px-4 py-10 text-center text-sm text-white/60">
          No orphan teams match your current filters.
        </div>
      ) : (
        <>
          <p className="text-xs text-white/55" data-testid="orphan-teams-results-count">
            {total} team{total === 1 ? '' : 's'} available
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map((card) => {
              const statusBadge = buildStatusBadge(card.myRequestStatus)
              return (
                <article
                  key={card.id}
                  className="rounded-2xl border border-white/10 bg-[#081329] p-4"
                  data-testid={`orphan-team-card-${card.leagueId}-${card.rosterId}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-semibold text-white">{card.teamName}</h2>
                      <p className="mt-0.5 text-xs text-white/55">{card.leagueName}</p>
                    </div>
                    {statusBadge ? (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusBadge.className}`}>
                        {statusBadge.label}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-white/70">
                    <p><span className="text-white/45">Sport:</span> {card.sport}</p>
                    <p><span className="text-white/45">League:</span> {card.leagueType}</p>
                    <p><span className="text-white/45">Record:</span> {card.record.wins}-{card.record.losses}-{card.record.ties}</p>
                    <p><span className="text-white/45">Scoring:</span> {card.scoringFormat}</p>
                  </div>

                  <div className="mt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/55">Roster preview</p>
                    {card.rosterPreview.length === 0 ? (
                      <p className="mt-1 text-xs text-white/50">No roster preview available yet.</p>
                    ) : (
                      <ul className="mt-1 space-y-1 text-xs text-white/80">
                        {card.rosterPreview.map((playerName) => (
                          <li key={`${card.id}-${playerName}`}>- {playerName}</li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="mt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/55">Draft picks owned</p>
                    {card.draftPicksOwned.length === 0 ? (
                      <p className="mt-1 text-xs text-white/50">No pick data listed.</p>
                    ) : (
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {card.draftPicksOwned.map((pick) => (
                          <span key={`${card.id}-${pick}`} className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/80">
                            {pick}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="mt-3 rounded-lg border border-cyan-400/20 bg-cyan-500/10 p-2">
                    <p className="flex items-start gap-1.5 text-xs text-cyan-100">
                      <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {card.aiEvaluationPreview}
                    </p>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2">
                    <p className="text-[11px] text-white/50">
                      Commissioner: {card.commissionerName}
                    </p>
                    <span className="text-[11px] text-white/45">{card.memberCount} teams filled</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => void requestAdoption(card)}
                    disabled={requestingCardId === card.id || card.myRequestStatus === 'pending' || card.myRequestStatus === 'approved'}
                    className="mt-3 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-violet-400/35 bg-violet-500/15 text-sm font-medium text-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
                    data-testid={`orphan-team-request-${card.leagueId}-${card.rosterId}`}
                  >
                    {card.myRequestStatus === 'approved' ? (
                      <>
                        <CheckCircle2 className="h-4 w-4" />
                        Approved
                      </>
                    ) : card.myRequestStatus === 'pending' ? (
                      <>
                        <Users className="h-4 w-4" />
                        Pending approval
                      </>
                    ) : (
                      <>
                        <UserPlus className="h-4 w-4" />
                        Request adoption
                      </>
                    )}
                  </button>
                </article>
              )
            })}
          </div>
        </>
      )}

      <nav className="flex items-center justify-center gap-2" aria-label="Orphan teams pagination">
        <button
          type="button"
          onClick={() => setPage((prev) => Math.max(1, prev - 1))}
          disabled={page <= 1}
          className="h-9 rounded-lg border border-white/20 px-3 text-xs text-white disabled:opacity-40"
          data-testid="orphan-teams-pagination-prev"
        >
          Previous
        </button>
        <span className="text-xs text-white/60">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          onClick={() => setPage((prev) => (hasMore ? prev + 1 : prev))}
          disabled={!hasMore}
          className="h-9 rounded-lg border border-white/20 px-3 text-xs text-white disabled:opacity-40"
          data-testid="orphan-teams-pagination-next"
        >
          Next
        </button>
      </nav>
    </section>
  )
}

