import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';

interface Artist {
  id: string;
  name: string;
  image?: string;
  genre?: string;
}

interface Track {
  id: string;
  name: string;
  artist: string;
  image?: string;
  duration?: number;
  spotifyUrl?: string;
  previewUrl?: string;
  artistId?: string;
}

interface Playlist {
  id: string;
  name: string;
  tracks: Track[];
}

const CLIENT_GENRE_FALLBACK: Record<string, string[]> = {
  Pop: ['Taylor Swift', 'Dua Lipa', 'Ariana Grande', 'Ed Sheeran', 'Lady Gaga'],
  Rock: ['Queen', 'Nirvana', 'Foo Fighters', 'Arctic Monkeys', 'Red Hot Chili Peppers'],
  'Hip Hop': ['Drake', 'Kendrick Lamar', 'J. Cole', 'Travis Scott', 'Nicki Minaj'],
  'R&B': ['SZA', 'Usher', 'Alicia Keys', 'The Weeknd', 'H.E.R.'],
  Jazz: ['Miles Davis', 'John Coltrane', 'Ella Fitzgerald', 'Louis Armstrong', 'Herbie Hancock'],
  Classical: ['Ludwig van Beethoven', 'Wolfgang Amadeus Mozart', 'Johann Sebastian Bach'],
  Electronic: ['Daft Punk', 'Calvin Harris', 'Deadmau5', 'Skrillex', 'Avicii'],
  Country: ['Luke Combs', 'Chris Stapleton', 'Carrie Underwood', 'Kacey Musgraves'],
  Latin: ['Bad Bunny', 'Shakira', 'J Balvin', 'Karol G', 'Rauw Alejandro'],
  Soul: ['Aretha Franklin', 'Marvin Gaye', 'Stevie Wonder', 'Al Green'],
  Blues: ['B.B. King', 'Muddy Waters', 'Buddy Guy', 'Etta James'],
  Folk: ['Bob Dylan', 'Joni Mitchell', 'Mumford & Sons', 'The Lumineers'],
  Metal: ['Metallica', 'Iron Maiden', 'Slipknot', 'Black Sabbath'],
  Reggae: ['Bob Marley', 'Peter Tosh', 'Jimmy Cliff', 'Sean Paul'],
  Disco: ['Bee Gees', 'Donna Summer', 'Chic', 'ABBA'],
};

interface UseMusicWidgetReturn {
  selectedGenre: string;
  setSelectedGenre: (genre: string) => void;
  artistSearchQuery: string;
  setArtistSearchQuery: (query: string) => void;
  artists: Artist[];
  artistTracks: Track[];
  currentTrack: Track | null;
  favorites: Track[];
  playlists: Playlist[];
  isSpotifyConnected: boolean;
  connectSpotify: () => void;
  playTrack: (artist: any, track?: any) => void;
  toggleFavorite: (track: any) => void;
  isFavorited: (trackId: string) => boolean;
  createPlaylist: (name: string) => void;
  deletePlaylist: (playlistId: string) => void;
  addTrackToPlaylist: (playlistId: string, track: Track) => void;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => void;
  replacePlaylists: (playlists: Playlist[]) => void;
}

const PLAYLIST_STORAGE_KEY = 'music-widget-playlists-v1';

