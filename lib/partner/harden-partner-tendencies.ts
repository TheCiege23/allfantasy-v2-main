type LdiPos = "QB" | "RB" | "WR" | "TE" | "PICK"

type PartnerTendency = {
  partnerRosterId?: number | string
  partnerName?: string
  partnerUserId?: string
  sampleTrades?: number

  ldiByPos?: Partial<Record<LdiPos, number>>
  meanPremiumByPos?: Partial<Record<LdiPos, number>>
  posCounts?: Partial<Record<LdiPos, number>>

  topOverpayPos?: LdiPos[]
  topDiscountPos?: LdiPos[]
  notes?: string[]
  label?: string
}

type HardenedPartnerTendenciesResponse = {
  leagueId: string
  leagueName?: string
  season?: number
  week?: number | null

  isOffseason: boolean
  fallbackMode: boolean

  partnerTendencies: PartnerTendency[]
  partnerPosCounts: Record<LdiPos, number>

  tradesAnalyzed: number
  partnersAnalyzed: number
  minTradesForPartnerSignal: number
  minPartnersForLeagueSignal: number

  rankingSource:
    | "live_partner_signals"
    | "baseline_offseason"
    | "baseline_no_trades"
    | "baseline_insufficient_sample"
  rankingSourceNote: string
  warnings: string[]
}

