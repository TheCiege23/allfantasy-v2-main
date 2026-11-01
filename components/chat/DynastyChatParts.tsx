'use client'

import { ListOrdered } from 'lucide-react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import {
  pickChipTone,
  pickSlotLabel,
  type DynastyDraftOrderNotice,
  type DynastySeasonClock,
} from '@/lib/league-chat/dynastyChatSkin'

/**
 * The dynasty league chat's own pieces (Dynasty Era, step 2). Every one renders only inside a
 * dynasty league's chat — non-dynasty leagues never mount them, so their chat is unchanged.
 * Styles: components/chat/league-chat-channels.css, scoped under `[data-dynasty-background=true]`.
 */

/** "Year 4 · 2026" under the league name. Absent when the clock cannot be derived. */
export function DynastySeasonClockLine({ clock }: { clock: DynastySeasonClock }) {
  const { tInterpolate } = useOptionalLanguage()
  return (
    <p className="lcc-dyn-clock" data-testid="dynasty-chat-clock">
      {tInterpolate('dynastyChat.clock', { year: clock.year, season: clock.season })}
    </p>
  )
}

/**
 * A draft pick as a chip. R1 wears the gold outline, later rounds the line outline, and a pick
 * whose round the message never recorded wears the line outline and says only "Pick".
 */
export function DynastyPickChip({
  round = null,
  season = null,
  slot = null,
  name = null,
  via = null,
}: {
  round?: number | null
  season?: number | null
  /** The pick's place in its round, when it is a draft-order slot ("1.04"). */
  slot?: number | null
  /** The team holding a draft-order slot. */
  name?: string | null
  /** The team the pick originally belonged to, when the message says. */
  via?: string | null
}) {
  const { t, tInterpolate } = useOptionalLanguage()
  const tone = pickChipTone(round)
  let text: string
  if (tone !== 'unknown' && slot != null && slot > 0) {
    text = pickSlotLabel(round!, slot)
  } else if (tone !== 'unknown') {
    text = tInterpolate('dynastyChat.pick.round', { round: round! })
    if (season != null) text = `${season} ${text}`
  } else {
    text = t('dynastyChat.pick')
  }
  const owner = name?.trim() || null
  const origin = via?.trim() || null
  return (
    <span className="lcc-dyn-pick" data-tone={tone} data-testid="dynasty-pick-chip">
      <span className="lcc-dyn-pick-label">{text}</span>
      {owner ? <span className="lcc-dyn-pick-name">{owner}</span> : null}
      {origin ? <span className="lcc-dyn-pick-via"> · {tInterpolate('dynastyChat.pick.via', { team: origin })}</span> : null}
    </span>
  )
}

/** "Trade accepted", in teal, over a completed trade card in a dynasty league's chat. */
export function DynastyTradeEyebrow() {
  const { t } = useOptionalLanguage()
  return <p className="lcc-dyn-trade-eyebrow">{t('dynastyChat.trade.eyebrow')}</p>
}

/** The gold card on a draft-order announcement. The announcement's own words stay in the bubble. */
export function DynastyDraftOrderCard({ notice }: { notice: DynastyDraftOrderNotice }) {
  const { t } = useOptionalLanguage()
  const eyebrow =
    notice.kind === 'randomized'
      ? t('dynastyChat.order.randomized')
      : notice.final
        ? t('dynastyChat.order.rookieFinal')
        : t('dynastyChat.order.rookieUpdate')
  return (
    <div className="lcc-dyn-order" data-testid="dynasty-draft-order-card" data-kind={notice.kind}>
      <div className="lcc-dyn-order-head">
        <span className="lcc-dyn-order-tile" aria-hidden="true">
          <ListOrdered size={18} />
        </span>
        <span className="lcc-dyn-order-eyebrow">{eyebrow}</span>
      </div>
      {notice.kind === 'randomized' ? (
        <ol className="lcc-dyn-order-slots" aria-label={t('dynastyChat.order.label')}>
          {notice.order.map((owner, i) => (
            <li key={`${i}-${owner}`}>
              <DynastyPickChip round={1} slot={i + 1} name={owner || t('dynastyChat.order.openSlot')} />
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}
