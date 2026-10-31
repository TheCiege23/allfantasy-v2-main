'use client'

import type { ReactNode } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { defineMessages } from '@/lib/i18n/messages'
import type { SurvivorSettingsForm, SurvivorSettingsKey } from '@/lib/survivor/survivorSettingsScreen'
import { SURVIVOR_REWARD_ADVANTAGE_POWERS } from '@/lib/survivor/survivorRewardModel'
import { SURVIVOR_HOUSE_RULES_MAX, SURVIVOR_WEEKLY_PRIZE_LIMITS, survivorTieBreakPositions } from '@/lib/survivor/survivorWeeklyPrizes'
import { SvkField, SvkSegmented, SvkToggle } from './core/SurvivorKit'

/**
 * The Survivor settings screen's newer fields (weekly tribe prizes, house rules, and the settings
 * that existed in storage without a screen). English and Spanish via a message catalog.
 */
export const survivorSettingsExtrasMessages = defineMessages({
  en: {
    rulesHeading: 'League rules',
    prizesHeading: 'Weekly tribe prizes',
    coCommish: 'Co-commissioner',
    coCommishHint: 'What a co-commissioner can see and do.',
    coOff: 'Off',
    coHost: 'Host only (not playing)',
    coSame: 'Same as you',
    tribeChats: 'Tribe chats',
    tribeChatsHint: 'Each tribe gets a private camp chat. Set before tribes are drawn.',
    houseRules: 'House rules',
    houseRulesHint: (max: number): string => `Your own rules, in your words: conduct, screenshots, anything else. Shown in the rulebook and quoted by Chimmy. Up to ${max} characters.`,
    houseRulesPlaceholder: 'One rule per line. Example: No screenshots of private chats.',
    jury: 'Jury',
    juryHint: 'Managers voted out after the merge pick the winner. Off: the finalists are decided without a jury vote.',
    mergeNaming: 'Merged tribe name',
    mergeNamingHint: 'Who names the tribe at the merge.',
    mergeByCommish: 'I name it',
    mergeByVote: 'Managers vote',
    harsh: 'Lose every token on a miss',
    harshHint: 'Token Pool: a wrong pick wipes the manager’s tokens instead of costing one.',
    tribeFaab: 'FAAB per player for the top tribe',
    tribeFaabHint: (max: number): string => `Each week before the merge, every member of the top-scoring tribe gets this much FAAB. $0 turns it off. Up to $${max}.`,
    topReward: 'Top scorer on the winning tribe',
    topRewardHint: 'An extra prize for the best score on that tribe. Points land on next week’s score.',
    rNone: 'Nothing', rFaab: 'FAAB', rAdvantage: 'Advantage', rBoost: 'Points',
    topAmountFaab: 'FAAB for the top scorer',
    topAmountPoints: 'Points for the top scorer',
    advantage: 'Which advantage',
    tieBreak: 'Tribe tie-break',
    tieBreakHint: 'When two tribes tie on points: the tribe whose starter at this position scored more wins.',
    tieNone: 'Tribe order (default)',
    power: (p: string): string => p.replace(/_/g, ' '),
  },
  es: {
    rulesHeading: 'Reglas de la liga',
    prizesHeading: 'Premios semanales de tribu',
    coCommish: 'Cocomisionado',
    coCommishHint: 'Lo que un cocomisionado puede ver y hacer.',
    coOff: 'Desactivado',
    coHost: 'Solo anfitrión (no juega)',
    coSame: 'Igual que tú',
    tribeChats: 'Chats de tribu',
    tribeChatsHint: 'Cada tribu tiene un chat privado de campamento. Se decide antes de sortear las tribus.',
    houseRules: 'Reglas de la casa',
    houseRulesHint: (max: number): string => `Tus propias reglas, con tus palabras: conducta, capturas de pantalla, lo que sea. Aparecen en el reglamento y Chimmy las cita. Hasta ${max} caracteres.`,
    houseRulesPlaceholder: 'Una regla por línea. Ejemplo: Nada de capturas de los chats privados.',
    jury: 'Jurado',
    juryHint: 'Los eliminados después de la fusión eligen al ganador. Desactivado: los finalistas se deciden sin voto del jurado.',
    mergeNaming: 'Nombre de la tribu fusionada',
    mergeNamingHint: 'Quién pone nombre a la tribu en la fusión.',
    mergeByCommish: 'Lo elijo yo',
    mergeByVote: 'Votan los mánagers',
    harsh: 'Perder todas las fichas al fallar',
    harshHint: 'Pozo de fichas: una elección equivocada borra todas las fichas en vez de costar una.',
    tribeFaab: 'FAAB por jugador para la mejor tribu',
    tribeFaabHint: (max: number): string => `Cada semana antes de la fusión, cada miembro de la tribu con más puntos recibe este FAAB. $0 lo desactiva. Hasta $${max}.`,
    topReward: 'Máximo anotador de la tribu ganadora',
    topRewardHint: 'Un premio extra para la mejor puntuación de esa tribu. Los puntos se suman a la semana siguiente.',
    rNone: 'Nada', rFaab: 'FAAB', rAdvantage: 'Ventaja', rBoost: 'Puntos',
    topAmountFaab: 'FAAB para el máximo anotador',
    topAmountPoints: 'Puntos para el máximo anotador',
    advantage: 'Qué ventaja',
    tieBreak: 'Desempate de tribus',
    tieBreakHint: 'Si dos tribus empatan en puntos, gana la tribu cuyo titular en esta posición puntuó más.',
    tieNone: 'Orden de tribus (predeterminado)',
  },
})

