"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ComposableMap, Geographies, Geography, Graticule, Sphere, Marker } from "react-simple-maps"
import { ChevronLeft, ChevronRight, Play, Pause } from "lucide-react"

/**
 * Rotatable orthographic globe of visitor locations.
 * Points come from VisitorLocation (lat/lng/visits/city/country) via
 * /api/admin/visitor-analytics. No raw IPs are ever sent to the client.
 *
 * geoUrl is a public world-atlas topojson. If your CSP blocks jsdelivr, download
 * countries-110m.json into /public and set GEO_URL to "/countries-110m.json".
 */
const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json"
const CENTER_LAT = 20

type GlobePoint = { lat: number; lng: number; city: string | null; country: string | null; countryCode: string | null; visits: number }
type CountryRollup = { country: string; countryCode: string | null; visits: number; visitors: number }

function fmt(n: number) {
  return n.toLocaleString("en-US")
}

// Is a lon/lat on the visible hemisphere given the current center longitude?
function isVisible(lng: number, lat: number, centerLng: number): boolean {
  const toRad = (d: number) => (d * Math.PI) / 180
  const cosc =
    Math.sin(toRad(CENTER_LAT)) * Math.sin(toRad(lat)) +
    Math.cos(toRad(CENTER_LAT)) * Math.cos(toRad(lat)) * Math.cos(toRad(lng - centerLng))
  return cosc > 0
}

export function VisitorGlobePanel() {
  const [points, setPoints] = useState<GlobePoint[]>([])
  const [countries, setCountries] = useState<CountryRollup[]>([])
  const [source, setSource] = useState<string>("")
  const [rotation, setRotation] = useState(-20) // rotate[0]; center lon = -rotation
  const [spinning, setSpinning] = useState(true)
  const spinRef = useRef<number | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/admin/visitor-analytics?window=24h`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        setPoints(Array.isArray(d.globe) ? d.globe : [])
        setCountries(Array.isArray(d.countries) ? d.countries : [])
        setSource(d.geoSource ?? "")
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!spinning) {
      if (spinRef.current) window.clearInterval(spinRef.current)
      return
    }
    spinRef.current = window.setInterval(() => setRotation((r) => (r - 0.6) % 360), 60)
    return () => {
      if (spinRef.current) window.clearInterval(spinRef.current)
    }
  }, [spinning])

  const centerLng = -rotation
  const maxVisits = useMemo(() => Math.max(1, ...points.map((p) => p.visits)), [points])
  const markerRadius = (visits: number) => 2 + Math.sqrt(visits / maxVisits) * 9

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* Globe */}
      <div className="relative rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_50%_40%,rgba(34,211,238,0.10),transparent_60%)] bg-black/30 p-2">
        <div className="pointer-events-none absolute left-3 top-3 z-10 text-[10px] font-black uppercase tracking-[0.16em] text-cyan-100/60">
          {points.length} located visitors
        </div>
        <ComposableMap
          projection="geoOrthographic"
          projectionConfig={{ rotate: [rotation, -CENTER_LAT, 0], scale: 185 }}
          width={420}
          height={420}
          style={{ width: "100%", height: "auto" }}
        >
          <Sphere id="globe-sphere" stroke="rgba(34,211,238,0.25)" strokeWidth={0.6} fill="rgba(8,20,38,0.85)" />
          <Graticule stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} />
          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              geographies.map((geo) => (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill="rgba(255,255,255,0.06)"
                  stroke="rgba(34,211,238,0.18)"
                  strokeWidth={0.4}
                  style={{ default: { outline: "none" }, hover: { outline: "none", fill: "rgba(34,211,238,0.12)" }, pressed: { outline: "none" } }}
                />
              ))
            }
          </Geographies>
          {points
            .filter((p) => isVisible(p.lng, p.lat, centerLng))
            .map((p, i) => (
              <Marker key={`${p.lat}-${p.lng}-${i}`} coordinates={[p.lng, p.lat]}>
                <circle r={markerRadius(p.visits)} fill="rgba(251,191,36,0.85)" stroke="rgba(255,255,255,0.7)" strokeWidth={0.5}>
                  <title>{`${[p.city, p.country].filter(Boolean).join(", ") || "Unknown"} — ${fmt(p.visits)} visits`}</title>
                </circle>
              </Marker>
            ))}
        </ComposableMap>

        {/* Controls */}
        <div className="mt-1 flex items-center justify-center gap-2">
          <button onClick={() => setRotation((r) => r + 15)} className="rounded-full border border-white/10 bg-black/30 p-2 text-white/70 hover:text-white" aria-label="Rotate left">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button onClick={() => setSpinning((s) => !s)} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/30 px-3 py-2 text-xs font-bold text-white/70 hover:text-white">
            {spinning ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {spinning ? "Pause" : "Spin"}
          </button>
          <button onClick={() => setRotation((r) => r - 15)} className="rounded-full border border-white/10 bg-black/30 p-2 text-white/70 hover:text-white" aria-label="Rotate right">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Country leaderboard */}
      <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
        <h3 className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100/75">Top countries</h3>
        <div className="mt-3 space-y-2">
          {countries.length === 0 ? (
            <p className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/45">
              No geolocated visitors yet. Points appear as <code className="text-cyan-200/80">/api/track-visitor</code> records IPs.
            </p>
          ) : (
            countries.map((c) => {
              const max = countries[0]?.visits || 1
              const pct = Math.max(4, Math.round((c.visits / max) * 100))
              return (
                <div key={`${c.country}-${c.countryCode}`} className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-white/85">{c.country}</span>
                    <span className="text-white/50">{fmt(c.visits)} visits · {fmt(c.visitors)} uniq</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-amber-300" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })
          )}
        </div>
        {source && source !== "visitor_location" ? (
          <p className="mt-3 text-[11px] text-white/40">Source: {source}</p>
        ) : null}
      </div>
    </div>
  )
}
