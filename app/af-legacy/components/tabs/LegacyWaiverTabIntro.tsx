'use client'

export default function LegacyWaiverTabIntro() {
  return (
    <>
      <p className="text-center text-sm sm:text-base text-white/60 mb-4">League-specific, goal-aware analysis with 4 scoring dimensions - not generic advice.</p>
      <div className="flex items-start sm:items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500/30 to-emerald-500/30 flex items-center justify-center text-xl flex-shrink-0">
          <span className="text-emerald-400 text-base">&#x2197;</span>
        </div>
        <div>
          <h3 className="text-lg sm:text-xl font-bold text-cyan-400">Waiver Chimmy</h3>
          <p className="text-xs sm:text-sm text-gray-400">Find the best adds for your team and league</p>
        </div>
      </div>
    </>
  )
}
