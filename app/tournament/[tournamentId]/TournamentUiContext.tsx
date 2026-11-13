'use client'

import { createContext, useContext, useMemo } from 'react'
import type { TournamentLayoutPayload } from '@/lib/tournament/tournamentPageData'

export type TournamentUiContextValue = TournamentLayoutPayload & {
  viewerUserId: string | null
}

const Ctx = createContext<TournamentUiContextValue | null>(null)

export function TournamentUiProvider({
  value,
  children,
}: {
  value: TournamentUiContextValue
  children: React.ReactNode
}) {
  const memo = useMemo(() => value, [value])
  return <Ctx.Provider value={memo}>{children}</Ctx.Provider>
}

export function useTournamentUi(): TournamentUiContextValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTournamentUi must be used within TournamentUiProvider')
  return v
}