function toNum(n: any, fallback: number) {
  const v = Number(n)
  return Number.isFinite(v) ? v : fallback
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function emptyPosCounts(): Record<LdiPos, number> {
  return { QB: 0, RB: 0, WR: 0, TE: 0, PICK: 0 }
}

export function hardenPartnerTendenciesResponse(args: {
  raw: any
  leagueId: string
  leagueName?: string
  season?: number
  week?: number | null
  isOffseason: boolean
  minTradesForPartnerSignal?: number
  minPartnersForLeagueSignal?: number
}): HardenedPartnerTendenciesResponse {
  const {
    raw,
    leagueId,
    leagueName,
    season,
    week,
    isOffseason,
    minTradesForPartnerSignal = 6,
    minPartnersForLeagueSignal = 3,
  } = args

  const warnings: string[] = []

  const rawArr = Array.isArray(raw) ? raw : raw?.partnerTendencies ?? raw?.partner_tendencies
  const partnerTendencies: PartnerTendency[] = Array.isArray(rawArr) ? rawArr : []

  const tradesAnalyzed = toNum(raw?.tradesAnalyzed ?? raw?.trades_analyzed, 0)
  const partnersAnalyzed = toNum(
    raw?.partnersAnalyzed ?? raw?.partners_analyzed ?? partnerTendencies.length,
    partnerTendencies.length
  )

  const rawCounts = raw?.partnerPosCounts ?? raw?.partner_pos_counts
  let partnerPosCounts: Record<LdiPos, number> = emptyPosCounts()

  if (rawCounts && typeof rawCounts === "object") {
    partnerPosCounts = {
      QB: toNum(rawCounts.QB, 0),
      RB: toNum(rawCounts.RB, 0),
      WR: toNum(rawCounts.WR, 0),
      TE: toNum(rawCounts.TE, 0),
      PICK: toNum(rawCounts.PICK, 0),
    }
  } else if (partnerTendencies.length > 0) {
    const sum = emptyPosCounts()
    for (const p of partnerTendencies) {
      const c = p.posCounts || {}
      ;(["QB", "RB", "WR", "TE", "PICK"] as LdiPos[]).forEach(pos => {
        sum[pos] += toNum((c as any)[pos], 0)
      })
    }
    partnerPosCounts = sum
  } else {
    warnings.push("Missing partnerPosCounts; returned safe default.")
  }

  const hasAnyTrades = tradesAnalyzed > 0

  const meaningfulPartners = partnerTendencies.filter(p => toNum(p.sampleTrades, 0) >= minTradesForPartnerSignal)
  const meaningfulPartnerCount = meaningfulPartners.length

  let rankingSource: HardenedPartnerTendenciesResponse["rankingSource"] = "live_partner_signals"
  let rankingSourceNote =
    "Partner tendencies computed from in-league trade history and per-partner premium signals."

  const insufficient =
    !hasAnyTrades ||
    meaningfulPartnerCount < minPartnersForLeagueSignal ||
    tradesAnalyzed < minTradesForPartnerSignal

  if (isOffseason && !hasAnyTrades) {
    rankingSource = "baseline_offseason"
    rankingSourceNote =
      "Offseason / preseason: no in-league trade sample yet. Partner tendencies will populate as trades occur."
    warnings.push("Partner tendencies in baseline mode (offseason, tradesAnalyzed=0).")
  } else if (!hasAnyTrades) {
    rankingSource = "baseline_no_trades"
    rankingSourceNote =
      "No in-league trades available for this league-season context. Partner tendencies will populate after trades occur."
    warnings.push("Partner tendencies in baseline mode (tradesAnalyzed=0).")
  } else if (meaningfulPartnerCount < minPartnersForLeagueSignal) {
    rankingSource = "baseline_insufficient_sample"
    rankingSourceNote =
      `Trade sample exists, but not enough partners meet the minimum sample threshold (${minTradesForPartnerSignal}+ trades). Showing dampened/limited partner signals.`
    warnings.push("Insufficient partner sample — per-partner signals are muted.")
  }

  const sanitized = partnerTendencies.map(p => {
    const ldi = p.ldiByPos || {}
    const mean = p.meanPremiumByPos || {}
    return {
      ...p,
      ldiByPos: {
        QB: ldi.QB != null ? clamp(toNum(ldi.QB, 50), 0, 100) : undefined,
        RB: ldi.RB != null ? clamp(toNum(ldi.RB, 50), 0, 100) : undefined,
        WR: ldi.WR != null ? clamp(toNum(ldi.WR, 50), 0, 100) : undefined,
        TE: ldi.TE != null ? clamp(toNum(ldi.TE, 50), 0, 100) : undefined,
        PICK: ldi.PICK != null ? clamp(toNum(ldi.PICK, 50), 0, 100) : undefined,
      },
      meanPremiumByPos: {
        QB: mean.QB != null ? toNum(mean.QB, 0) : undefined,
        RB: mean.RB != null ? toNum(mean.RB, 0) : undefined,
        WR: mean.WR != null ? toNum(mean.WR, 0) : undefined,
        TE: mean.TE != null ? toNum(mean.TE, 0) : undefined,
        PICK: mean.PICK != null ? toNum(mean.PICK, 0) : undefined,
      },
    }
  })

  const looksEmpty =
    !raw ||
    (typeof raw === "object" && Object.keys(raw).length < 2) ||
    (sanitized.length === 0 && tradesAnalyzed === 0)

  if (looksEmpty) {
    warnings.push("Raw partner tendencies payload was empty/near-empty; forced baseline contract.")
    return {
      leagueId,
      leagueName,
      season,
      week: week ?? null,
      isOffseason,
      fallbackMode: true,

      partnerTendencies: [],
      partnerPosCounts: emptyPosCounts(),

      tradesAnalyzed: 0,
      partnersAnalyzed: 0,
      minTradesForPartnerSignal,
      minPartnersForLeagueSignal,

      rankingSource: isOffseason ? "baseline_offseason" : "baseline_no_trades",
      rankingSourceNote: isOffseason
        ? "Offseason / preseason: partner tendencies will populate after trades occur."
        : "No trade sample: partner tendencies will populate after trades occur.",
      warnings,
    }
  }

  return {
    leagueId,
    leagueName,
    season,
    week: week ?? null,
    isOffseason,
    fallbackMode: insufficient || isOffseason,

    partnerTendencies: sanitized,
    partnerPosCounts,

    tradesAnalyzed,
    partnersAnalyzed,
    minTradesForPartnerSignal,
    minPartnersForLeagueSignal,

    rankingSource,
    rankingSourceNote,
    warnings,
  }
}
