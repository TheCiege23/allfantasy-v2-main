'use client'

import { useMemo, useState } from 'react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { useTournamentUi } from '@/app/tournament/[tournamentId]/TournamentUiContext'
import { useTournamentParticipantState } from '@/lib/tournament/useTournamentParticipantState'
import { DraftTransitionCard, RoundResetExplainer } from '@/app/tournament/components/DraftTransitionCard'

export default function TournamentDraftsPage() {
  const { t, tInterpolate } = useLanguage()
  const ctx = useTournamentUi()
  const state = useTournamentParticipantState(ctx)
  const { shell, rounds, tournamentLeagues, conferences } = ctx
  const [rn, setRn] = useState(shell.currentRoundNumber || 1)

  const selectedRound = rounds.find((r) => r.roundNumber === rn) ?? rounds[0]
  const tls = useMemo(
    () => tournamentLeagues.filter((l) => l.roundId === selectedRound?.id),
    [tournamentLeagues, selectedRound?.id],
  )

  const myTl = useMemo(() => {
    const p = ctx.participant
    if (!p?.currentLeagueId) return null
    return tournamentLeagues.find((l) => l.id === p.currentLeagueId) ?? null
  }, [ctx.participant, tournamentLeagues])

  const eliminated = state.status === 'eliminated'

  const draftLabel = tInterpolate('tournament.hub.draftsPage.draftMeta', {
    type: String(shell.draftType),
    clock: String(shell.draftClockSeconds),
  })

  return (
    <div className="mx-auto max-w-lg space-y-4 md:max-w-xl">
      <h1 className="text-[18px] font-bold text-white">{t('tournament.hub.draftsPage.title')}</h1>
      <div className="scrollbar-none flex gap-1 overflow-x-auto">
        {rounds.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setRn(r.roundNumber)}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-bold ${
              rn === r.roundNumber ? 'bg-cyan-500/25 text-cyan-100' : 'bg-white/5 text-white/60'
            }`}
          >
            {r.roundLabel}
          </button>
        ))}
      </div>

      <RoundResetExplainer
        roundNumber={rn}
        rosterBefore={shell.openingRosterSize}
        rosterAfter={rn === 1 ? shell.openingRosterSize : shell.tournamentRosterSize}
        faabReset={shell.faabResetOnRedraft}
      />

      <div className="space-y-3">
        {tls.map((l) => {
          const conf = conferences.find((c) => c.id === l.conferenceId)
          const isMine = l.id === myTl?.id
          const scheduled = l.draftScheduledAt ? new Date(l.draftScheduledAt).toLocaleString() : t('tournament.hub.draftsPage.tbd')
          const slotRow = isMine ? state.myStandingsRow : null
          // The league's own draft state when the page data carries it; `l.status` is the round's phase.
          const draftState = l.draftStatus ?? (l.status === 'drafting' ? 'drafting' : l.status === 'complete' || l.status === 'archived' ? 'complete' : 'scheduled')
          const status = draftState === 'drafting' ? 'LIVE' : draftState === 'complete' ? 'COMPLETE' : 'SCHEDULED'
          if (eliminated && !isMine) return null
          if (eliminated && isMine)
            return (
              <DraftTransitionCard
                key={l.id}
                leagueName={l.name}
                conferenceName={conf?.name ?? null}
                draftTypeLabel={draftLabel}
                clockLabel={`${shell.draftClockSeconds}s`}
                draftSlot={slotRow?.draftSlot ?? null}
                scheduledLabel={scheduled}
                status={status}
                countdownLabel={null}
                leagueRoomHref={l.leagueId ? `/league/${l.leagueId}` : null}
                readOnly
              />
            )
          return (
            <DraftTransitionCard
              key={l.id}
                leagueName={l.name + (isMine ? t('tournament.hub.draftsPage.youSuffix') : '')}
              conferenceName={conf?.name ?? null}
              draftTypeLabel={draftLabel}
              clockLabel={`${shell.draftClockSeconds}s`}
              draftSlot={slotRow?.draftSlot ?? null}
              scheduledLabel={scheduled}
              status={status}
              countdownLabel={null}
              leagueRoomHref={l.leagueId ? `/league/${l.leagueId}` : null}
              readOnly={eliminated}
            />
          )
        })}
      </div>

      {eliminated ? (
        <p className="text-center text-[11px] text-[var(--tournament-text-dim)]">
          {t('tournament.hub.draftsPage.eliminatedNote')}
        </p>
      ) : null}
    </div>
  )
}
