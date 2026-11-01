import type { Dash34Data } from '@/components/core-app/screens/Dashboard34'
import {
  briefCaveatText,
  briefHeadlineText,
  briefLineText,
  coverageText,
  dash34FixedText,
  firstLockText,
  noticeBodyText,
} from '@/lib/core-app/homeBandsCopy'
import { defineMessages } from '@/lib/i18n/messages'

type FirstLock = NonNullable<Dash34Data['firstLock']>
type Brief = NonNullable<Dash34Data['chimmyBrief']>
type BriefLine = Brief['lines'][number]
type Notice = NonNullable<Dash34Data['notice']>
type Coverage = NonNullable<Dash34Data['coverage']>[number]

/**
 * Carryover + coverage (components/core-app/screens/Dash34CarryoverView.tsx). Every string is the one
 * the cards printed before the move, byte for byte, in both languages — this is a relocation, not a
 * rewrite. The server-written sentences are still rebuilt from their parts by `homeBandsCopy`; the
 * entries below only choose, per language, whether to rebuild: English prints the server's words as
 * written, Spanish rebuilds and falls back to them where `homeBandsCopy` has nothing.
 *
 * The `…DayLanguage` entries are the language handed to `Dash34When` beside a label: a Spanish day only
 * beside a Spanish label, never half of one.
 */
export const dashCarryoverMessages = defineMessages({
  en: {
    mostUrgent: 'Most urgent',
    chimmyBrief: 'Chimmy brief',
    notWatching: 'What this screen is not watching',
    fixed: (english: string): string => english,
    lockKickoff: (lock: FirstLock): string => lock.kickoffLabel,
    lockHeadline: (lock: FirstLock): string => lock.headline,
    lockOpen: (lock: FirstLock): string => lock.openLabel,
    lockDayLanguage: (_lock: FirstLock): string => 'en',
    noticeBody: (notice: Notice): string => notice.body,
    briefHeadline: (brief: Brief): string => brief.headline,
    briefLine: (line: BriefLine): string => line.text,
    briefLineDayLanguage: (_line: BriefLine): string => 'en',
    briefCaveat: (brief: Brief): string => brief.caveat,
    coverageLabel: (item: Coverage): string => item.label,
    coverageReason: (item: Coverage): string => item.reason,
  },
  es: {
    mostUrgent: 'Lo más urgente',
    chimmyBrief: 'Resumen de Chimmy',
    notWatching: 'Lo que esta pantalla no vigila',
    fixed: (english) => dash34FixedText(english) ?? english,
    lockKickoff: (lock) => firstLockText(lock)?.kickoffLabel ?? lock.kickoffLabel,
    lockHeadline: (lock) => firstLockText(lock)?.headline ?? lock.headline,
    lockOpen: (lock) => firstLockText(lock)?.openLabel ?? dash34FixedText(lock.openLabel) ?? lock.openLabel,
    lockDayLanguage: (lock) => (firstLockText(lock) ? 'es' : 'en'),
    noticeBody: (notice) => noticeBodyText(notice) ?? notice.body,
    briefHeadline: (brief) => briefHeadlineText(brief) ?? brief.headline,
    briefLine: (line) => briefLineText(line.parts) ?? line.text,
    briefLineDayLanguage: (line) => (briefLineText(line.parts) ? 'es' : 'en'),
    briefCaveat: (brief) => briefCaveatText(brief) ?? brief.caveat,
    coverageLabel: (item) => coverageText(item)?.label ?? item.label,
    coverageReason: (item) => coverageText(item)?.reason ?? item.reason,
  },
})
