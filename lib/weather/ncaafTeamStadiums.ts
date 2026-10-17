/** Selected FBS home venues for weather (expand over time). Unmapped teams skip weather until geocoding is added. */
export type StadiumCoords = { lat: number; lng: number; dome: boolean; label: string }

export const NCAAF_TEAM_STADIUM: Record<string, StadiumCoords> = {
  UGA: { lat: 33.9498, lng: -83.3733, dome: false, label: 'Sanford Stadium' },
  ALA: { lat: 33.2083, lng: -87.5504, dome: false, label: 'Bryant-Denny Stadium' },
  OSU: { lat: 40.0016, lng: -83.0197, dome: false, label: 'Ohio Stadium' },
  MICH: { lat: 42.2658, lng: -83.7487, dome: false, label: 'Michigan Stadium' },
  TEX: { lat: 30.2839, lng: -97.7325, dome: false, label: 'DKR Stadium' },
  OU: { lat: 35.2059, lng: -97.4457, dome: false, label: 'Gaylord Family Stadium' },
  USC: { lat: 34.0141, lng: -118.2879, dome: false, label: 'LA Memorial Coliseum' },
  LSU: { lat: 30.412, lng: -91.1838, dome: false, label: 'Tiger Stadium' },
  CLEM: { lat: 34.6788, lng: -82.8432, dome: false, label: 'Memorial Stadium' },
  PSU: { lat: 40.8122, lng: -77.8561, dome: false, label: 'Beaver Stadium' },
  ORE: { lat: 44.0582, lng: -123.0735, dome: false, label: 'Autzen Stadium' },
  UT: { lat: 35.9544, lng: -83.9249, dome: false, label: 'Neyland Stadium' },
  FSU: { lat: 30.4363, lng: -84.3044, dome: false, label: 'Doak Campbell Stadium' },
  // Hard Rock Stadium, Miami Gardens — the same point as NFL_VENUE_COORDS['Hard Rock Stadium'].
  // This row said (25.7211, -80.2795), the Coral Gables campus about 16 miles south, under this label.
  MIA: { lat: 25.958, lng: -80.2389, dome: false, label: 'Hard Rock Stadium' },
  ND: { lat: 41.7056, lng: -86.2353, dome: false, label: 'Notre Dame Stadium' },
}
