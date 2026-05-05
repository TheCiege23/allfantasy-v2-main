'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronUp, X, Music, Volume2 } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useMusicWidget } from '@/hooks/useMusicWidget';
import GenreSelector from './GenreSelector';
import ArtistBrowser from './ArtistBrowser';
import NowPlaying from './NowPlaying';
import FavoriteTracks from './FavoriteTracks';
import PlaylistsPanel from './PlaylistsPanel';
import './FloatingMusicWidget.css';

interface Position {
  x: number;
  y: number;
}

export const FloatingMusicWidget: React.FC = () => {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [position, setPosition] = useState<Position>({ x: 20, y: 80 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState<Position>({ x: 0, y: 0 });
  const [activeTab, setActiveTab] = useState<'browse' | 'favorites' | 'now-playing' | 'playlists'>('browse');
  const [volume, setVolume] = useState(70);
  const [autoPlayQueue, setAutoPlayQueue] = useState(true);
  const widgetRef = useRef<HTMLDivElement>(null);

  const {
    selectedGenre,
    setSelectedGenre,
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
  } = useMusicWidget();

  const exportPlaylists = () => {
    try {
      const payload = JSON.stringify({ playlists }, null, 2);
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'allfantasy-music-playlists.json';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      // ignore export failures
    }
  };

  // Handle dragging
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;

      setPosition({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  const handleDragStart = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!widgetRef.current) return;
    const rect = widgetRef.current.getBoundingClientRect();
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const handlePlayTrack = (artist: any, track?: any) => {
    void playTrack(artist, track);
    setActiveTab('now-playing');
  };

  // Must run after all hooks — early return before hooks breaks Rules of Hooks when pathname changes.
  if (pathname?.startsWith('/e2e')) return null;

  return (
    <>
      {!isVisible && (
        <button
          type="button"
          className="floating-music-widget-reopen"
          onClick={() => setIsVisible(true)}
          title="Open music player"
          aria-label="Open music player"
        >
          <Music size={22} />
        </button>
      )}
    <div
      ref={widgetRef}
      className={`floating-music-widget ${isCollapsed ? 'collapsed' : 'expanded'} ${!isVisible ? 'hidden' : ''}`}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        display: isVisible ? undefined : 'none',
      }}
    >
      {/* Header / Drag Handle */}
      <div className="widget-header" onMouseDown={handleDragStart}>
        <div className="header-content">
          <Music size={18} className="header-icon" />
          <span className="header-title">Music Player</span>
        </div>
        <div className="header-actions">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="icon-button"
            title={isCollapsed ? 'Expand' : 'Collapse'}
          >
            {isCollapsed ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          <button
            onClick={() => setIsVisible(false)}
            className="icon-button close-btn"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="widget-content">
          {/* Tabs */}
          <div className="widget-tabs">
            <button
              className={`tab ${activeTab === 'browse' ? 'active' : ''}`}
              onClick={() => setActiveTab('browse')}
            >
              Browse
            </button>
            <button
              className={`tab ${activeTab === 'now-playing' ? 'active' : ''}`}
              onClick={() => setActiveTab('now-playing')}
            >
              Now Playing
            </button>
            <button
              className={`tab ${activeTab === 'favorites' ? 'active' : ''}`}
              onClick={() => setActiveTab('favorites')}
            >
              ♥ ({favorites.length})
            </button>
            <button
              className={`tab ${activeTab === 'playlists' ? 'active' : ''}`}
              onClick={() => setActiveTab('playlists')}
            >
              Playlists ({playlists.length})
            </button>
          </div>

          {/* Tab Content */}
          <div className="widget-body">
            {activeTab === 'browse' && (
              <div className="browse-content">
                <GenreSelector
                  selectedGenre={selectedGenre}
                  onGenreChange={setSelectedGenre}
                />
                <div className="spotify-connect">
                  {!isSpotifyConnected ? (
                    <button type="button" className="spotify-button" onClick={connectSpotify}>
                      Connect Spotify
                    </button>
                  ) : (
                    <div className="spotify-connected">✓ Spotify Connected</div>
                  )}
                </div>
                <ArtistBrowser
                  artists={artists}
                  onPlayTrack={handlePlayTrack}
                  onToggleFavorite={toggleFavorite}
                  isFavorited={isFavorited}
                  onSearchArtists={setArtistSearchQuery}
                />
              </div>
            )}

            {activeTab === 'now-playing' && (
              <NowPlaying
                currentTrack={currentTrack}
                availableTracks={artistTracks}
                onSelectTrack={(track) => {
                  const artist = {
                    id: track.id,
                    name: track.artist,
                  };
                  handlePlayTrack(artist, track);
                }}
                onToggleFavorite={toggleFavorite}
                isFavorited={isFavorited}
                volume={volume}
                onVolumeChange={setVolume}
                autoPlayQueue={autoPlayQueue}
                onToggleAutoPlayQueue={() => setAutoPlayQueue((prev) => !prev)}
              />
            )}

            {activeTab === 'favorites' && (
              <FavoriteTracks
                favorites={favorites}
                onPlayTrack={(track) => {
                  const artist = {
                    id: track.id,
                    name: track.artist,
                  };
                  handlePlayTrack(artist, track);
                }}
                onToggleFavorite={toggleFavorite}
              />
            )}

            {activeTab === 'playlists' && (
              <PlaylistsPanel
                playlists={playlists}
                currentTrack={currentTrack}
                onCreatePlaylist={createPlaylist}
                onDeletePlaylist={deletePlaylist}
                onAddTrackToPlaylist={addTrackToPlaylist}
                onRemoveTrackFromPlaylist={removeTrackFromPlaylist}
                onExportPlaylists={exportPlaylists}
                onImportPlaylists={replacePlaylists}
                onPlayTrack={(track) => {
                  const artist = {
                    id: track.id,
                    name: track.artist,
                  };
                  handlePlayTrack(artist, track);
                  setActiveTab('now-playing');
                }}
              />
            )}
          </div>

          {/* Volume Control Footer */}
          <div className="widget-footer">
            <Volume2 size={16} />
            <input
              type="range"
              min="0"
              max="100"
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="volume-slider"
            />
            <span className="volume-text">{volume}%</span>
          </div>
        </div>
      )}
    </div>
    </>
  );
};

export default FloatingMusicWidget;
