'use client'

export function DevyImportPanel() {
  return (
    <div className="space-y-5 px-4 py-5 text-[13px] text-white/85 md:px-6">
      <div>
        <button
          type="button"
          disabled
          className="inline-flex min-h-[44px] cursor-not-allowed items-center justify-center rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-2 text-[13px] font-semibold text-white/40"
          data-testid="devy-open-import-wizard"
        >
          Open import wizard
        </button>
        <p className="mt-2 text-[12px] text-amber-200/80">Import surface not yet enabled in production.</p>
      </div>
      <section className="rounded-xl border border-white/[0.08] bg-[#0a1228] p-4">
        <h3 className="text-[12px] font-bold uppercase tracking-wide text-white/80">Connected sources</h3>
        <p className="mt-2 text-[12px] text-white/50">Past sources and re-import actions will list here after merge sessions.</p>
      </section>
    </div>
  )
}
