/**
 * Environment badge — makes the current environment unmistakable, with
 * production getting a persistent warning treatment (spec: "Production must be
 * visually unmistakable").
 *
 * Intentionally non-interactive: there is no environment "switcher" here.
 * Environment is a fact of the deployment, not something an operator toggles
 * from the UI, so this is a labelled indicator, not a dropdown.
 */
import type { OperatorEnvironment } from "@/lib/admin-dashboard/operatorEnvironment"

const STYLES: Record<OperatorEnvironment["key"], { chip: string; dot: string }> = {
  production: {
    chip: "border-rose-500/50 bg-rose-500/15 text-rose-100 ring-1 ring-inset ring-rose-500/30",
    dot: "bg-rose-500",
  },
  staging: {
    chip: "border-amber-400/45 bg-amber-400/10 text-amber-100",
    dot: "bg-amber-400",
  },
  development: {
    chip: "border-white/15 bg-white/[0.05] text-slate-300",
    dot: "bg-slate-400",
  },
}

export function EnvironmentBadge({
  environment,
  className = "",
}: {
  environment: OperatorEnvironment
  className?: string
}) {
  const style = STYLES[environment.key]
  return (
    <span
      title={environment.description}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.14em] ${style.chip} ${className}`}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${style.dot}`} aria-hidden />
      {environment.label}
    </span>
  )
}
