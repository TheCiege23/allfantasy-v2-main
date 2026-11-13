import { getV2Rankings } from "./v2-adapter"

type PartnerProfile = {
  rosterId: string
  name: string
  sampleSize: number
  ldiByPos: Record<string, number>
  meanPremiumPctByPos: Record<string, number>
  topOverpayPos?: string
  topDiscountPos?: string
  tags: Array<"Active Trader" | "Aggressive" | "Pick Hoarder" | "Learning">
}

export async function buildPartnerProfiles(args: { leagueId: string; week: number }) {
  const v2 = await getV2Rankings(args)

  const profiles: PartnerProfile[] = (v2.partnerTendencies ?? []).map((t: any) => {
    const name = String(t.name ?? t.teamName ?? `Roster ${t.rosterId}`)
    const rosterId = String(t.rosterId)
    const sampleSize = Number(t.sampleSize ?? t.sample ?? 0)

    const ldiByPos: Record<string, number> = t.ldiByPos ?? {}
    const prem: Record<string, number> = t.meanPremiumPctByPos ?? {}

    const sortedHigh = Object.entries(prem).sort((a, b) => Number(b[1]) - Number(a[1]))
    const sortedLow = Object.entries(prem).sort((a, b) => Number(a[1]) - Number(b[1]))

    const tags: PartnerProfile["tags"] = []
    if (sampleSize < 3) tags.push("Learning")
    else tags.push("Active Trader")
    if (Number(t.aggressionIndex ?? 0) >= 0.7) tags.push("Aggressive")
    if (Number(t.pickTradingIndex ?? 0) >= 0.7) tags.push("Pick Hoarder")

    return {
      rosterId,
      name,
      sampleSize,
      ldiByPos,
      meanPremiumPctByPos: prem,
      topOverpayPos: sortedHigh[0]?.[0],
      topDiscountPos: sortedLow[0]?.[0],
      tags
    }
  })

  return {
    leagueId: v2.leagueId,
    leagueName: v2.leagueName,
    season: v2.season,
    week: v2.week,
    profiles
  }
}
