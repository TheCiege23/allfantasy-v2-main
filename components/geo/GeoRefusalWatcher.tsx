"use client"

import { useEffect } from "react"

import { installGeoRefusalWatcher } from "@/lib/geo/geoRefusalWatcher"

/** Mid-session VPN / Washington lock → the block page, not a generic error. See lib/geo/geoRefusalWatcher. */
export function GeoRefusalWatcher() {
  useEffect(() => {
    installGeoRefusalWatcher(window)
  }, [])
  return null
}
