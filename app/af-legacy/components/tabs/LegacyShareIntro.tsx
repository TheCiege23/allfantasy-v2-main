'use client'

export default function LegacyShareIntro({
  shareRemaining,
  shareCooldownMs,
}: {
  shareRemaining: number | null
  shareCooldownMs: number
}) {
  const secs = Math.max(0, Math.ceil(shareCooldownMs / 1000))

  return (
    <>
      <p className="text-center text-sm sm:text-base mode-muted mb-4">Turn your fantasy career into a shareable report card.</p>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-lg sm:text-xl font-bold text-cyan-400">Share Your Legacy</h3>
          <span className="rounded-full border px-2 py-0.5 text-[11px]" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
            {secs > 0 ? `Cooldown ${secs}s` : 'Ready'}
          </span>
        </div>

        {shareRemaining != null && (
          <div className="text-[11px] mode-muted">Remaining: {shareRemaining}</div>
        )}
      </div>
    </>
  )
}
