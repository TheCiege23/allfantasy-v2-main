"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Users, Loader2, ChevronRight } from "lucide-react"
import { groupLeaguesBySport } from "@/lib/dashboard"
import type { LeagueForGrouping } from "@/lib/dashboard"
import { useLanguage } from "@/components/i18n/LanguageProviderClient"
import { DashboardSportGroups } from '@/components/dashboard/DashboardSportGroups'

export function ActiveLeaguesSection() {
  const { t } = useLanguage()
  const [leagues, setLeagues] = useState<LeagueForGrouping[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/league/list")
      .then((r) => (r.status === 401 ? { leagues: [] } : r.json()))
      .then((data) => {
        setLeagues(data.leagues ?? [])
      })
      .catch(() => setLeagues([]))
      .finally(() => setLoading(false))
  }, [])

  const groups = groupLeaguesBySport(leagues)

  if (loading) {
    return (
      <section className="card-premium p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Users className="h-4 w-4 text-cyan-400" />
            {t("dashboard.activeLeagues")}
          </div>
          <Link href="/leagues" className="text-xs text-muted hover:text-secondary">{t("dashboard.viewAll")}</Link>
        </div>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      </section>
    )
  }

  if (leagues.length === 0) {
    return (
      <section className="card-premium p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Users className="h-4 w-4 text-cyan-400" />
            {t("dashboard.activeLeagues")}
          </div>
          <Link href="/leagues" className="text-xs text-muted hover:text-secondary">{t("dashboard.viewAll")}</Link>
        </div>
        <p className="py-4 text-sm text-muted">{t("dashboard.activeLeagues.empty")}</p>
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300">{t("dashboard.action.openWebApp")} <ChevronRight className="h-3.5 w-3.5" /></Link>
      </section>
    )
  }

  return (
    <section className="card-premium p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Users className="h-4 w-4 text-cyan-400" />
          {t("dashboard.activeLeagues")}
        </div>
        <Link href="/leagues" className="text-xs text-muted hover:text-secondary">{t("dashboard.viewAll")}</Link>
      </div>
      <div className="space-y-6">
        <DashboardSportGroups
          groups={groups}
          maxPerGroup={3}
          emptyLeagueLabel={t('dashboard.unnamedLeague')}
        />
      </div>
    </section>
  )
}
