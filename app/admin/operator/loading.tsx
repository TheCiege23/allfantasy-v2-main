/**
 * Route-segment loading skeleton for the operator console. Server sections do
 * real DB/provider work; this gives immediate structure instead of a blank
 * flash while the segment streams in. The shell (layout) stays visible above it.
 */
export default function OperatorSectionLoading() {
  return (
    <div className="flex animate-pulse flex-col gap-5" aria-busy="true" aria-label="Loading section">
      <div className="h-8 w-64 rounded-lg bg-white/[0.06]" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-24 rounded-2xl border border-white/[0.06] bg-white/[0.03]" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="h-80 rounded-2xl border border-white/[0.06] bg-white/[0.03]" />
        <div className="h-80 rounded-2xl border border-white/[0.06] bg-white/[0.03]" />
      </div>
    </div>
  )
}
