'use client'

import { useCallback, useState } from 'react'
import { Sparkles, Loader2, Target, Zap } from 'lucide-react'
import type {
  UserDiscoveryPreferences,
  CandidateLeague,
  LeagueMatchSuggestion,
} from '@/lib/league-discovery'
import { normalizeToSupportedSport, SUPPORTED_SPORTS } from '@/lib/sport-scope'
import { useUserTimezone } from '@/hooks/useUserTimezone'

const SKILL_OPTIONS: { value: string; label: string }[] = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'expert', label: 'Expert' },
]

const ACTIVITY_OPTIONS: { value: string; label: string }[] = [
  { value: 'quiet', label: 'Quiet (low chat/trades)' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'active', label: 'Active (lots of trades/chat)' },
]

const BALANCE_OPTIONS: { value: string; label: string }[] = [
  { value: 'casual', label: 'Casual' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'competitive', label: 'Competitive' },
]

type SourceMode = 'pools' | 'discovered'

function getDiscoveryErrorMessage(data: { error?: string } | null | undefined, fallback: string) {
  if (data?.error === 'VERIFICATION_REQUIRED') return 'Verify your email or phone before discovering leagues.'
  if (data?.error === 'AGE_REQUIRED') return 'Confirm that you are 18+ before discovering leagues.'
  if (data?.error === 'UNAUTHENTICATED' || data?.error === 'Unauthorized') return 'Sign in to discover leagues.'
  return data?.error || fallback
}

