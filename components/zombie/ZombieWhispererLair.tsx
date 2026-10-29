'use client'

/*
 * The Whisperer's lair (design handoff ZombieWhisperer), read-only for this season: whether the league
 * knows who you are, the horde you've turned, and what you hold. Ambushes and powers are tracked but do
 * nothing yet — the engine has no ambush re-pairing or power effects — so there is nothing to set and no
 * button promising otherwise. Rendered only for the Whisperer themself; every name in it is the viewer's
 * own doing.
 */

const POWERS = ['Horde command', 'Dark whisper', 'Infection override', 'Mass serum burn']

export function ZombieWhispererLair({
  isPublic,
  horde,
  ambushes,
}: {
  isPublic: boolean
  horde: readonly string[]
  ambushes: number
}) {
  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-violet-400/30 bg-[linear-gradient(180deg,rgba(60,30,90,0.35),rgba(7,8,13,0.92))] p-4 sm:p-5"
      data-testid="zombie-whisperer-lair"
    >
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- local SVG */}
        <img src="/zombie/art/whisperer.svg" alt="" className="zombie-float h-14 w-14 shrink-0" />
        <div className="min-w-0">
          <h2 className="text-lg font-black uppercase tracking-tight text-violet-200">Your lair</h2>
          <p className="text-[13px] text-violet-100/80">
            {isPublic ? 'The whole league knows you are the Whisperer.' : 'Nobody knows you are the Whisperer. Keep it that way.'}
          </p>
        </div>
      </div>

      <h3 className="mt-4 text-[11px] font-bold uppercase tracking-[0.16em] text-violet-200/80">
        Your horde · {horde.length} turned
      </h3>
      {horde.length ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {horde.map((name) => (
            <li key={name} className="rounded-full border border-lime-400/30 bg-lime-500/10 px-2.5 py-1 text-[12px] font-semibold text-lime-100">
              {name}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[13px] text-white/60">Nobody yet. Every Survivor you beat turns.</p>
      )}

      <h3 className="mt-4 text-[11px] font-bold uppercase tracking-[0.16em] text-violet-200/80">What you hold</h3>
      <ul className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
        <li className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- local SVG */}
          <img src="/zombie/art/ambush.svg" alt="" className="h-8 w-8 shrink-0" />
          <span className="text-white/85">
            Ambushes <span className="font-mono text-violet-200">×{ambushes}</span>
          </span>
        </li>
        {POWERS.map((p, i) => (
          <li key={p} className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 p-2 opacity-70">
            {/* eslint-disable-next-line @next/next/no-img-element -- local SVG */}
            <img src={`/zombie/art/${['power-horde', 'power-whisper', 'power-override', 'power-burn'][i]}.svg`} alt="" className="h-8 w-8 shrink-0" />
            <span className="text-white/75">{p}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12px] text-white/50">Ambushes and powers are tracked this season but don&apos;t change matchups or scores yet.</p>
    </section>
  )
}
