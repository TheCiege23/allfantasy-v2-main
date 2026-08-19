import type { ReactNode } from "react"
import Link from "next/link"
import ProductShellLayout from "@/components/navigation/ProductShellLayout"

const LEGACY_TABS = [
  { href: "/af-legacy?tab=overview", label: "Overview" },
  { href: "/af-legacy?tab=transfer", label: "Imports" },
  { href: "/af-legacy?tab=player-finder", label: "Team Scan" },
  { href: "/af-legacy?tab=rankings", label: "Team Direction" },
  { href: "/af-legacy?tab=mock-draft", label: "AF Legacy Draft" },
  { href: "/af-legacy?tab=trade", label: "Trade Command Center" },
  { href: "/af-legacy?tab=finder", label: "Trade Review" },
  { href: "/af-legacy?tab=strategy", label: "Renegotiation" },
  { href: "/af-legacy?tab=pulse", label: "Market Board" },
  { href: "/af-legacy?tab=waiver", label: "Waiver Engine" },
  { href: "/af-legacy?tab=compare", label: "Opponent Behavior" },
  { href: "/af-legacy?tab=share", label: "League Fairness" },
  { href: "/af-legacy?tab=chat", label: "Chimmy Chat" },
] as const

export default function AFLegacyLayout({ children }: { children: ReactNode }) {
  return (
    <ProductShellLayout>
      <div className="mx-auto mt-4 w-full max-w-6xl px-4 sm:px-6">
        <div className="flex gap-2 overflow-x-auto rounded-xl border border-white/10 bg-white/[0.03] p-2">
          {LEGACY_TABS.map((tab) => (
            <Link
              key={tab.label}
              href={tab.href}
              className="whitespace-nowrap rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10"
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </div>
      {children}
    </ProductShellLayout>
  )
}
