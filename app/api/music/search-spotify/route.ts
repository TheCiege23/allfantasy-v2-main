import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { fetchPreviewUrl } from '@/lib/music/preview-url';
import type { NextRequest } from 'next/server';

// Refresh Spotify access token if expired
async function refreshSpotifyToken(refreshToken: string) {
  try {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: process.env.SPOTIFY_CLIENT_ID || '',
        client_secret: process.env.SPOTIFY_CLIENT_SECRET || '',
      }),
    });

    if (!response.ok) throw new Error('Failed to refresh token');
    return response.json();
  } catch (error) {
    console.error('Spotify token refresh error:', error);
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();

    if (!session?.user?.id) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { artist, track } = await request.json();

    if (!artist) {
      return new Response(JSON.stringify({ error: 'Artist is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get user's Spotify account info
    const userAccount = await prisma.authAccount.findFirst({
      where: {
        userId: session.user.id,
        provider: 'spotify',
      },
    });

    if (!userAccount?.access_token) {
      return new Response(JSON.stringify({ error: 'Spotify account not connected' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let accessToken = userAccount.access_token;

    // Check if token needs refresh
    if (userAccount.expires_at && userAccount.expires_at < Date.now() / 1000) {
      if (!userAccount.refresh_token) {
        return new Response(JSON.stringify({ error: 'Cannot refresh Spotify token' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const newToken = await refreshSpotifyToken(userAccount.refresh_token);
      accessToken = newToken.access_token;

      // Update token in DB
      await prisma.authAccount.update({
        where: { id: userAccount.id },
        data: { access_token: accessToken },
      });
    }

    // Search Spotify
    const query = track ? `${artist} ${track}` : artist;
    const spotifyResponse = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=5`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!spotifyResponse.ok) {
      throw new Error(`Spotify API error: ${spotifyResponse.status}`);
    }

    const spotifyData = await spotifyResponse.json();
    const firstTrack = spotifyData.tracks?.items?.[0];

    if (!firstTrack) {
      return new Response(JSON.stringify({ track: null, message: 'No tracks found' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const trackArtist = firstTrack.artists?.[0]?.name || 'Unknown';
    // Spotify deprecated `preview_url` for newer integrations (usually null now),
    // so without enrichment a CONNECTED user got fewer previews than a guest.
    // Same Deezer-then-iTunes lookup the unconnected track-info path uses;
    // null when nothing is found — the UI already labels that state.
    const previewUrl =
      (typeof firstTrack.preview_url === 'string' && firstTrack.preview_url) ||
      (await fetchPreviewUrl(trackArtist, firstTrack.name)) ||
      null;

    const mappedTrack = {
      id: firstTrack.id,
      name: firstTrack.name,
      artist: trackArtist,
      image: firstTrack.album?.images?.[0]?.url,
      duration: firstTrack.duration_ms,
      spotifyUrl: firstTrack.external_urls?.spotify,
      previewUrl,
    };

    return new Response(JSON.stringify({ track: mappedTrack }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error searching Spotify:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to search Spotify',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