type ExtraProps = {
  draft: SurvivorSettingsForm
  set: <K extends SurvivorSettingsKey>(key: K, value: SurvivorSettingsForm[K]) => void
  disabled: (key: SurvivorSettingsKey) => boolean
  lockNote: (key: SurvivorSettingsKey) => ReactNode
}

const numberOr = (raw: string, fallback: number) => (raw === '' ? fallback : Number(raw))

export function SurvivorRulesSection({ draft, set, disabled, lockNote, icon }: ExtraProps & { icon: string }) {
  const m = useMessages(survivorSettingsExtrasMessages)
  return <section id="svt-rules" className="svk-card svt-sec" aria-labelledby="svt-rules-h" data-testid="survivor-settings-rules">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <h2 id="svt-rules-h"><img src={icon} alt="" />{m.rulesHeading}</h2>
    <SvkField title={m.coCommish} hint={m.coCommishHint}>
      {lockNote('coCommissionerMode')}
      <SvkSegmented label={m.coCommish} value={draft.coCommissionerMode} onChange={v => set('coCommissionerMode', v)} disabled={disabled('coCommissionerMode')} options={[
        { value: 'disabled', label: m.coOff },
        { value: 'non_participating_host', label: m.coHost },
        { value: 'same_privacy_as_commissioner', label: m.coSame },
      ]} testId="survivor-settings-cocommish" />
    </SvkField>
    <SvkField title={m.tribeChats} hint={m.tribeChatsHint}>
      {lockNote('tribeChatsEnabled')}
      <SvkToggle label={m.tribeChats} checked={draft.tribeChatsEnabled} onChange={v => set('tribeChatsEnabled', v)} disabled={disabled('tribeChatsEnabled')} />
    </SvkField>
    <SvkField title={m.houseRules} hint={m.houseRulesHint(SURVIVOR_HOUSE_RULES_MAX)}>
      {lockNote('houseRules')}
      <textarea className="svk-input" rows={5} maxLength={SURVIVOR_HOUSE_RULES_MAX} aria-label={m.houseRules} placeholder={m.houseRulesPlaceholder} value={draft.houseRules} onChange={e => set('houseRules', e.target.value)} disabled={disabled('houseRules')} data-testid="survivor-settings-house-rules" style={{ width: '100%', minHeight: 110, resize: 'vertical' }} />
    </SvkField>
  </section>
}

