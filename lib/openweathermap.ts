
export interface WeatherData {
  city: string;
  temp: number;
  feelsLike: number;
  tempMin: number;
  tempMax: number;
  humidity: number;
  pressure: number;
  windSpeed: number;
  windGust: number | null;
  windDeg: number;
  description: string;
  icon: string;
  iconUrl: string;
  visibility: number;
  clouds: number;
  rain1h: number | null;
  snow1h: number | null;
  condition: string;
  fantasyImpact: string;
  fantasyImpactLevel: 'none' | 'low' | 'moderate' | 'high' | 'extreme';
}

export interface GameWeather {
  venue: string;
  homeTeam: string;
  awayTeam: string;
  weather: WeatherData;
  gameTime: string;
  isDome: boolean;
}

/** NFL stadium coordinates + dome flag (used by weather + projections). */
export const NFL_VENUE_COORDS: Record<string, { lat: number; lon: number; dome: boolean }> = {
  'State Farm Stadium': { lat: 33.5276, lon: -112.2626, dome: true },
  'Mercedes-Benz Stadium': { lat: 33.7554, lon: -84.4010, dome: true },
  'M&T Bank Stadium': { lat: 39.2780, lon: -76.6227, dome: false },
  'Highmark Stadium': { lat: 42.7738, lon: -78.7870, dome: false },
  'Bank of America Stadium': { lat: 35.2258, lon: -80.8528, dome: false },
  'Soldier Field': { lat: 41.8623, lon: -87.6167, dome: false },
  'Paycor Stadium': { lat: 39.0955, lon: -84.5160, dome: false },
  'Cleveland Browns Stadium': { lat: 41.5061, lon: -81.6995, dome: false },
  'AT&T Stadium': { lat: 32.7473, lon: -97.0945, dome: true },
  'Empower Field at Mile High': { lat: 39.7439, lon: -105.0201, dome: false },
  'Ford Field': { lat: 42.3400, lon: -83.0456, dome: true },
  'Lambeau Field': { lat: 44.5013, lon: -88.0622, dome: false },
  'NRG Stadium': { lat: 29.6847, lon: -95.4107, dome: true },
  'Lucas Oil Stadium': { lat: 39.7601, lon: -86.1639, dome: true },
  'EverBank Stadium': { lat: 30.3239, lon: -81.6373, dome: false },
  'GEHA Field at Arrowhead Stadium': { lat: 39.0489, lon: -94.4839, dome: false },
  'Arrowhead Stadium': { lat: 39.0489, lon: -94.4839, dome: false },
  'Allegiant Stadium': { lat: 36.0909, lon: -115.1833, dome: true },
  'SoFi Stadium': { lat: 33.9534, lon: -118.3390, dome: true },
  'Hard Rock Stadium': { lat: 25.9580, lon: -80.2389, dome: false },
  'U.S. Bank Stadium': { lat: 44.9736, lon: -93.2575, dome: true },
  'Gillette Stadium': { lat: 42.0909, lon: -71.2643, dome: false },
  'Caesars Superdome': { lat: 29.9511, lon: -90.0812, dome: true },
  'MetLife Stadium': { lat: 40.8128, lon: -74.0742, dome: false },
  'Lincoln Financial Field': { lat: 39.9008, lon: -75.1675, dome: false },
  'Acrisure Stadium': { lat: 40.4468, lon: -80.0158, dome: false },
  'Levi\'s Stadium': { lat: 37.4033, lon: -121.9694, dome: false },
  'Lumen Field': { lat: 47.5952, lon: -122.3316, dome: false },
  'Raymond James Stadium': { lat: 27.9759, lon: -82.5033, dome: false },
  'Nissan Stadium': { lat: 36.1665, lon: -86.7713, dome: false },
  'Northwest Stadium': { lat: 38.9076, lon: -76.8645, dome: false },
};

export const NFL_TEAM_VENUES: Record<string, string> = {
  'ARI': 'State Farm Stadium', 'ATL': 'Mercedes-Benz Stadium',
  'BAL': 'M&T Bank Stadium', 'BUF': 'Highmark Stadium',
  'CAR': 'Bank of America Stadium', 'CHI': 'Soldier Field',
  'CIN': 'Paycor Stadium', 'CLE': 'Cleveland Browns Stadium',
  'DAL': 'AT&T Stadium', 'DEN': 'Empower Field at Mile High',
  'DET': 'Ford Field', 'GB': 'Lambeau Field',
  'HOU': 'NRG Stadium', 'IND': 'Lucas Oil Stadium',
  'JAX': 'EverBank Stadium', 'KC': 'Arrowhead Stadium',
  'LV': 'Allegiant Stadium', 'LAC': 'SoFi Stadium',
  'LAR': 'SoFi Stadium', 'MIA': 'Hard Rock Stadium',
  'MIN': 'U.S. Bank Stadium', 'NE': 'Gillette Stadium',
  'NO': 'Caesars Superdome', 'NYG': 'MetLife Stadium',
  'NYJ': 'MetLife Stadium', 'PHI': 'Lincoln Financial Field',
  'PIT': 'Acrisure Stadium', 'SF': 'Levi\'s Stadium',
  'SEA': 'Lumen Field', 'TB': 'Raymond James Stadium',
  'TEN': 'Nissan Stadium', 'WAS': 'Northwest Stadium',
};

/** Single 3h slot from OWM 5-day forecast, closest to `targetTime`. */
export interface ForecastWeatherAtTime {
  temp: number
  feelsLike: number
  windSpeed: number
  windGust: number | null
  windDeg: number
  humidity: number
  visibilityMeters: number
  clouds: number
  rainInches3h: number
  snowInches3h: number
  conditionMain: string
  conditionCode: string
  description: string
  /** 0–1 probability of precipitation */
  pop: number
  forecastDt: Date
}



export function getVenueForTeam(teamAbbrev: string): string | null {
  return NFL_TEAM_VENUES[teamAbbrev] || null;
}

export function isTeamDome(teamAbbrev: string): boolean {
  const venue = NFL_TEAM_VENUES[teamAbbrev];
  if (!venue) return false;
  return NFL_VENUE_COORDS[venue]?.dome || false;
}
