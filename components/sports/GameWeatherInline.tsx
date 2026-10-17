'use client'

import { Cloud, CloudRain, CloudSnow, Sun, Wind, Home } from 'lucide-react'
import type { GameWeather } from '@/hooks/usePhase1Data'

function weatherIcon(w: GameWeather) {
  if (w.isDome) return <Home className="h-3.5 w-3.5 text-cyan-400" />
  if (w.impact?.toLowerCase().includes('snow')) return <CloudSnow className="h-3.5 w-3.5 text-blue-300" />
  if (w.impact?.toLowerCase().includes('rain')) return <CloudRain className="h-3.5 w-3.5 text-blue-400" />
  if ((w.wind ?? 0) > 15) return <Wind className="h-3.5 w-3.5 text-amber-300" />
  if ((w.temp ?? 72) > 80) return <Sun className="h-3.5 w-3.5 text-orange-300" />
  return <Cloud className="h-3.5 w-3.5 text-white/40" />
}

export function GameWeatherInline({ weather }: { weather: GameWeather }) {
  if (weather.isDome) {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg bg-cyan-500/10 px-2 py-0.5 text-[11px] font-semibold text-cyan-300">
        <Home className="h-3 w-3" /> Dome
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/60">
      {weatherIcon(weather)}
      {weather.temp != null && <span>{Math.round(weather.temp)}°F</span>}
      {(weather.wind ?? 0) > 5 && <span className="text-white/40">{Math.round(weather.wind!)}mph</span>}
      {weather.impact && !['none', 'minimal'].includes(weather.impact.toLowerCase()) && (
        <span className="font-semibold text-amber-300">{weather.impact}</span>
      )}
    </span>
  )
}
