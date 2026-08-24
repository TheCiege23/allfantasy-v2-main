/**
 * Free 30-second preview enrichment — Deezer first, iTunes fallback.
 *
 * Extracted verbatim from app/api/music/track-info/route.ts so the
 * Spotify-connected search path (app/api/music/search-spotify) can use it too:
 * Spotify deprecated `preview_url` for newer integrations (it is usually null
 * now), so without this a CONNECTED user got fewer previews than a guest.
 *
 * Route files cannot export helpers under App Router export checking, hence
 * the shared module rather than a cross-route import.
 */

export async function fetchJsonWithTimeout<T>(url: string, timeoutMs = 5000): Promise<T | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      next: { revalidate: 3600 },
    });

    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchPreviewUrl(artist: string, track: string): Promise<string | undefined> {
  // Prefer MP3 previews first (better codec support in Chromium-based runtimes).
  try {
    const deezerQueries = [
      `${artist} ${track}`,
      `artist:\"${artist}\" track:\"${track}\"`,
      artist,
    ];

    for (const q of deezerQueries) {
      const data = await fetchJsonWithTimeout<any>(
        `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=1&output=json`,
        4000
      );
      if (!data) continue;
      const preview = data?.data?.[0]?.preview;
      if (typeof preview === 'string' && preview.length > 0) {
        return preview;
      }
    }
  } catch {
    // Fall back to iTunes lookup below.
  }

  try {
    const term = encodeURIComponent(`${artist} ${track}`);
    const data = await fetchJsonWithTimeout<any>(
      `https://itunes.apple.com/search?term=${term}&entity=song&limit=1`,
      4000
    );
    if (!data) return undefined;
    return data?.results?.[0]?.previewUrl;
  } catch {
    return undefined;
  }
}
