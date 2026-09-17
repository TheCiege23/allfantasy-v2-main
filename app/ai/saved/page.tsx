import { redirect } from 'next/navigation'

/**
 * `/ai/saved` — RETIRED (2026-09-16), kept as a redirect so old links and bookmarks still land.
 *
 * This page listed saved recommendations through `/api/ai/saved-recommendations`, backed by a
 * Supabase-era service with no database behind it: the list was always empty and saving always
 * failed, and nothing mounted anywhere ever saved one. The stub, its routes and its UI were retired.
 *
 * `/ai/history` is where saved AI results actually live — the workbench's Save button writes to
 * `/api/ai/history` — so that is where this sends people.
 */
export default function AISavedPage(): never {
  redirect('/ai/history')
}
