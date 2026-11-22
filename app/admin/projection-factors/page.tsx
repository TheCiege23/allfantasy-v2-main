import Link from "next/link"
import { redirect } from "next/navigation"

import { getAdminAccessState } from "@/lib/adminAuth"
import { prisma } from "@/lib/prisma"
import { FACTOR_SPORTS, FACTOR_TABLE_KEY, projectionFactorsOn, AF_PROJECTION_FACTORS_ENV, type StoredFactorTable } from "@/lib/af-projections/factors/factorLearning"
import { factorReason } from "@/lib/af-projections/factors/factorTables"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const metadata = { robots: { index: false, follow: false } }

/**
 * AF projection factors (owner's call 2026-11-22): per sport, what each situation (back-to-back, hot streak, playing
 * time, opponent, new team, a return) did to scoring, measured on past games, and whether it made LATER games'
 * projections closer — the only test a factor has to pass before it moves a projection. Rules:
 * lib/af-projections/factors/factorLearner.ts. Read-only.
 */
export default async function ProjectionFactorsPage() {
  const gate = await getAdminAccessState()
  if (gate.status === "unauthenticated") redirect("/admin-login?next=/admin/projection-factors")
  if (gate.status === "forbidden") {
    return (
      <main className="min-h-dvh bg-[#020817] p-8 text-white">
        <p className="text-rose-300">Forbidden — admin access required.</p>
      </main>
    )
  }

  const rows = await prisma.sportsDataCache
    .findMany({ where: { cacheKey: { in: FACTOR_SPORTS.map(FACTOR_TABLE_KEY) } }, select: { cacheKey: true, data: true } })
    .catch(() => [])
  const tables = new Map(rows.map((r) => [r.cacheKey, r.data as StoredFactorTable | null]))
  const on = projectionFactorsOn()

  return (
    <main className="min-h-dvh bg-[#020817] text-white">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6" data-testid="admin-projection-factors">
        <div>
          <Link href="/admin" className="text-xs text-cyan-300/80">← Admin</Link>
          <h1 className="mt-1 text-2xl font-black">AF projection factors</h1>
          <p className="text-sm text-white/60">
            What each situation did to scoring in past games, and whether it made later games&apos; projections closer.
            Only <b>published</b> factors move a projection. {AF_PROJECTION_FACTORS_ENV} is {on ? "on" : "off"} on this service.
          </p>
        </div>
        {FACTOR_SPORTS.map((sport) => {
          const t = tables.get(FACTOR_TABLE_KEY(sport))
          return (
            <section key={sport} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4" data-sport={sport}>
              <h2 className="text-base font-bold">{sport}</h2>
              {!t ? (
                <p className="mt-1 text-sm text-white/55">Not learned yet. The maintenance job learns one sport per run.</p>
              ) : (
                <>
                  <p className="mt-1 text-xs text-white/60" data-testid={`factors-summary-${sport}`}>
                    Learned {t.generatedAt.slice(0, 16).replace("T", " ")} UTC from {t.observations.toLocaleString("en-US")} games.{" "}
                    {t.overall.improvementPct == null
                      ? "Not enough later games to check the whole model yet."
                      : `On the ${t.overall.games.toLocaleString("en-US")} most recent games, the published factors were ${t.overall.improvementPct > 0 ? `${t.overall.improvementPct}% closer to` : `${-t.overall.improvementPct}% further from`} what was scored than the trailing average alone.`}
                  </p>
                  <ul className="mt-3 grid gap-1.5 text-sm">
                    {t.levels.map((l) => (
                      <li key={`${l.factor}:${l.level}`} className="flex flex-col gap-0.5 border-t border-white/5 pt-1.5 sm:flex-row sm:items-baseline sm:gap-3" data-published={l.published ? "" : undefined}>
                        <span className={`shrink-0 rounded px-1.5 text-[11px] font-semibold ${l.published ? "bg-emerald-400/15 text-emerald-200" : "bg-white/5 text-white/50"}`}>
                          {l.published ? "Published" : "Not used"}
                        </span>
                        <span className="min-w-0 text-white/85">{factorReason(l)}</span>
                        <span className="text-xs text-white/45 sm:ml-auto">{l.note}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )
        })}
      </div>
    </main>
  )
}
