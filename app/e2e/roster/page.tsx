import RosterBoard from '@/components/app/roster/RosterBoard'

type E2eRosterPageProps = {
  searchParams?: {
    leagueId?: string
  }
}

export default function E2eRosterPage({ searchParams }: E2eRosterPageProps) {
  const leagueId = searchParams?.leagueId?.trim() || 'e2e-roster-league'

  return (
    <main className="min-h-screen bg-[#030712] p-4 text-white sm:p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <header className="rounded-2xl border border-white/10 bg-black/30 p-4">
          <h1 className="text-lg font-semibold">E2E roster harness</h1>
          <p className="mt-1 text-xs text-white/60">
            Deterministic browser harness for roster slot movement, IR, save wiring, and reload persistence.
          </p>
        </header>
        <RosterBoard leagueId={leagueId} />
      </div>
    </main>
  )
}
