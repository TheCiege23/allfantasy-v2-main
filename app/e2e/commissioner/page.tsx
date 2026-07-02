import CommissionerTab from '@/components/app/tabs/CommissionerTab'

type E2eCommissionerPageProps = {
  searchParams?: {
    leagueId?: string
  }
}

export default function E2eCommissionerPage({ searchParams }: E2eCommissionerPageProps) {
  const leagueId = searchParams?.leagueId?.trim() || 'e2e-commissioner-league'

  return (
    <main className="min-h-screen bg-[#030712] p-4 text-white sm:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="rounded-2xl border border-white/10 bg-black/30 p-4">
          <h1 className="text-lg font-semibold">E2E commissioner harness</h1>
          <p className="mt-1 text-xs text-white/60">
            Deterministic browser harness for lineup audit, lock rules, and commissioner roster correction controls.
          </p>
        </header>
        <CommissionerTab leagueId={leagueId} />
      </div>
    </main>
  )
}
