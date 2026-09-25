import { readProactiveFrom } from '@/lib/chimmy-alerts/proactiveLinks'
import { recordProactiveOpen } from '@/lib/chimmy-alerts/recordProactiveOpen'
import { ChimmyChatPageClient } from './ChimmyChatPageClient'

function firstParam(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0]
  return v
}

export default async function ChimmyChatPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = searchParams ? await searchParams : {}

  /*
   * Opened from a weekly Chimmy message (lineup / waiver check) — count the open, so we can tell
   * whether those messages bring anyone in. Only a known tag is recorded; see proactiveLinks.ts.
   *
   * Awaited, because it reads the session and a request-scoped read is only safe inside the render
   * on Next 14 (no `after()`). Bounded, because a count must never hold up the page: past 1.5s the
   * page renders and the write finishes on its own. It never throws.
   */
  const from = readProactiveFrom(firstParam(sp.from))
  if (from) {
    await Promise.race([
      recordProactiveOpen({ from, leagueId: firstParam(sp.leagueId) ?? null }),
      new Promise<void>((resolve) => setTimeout(resolve, 1500)),
    ])
  }

  return (
    <ChimmyChatPageClient
      prompt={firstParam(sp.prompt)}
      leagueId={firstParam(sp.leagueId)}
      sport={firstParam(sp.sport)}
      teamId={firstParam(sp.teamId)}
      week={firstParam(sp.week)}
      strategyMode={firstParam(sp.strategyMode)}
    />
  )
}
