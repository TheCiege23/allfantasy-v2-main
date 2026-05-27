"use client"

import { useEffect, useMemo, useState } from "react"
import { Globe2 } from "lucide-react"

/** Name → FIFA code lookup. Covers all 2022 + 2026 World Cup entrants. */
const TEAM_CODE_BY_NAME: Record<string, string> = {
  // 2022 entrants
  argentina: "ARG",
  australia: "AUS",
  belgium: "BEL",
  brazil: "BRA",
  canada: "CAN",
  colombia: "COL",
  croatia: "CRO",
  denmark: "DEN",
  ecuador: "ECU",
  england: "ENG",
  france: "FRA",
  germany: "GER",
  ghana: "GHA",
  iran: "IRN",
  japan: "JPN",
  mexico: "MEX",
  morocco: "MAR",
  netherlands: "NED",
  new_zealand: "NZL",
  "new zealand": "NZL",
  nigeria: "NGA",
  paraguay: "PAR",
  portugal: "POR",
  "saudi arabia": "KSA",
  senegal: "SEN",
  "south africa": "RSA",
  "south korea": "KOR",
  spain: "ESP",
  sweden: "SWE",
  switzerland: "SUI",
  tunisia: "TUN",
  uruguay: "URU",
  usa: "USA",
  "united states": "USA",
  // 2026 additions
  algeria: "ALG",
  austria: "AUT",
  "bosnia-herzegovina": "BIH",
  "bosnia herzegovina": "BIH",
  bolivia: "BOL",
  "cape verde": "CPV",
  "côte d'ivoire": "CIV",
  "ivory coast": "CIV",
  "cote d'ivoire": "CIV",
  curacao: "CUW",
  curaçao: "CUW",
  "czech republic": "CZE",
  czechia: "CZE",
  "dr congo": "COD",
  "democratic republic of congo": "COD",
  egypt: "EGY",
  haiti: "HAI",
  honduras: "HON",
  indonesia: "IDN",
  iraq: "IRQ",
  jamaica: "JAM",
  jordan: "JOR",
  kyrgyzstan: "KGZ",
  norway: "NOR",
  panama: "PAN",
  qatar: "QAT",
  scotland: "SCO",
  "el salvador": "SLV",
  thailand: "THA",
  turkey: "TUR",
  türkiye: "TUR",
  turkiye: "TUR",
  uzbekistan: "UZB",
  venezuela: "VEN",
  philippines: "PHI",
}

/** FIFA code → ISO 3166-1 alpha-2 for emoji flag synthesis. Covers 2022 + 2026. */
const FIFA_TO_ISO2: Record<string, string> = {
  // 2022 entrants
  ARG: "AR",
  AUS: "AU",
  BEL: "BE",
  BRA: "BR",
  CAN: "CA",
  COL: "CO",
  CRO: "HR",
  DEN: "DK",
  ECU: "EC",
  ENG: "GB",
  ESP: "ES",
  FRA: "FR",
  GER: "DE",
  GHA: "GH",
  IRN: "IR",
  JPN: "JP",
  KOR: "KR",
  KSA: "SA",
  MAR: "MA",
  MEX: "MX",
  NED: "NL",
  NGA: "NG",
  NZL: "NZ",
  PAR: "PY",
  POR: "PT",
  RSA: "ZA",
  SEN: "SN",
  SUI: "CH",
  SWE: "SE",
  TUN: "TN",
  URU: "UY",
  USA: "US",
  // 2026 additions
  ALG: "DZ",
  AUT: "AT",
  BIH: "BA",
  BOL: "BO",
  CIV: "CI",
  COD: "CD",
  CPV: "CV",
  CUW: "CW",
  CZE: "CZ",
  EGY: "EG",
  HAI: "HT",
  HON: "HN",
  IDN: "ID",
  IRQ: "IQ",
  JAM: "JM",
  JOR: "JO",
  KGZ: "KG",
  NOR: "NO",
  PAN: "PA",
  PHI: "PH",
  QAT: "QA",
  // SCO has no standard Unicode emoji (GB-SCT not supported everywhere) — falls through to 3-letter badge
  SLV: "SV",
  THA: "TH",
  TUR: "TR",
  UZB: "UZ",
  VEN: "VE",
}

const SIZE_CLASS = {
  xs: "h-5 w-5 text-[9px]",
  sm: "h-7 w-7 text-[10px]",
  md: "h-12 w-12 text-sm",
  lg: "h-16 w-16 text-xl sm:h-14 sm:w-14 sm:text-lg",
}

