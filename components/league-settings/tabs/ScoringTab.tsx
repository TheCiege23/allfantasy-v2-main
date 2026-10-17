'use client'

import { ScoringSettingsFullSection } from '@/app/league/[leagueId]/components/ScoringSettingsFullSection'
import { NflScoringSettingsPanel } from '@/components/league-settings/NflScoringSettingsPanel'
import { NbaScoringSettingsPanel } from '@/components/league-settings/NbaScoringSettingsPanel'
import { NcaabScoringSettingsPanel } from '@/components/league-settings/NcaabScoringSettingsPanel'
import { MlbScoringSettingsPanel } from '@/components/league-settings/MlbScoringSettingsPanel'
import { NhlScoringSettingsPanel } from '@/components/league-settings/NhlScoringSettingsPanel'
import { NcaafScoringSettingsPanel } from '@/components/league-settings/NcaafScoringSettingsPanel'
import { SoccerScoringSettingsPanel } from '@/components/league-settings/SoccerScoringSettingsPanel'
import type { LeagueSettingsTabProps } from '../league-settings-tabs-types'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { useEffect, useState } from 'react'
import { useLeagueSettingsSectionAutosave } from '@/hooks/useLeagueSettingsSectionAutosave'
import { HubCard, HubChoices, HubSavingNote, rangeChoices } from './hubFields'

/**
 * Exactly ONE sport's editor renders — the league's own sport. There is no football fallback:
 * an NBA league gets the NBA panel (no Passing/Rushing), and an unsupported sport gets a message.
 */
function SportScoringPanel({ sport, leagueId, isCommissioner }: { sport: string; leagueId: string; isCommissioner: boolean }) {
  const { t } = useLanguage()
  const props = { leagueId, isCommissioner }
  switch (String(sport ?? '').trim().toUpperCase()) {
    case 'NFL':
      return <NflScoringSettingsPanel {...props} />
    case 'NBA':
      return <NbaScoringSettingsPanel {...props} />
    case 'NCAAB':
      return <NcaabScoringSettingsPanel {...props} />
    case 'MLB':
      return <MlbScoringSettingsPanel {...props} />
    case 'NHL':
      return <NhlScoringSettingsPanel {...props} />
    case 'NCAAF':
      return <NcaafScoringSettingsPanel {...props} />
    case 'SOCCER':
      return <SoccerScoringSettingsPanel {...props} />
    default:
      return <p className="text-[13px] text-white/45">{t('lsHub.sc.unavailable')}</p>
  }
}

export function ScoringTab({ ctx, canEdit }: LeagueSettingsTabProps) {
  const sleeperSettingsHref = ctx.sleeperLeagueId
    ? `https://sleeper.com/leagues/${ctx.sleeperLeagueId}/settings`
    : null

  return (
    <div className="min-w-0 space-y-6">
      <SportScoringPanel
        sport={ctx.league.sport}
        leagueId={ctx.league.id}
        isCommissioner={ctx.isCommissioner}
      />
      {/* The host's raw scoring_settings mirror only means something for a host-linked league;
          for a native league it was an empty "no rules" list beside the real editor. */}
      {sleeperSettingsHref ? (
        <ScoringSettingsFullSection
          league={ctx.league}
          sleeperSettingsHref={sleeperSettingsHref}
          showEditLink
        />
      ) : null}
      <StatCorrectionsCard leagueId={ctx.league.id} canEdit={canEdit} />
    </div>
  )
}

type CorrectionRow = {
  id: string
  at: string
  week: number | null
  source: 'official' | 'commish'
  reason: string | null
  players: Array<{ playerId: string; playerName: string | null; teamName: string | null; pointsBefore: number; pointsAfter: number }>
  matchups: Array<{ homeTeam: string | null; awayTeam: string | null; before: { home: number; away: number }; after: { home: number; away: number }; resultFlipped: boolean }>
}
type CorrectionsData = { supported: boolean; days: number; canEdit: boolean; corrections: CorrectionRow[] }

const pts = (n: number) => (Math.round(n * 100) / 100).toFixed(2)

