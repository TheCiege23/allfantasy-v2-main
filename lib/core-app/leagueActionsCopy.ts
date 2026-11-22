import type { LeagueAction, LeagueCardState } from './leagueActions'
import { messagesFor } from '@/lib/i18n/messages'
import { leagueActionsMessages } from './messages/leagueActions'

/**
 * Words for the per-league action cards and sheet (leagueActions.ts) and the phone-only search
 * dock and folds (2026-10-08). Pure, client-safe; English and Spanish, in
 * lib/core-app/messages/leagueActions.ts.
 */

export type LeagueActionsCopy = {
  cardsLabel: string
  cardsHint: string
  actionLabel: (a: LeagueAction, last: string) => string
  state: (s: LeagueCardState, owner: string | null) => string
  bestBall: string
  nothingHere: string
  moreFor: (league: string) => string
  sheetTitle: (last: string, league: string) => string
  close: string
  readOnly: string
  dockSearch: string
  foldShow: (title: string) => string
  foldHide: (title: string) => string
  foldNews: string
  foldValue: string
  foldDepth: string
  foldWhoStarts: string
  foldSeason: string
}

export function leagueActionsCopy(language: string): LeagueActionsCopy {
  return messagesFor(leagueActionsMessages, language)
}