function isImageUrl(value?: string | null): value is string {
  return Boolean(value && (/^https?:\/\//i.test(value) || value.startsWith("/")))
}

function normalizeCode(value?: string | null): string | null {
  const code = value?.trim().toUpperCase().replace(/[^A-Z]/g, "")
  if (!code || code.length < 2 || code.length > 3) return null
  return code
}

function countryCodeFromName(teamName?: string | null): string | null {
  const key = teamName?.trim().toLowerCase()
  if (!key || key === "tbd") return null
  return TEAM_CODE_BY_NAME[key] ?? null
}

function flagCodeFromUrl(value?: string | null): string | null {
  if (!value) return null
  const match = value.toLowerCase().match(/\/([a-z]{2})(?:\.png|\.svg|\.jpg|\.webp)(?:\?|$)/)
  return match?.[1]?.toUpperCase() ?? null
}

function emojiFromIso2(value?: string | null): string | null {
  const code = normalizeCode(value)
  if (!code || code.length !== 2) return null
  const base = 127397
  return String.fromCodePoint(...code.split("").map((char) => base + char.charCodeAt(0)))
}

function emojiFromCode(value?: string | null): string | null {
  const code = normalizeCode(value)
  if (!code) return null
  return emojiFromIso2(code.length === 2 ? code : FIFA_TO_ISO2[code])
}

function emojiFromStoredValue(value?: string | null): string | null {
  const raw = value?.trim()
  if (!raw || isImageUrl(raw)) return null
  return /[^\u0000-\u007f]/.test(raw) ? raw : null
}

export default function WorldCupTeamFlag({
  flagUrl,
  teamName,
  countryCode,
  emoji,
  size = "sm",
  className = "",
  testId,
}: {
  flagUrl?: string | null
  teamName?: string | null
  countryCode?: string | null
  emoji?: string | null
  size?: keyof typeof SIZE_CLASS
  className?: string
  testId?: string
}) {
  const [imageFailed, setImageFailed] = useState(false)
  const label = teamName?.trim() || countryCode?.trim() || "Team"
  const imageSrc = isImageUrl(flagUrl) ? flagUrl : null

  useEffect(() => {
    setImageFailed(false)
  }, [imageSrc])

  const inferredCode = useMemo(
    () =>
      normalizeCode(countryCode) ??
      normalizeCode(!isImageUrl(flagUrl) ? flagUrl : null) ??
      countryCodeFromName(teamName) ??
      normalizeCode(flagCodeFromUrl(flagUrl)),
    [countryCode, flagUrl, teamName]
  )
  // Compute emoji fallback when:
  //   a) an explicit emoji/emojiUrl was stored (emojiFromStoredValue), OR
  //   b) the image failed to load (imageFailed), OR
  //   c) there is no image URL at all (!imageSrc) — in this case imageFailed
  //      never becomes true because no <img> is ever rendered, so we must
  //      eagerly derive the emoji from the inferred country code instead.
  const fallbackEmoji = useMemo(
    () =>
      emoji ||
      emojiFromStoredValue(flagUrl) ||
      (!imageSrc || imageFailed ? emojiFromCode(flagCodeFromUrl(flagUrl) ?? inferredCode) : null),
    [emoji, flagUrl, imageFailed, imageSrc, inferredCode]
  )
  const baseClass = `inline-flex shrink-0 items-center justify-center rounded-full bg-white/10 ${SIZE_CLASS[size]} ${className}`

  if (imageSrc && !imageFailed) {
    return (
      <img
        src={imageSrc}
        alt={`${label} flag`}
        data-testid={testId ?? "world-cup-team-flag-image"}
        onError={() => setImageFailed(true)}
        className={`${baseClass} bg-white object-contain p-0.5`}
      />
    )
  }

  if (fallbackEmoji) {
    return (
      <span
        role="img"
        aria-label={`${label} flag`}
        data-testid={testId ?? "world-cup-team-flag-emoji"}
        className={baseClass}
      >
        {fallbackEmoji}
      </span>
    )
  }

  if (inferredCode) {
    return (
      <span
        aria-label={`${label} country code ${inferredCode}`}
        data-testid={testId ?? "world-cup-team-flag-code"}
        className={`${baseClass} font-black text-white/70`}
      >
        {inferredCode}
      </span>
    )
  }

  return (
    <span
      role="img"
      aria-label={`${label} flag unavailable`}
      data-testid={testId ?? "world-cup-team-flag-globe"}
      className={`${baseClass} text-white/55`}
    >
      <Globe2 className="h-1/2 w-1/2" aria-hidden />
    </span>
  )
}
