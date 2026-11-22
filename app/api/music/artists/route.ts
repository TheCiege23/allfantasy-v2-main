import { searchArtistsCached } from '@/lib/music/musicCatalog';
import type { NextRequest } from 'next/server';

type ArtistSummary = {
  idArtist?: string;
  strArtist?: string;
  strArtistThumb?: string;
  strGenre?: string;
  strStyle?: string;
};

type ItunesArtist = {
  artistId?: number;
  artistName?: string;
  primaryGenreName?: string;
  artistLinkUrl?: string;
};

const GENRE_SEED_ARTISTS: Record<string, string[]> = {
  Pop: ['Taylor Swift', 'Dua Lipa', 'Ariana Grande', 'Ed Sheeran', 'Lady Gaga'],
  Rock: ['Queen', 'Nirvana', 'Foo Fighters', 'Arctic Monkeys', 'Red Hot Chili Peppers'],
  'Hip Hop': ['Drake', 'Kendrick Lamar', 'J. Cole', 'Travis Scott', 'Nicki Minaj'],
  'R&B': ['SZA', 'Usher', 'Alicia Keys', 'The Weeknd', 'H.E.R.'],
  Jazz: ['Miles Davis', 'John Coltrane', 'Ella Fitzgerald', 'Louis Armstrong', 'Herbie Hancock'],
  Classical: ['Ludwig van Beethoven', 'Wolfgang Amadeus Mozart', 'Johann Sebastian Bach', 'Antonio Vivaldi', 'Pyotr Ilyich Tchaikovsky'],
  Electronic: ['Daft Punk', 'Calvin Harris', 'Deadmau5', 'Skrillex', 'Avicii'],
  Country: ['Luke Combs', 'Chris Stapleton', 'Carrie Underwood', 'Kacey Musgraves', 'Morgan Wallen'],
  Latin: ['Bad Bunny', 'Shakira', 'J Balvin', 'Karol G', 'Rauw Alejandro'],
  Soul: ['Aretha Franklin', 'Marvin Gaye', 'Stevie Wonder', 'Al Green', 'Erykah Badu'],
  Blues: ['B.B. King', 'Muddy Waters', 'Buddy Guy', 'John Lee Hooker', 'Etta James'],
  Folk: ['Bob Dylan', 'Joni Mitchell', 'Mumford & Sons', 'The Lumineers', 'Joan Baez'],
  Metal: ['Metallica', 'Iron Maiden', 'Slipknot', 'Black Sabbath', 'Megadeth'],
  Reggae: ['Bob Marley', 'Peter Tosh', 'Jimmy Cliff', 'Sean Paul', 'Shaggy'],
  Disco: ['Bee Gees', 'Donna Summer', 'Chic', 'ABBA', 'Earth, Wind & Fire'],
};

function getAllGenreCandidates(): string[] {
  const perGenre = Object.values(GENRE_SEED_ARTISTS)
    .map((artists) => artists.slice(0, 1))
    .flat();

  return Array.from(new Set(perGenre));
}

async function fetchItunesArtists(query: string): Promise<ArtistSummary[]> {
  try {
    const response = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=musicArtist&limit=20`,
      { next: { revalidate: 3600 } }
    );

    if (!response.ok) return [];

    const data = await response.json();
    const results: ItunesArtist[] = Array.isArray(data?.results) ? data.results : [];

    return results
      .filter((artist) => !!artist.artistName)
      .map((artist) => ({
        idArtist: artist.artistId ? `itunes-${artist.artistId}` : `itunes-${artist.artistName}`,
        strArtist: artist.artistName,
        strGenre: artist.primaryGenreName || 'Mixed',
        strStyle: 'iTunes',
      }));
  } catch {
    return [];
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request
      .json()
      .catch(() => ({} as { genre?: unknown; query?: unknown }));
    const { genre, query } = body;
    const genreLabel = typeof genre === 'string' ? genre.trim() : '';
    const searchQuery = typeof query === 'string' ? query.trim() : '';
    const isAllGenres = !genreLabel;

    /*
     * TheAudioDB is read through the durable cache (lib/music/musicCatalog.ts); its key-bearing URL
     * lives only in lib/music/theAudioDbFetch.ts. `null` = no answer, which falls back as a throw did.
     */
    let artists: ArtistSummary[] = [];
    let fallbackArtists: ArtistSummary[] = [];

    if (searchQuery.length > 0) {
      const found = await searchArtistsCached(searchQuery);
      artists = found
        ? found.filter((artist) => !!artist.idArtist && !!artist.strArtist).slice(0, 20)
        : await fetchItunesArtists(searchQuery);

      fallbackArtists = [];
    } else {
      // TheAudioDB has no working artist-by-genre endpoint for this widget, so the route uses a small
      // curated genre seed list and resolves each artist through the cached reader.
      const candidates = isAllGenres ? getAllGenreCandidates() : GENRE_SEED_ARTISTS[genreLabel] || [];

      const artistResults = await Promise.allSettled(
        candidates.map(async (artistName) => {
          const found = await searchArtistsCached(artistName);
          const artist = found?.[0];
          if (!artist) {
            return null;
          }

          return artist;
        })
      );

      artists = artistResults
        .filter(
          (result): result is PromiseFulfilledResult<ArtistSummary | null> =>
            result.status === 'fulfilled' && !!result.value?.idArtist && !!result.value?.strArtist
        )
        .map((result) => result.value as ArtistSummary)
        .slice(0, 12);

      fallbackArtists = candidates.slice(0, 12).map((artistName) => ({
        idArtist: `seed-${artistName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        strArtist: artistName,
        strGenre: isAllGenres ? 'Mixed' : genreLabel,
      }));
    }

    return new Response(
      JSON.stringify({
        artists: artists.length > 0 ? artists : fallbackArtists,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error fetching artists:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch artists',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