/**
 * Stat corrections: how long after a week the league keeps applying official corrections (they can
 * flip a final result), and every correction that has changed this league. lib/redraft/statCorrections.ts.
 */
function StatCorrectionsCard({ leagueId, canEdit }: { leagueId: string; canEdit: boolean }) {
  const { t } = useLanguage()
  const [data, setData] = useState<CorrectionsData | null>(null)
  const [days, setDays] = useState(3)
  const [failed, setFailed] = useState(false)
  const { queuePatch, saving } = useLeagueSettingsSectionAutosave(leagueId, 'commissioner', { enabled: canEdit })

  useEffect(() => {
    let cancelled = false
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/stat-corrections`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: CorrectionsData) => {
        if (cancelled) return
        setData(d)
        setDays(d.days)
      })
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [leagueId])

  if (failed) return null
  const editable = canEdit && Boolean(data?.supported && data.canEdit)

  return (
    <HubCard title={t('lsHub.scx.title')} testId="league-settings-stat-corrections">
      <HubSavingNote saving={saving} text={t('lsHub.saving')} />
      {!data ? (
        <div className="h-24 animate-pulse rounded-xl bg-white/[0.05]" />
      ) : (
        <>
          <p className="text-[12px] text-white/50">{data.supported ? t('lsHub.scx.hint') : t('lsHub.scx.unsupported')}</p>
          {data.supported ? (
            <HubChoices
              label={t('lsHub.scx.window')}
              value={days}
              disabled={!editable}
              options={[
                { value: 0, label: t('lsHub.scx.off'), hint: t('lsHub.scx.offHint') },
                ...rangeChoices(1, 7, (n) => t('lsHub.scx.days').replace('{{n}}', String(n))),
              ]}
              onChange={(n) => {
                setDays(n)
                queuePatch({ statCorrectionDays: n })
              }}
              testId="stat-correction-window"
            />
          ) : null}
          <p className="text-[11px] font-bold uppercase tracking-wide text-white/40">{t('lsHub.scx.history')}</p>
          {data.corrections.length === 0 ? (
            <p className="text-[12px] text-white/45">{t('lsHub.scx.none')}</p>
          ) : (
            <ul className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.08] bg-black/20" data-testid="stat-corrections-list">
              {data.corrections.map((c) => (
                <li key={c.id} className="space-y-1.5 px-3 py-3">
                  <div className="flex items-center justify-between gap-3 text-[12px]">
                    <span className="font-bold text-white">
                      {c.week != null ? t('lsHub.scx.week').replace('{{week}}', String(c.week)) : ''}
                    </span>
                    <span className="text-white/45">
                      {c.source === 'official' ? t('lsHub.scx.official') : t('lsHub.scx.commish')} · {new Date(c.at).toLocaleDateString()}
                    </span>
                  </div>
                  {c.players.map((p) => (
                    <p key={`${c.id}-${p.playerId}`} className="flex justify-between gap-3 text-[12px] text-white/80">
                      <span className="truncate">
                        {p.playerName ?? p.playerId}
                        {p.teamName ? <span className="text-white/40"> · {p.teamName}</span> : null}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {pts(p.pointsBefore)} → <span className={p.pointsAfter >= p.pointsBefore ? 'text-emerald-300' : 'text-red-300'}>{pts(p.pointsAfter)}</span>
                      </span>
                    </p>
                  ))}
                  {c.matchups.map((m, i) => (
                    <p key={`${c.id}-m${i}`} className="text-[11px] text-white/55">
                      {m.homeTeam ?? '—'} {pts(m.before.home)}–{pts(m.before.away)} {m.awayTeam ?? '—'} → {pts(m.after.home)}–{pts(m.after.away)}
                      {m.resultFlipped ? <span className="ml-1.5 font-bold text-amber-200">{t('lsHub.scx.flipped')}</span> : null}
                    </p>
                  ))}
                  {c.reason ? <p className="text-[11px] italic text-white/40">{c.reason}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </HubCard>
  )
}
