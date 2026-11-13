type WeatherFactor =
  | 'wind'
  | 'rain'
  | 'snow'
  | 'cold'
  | 'heat'
  | 'humidity'
  | 'visibility'
  | 'track_condition'
  | 'precipitation_delay_risk'
  | 'air_density'

type OutdoorSportMeta = {
  sport: string
  isOutdoor: boolean
  canBeIndoor: boolean
  venueCheckRequired: boolean
  weatherFactors: WeatherFactor[]
  positionWeatherSensitivity: Record<string, WeatherFactor[]>
  adjustmentNotes: string
}

const NCAAF_META: OutdoorSportMeta = {
  sport: 'NCAAF',
  isOutdoor: true,
  canBeIndoor: true,
  venueCheckRequired: true,
  weatherFactors: ['wind', 'rain', 'snow', 'cold'],
  positionWeatherSensitivity: {
    QB: ['wind', 'rain', 'snow'],
    WR: ['wind', 'rain'],
    RB: ['rain', 'snow'],
    K: ['wind', 'cold'],
  },
  adjustmentNotes:
    'Same as NFL but lower baseline efficiency so weather impact is slightly amplified.',
}

const OUTDOOR_SPORT_METADATA: Record<string, OutdoorSportMeta> = {
  NFL: {
    sport: 'NFL',
    isOutdoor: true,
    canBeIndoor: true,
    venueCheckRequired: true,
    weatherFactors: ['wind', 'rain', 'snow', 'cold'],
    positionWeatherSensitivity: {
      QB: ['wind', 'rain', 'snow'],
      WR: ['wind', 'rain', 'snow'],
      TE: ['wind', 'rain', 'snow'],
      RB: ['rain', 'snow'],
      K: ['wind', 'cold', 'rain', 'snow'],
      DL: ['rain', 'snow'],
      LB: ['rain', 'snow'],
      DB: ['wind', 'rain'],
    },
    adjustmentNotes:
      'Wind >15mph reduces passing; >25mph severe. Rain and snow shift game toward run. Cold primarily impacts kickers.',
  },

  NCAAF: NCAAF_META,
  NCAAFB: { ...NCAAF_META, sport: 'NCAAFB' },

  MLB: {
    sport: 'MLB',
    isOutdoor: true,
    canBeIndoor: true,
    venueCheckRequired: true,
    weatherFactors: ['wind', 'rain', 'cold', 'heat', 'precipitation_delay_risk'],
    positionWeatherSensitivity: {
      SP: ['rain', 'cold', 'precipitation_delay_risk'],
      RP: ['rain', 'precipitation_delay_risk'],
      OF: ['wind', 'cold'],
      '1B': ['wind', 'cold'],
      '3B': ['wind'],
      C: ['cold'],
      SS: ['wind'],
      '2B': ['wind'],
    },
    adjustmentNotes:
      'Wind direction (out vs in) affects HR environment. Cold suppresses carry. Rain raises delay/cancelation risk for SPs.',
  },

  SOCCER: {
    sport: 'SOCCER',
    isOutdoor: true,
    canBeIndoor: false,
    venueCheckRequired: false,
    weatherFactors: ['wind', 'rain', 'cold', 'heat'],
    positionWeatherSensitivity: {
      FWD: ['rain', 'wind'],
      MID: ['rain', 'wind', 'heat'],
      DEF: ['rain', 'wind'],
      GK: ['rain', 'wind'],
    },
    adjustmentNotes:
      'Heavy rain and wind reduce pass completion, crossing accuracy, and shot quality.',
  },

  GOLF: {
    sport: 'GOLF',
    isOutdoor: true,
    canBeIndoor: false,
    venueCheckRequired: false,
    weatherFactors: ['wind', 'rain', 'cold', 'heat', 'visibility', 'precipitation_delay_risk'],
    positionWeatherSensitivity: {
      GOLFER: ['wind', 'rain', 'cold', 'precipitation_delay_risk'],
    },
    adjustmentNotes:
      'Wind is the dominant factor. Wind-resistant players gain relative value. Rain and delay risk affect scoring.',
  },

  NASCAR: {
    sport: 'NASCAR',
    isOutdoor: true,
    canBeIndoor: false,
    venueCheckRequired: false,
    weatherFactors: ['rain', 'heat', 'wind', 'precipitation_delay_risk'],
    positionWeatherSensitivity: {
      DRIVER: ['rain', 'precipitation_delay_risk', 'heat'],
    },
    adjustmentNotes:
      'Rain causes delays or cancellations. Track temp affects tire strategy. Wind at superspeedways can matter.',
  },

  TENNIS: {
    sport: 'TENNIS',
    isOutdoor: true,
    canBeIndoor: true,
    venueCheckRequired: true,
    weatherFactors: ['wind', 'heat', 'humidity', 'rain', 'precipitation_delay_risk'],
    positionWeatherSensitivity: {
      PLAYER: ['wind', 'heat', 'humidity', 'precipitation_delay_risk'],
    },
    adjustmentNotes:
      'Wind disrupts serve and groundstroke consistency. Heat and humidity increase physical attrition risk.',
  },

  CRICKET: {
    sport: 'CRICKET',
    isOutdoor: true,
    canBeIndoor: false,
    venueCheckRequired: false,
    weatherFactors: ['rain', 'humidity', 'wind', 'precipitation_delay_risk'],
    positionWeatherSensitivity: {
      BATSMAN: ['rain', 'precipitation_delay_risk'],
      BOWLER: ['humidity', 'wind', 'rain'],
      ALL_ROUNDER: ['rain', 'humidity', 'wind'],
    },
    adjustmentNotes:
      'Rain interruptions reduce overs. Humidity can assist swing bowling. DLS method adjustments affect scoring.',
  },

  HORSE_RACING: {
    sport: 'HORSE_RACING',
    isOutdoor: true,
    canBeIndoor: false,
    venueCheckRequired: false,
    weatherFactors: ['rain', 'track_condition', 'wind', 'heat'],
    positionWeatherSensitivity: {
      HORSE: ['rain', 'track_condition'],
    },
    adjustmentNotes:
      'Rain changes track condition (firm → soft → heavy). Horse preferences for track condition are the key factor.',
  },
}

export function isWeatherSensitiveSport(sport: string): boolean {
  const key = sport.trim().toUpperCase()
  return OUTDOOR_SPORT_METADATA[key]?.isOutdoor ?? false
}

export function getPositionWeatherFactors(sport: string, position: string): WeatherFactor[] {
  const key = sport.trim().toUpperCase()
  const meta = OUTDOOR_SPORT_METADATA[key]
  if (!meta) return []
  const pos = position.trim().toUpperCase()
  return (
    meta.positionWeatherSensitivity[pos] ??
    meta.positionWeatherSensitivity['PLAYER'] ??
    meta.positionWeatherSensitivity['GOLFER'] ??
    meta.positionWeatherSensitivity['DRIVER'] ??
    meta.positionWeatherSensitivity['HORSE'] ??
    meta.weatherFactors
  )
}