export function SurvivorPrizesSection({ draft, set, disabled, lockNote, icon, sport }: ExtraProps & { icon: string; sport?: string }) {
  const m = useMessages(survivorSettingsExtrasMessages)
  const positions = survivorTieBreakPositions(sport)
  return <section id="svt-prizes" className="svk-card svt-sec" aria-labelledby="svt-prizes-h" data-testid="survivor-settings-prizes">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <h2 id="svt-prizes-h"><img src={icon} alt="" />{m.prizesHeading}</h2>
    <SvkField title={m.tribeFaab} hint={m.tribeFaabHint(SURVIVOR_WEEKLY_PRIZE_LIMITS.faabPerPlayer)}>
      {lockNote('winningTribeFaabPerPlayer')}
      <input className="svk-input" type="number" min={0} max={SURVIVOR_WEEKLY_PRIZE_LIMITS.faabPerPlayer} step={1} aria-label={m.tribeFaab} value={draft.winningTribeFaabPerPlayer} onChange={e => set('winningTribeFaabPerPlayer', numberOr(e.target.value, 0))} disabled={disabled('winningTribeFaabPerPlayer')} data-testid="survivor-settings-tribe-faab" />
    </SvkField>
    <SvkField title={m.topReward} hint={m.topRewardHint}>
      {lockNote('topScorerReward')}
      <SvkSegmented label={m.topReward} value={draft.topScorerReward} onChange={v => set('topScorerReward', v)} disabled={disabled('topScorerReward')} options={[
        { value: 'none', label: m.rNone },
        { value: 'faab', label: m.rFaab },
        { value: 'advantage', label: m.rAdvantage },
        { value: 'score_boost', label: m.rBoost },
      ]} testId="survivor-settings-top-reward" />
      {(draft.topScorerReward === 'faab' || draft.topScorerReward === 'score_boost') && <input className="svk-input" type="number" min={0} step={draft.topScorerReward === 'faab' ? 1 : 0.5} aria-label={draft.topScorerReward === 'faab' ? m.topAmountFaab : m.topAmountPoints} value={draft.topScorerAmount} onChange={e => set('topScorerAmount', numberOr(e.target.value, 0))} disabled={disabled('topScorerAmount')} data-testid="survivor-settings-top-amount" />}
      {draft.topScorerReward === 'advantage' && <select className="svk-select" aria-label={m.advantage} value={draft.topScorerPowerType} onChange={e => set('topScorerPowerType', e.target.value as SurvivorSettingsForm['topScorerPowerType'])} disabled={disabled('topScorerPowerType')}>
        {SURVIVOR_REWARD_ADVANTAGE_POWERS.map(p => <option key={p} value={p}>{m.power(p)}</option>)}
      </select>}
    </SvkField>
    <SvkField title={m.tieBreak} hint={m.tieBreakHint}>
      {lockNote('tribeTieBreakPosition')}
      <select className="svk-select" aria-label={m.tieBreak} value={draft.tribeTieBreakPosition} onChange={e => set('tribeTieBreakPosition', e.target.value)} disabled={disabled('tribeTieBreakPosition')} data-testid="survivor-settings-tiebreak">
        <option value="none">{m.tieNone}</option>
        {[...new Set([...positions, ...(draft.tribeTieBreakPosition !== 'none' ? [draft.tribeTieBreakPosition] : [])])].map(p => <option key={p} value={p}>{p}</option>)}
      </select>
    </SvkField>
  </section>
}

export function SurvivorJuryExtras({ draft, set, disabled, lockNote }: ExtraProps) {
  const m = useMessages(survivorSettingsExtrasMessages)
  return <>
    <SvkField title={m.jury} hint={m.juryHint}>
      {lockNote('juryEnabled')}
      <SvkToggle label={m.jury} checked={draft.juryEnabled} onChange={v => set('juryEnabled', v)} disabled={disabled('juryEnabled')} testId="survivor-settings-jury" />
    </SvkField>
    <SvkField title={m.mergeNaming} hint={m.mergeNamingHint}>
      {lockNote('mergeNamingMode')}
      <SvkSegmented label={m.mergeNaming} value={draft.mergeNamingMode} onChange={v => set('mergeNamingMode', v)} disabled={disabled('mergeNamingMode')} options={[
        { value: 'commissioner', label: m.mergeByCommish },
        { value: 'manager_vote', label: m.mergeByVote },
      ]} />
    </SvkField>
  </>
}

export function SurvivorExileExtras({ draft, set, disabled, lockNote }: ExtraProps) {
  const m = useMessages(survivorSettingsExtrasMessages)
  return <SvkField title={m.harsh} hint={m.harshHint}>
    {lockNote('exileHarshTokenLoss')}
    <SvkToggle label={m.harsh} checked={draft.exileHarshTokenLoss} onChange={v => set('exileHarshTokenLoss', v)} disabled={disabled('exileHarshTokenLoss')} testId="survivor-settings-harsh" />
  </SvkField>
}