export const useMusicWidget = (): UseMusicWidgetReturn => {
  const { data: session } = useSession();
  const [selectedGenre, setSelectedGenre] = useState('');
  const [artistSearchQuery, setArtistSearchQuery] = useState('');
  const [artists, setArtists] = useState<Artist[]>([]);
  const [artistTracks, setArtistTracks] = useState<Track[]>([]);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [favorites, setFavorites] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [isSpotifyConnected, setIsSpotifyConnected] = useState(false);

  // Check Spotify connection
  useEffect(() => {
    setIsSpotifyConnected(!!session?.user?.spotifyAccount);
  }, [session]);

  // Fetch artists from TheAudioDB
  useEffect(() => {
    const fetchArtists = async () => {
      try {
        const response = await fetch('/api/music/artists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ genre: selectedGenre, query: artistSearchQuery }),
        });

        if (!response.ok) throw new Error('Failed to fetch artists');

        const data = await response.json();
        const mappedArtists = (data.artists || []).map((artist: any) => ({
            id: artist.idArtist,
            name: artist.strArtist,
            image: artist.strArtistThumb,
            genre: artist.strGenre,
          }));

        if (mappedArtists.length > 0) {
          setArtists(mappedArtists);
          return;
        }

        if (selectedGenre && CLIENT_GENRE_FALLBACK[selectedGenre]) {
          setArtists(
            CLIENT_GENRE_FALLBACK[selectedGenre].map((artistName) => ({
              id: `local-${artistName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
              name: artistName,
              genre: selectedGenre,
            }))
          );
          return;
        }

        setArtists([]);
      } catch (error) {
        console.error('Error fetching artists:', error);
        if (selectedGenre && CLIENT_GENRE_FALLBACK[selectedGenre]) {
          setArtists(
            CLIENT_GENRE_FALLBACK[selectedGenre].map((artistName) => ({
              id: `local-${artistName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
              name: artistName,
              genre: selectedGenre,
            }))
          );
        } else {
          setArtists([]);
        }
      }
    };

    fetchArtists();
  }, [selectedGenre, artistSearchQuery]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PLAYLIST_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setPlaylists(parsed);
      }
    } catch {
      // ignore invalid local storage payloads
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify(playlists));
    } catch {
      // ignore storage write failures
    }
  }, [playlists]);

  // Load user favorites from database
  useEffect(() => {
    const loadFavorites = async () => {
      try {
        const response = await fetch('/api/music/favorites');
        if (!response.ok) throw new Error('Failed to load favorites');
        const data = await response.json();
        setFavorites(data.favorites || []);
      } catch (error) {
        console.error('Error loading favorites:', error);
      }
    };

    if (session?.user?.id) {
      loadFavorites();
    }
  }, [session]);

  /** Same OAuth entry as Settings → Connected Accounts (custom `/api/auth/spotify`, not NextAuth `signIn`). */
  const connectSpotify = useCallback(() => {
    if (typeof window === 'undefined') return
    window.location.assign('/api/auth/spotify')
  }, []);

  const toTrack = useCallback((value: any): Track => {
    const artistName = value?.artist || value?.name || value?.strArtist || 'Unknown Artist';
    return {
      id: value?.id || value?.idTrack || value?.idArtist || `track-${Date.now()}`,
      name: value?.name || value?.strTrack || artistName,
      artist: artistName,
      image: value?.image || value?.strTrackThumb || value?.strArtistThumb,
      duration: value?.duration || value?.intDuration,
      spotifyUrl: value?.spotifyUrl,
      previewUrl: value?.previewUrl,
      artistId: value?.artistId || value?.id || value?.idArtist,
    };
  }, []);

  const playTrack = useCallback(async (artist: any, track?: any) => {
    const artistName = artist?.name || artist?.strArtist || 'Unknown Artist';
    try {
      // Fetch track details from Spotify or TheAudioDB
      if (isSpotifyConnected && session?.user?.spotifyAccount) {
        // Use Spotify API
        const response = await fetch('/api/music/search-spotify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ artist: artist.name, track: track?.name }),
        });

        if (!response.ok) throw new Error('Spotify search failed');
        const data = await response.json();
        const nextTrack = toTrack(data.track || { ...track, artist: artistName });
        setArtistTracks(nextTrack ? [nextTrack] : []);
        setCurrentTrack(nextTrack);
      } else {
        // Use TheAudioDB + preview URL enrichment
        const response = await fetch('/api/music/track-info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            artistId: artist?.id || artist?.idArtist,
            artistName,
            trackName: track?.name || track?.strTrack,
          }),
        });

        if (!response.ok) {
          setCurrentTrack(toTrack({ ...track, ...artist, artist: artistName }));
          throw new Error('Track info failed');
        }

        const data = await response.json();
        const mappedTracks: Track[] = Array.isArray(data.tracks)
          ? data.tracks.map((item: any) => toTrack(item))
          : [];

        const matched = track?.name
          ? mappedTracks.find((item) => item.name.toLowerCase() === String(track.name).toLowerCase())
          : undefined;

        const primary = toTrack({ ...data.track, artist: artistName, artistId: artist?.id });

        setArtistTracks(mappedTracks.length > 0 ? mappedTracks : [primary]);
        setCurrentTrack(matched || primary);
      }
    } catch (error) {
      // Keep the UI responsive even when upstream track lookup fails.
      setCurrentTrack((prev) => prev || toTrack({ ...track, ...artist, artist: artistName }));
      console.error('Error playing track:', error);
    }
  }, [isSpotifyConnected, session, toTrack]);

  const toggleFavorite = useCallback(
    async (track: any) => {
      try {
        const trackId = track?.id || track?.idTrack || track?.idArtist;
        const trackName = track?.name || track?.strTrack || track?.strArtist || 'Unknown Track';
        const artistName = track?.artist || track?.name || track?.strArtist || 'Unknown Artist';
        const trackImage = track?.image || track?.strTrackThumb || track?.strArtistThumb;

        if (!trackId) return;

        const isFav = favorites.some((fav) => fav.id === trackId);

        // Guest mode: persist locally without requiring auth.
        if (!session?.user?.id) {
          if (isFav) {
            setFavorites((prev) => prev.filter((fav) => fav.id !== trackId));
          } else {
            setFavorites((prev) => [
              ...prev,
              {
                id: trackId,
                name: trackName,
                artist: artistName,
                image: trackImage,
              },
            ]);
          }
          return;
        }

        const response = await fetch('/api/music/favorites', {
          method: isFav ? 'DELETE' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trackId,
            name: trackName,
            artist: artistName,
            image: trackImage,
          }),
        });

        if (!response.ok) {
          if (response.status === 401) {
            if (isFav) {
              setFavorites((prev) => prev.filter((fav) => fav.id !== trackId));
            } else {
              setFavorites((prev) => [
                ...prev,
                {
                  id: trackId,
                  name: trackName,
                  artist: artistName,
                  image: trackImage,
                },
              ]);
            }
            return;
          }
          throw new Error('Failed to update favorites');
        }

        if (isFav) {
          setFavorites((prev) => prev.filter((fav) => fav.id !== trackId));
        } else {
          setFavorites((prev) => [
            ...prev,
            {
              id: trackId,
              name: trackName,
              artist: artistName,
              image: trackImage,
              addedAt: new Date().toLocaleDateString(),
            },
          ]);
        }
      } catch (error) {
        console.error('Error toggling favorite:', error);
      }
    },
    [favorites, session]
  );

  const isFavorited = useCallback(
    (trackId: string) => favorites.some((fav) => fav.id === trackId),
    [favorites]
  );

  const createPlaylist = useCallback((name: string) => {
    const normalized = name.trim();
    if (!normalized) return;

    setPlaylists((prev) => {
      if (prev.some((playlist) => playlist.name.toLowerCase() === normalized.toLowerCase())) {
        return prev;
      }

      return [
        ...prev,
        {
          id: `playlist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: normalized,
          tracks: [],
        },
      ];
    });
  }, []);

  const deletePlaylist = useCallback((playlistId: string) => {
    setPlaylists((prev) => prev.filter((playlist) => playlist.id !== playlistId));
  }, []);

  const addTrackToPlaylist = useCallback((playlistId: string, track: Track) => {
    if (!track?.id) return;

    setPlaylists((prev) =>
      prev.map((playlist) => {
        if (playlist.id !== playlistId) return playlist;
        if (playlist.tracks.some((item) => item.id === track.id)) return playlist;
        return {
          ...playlist,
          tracks: [...playlist.tracks, track],
        };
      })
    );
  }, []);

  const removeTrackFromPlaylist = useCallback((playlistId: string, trackId: string) => {
    setPlaylists((prev) =>
      prev.map((playlist) => {
        if (playlist.id !== playlistId) return playlist;
        return {
          ...playlist,
          tracks: playlist.tracks.filter((track) => track.id !== trackId),
        };
      })
    );
  }, []);

  const replacePlaylists = useCallback((incoming: Playlist[]) => {
    const safe = Array.isArray(incoming)
      ? incoming
          .filter((playlist) => playlist && typeof playlist.id === 'string' && typeof playlist.name === 'string')
          .map((playlist) => ({
            id: playlist.id,
            name: playlist.name,
            tracks: Array.isArray(playlist.tracks)
              ? playlist.tracks.filter((track) => track && typeof track.id === 'string' && typeof track.name === 'string')
              : [],
          }))
      : [];

    setPlaylists(safe);
  }, []);

  return {
    selectedGenre,
    setSelectedGenre,
    artistSearchQuery,
    setArtistSearchQuery,
    artists,
    artistTracks,
    currentTrack,
    favorites,
    playlists,
    isSpotifyConnected,
    connectSpotify,
    playTrack,
    toggleFavorite,
    isFavorited,
    createPlaylist,
    deletePlaylist,
    addTrackToPlaylist,
    removeTrackFromPlaylist,
    replacePlaylists,
  };
};
