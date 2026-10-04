'use client'

/**
 * components/league-settings/CoOwnerSettingsPanel.tsx
 * Co-owner Settings panel matching Sleeper UI.
 * A co-owner is another user that a manager adds to help manage their team —
 * drafting, waivers, trades, lineup setting, etc.
 *
 * Features:
 * - Search bar for filtering members
 * - List of all league members with co-owner status
 * - Commissioner can add/remove co-owners
 * - Non-commissioners can view only
 * - Co-commissioners get league-level management access
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, UserPlus, UserMinus, Shield, ShieldCheck } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TeamMember {
  teamId: string
  teamName: string
  ownerName: string
  avatarUrl: string | null
  platformUserId: string | null
  isCommissioner: boolean
  isCoCommissioner: boolean
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  leagueId: string
}

export function CoOwnerSettingsPanel({ leagueId }: Props) {
  const { t } = useLanguage()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isCommissioner, setIsCommissioner] = useState(false)
  const [members, setMembers] = useState<TeamMember[]>([])
  const [query, setQuery] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Load league teams
  const load = useCallback(async () => {
    try {
      // Use division-settings endpoint which returns teams + isCommissioner
      const res = await fetch(
        `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/division-settings`,
        { cache: 'no-store' }
      )
      if (!res.ok) {
        setError(t('leagueSettings.loadFailed'))
        return
      }
      const data = await res.json()
      setIsCommissioner(data.isCommissioner ?? false)
      const teams = (data.teams ?? []) as Array<{
        id: string
        teamName: string | null
        ownerName: string | null
        avatarUrl: string | null
        platformUserId?: string | null
        isCommissioner?: boolean
        isCoCommissioner?: boolean
      }>
      setMembers(
        teams.map((team) => ({
          teamId: team.id,
          teamName: team.teamName ?? t('division.unknownTeam'),
          ownerName: team.ownerName ?? '',
          avatarUrl: team.avatarUrl ?? null,
          platformUserId: team.platformUserId ?? null,
          isCommissioner: team.isCommissioner ?? false,
          isCoCommissioner: team.isCoCommissioner ?? false,
        }))
      )
    } catch {
      setError(t('coowner.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  useEffect(() => { load() }, [load])

  // Toggle co-commissioner status
  const toggleCoOwner = useCallback(async (member: TeamMember) => {
    if (member.isCommissioner) return // Can't change main commissioner
    setActionLoading(member.teamId)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch('/api/league/settings/co-commissioners', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueId,
          memberId: member.teamId,
          isCoCommissioner: !member.isCoCommissioner,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? t('coowner.updateFailed')); return }
      setSuccess(
        `${member.ownerName || member.teamName} ${member.isCoCommissioner ? t('coowner.removed') : t('coowner.added')}`
      )
      setTimeout(() => setSuccess(null), 3000)
      // Update local state
      setMembers((prev) =>
        prev.map((m) =>
          m.teamId === member.teamId
            ? { ...m, isCoCommissioner: !m.isCoCommissioner }
            : m
        )
      )
    } catch {
      setError(t('leagueSettings.requestFailed'))
    } finally {
      setActionLoading(null)
    }
  }, [leagueId])

  // Filtered members
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return members
    return members.filter(
      (m) =>
        m.teamName.toLowerCase().includes(q) ||
        m.ownerName.toLowerCase().includes(q)
    )
  }, [members, query])

  const coOwnerCount = useMemo(
    () => members.filter((m) => m.isCoCommissioner).length,
    [members]
  )

  if (loading) {
    return <div className="py-8 text-center text-sm text-white/50">{t('coowner.loading')}</div>
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h3 className="text-base font-semibold text-white">{t('coowner.title')}</h3>
        <p className="mt-0.5 text-xs text-white/50">{t('coowner.subtitle')}</p>
      </div>

      {/* Status messages */}
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-950/20 px-3 py-2 text-xs text-red-300">{error}</div>
      )}
      {success && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300">{success}</div>
      )}

      {/* Search bar — matches Sleeper screenshot exactly */}
      <div className="space-y-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-white/40">
          {t('coowner.searchLabel')}
        </p>
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('coowner.search')}
            className="w-full rounded-lg border border-white/15 bg-[#0d1526] py-2.5 pl-4 pr-10 text-[13px] text-white placeholder:text-white/30 focus:border-cyan-500/40 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
          />
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
        </div>
      </div>

      {/* Co-owner summary */}
      {coOwnerCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-cyan-500/20 bg-cyan-950/15 px-3 py-2">
          <ShieldCheck className="h-4 w-4 text-cyan-400" />
          <span className="text-[12px] text-cyan-200/80">
            {coOwnerCount} {t('coowner.active')}
          </span>
        </div>
      )}

      {/* Member list */}
      <div className="space-y-1">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-6 text-center text-[13px] text-white/30">
            {query ? t('coowner.noMatch') : t('coowner.noMembers')}
          </div>
        ) : (
          filtered.map((member) => {
            const isMain = member.isCommissioner
            const isCo = member.isCoCommissioner
            const isLoading = actionLoading === member.teamId

            return (
              <div
                key={member.teamId}
                className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition ${
                  isCo || isMain ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'
                }`}
              >
                {/* Avatar + name */}
                <div className="flex min-w-0 items-center gap-3">
                  {member.avatarUrl ? (
                    <img
                      src={member.avatarUrl}
                      alt=""
                      className="h-9 w-9 shrink-0 rounded-full border border-white/10 object-cover"
                    />
                  ) : (
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[11px] font-bold text-white/30">
                      {(member.teamName ?? '?')[0]}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium text-white">
                        {member.ownerName || member.teamName}
                      </span>
                      {isMain && (
                        <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[11px] font-bold uppercase text-amber-300">
                          {t('coowner.commissioner')}
                        </span>
                      )}
                      {isCo && !isMain && (
                        <span className="shrink-0 rounded bg-cyan-500/20 px-1.5 py-0.5 text-[11px] font-bold uppercase text-cyan-300">
                          {t('coowner.coOwner')}
                        </span>
                      )}
                    </div>
                    {member.ownerName && member.teamName !== member.ownerName && (
                      <p className="truncate text-[11px] text-white/35">{member.teamName}</p>
                    )}
                  </div>
                </div>

                {/* Action button — commissioner only, not for main commissioner */}
                {isCommissioner && !isMain && (
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={() => toggleCoOwner(member)}
                    className={`flex shrink-0 items-center gap-1 rounded-lg border px-3 py-1.5 text-[11px] font-medium transition disabled:opacity-50 ${
                      isCo
                        ? 'border-red-500/20 bg-red-950/15 text-red-300 hover:bg-red-950/30'
                        : 'border-cyan-500/20 bg-cyan-950/15 text-cyan-300 hover:bg-cyan-950/30'
                    }`}
                  >
                    {isCo ? (
                      <>
                        <UserMinus className="h-3.5 w-3.5" />
                        {t('coowner.remove')}
                      </>
                    ) : (
                      <>
                        <UserPlus className="h-3.5 w-3.5" />
                        {t('coowner.add')}
                      </>
                    )}
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Info text */}
      <div className="space-y-2 border-t border-white/10 pt-3">
        <p className="text-[11px] leading-relaxed text-white/35">
          {t('coowner.info')}
        </p>
        {!isCommissioner && (
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] text-white/40">
            {t('coowner.readOnlyBanner')}
          </div>
        )}
      </div>
    </div>
  )
}
