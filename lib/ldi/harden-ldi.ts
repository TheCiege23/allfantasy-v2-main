type LdiPos = "QB" | "RB" | "WR" | "TE" | "PICK"

type HardenedLdiResponse = {
  leagueId: string
  leagueName?: string
  season?: number
  week?: number | null
  isOffseason: boolean
  fallbackMode: boolean

  tradesAnalyzed: number
  sampleSize: number
  partnerCount: number

  ldiByPos: Record<LdiPos, number>
  positionDemandNorm: Record<LdiPos, number>
  pickDemand: { early: number; mid: number; late: number }
  demandByPosition: Record<LdiPos, any>
  hotPlayers: Array<any>
  perPlayerDemand: Record<string, any>

  rankingSource: "live_league_trades" | "baseline_no_trades" | "baseline_offseason" | "baseline_insufficient_sample"
  rankingSourceNote: string
  warnings: string[]
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function toNum(n: any, fallback: number) {
  const v = Number(n)
  return Number.isFinite(v) ? v : fallback
}

function baselineLdiByPos(): Record<LdiPos, number> {
  return { QB: 50, RB: 50, WR: 50, TE: 50, PICK: 50 }
}

function baselinePickDemand() {
  return { early: 50, mid: 50, late: 50 }
}

export function hardenLdiResponse(args: {
  raw: any
  leagueId: string
  leagueName?: string
  season?: number
  week?: number | null
  isOffseason: boolean
}): HardenedLdiResponse {
  const { raw, leagueId, leagueName, season, week, isOffseason } = args

  const warnings: string[] = []

  const tradesAnalyzed = toNum(raw?.tradesAnalyzed ?? raw?.trades_analyzed, 0)
  const sampleSize = toNum(raw?.sampleSize ?? raw?.sample_size ?? tradesAnalyzed, tradesAnalyzed)
  const partnerCount = toNum(raw?.partnerCount ?? raw?.partner_count, 0)

  const insufficient = tradesAnalyzed < 1 || sampleSize < 1

  const rawLdiByPos = raw?.ldiByPos ?? raw?.ldi_by_pos ?? raw?.positionDemand ?? raw?.position_demand
  const ldiByPos: Record<LdiPos, number> = {
    QB: clamp(toNum(rawLdiByPos?.QB, 50), 0, 100),
    RB: clamp(toNum(rawLdiByPos?.RB, 50), 0, 100),
    WR: clamp(toNum(rawLdiByPos?.WR, 50), 0, 100),
    TE: clamp(toNum(rawLdiByPos?.TE, 50), 0, 100),
    PICK: clamp(toNum(rawLdiByPos?.PICK, 50), 0, 100),
  }

  const rawPositionDemand = raw?.positionDemand ?? raw?.position_demand ?? raw?.demandByPosition ?? raw?.demand_by_position
  const positionDemandNorm: Record<LdiPos, number> = {
    QB: clamp(toNum(rawPositionDemand?.QB, ldiByPos.QB), 0, 100),
    RB: clamp(toNum(rawPositionDemand?.RB, ldiByPos.RB), 0, 100),
    WR: clamp(toNum(rawPositionDemand?.WR, ldiByPos.WR), 0, 100),
    TE: clamp(toNum(rawPositionDemand?.TE, ldiByPos.TE), 0, 100),
    PICK: clamp(toNum(rawPositionDemand?.PICK, ldiByPos.PICK), 0, 100),
  }

  const rawPickDemand = raw?.pickDemand ?? raw?.pick_demand
  const pickDemand = {
    early: clamp(toNum(rawPickDemand?.early, 50), 0, 100),
    mid: clamp(toNum(rawPickDemand?.mid, 50), 0, 100),
    late: clamp(toNum(rawPickDemand?.late, 50), 0, 100),
  }

  const demandByPosition = raw?.demandByPosition ?? raw?.demand_by_position ?? {}
  const hotPlayers = Array.isArray(raw?.hotPlayers ?? raw?.hot_players) ? (raw?.hotPlayers ?? raw?.hot_players) : []
  const perPlayerDemand = raw?.perPlayerDemand ?? raw?.per_player_demand ?? {}

  let rankingSource: HardenedLdiResponse["rankingSource"] = "live_league_trades"
  let rankingSourceNote = "League trade demand index computed from in-league trade history."

  if (isOffseason && insufficient) {
    rankingSource = "baseline_offseason"
    rankingSourceNote =
      "Offseason / preseason: no meaningful in-league trade sample yet. Using baseline demand (50) until trades occur."
    warnings.push("LDI uses baseline demand in offseason when tradesAnalyzed=0.")
  } else if (insufficient) {
    rankingSource = "baseline_no_trades"
    rankingSourceNote =
      "No in-league trades available for this league-season context. Using baseline demand (50) until trades occur."
    warnings.push("LDI uses baseline demand when tradesAnalyzed=0.")
  } else if (partnerCount > 0 && partnerCount < 3) {
    rankingSource = "baseline_insufficient_sample"
    rankingSourceNote =
      "Trade sample exists, but partner sample is too small for strong per-manager signals. Showing dampened demand."
    warnings.push("Partner sample small — per-manager tendencies may be muted.")
  }

  const mustHaveObj = (val: any, key: string) => {
    if (!val || typeof val !== "object") warnings.push(`Missing/invalid ${key}; returned safe default.`)
  }
  mustHaveObj(demandByPosition, "demandByPosition")
  mustHaveObj(perPlayerDemand, "perPlayerDemand")

  const fallbackMode = insufficient || isOffseason

  const looksEmpty =
    !raw ||
    (typeof raw === "object" && Object.keys(raw).length < 3) ||
    (tradesAnalyzed === 0 && hotPlayers.length === 0 && (!perPlayerDemand || Object.keys(perPlayerDemand).length === 0))

  if (looksEmpty) {
    warnings.push("Raw LDI payload was empty/near-empty; forced baseline contract.")
    return {
      leagueId,
      leagueName,
      season,
      week: week ?? null,
      isOffseason,
      fallbackMode: true,

      tradesAnalyzed: 0,
      sampleSize: 0,
      partnerCount: 0,

      ldiByPos: baselineLdiByPos(),
      positionDemandNorm: baselineLdiByPos(),
      pickDemand: baselinePickDemand(),
      demandByPosition: { QB: 0, RB: 0, WR: 0, TE: 0, PICK: 0 },
      hotPlayers: [],
      perPlayerDemand: {},

      rankingSource: isOffseason ? "baseline_offseason" : "baseline_no_trades",
      rankingSourceNote: isOffseason
        ? "Offseason / preseason: baseline demand until trades occur."
        : "No trade sample: baseline demand until trades occur.",
      warnings,
    }
  }

  return {
    leagueId,
    leagueName,
    season,
    week: week ?? null,
    isOffseason,
    fallbackMode,

    tradesAnalyzed,
    sampleSize,
    partnerCount,

    ldiByPos,
    positionDemandNorm,
    pickDemand,
    demandByPosition,
    hotPlayers,
    perPlayerDemand,

    rankingSource,
    rankingSourceNote,
    warnings,
  }
}
