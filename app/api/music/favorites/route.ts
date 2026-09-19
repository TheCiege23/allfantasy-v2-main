import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { NextRequest } from 'next/server';

function isFavoritesTableMissing(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2021') return true;
    const msg = String(error.message || '').toLowerCase();
    if (msg.includes('user_music_favorites') && msg.includes('does not exist')) return true;
  }
  return false;
}

/**
 * Whether this user has linked Spotify.
 *
 * 🛑 THIS USED TO BE `session.user.spotifyAccount`, WHICH MEANT ONE OR TWO PRISMA READS ON EVERY
 * AUTHENTICATED REQUEST IN THE PRODUCT. A boolean on the session has to be computed eagerly, so
 * the `auth_accounts` lookup — and, when it missed, the `user_profiles` fallback — ran in the
 * session callback whether or not anything was going to read it. For the overwhelming majority,
 * who have no Spotify, both ran. There are ~2,259 `getServerSession` call sites across ~1,017 API
 * routes, and `/core?league=` resolves the session twice per render.
 *
 * Its only consumer in the repo is `hooks/useMusicWidget.ts`, which already calls this route on
 * mount — so the flag now costs no extra request here, and nothing anywhere else.
 *
 * ⚠ IT NEVER THROWS. Favourites are this route's job; the flag is a passenger, and a passenger
 * that can 500 its host is a worse trade than a stale boolean. Unknown reads as NOT connected,
 * which sends the reader to a "Connect Spotify" button rather than to a silent dead end.
 */
async function resolveSpotifyConnected(userId: string): Promise<boolean> {
  try {
    const account = await prisma.authAccount.findFirst({
      where: { userId, provider: 'spotify' },
      select: { id: true },
    });
    if (account?.id) return true;
    const profile = await prisma.userProfile.findUnique({
      where: { userId },
      select: { spotifyConnectedAt: true },
    });
    return Boolean(profile?.spotifyConnectedAt);
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  /*
   * ⚠ DECLARED OUT HERE, NOT INSIDE THE `try`, AND THAT IS THE WHOLE POINT OF RESOLVING IT
   * FIRST. `user_music_favorites` may not exist yet, and the catch below answers that with an
   * empty list and a 200 — a branch that could not see this would silently report "not
   * connected" and send someone to re-link an account they had already linked.
   */
  let spotifyConnected = false;
  try {
    const session = await getServerSession();

    if (!session?.user?.id) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    spotifyConnected = await resolveSpotifyConnected(session.user.id);

    const favorites = await prisma.userMusicFavorite.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        trackId: true,
        trackName: true,
        artistName: true,
        trackImage: true,
        createdAt: true,
      },
    });

    const mapped = favorites.map((fav) => ({
      id: fav.trackId,
      name: fav.trackName,
      artist: fav.artistName,
      image: fav.trackImage,
      addedAt: fav.createdAt.toLocaleDateString(),
    }));

    return new Response(JSON.stringify({ favorites: mapped, spotifyConnected }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    if (isFavoritesTableMissing(error)) {
      return new Response(JSON.stringify({ favorites: [], spotifyConnected }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    console.error('Error fetching favorites:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch favorites',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
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

    const { trackId, name, artist, image } = await request.json();

    if (!trackId || !name || !artist) {
      return new Response(
        JSON.stringify({ error: 'trackId, name, and artist are required' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const favorite = await prisma.userMusicFavorite.create({
      data: {
        userId: session.user.id,
        trackId,
        trackName: name,
        artistName: artist,
        trackImage: image || null,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        favorite: {
          id: favorite.trackId,
          name: favorite.trackName,
          artist: favorite.artistName,
          image: favorite.trackImage,
        },
      }),
      {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    if (isFavoritesTableMissing(error)) {
      return new Response(
        JSON.stringify({
          error: 'Favorites storage is not ready',
          code: 'MIGRATION_PENDING',
          message: 'Run: npx prisma migrate deploy (or migrate dev) to add user_music_favorites.',
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }
    console.error('Error adding favorite:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to add favorite',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession();

    if (!session?.user?.id) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { trackId } = await request.json();

    if (!trackId) {
      return new Response(JSON.stringify({ error: 'trackId is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await prisma.userMusicFavorite.deleteMany({
      where: {
        userId: session.user.id,
        trackId,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Favorite removed',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    if (isFavoritesTableMissing(error)) {
      return new Response(
        JSON.stringify({
          error: 'Favorites storage is not ready',
          code: 'MIGRATION_PENDING',
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }
    console.error('Error removing favorite:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to remove favorite',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
