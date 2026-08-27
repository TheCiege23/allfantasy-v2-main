/**
 * The OpenWeatherMap geocoding call — the vendor boundary, and nothing else.
 *
 * Same shape as `lib/fantasycalc-fetch.ts`: the network lives alone in a module
 * whose only importer is a DB-first reader, so the exemption is granted on a
 * caller census rather than asserted with a marker. `db-first-exception:` is
 * reserved for temporary debt with a migration plan (and the standing health-probe
 * case); a permanent read-through cache is neither, so it does not belong there.
 *
 * ⚠ The only legitimate caller is `geocodeAddressCached` in
 * `lib/weather/weatherService.ts`, which checks the durable cache first. Calling
 * this directly from anywhere else puts an uncached, rate-limited vendor request
 * on that path.
 */

/** Address → coordinates, or null for "no answer" (missing key, non-ok, empty). */
export async function fetchOpenWeatherGeocode(
  address: string
): Promise<{ lat: number; lng: number } | null> {
  const apiKey = process.env.OPENWEATHERMAP_API_KEY
  if (!apiKey) return null
  try {
    const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(address)}&limit=1&appid=${apiKey}`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    const data = (await res.json()) as Array<{ lat: number; lon: number }>
    if (!data?.length) return null
    return { lat: data[0]!.lat, lng: data[0]!.lon }
  } catch {
    return null
  }
}
