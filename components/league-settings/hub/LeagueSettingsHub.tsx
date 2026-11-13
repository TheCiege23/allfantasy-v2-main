'use client'

/**
 * League Settings hub — data container. Every value comes from an existing endpoint; this
 * file adds no API. Each source loads independently and degrades to its own empty state,
 * so one failing request (say, history) never blanks the whole settings page.
 *
 *   GET   /api/league/settings?leagueId=          role, league fields, teams, draft row, scoring
 *   PATCH /api/league/settings                     inline toggles + commissioner notes (settingsMerge)
 *   GET   /api/commissioner/leagues/[id]/roster-settings   roster slots (member-gated)
 *   GET   /api/leagues/[id]/draft/order            draft order
 *   GET   /api/leagues/[id]/history                past seasons + all-time standings
 *   GET   /api/leagues/[id]/record-book            highest_score records
 *   GET   /api/leagues/[id]/player-high-scores     biggest starter weeks (this season + last)
 *   GET   /api/leagues/[id]/stat-corrections       per-week final/open + rescored-at
 *   GET   /api/user/profile  · PATCH { notificationPreferences }   per-league alert mutes
 *   POST  /api/leagues/[id]/my-team { teamName }   rename my team
 *   GET/POST /api/leagues/[id]/team-coowners       co-owner invitations
 *   PATCH /api/league/settings/co-commissioners    co-commissioner switch (head commish)
 *   GET   /api/commissioner/leagues/[id]/invite    invite link (commissioners)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  buildAllTimeStandings,
  buildDraftGroups,
  buildGeneralGroups,
  buildNotificationGroups,
  buildRosterItems,
  buildTypeRuleGroups,
  buildWaiverGroups,
  groupScoringRules,
  isLeagueCategoryOn,
  resolveHubKind,
  type HubSettingsPayload,
  type HubSlotDef,
} from '@/lib/league-settings-hub/hubModel'
import { followGlobal, muteLeague, toggleCategory } from '@/lib/notification-settings/leagueOverrideEdits'
import type { NotificationCategoryId, NotificationPreferences } from '@/lib/notification-settings/types'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { LeagueSettingsHubView, type HubTabId, type HubViewData } from './LeagueSettingsHubView'

export const COMMISSIONER_NOTES_KEY = 'commissioner_notes'

export type LeagueSettingsHubLeague = {
  id: string
  name?: string | null
  avatarUrl?: string | null
  logoUrl?: string | null
  platform?: string | null
  sport?: string | null
  season?: number | null
  leagueSize?: number | null
  leagueType?: string | null
  leagueVariant?: string | null
  isDynasty?: boolean | null
  bestBallMode?: boolean | null
  guillotineMode?: boolean | null
  settings?: unknown
}

type Loadable<T> = T | null | undefined

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { credentials: 'include', cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

async function sendJson(url: string, method: string, body: unknown): Promise<{ ok: boolean; error: string | null; json: Record<string, unknown> | null }> {
  try {
    const res = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok) return { ok: false, error: typeof json?.error === 'string' ? json.error : `Request failed (${res.status})`, json }
    return { ok: true, error: null, json }
  } catch {
    return { ok: false, error: 'Network error — try again', json: null }
  }
}

export function LeagueSettingsHub({
  league,
  userId,
  isHeadCommissioner,
  initialTab,
  onOpenEditor,
  onLeaveLeague,
  advanced,
}: {
  league: LeagueSettingsHubLeague
  userId: string
  isHeadCommissioner: boolean
  initialTab?: HubTabId
  onOpenEditor: (panelId: string) => void
  onLeaveLeague?: () => void
  advanced?: { label: string; onOpen: () => void }
}) {
  const leagueId = league.id
  const [payload, setPayload] = useState<Loadable<HubSettingsPayload>>(undefined)
  const [roster, setRoster] = useState<Loadable<{ unifiedConfig?: unknown; slotDefs?: HubSlotDef[] }>>(undefined)
  const [order, setOrder] = useState<Loadable<Array<{ slot: number; name: string }>>>(undefined)
  const [orderStatus, setOrderStatus] = useState<string | null>(null)
  const [history, setHistory] = useState<Loadable<{ seasons?: Array<Record<string, unknown>>; allTimeStandings?: Parameters<typeof buildAllTimeStandings>[0] }>>(undefined)
  const [records, setRecords] = useState<Loadable<Array<{ holderId: string; value: number; season: number | null; rank: number }>>>(undefined)
  const [playerHighs, setPlayerHighs] = useState<Loadable<{ seasons: number[]; rows: Array<{ rank: number; playerName: string; teamName: string; season: number; week: number; points: number }> }>>(undefined)
  const [corrections, setCorrections] = useState<Loadable<{ season: number; weeks: Array<{ week: number; final: boolean; rescoredAt: string | null }> }>>(undefined)
  const [prefs, setPrefs] = useState<Loadable<NotificationPreferences>>(undefined)
  const [invite, setInvite] = useState<Loadable<string>>(undefined)
  const [coOwners, setCoOwners] = useState<Loadable<Array<{ id: string; accepted: boolean; name: string }>>>(undefined)
  const [busyField, setBusyField] = useState<string | null>(null)
  const prefsRef = useRef<NotificationPreferences | null>(null)

  const loadSettings = useCallback(async () => {
    const data = await getJson<HubSettingsPayload>(`/api/league/settings?leagueId=${encodeURIComponent(leagueId)}`)
    setPayload(data)
    return data
  }, [leagueId])

  useEffect(() => {
    let live = true
    const id = encodeURIComponent(leagueId)
    void loadSettings()
    void getJson<{ unifiedConfig?: unknown; slotDefs?: HubSlotDef[] }>(`/api/commissioner/leagues/${id}/roster-settings`).then((d) => { if (live) setRoster(d) })
    void getJson<{ slotOrder?: Array<{ slot: number; displayName?: string }> | null; status?: string | null }>(`/api/leagues/${id}/draft/order`).then((d) => {
      if (!live) return
      setOrder(d?.slotOrder?.length ? d.slotOrder.map((s) => ({ slot: s.slot, name: s.displayName || `Team ${s.slot}` })).sort((a, b) => a.slot - b.slot) : d ? [] : null)
      setOrderStatus(d?.status ?? null)
    })
    void getJson<{ seasons?: Array<Record<string, unknown>>; allTimeStandings?: Parameters<typeof buildAllTimeStandings>[0] }>(`/api/leagues/${id}/history`).then((d) => { if (live) setHistory(d) })
    void getJson<{ records?: Array<{ holderId: string; value: number; season: number | null; rank: number }> }>(`/api/leagues/${id}/record-book?recordType=highest_score&limit=10`).then((d) => { if (live) setRecords(d?.records ?? null) })
    void getJson<{ seasons: number[]; rows: Array<{ rank: number; playerName: string; teamName: string; season: number; week: number; points: number }> }>(`/api/leagues/${id}/player-high-scores?limit=10`).then((d) => { if (live) setPlayerHighs(d) })
    void getJson<{ season: number; weeks: Array<{ week: number; final: boolean; rescoredAt: string | null }> }>(`/api/leagues/${id}/stat-corrections`).then((d) => { if (live) setCorrections(d) })
    void getJson<{ notificationPreferences?: NotificationPreferences | null }>('/api/user/profile').then((d) => {
      if (!live) return
      const p = (d?.notificationPreferences ?? {}) as NotificationPreferences
      prefsRef.current = d ? p : null
      setPrefs(d ? p : null)
    })
    return () => { live = false }
  }, [leagueId, loadSettings])

  const teams = useMemo(() => payload?.league?.teams ?? [], [payload])
  const myTeam = useMemo(() => teams.find((t) => t.claimedByUserId === userId) ?? null, [teams, userId])
  const canEdit = Boolean(payload?.canEdit)
  const native = isNativePlatform(String(league.platform ?? '').trim().toLowerCase() || 'manual')

  // Invite link (commissioners only) and co-owner invitations (my roster) depend on the payload.
  useEffect(() => {
    if (payload === undefined) return
    let live = true
    const id = encodeURIComponent(leagueId)
    if (payload && canEdit && native) {
      void getJson<{ inviteLink?: string; joinUrl?: string }>(`/api/commissioner/leagues/${id}/invite`).then((d) => { if (live) setInvite(d?.inviteLink ?? d?.joinUrl ?? null) })
    } else setInvite(null)
    const rosterId = myTeam?.externalId
    if (native && rosterId) {
      void getJson<{ invitations?: Array<{ id: string; acceptedAt: string | null; user?: { username?: string | null; displayName?: string | null } }> }>(`/api/leagues/${id}/team-coowners?rosterId=${encodeURIComponent(rosterId)}`).then((d) => {
        if (!live) return
        setCoOwners(d ? (d.invitations ?? []).map((i) => ({ id: i.id, accepted: Boolean(i.acceptedAt), name: i.user?.displayName || i.user?.username || 'Member' })) : null)
      })
    } else setCoOwners(null)
    return () => { live = false }
  }, [payload, canEdit, native, leagueId, myTeam?.externalId])

  const kind = useMemo(
    () => resolveHubKind({ leagueType: league.leagueType ?? (payload?.league?.leagueType as string | undefined), leagueVariant: league.leagueVariant, settings: league.settings, isDynasty: league.isDynasty, guillotineMode: league.guillotineMode, bestBallMode: league.bestBallMode }),
    [league, payload],
  )

  /* ---------------------------------------------------------- actions */

  const onToggleSetting = useCallback(async (field: string, next: boolean) => {
    setBusyField(field)
    const r = await sendJson('/api/league/settings', 'PATCH', { leagueId, [field]: next })
    setBusyField(null)
    if (!r.ok) { toast.error(r.error ?? 'Save failed'); return }
    toast.success('Saved')
    await loadSettings()
  }, [leagueId, loadSettings])

  const onSaveNote = useCallback(async (text: string): Promise<string | null> => {
    const r = await sendJson('/api/league/settings', 'PATCH', { leagueId, settingsMerge: { [COMMISSIONER_NOTES_KEY]: text.slice(0, 2000) } })
    if (!r.ok) return r.error
    await loadSettings()
    return null
  }, [leagueId, loadSettings])

  const onSaveTeamName = useCallback(async (name: string): Promise<string | null> => {
    const r = await sendJson(`/api/leagues/${encodeURIComponent(leagueId)}/my-team`, 'POST', { teamName: name })
    if (!r.ok) return r.error
    await loadSettings()
    return null
  }, [leagueId, loadSettings])

  const savePrefs = useCallback(async (next: NotificationPreferences) => {
    const prev = prefsRef.current
    prefsRef.current = next
    setPrefs(next) // optimistic
    const r = await sendJson('/api/user/profile', 'PATCH', { notificationPreferences: next })
    if (!r.ok) {
      prefsRef.current = prev
      setPrefs(prev)
      toast.error(r.error ?? 'Could not save notification settings')
    }
  }, [])

  const onToggleNotification = useCallback((id: NotificationCategoryId, on: boolean) => {
    const cur = prefsRef.current
    if (!cur) return
    void savePrefs(toggleCategory(cur, leagueId, id, !on))
  }, [leagueId, savePrefs])

  const onToggleLeagueNotifications = useCallback((on: boolean) => {
    const cur = prefsRef.current
    if (!cur) return
    void savePrefs(on ? followGlobal(cur, leagueId) : muteLeague(cur, leagueId))
  }, [leagueId, savePrefs])

  const onToggleCoCommissioner = useCallback(async (memberId: string, next: boolean) => {
    const r = await sendJson('/api/league/settings/co-commissioners', 'PATCH', { leagueId, memberId, isCoCommissioner: next })
    if (!r.ok) { toast.error(r.error ?? 'Update failed'); return }
    toast.success(next ? 'Co-commissioner added' : 'Co-commissioner removed')
    await loadSettings()
  }, [leagueId, loadSettings])

  const onInviteCoOwner = useCallback(async (username: string): Promise<string | null> => {
    const rosterId = myTeam?.externalId
    if (!rosterId) return 'You need a team in this league to add a co-owner.'
    const r = await sendJson(`/api/leagues/${encodeURIComponent(leagueId)}/team-coowners`, 'POST', { rosterId, username })
    if (!r.ok) return r.error
    const inv = (r.json?.invitation ?? null) as { id?: string } | null
    setCoOwners((prev) => [...(prev ?? []), { id: inv?.id ?? `pending-${username}`, accepted: false, name: username }])
    return null
  }, [leagueId, myTeam?.externalId])

  const onCopy = useCallback((text: string) => {
    void navigator.clipboard?.writeText(text).then(() => toast.success('Copied'), () => toast.error('Copy failed'))
  }, [])

  const onShare = useMemo(() => {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return undefined
    return (url: string) => { void navigator.share({ title: league.name ?? 'Join my league', url }).catch(() => {}) }
  }, [league.name])

  /* ---------------------------------------------------------- view data */

  const data: HubViewData = useMemo(() => {
    const p = payload
    const snap = p?.settingsSnapshot ?? {}
    const teamCount = (p?.league?.teamCount as number | undefined) ?? league.leagueSize ?? null
    const teamName = (id: string) => {
      const t = teams.find((x) => x.id === id || x.externalId === id || x.claimedByUserId === id)
      return t?.teamName || t?.ownerName || null
    }
    const leagueOn = prefs ? prefs.leagues?.[leagueId]?.enabled !== false && prefs.globalEnabled !== false : true
    const notifGroups = buildNotificationGroups(kind, canEdit)
    const notifOn: Partial<Record<NotificationCategoryId, boolean>> = {}
    if (prefs) for (const g of notifGroups) for (const r of g.rows) notifOn[r.id] = isLeagueCategoryOn({ ...prefs, leagues: { ...prefs.leagues, [leagueId]: { ...(prefs.leagues?.[leagueId] ?? {}), enabled: true } } }, leagueId, r.id)
    const noteRaw = snap[COMMISSIONER_NOTES_KEY]
    const seasons = history?.seasons
      ?.map((s) => ({ year: Number(s.season), champion: (s.championName as string | null) ?? null, runnerUp: (s.runnerUpName as string | null) ?? null }))
      .filter((s) => Number.isFinite(s.year))
      .sort((a, b) => b.year - a.year)
    const draftRow = (p?.settings ?? {}) as Record<string, unknown>
    const preset = (p?.league?.scoring as string | undefined) ?? p?.scoringConfig?.formatType ?? null

    return {
      leagueId,
      kind,
      leagueName: (p?.league?.name as string | undefined) ?? league.name ?? 'League',
      leagueAvatarUrl: (p?.league?.logoUrl as string | undefined) ?? league.logoUrl ?? league.avatarUrl ?? null,
      sport: (p?.league?.sport as string | undefined) ?? league.sport ?? null,
      season: (p?.league?.season as number | undefined) ?? league.season ?? null,
      teamCount,
      leagueArt: null,
      canEdit,
      isHeadCommissioner,
      importedFrom: native ? null : String(league.platform ?? '').replace(/^./, (c) => c.toUpperCase()),
      myTeam: p === undefined ? undefined : myTeam ? { name: myTeam.teamName || myTeam.ownerName || 'My Team', avatarUrl: myTeam.avatarUrl ?? null } : null,
      notifications: prefs === undefined ? undefined : prefs === null ? null : { groups: notifGroups, on: notifOn, leagueEnabled: leagueOn },
      general: p ? buildGeneralGroups(p, kind) : p === null ? [] : undefined,
      waivers: p ? buildWaiverGroups(p, kind) : p === null ? [] : undefined,
      typeRules: p ? buildTypeRuleGroups(p, kind) : p === null ? [] : undefined,
      commissionerNote: p === undefined ? undefined : typeof noteRaw === 'string' ? noteRaw : null,
      roster: roster === undefined ? undefined : roster ? buildRosterItems(roster.unifiedConfig as Parameters<typeof buildRosterItems>[0], roster.slotDefs) : null,
      scoring: p === undefined ? undefined : p?.scoringConfig?.rules?.length ? { preset: preset ? String(preset).replace(/_/g, ' ') : null, categories: groupScoringRules(p.scoringConfig.rules) } : null,
      draft: p ? buildDraftGroups(p) : p === null ? [] : undefined,
      draftOrder: order,
      members: p === undefined ? undefined : teams.map((t) => ({
        id: t.id,
        name: t.ownerName || t.teamName || 'Open team',
        teamName: t.teamName ?? null,
        avatarUrl: t.avatarUrl ?? null,
        isCommissioner: Boolean(t.isCommissioner),
        isCoCommissioner: Boolean(t.isCoCommissioner),
        isYou: t.claimedByUserId === userId,
      })),
      coOwners: coOwners === undefined ? undefined : coOwners === null || !myTeam?.externalId ? null : { rosterId: myTeam.externalId, invitations: coOwners },
      invite: p === undefined || invite === undefined ? undefined : { link: invite ?? null, filled: teams.filter((t) => t.claimedByUserId).length, capacity: teamCount },
      draftHistory: p === undefined ? undefined : draftRow.draftType || order?.length ? { title: `${(p?.league?.season as number | undefined) ?? league.season ?? ''} ${kind === 'dynasty' ? 'Rookie Draft' : 'Season Draft'}`.trim(), status: [orderStatus ? orderStatus.replace(/_/g, ' ') : null, draftRow.draftType ? String(draftRow.draftType) : null, draftRow.rounds ? `${draftRow.rounds} rounds` : null].filter(Boolean).join(' · ') || 'Scheduled' } : null,
      seasons: history === undefined ? undefined : seasons ?? null,
      standings: history === undefined ? undefined : history ? buildAllTimeStandings(history.allTimeStandings) : null,
      highScores: records === undefined ? undefined : records ? records.map((r) => ({ rank: r.rank, holder: teamName(r.holderId) ?? 'Former manager', season: r.season, value: Number(r.value).toFixed(2) })) : null,
      playerHighScores: playerHighs === undefined ? undefined : playerHighs ? { seasons: playerHighs.seasons, rows: playerHighs.rows.map((r) => ({ rank: r.rank, name: r.playerName, team: r.teamName, season: r.season, week: r.week, points: r.points.toFixed(2) })) } : null,
      correctionWeeks: corrections,
    }
  }, [payload, league, kind, canEdit, isHeadCommissioner, native, myTeam, prefs, roster, order, orderStatus, teams, userId, coOwners, invite, history, records, playerHighs, corrections, leagueId])

  return (
    <LeagueSettingsHubView
      data={data}
      initialTab={initialTab}
      busyField={busyField}
      advanced={advanced}
      cb={{
        onToggleSetting: (f, n) => void onToggleSetting(f, n),
        onSaveTeamName,
        onSaveNote,
        onToggleNotification,
        onToggleLeagueNotifications,
        onToggleCoCommissioner: (m, n) => void onToggleCoCommissioner(m, n),
        onInviteCoOwner,
        onOpenEditor,
        onLeaveLeague,
        onCopy,
        onShare,
      }}
    />
  )
}