export default function LeagueDiscoverySuggest() {
  const { formatInTimezone } = useUserTimezone()
  const [sourceMode, setSourceMode] = useState<SourceMode>('pools')
  const [tournamentId, setTournamentId] = useState('')
  const [prefs, setPrefs] = useState<UserDiscoveryPreferences>({
    skillLevel: 'intermediate',
    sportsPreferences: ['NFL'],
    preferredActivity: 'moderate',
    competitionBalance: 'balanced',
  })
  const [suggestions, setSuggestions] = useState<LeagueMatchSuggestion[]>([])
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [discoveredLeagues, setDiscoveredLeagues] = useState<CandidateLeague[]>([])
  const [sleeperUsername, setSleeperUsername] = useState('')
  const [discovering, setDiscovering] = useState(false)

  const discoverSleeper = useCallback(async () => {
    if (!sleeperUsername.trim()) return
    setDiscovering(true)
    setError(null)
    try {
      const res = await fetch('/api/league/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'sleeper', credentials: { username: sleeperUsername.trim() } }),
      })
      const data = await res.json()
      if (data.success && Array.isArray(data.discovered)) {
        const candidates: CandidateLeague[] = data.discovered.map((l: any) => ({
          id: l.league_id || l.sleeperLeagueId || String(l.id ?? ''),
          name: l.name || 'Unnamed',
          sport: normalizeToSupportedSport('NFL'),
          leagueSize: l.total_rosters ?? l.totalTeams,
          isDynasty: l.settings != null ? l.settings.type === 2 : l.isDynasty,
          activityLevel: 'moderate',
          competitionSpread: 'balanced',
        }))
        setDiscoveredLeagues(candidates)
        setSourceMode('discovered')
      } else {
        setError(getDiscoveryErrorMessage(data, 'Discovery failed'))
      }
    } catch {
      setError('Failed to discover leagues')
    } finally {
      setDiscovering(false)
    }
  }, [sleeperUsername])

  const runSuggest = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const body: { preferences: UserDiscoveryPreferences; tournamentId?: string; candidates?: CandidateLeague[] } = {
        preferences: prefs,
      }
      if (sourceMode === 'pools' && tournamentId.trim()) {
        body.tournamentId = tournamentId.trim()
      } else if (sourceMode === 'discovered' && discoveredLeagues.length > 0) {
        body.candidates = discoveredLeagues
      } else {
        setError(sourceMode === 'pools' ? 'Enter a tournament ID for public pools.' : 'Discover leagues first (Sleeper username) or switch to Public pools.')
        setLoading(false)
        return
      }
      const res = await fetch('/api/league/discovery/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Suggestions failed')
        setSuggestions([])
        setGeneratedAt(null)
      } else {
        setSuggestions(data.suggestions || [])
        setGeneratedAt(typeof data.generatedAt === 'string' ? data.generatedAt : null)
      }
    } catch {
      setError('Request failed')
      setSuggestions([])
      setGeneratedAt(null)
    } finally {
      setLoading(false)
    }
  }, [prefs, sourceMode, tournamentId, discoveredLeagues])

  const toggleSport = (sport: string) => {
    const next = Array.isArray(prefs.sportsPreferences) ? prefs.sportsPreferences : []
    const set = new Set(next)
    if (set.has(sport)) set.delete(sport)
    else set.add(sport)
    setPrefs({ ...prefs, sportsPreferences: [...set] })
  }

  return (
    <div className="space-y-6 rounded-2xl border border-cyan-500/20 bg-cyan-950/20 p-6">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-cyan-400" />
        <h2 className="text-lg font-bold text-white">League Discovery Chimmy</h2>
      </div>
      <p className="text-sm text-white/70">
        Get league suggestions based on your skill level, sports, preferred activity, and competition balance.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-white/80">Skill level</label>
          <select
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            value={String(prefs.skillLevel ?? 'intermediate')}
            onChange={(e) => setPrefs({ ...prefs, skillLevel: e.target.value as UserDiscoveryPreferences['skillLevel'] })}
          >
            {SKILL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-white/80">Preferred activity</label>
          <select
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            value={String(prefs.preferredActivity ?? 'moderate')}
            onChange={(e) => setPrefs({ ...prefs, preferredActivity: e.target.value as UserDiscoveryPreferences['preferredActivity'] })}
          >
            {ACTIVITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-white/80">Competition balance</label>
          <select
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            value={String(prefs.competitionBalance ?? 'balanced')}
            onChange={(e) => setPrefs({ ...prefs, competitionBalance: e.target.value as UserDiscoveryPreferences['competitionBalance'] })}
          >
            {BALANCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-white/80">Sports</label>
          <div className="flex flex-wrap gap-2">
            {SUPPORTED_SPORTS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => toggleSport(s)}
                className={`rounded-lg border px-2 py-1 text-xs ${(Array.isArray(prefs.sportsPreferences) && prefs.sportsPreferences.includes(s)) ? 'border-cyan-500 bg-cyan-500/20 text-cyan-200' : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10'}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <label className="mb-2 block text-xs font-medium text-white/80">League source</label>
        <div className="flex flex-wrap gap-4">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="source"
              checked={sourceMode === 'pools'}
              onChange={() => setSourceMode('pools')}
              className="rounded border-white/20"
            />
            <span className="text-sm text-white">Public pools (bracket)</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="source"
              checked={sourceMode === 'discovered'}
              onChange={() => setSourceMode('discovered')}
              className="rounded border-white/20"
            />
            <span className="text-sm text-white">My discovered leagues</span>
          </label>
        </div>
        {sourceMode === 'pools' && (
          <input
            type="text"
            placeholder="Tournament ID (from brackets)"
            value={tournamentId}
            onChange={(e) => setTournamentId(e.target.value)}
            className="mt-3 w-full max-w-sm rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/40"
          />
        )}
        {sourceMode === 'discovered' && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="Sleeper username"
              value={sleeperUsername}
              onChange={(e) => setSleeperUsername(e.target.value)}
              className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/40"
            />
            <button
              type="button"
              onClick={discoverSleeper}
              disabled={discovering || !sleeperUsername.trim()}
              className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              {discovering ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Discover'}
            </button>
            {discoveredLeagues.length > 0 && (
              <span className="text-xs text-white/60">{discoveredLeagues.length} league(s) found</span>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={runSuggest}
        disabled={loading}
        className="flex items-center gap-2 rounded-xl bg-cyan-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Target className="h-4 w-4" />}
        Get suggestions
      </button>

      {error && (
        <p className="text-sm text-rose-400">{error}</p>
      )}

      {suggestions.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-white">Suggested for you</h3>
            {generatedAt && (
              <p className="text-xs text-white/50">Generated {formatInTimezone(generatedAt)}</p>
            )}
          </div>
          <ul className="space-y-3">
            {suggestions.map((s) => (
              <li
                key={s.id}
                className="rounded-xl border border-white/10 bg-black/20 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-white">{s.name}</p>
                    <p className="text-xs text-white/60">
                      {s.sport || '?'} · {s.entryCount ?? s.maxManagers ?? s.memberCount ?? '?'} teams
                      {s.tournamentName && ` · ${s.tournamentName}`}
                    </p>
                  </div>
                  <div className="inline-flex items-center rounded-full border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1 text-xs font-semibold text-cyan-200">
                    {s.matchScore}% match
                  </div>
                </div>
                <p className="mt-2 text-sm text-white/80">{s.summary}</p>
                {Array.isArray(s.reasons) && s.reasons.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-white/65">
                    {s.reasons.map((reason, idx) => (
                      <li key={`${s.id}-reason-${idx}`} className="flex items-start gap-1.5">
                        <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" />
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {s.joinCode && (
                  <p className="mt-2 text-xs text-white/50">Join code: {s.joinCode}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
