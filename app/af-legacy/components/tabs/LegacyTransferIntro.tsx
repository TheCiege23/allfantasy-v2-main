'use client'

export default function LegacyTransferIntro({
  subtitle,
}: {
  subtitle: string
}) {
  return (
    <>
      <p className="text-center text-sm sm:text-base text-white/60 mb-4">{subtitle}</p>
      <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-500/10 to-cyan-500/10 border border-emerald-400/20 mb-6">
        <p className="text-sm text-gray-300">
          <span className="text-emerald-400 font-semibold">Full League Migration</span> - Transfer your complete Sleeper league history,
          settings, and data to AllFantasy with one click. Everything stays intact.
        </p>
      </div>
    </>
  )
}
