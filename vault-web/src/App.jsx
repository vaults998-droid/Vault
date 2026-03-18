import React, { useState, useMemo, useEffect } from 'react';
import { Search, Image, Video, FileText, Music, Hash, Download, Link as LinkIcon, X, Filter, HardDrive, Zap, RefreshCw, CloudRain, AlertTriangle } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

const MOCK_MEDIA = [];

const TierIcon = ({ tier }) => {
  if (tier === 'ARCHIVE') return <HardDrive className="w-3 h-3 text-[#0088cc]" />;
  if (tier === 'HOT') return <Zap className="w-3 h-3 text-[#5865F2]" />;
  if (tier === 'EXPIRED') return <AlertTriangle className="w-3 h-3 text-red-500" />;
  return (
    <div className="flex -space-x-1">
      <HardDrive className="w-3 h-3 text-[#0088cc]" />
      <Zap className="w-3 h-3 text-[#5865F2]" />
    </div>
  );
};

const ImageFallback = ({ item, className }) => {
  const [src, setSrc] = useState(item.discord_url || item.telegram_url);
  const [error, setError] = useState(false);

  const handleError = () => {
    if (src === item.discord_url && item.telegram_url) {
      setSrc(item.telegram_url);
    } else {
      setError(true);
    }
  };

  if (error || !src) return <div className="absolute inset-0 bg-red-500/10 flex flex-col items-center justify-center text-red-400 text-xs"><AlertTriangle className="w-6 h-6 mb-1 opacity-50"/>Link Expired</div>;

  return <img src={src} alt={item.filename} onError={handleError} className={className} />;
};

const TypeIcon = ({ type, className = "" }) => {
  switch (type) {
    case 'IMG': return <Image className={className} />;
    case 'VID': return <Video className={className} />;
    case 'AUDIO': return <Music className={className} />;
    case 'DOC': return <FileText className={className} />;
    default: return <FileText className={className} />;
  }
};

const MediaCard = ({ item, onClick }) => {
  return (
    <div 
      onClick={() => onClick(item)}
      className="group relative flex flex-col bg-vault-surface rounded-xl border border-vault-border overflow-hidden cursor-pointer hover:border-vault-accent/50 hover:shadow-[0_8px_30px_rgb(0,0,0,0.5)] hover:-translate-y-1 transition-all duration-300"
    >
      <div className="h-48 w-full bg-[#1e1e24] flex items-center justify-center relative overflow-hidden text-vault-text-muted">
        {item.type === 'IMG' && (item.discord_url || item.telegram_url) ? (
          <ImageFallback item={item} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        ) : (
          <TypeIcon type={item.type} className="w-16 h-16 opacity-50 group-hover:scale-110 transition-transform duration-300 group-hover:text-vault-accent" />
        )}
        
        {/* Tier Badge */}
        <div className="absolute top-3 right-3 px-2 py-1 rounded bg-black/80 backdrop-blur-md text-xs font-bold border border-white/10 tracking-wider flex items-center gap-1.5 shadow-lg">
          <TierIcon tier={item.tier} />
          <span className="text-[10px] uppercase text-vault-text-muted">{item.tier}</span>
        </div>
      </div>
      
      <div className="p-4 flex-1 flex flex-col gap-2">
        <h3 className="font-semibold text-sm truncate text-vault-text group-hover:text-vault-accent transition-colors" title={item.filename}>{item.filename}</h3>
        <div className="flex justify-between items-center text-xs text-vault-text-muted">
          <span>{item.date_added || item.date}</span>
          <span>{item.size_bytes || item.size}</span>
        </div>
        <div className="mt-auto pt-3 flex flex-wrap gap-1.5">
          {item.tags?.slice(0, 3).map(tag => (
            <span key={tag} className="text-[10px] px-2 py-0.5 rounded-md bg-vault-border text-vault-text-muted uppercase tracking-wider font-semibold">
              <Hash className="w-2 h-2 inline mr-0.5 opacity-70" />{tag}
            </span>
          ))}
          {item.tags?.length > 3 && <span className="text-[10px] px-2 py-0.5 text-vault-text-muted">+{item.tags.length - 3}</span>}
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [search, setSearch] = useState('');
  const [activeType, setActiveType] = useState('ALL');
  const [activeTier, setActiveTier] = useState('ALL');
  const [selectedMedia, setSelectedMedia] = useState(null);
  const [mediaItems, setMediaItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const observerTarget = React.useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && hasMore && !isLoading && isConnected) {
          setPage(prev => prev + 1);
        }
      },
      { threshold: 1.0 }
    );
    if (observerTarget.current) observer.observe(observerTarget.current);
    return () => observer.disconnect();
  }, [hasMore, isLoading, isConnected]);

  useEffect(() => {
    async function fetchMedia() {
      if (!supabase) {
        if (page === 0) setMediaItems(MOCK_MEDIA);
        setIsLoading(false);
        setHasMore(false);
        return;
      }
      setIsConnected(true);
      if (page === 0) setIsLoading(true);

      const from = page * 50;
      const to = from + 49;

      const { data, error } = await supabase.from('vault_media').select('*').order('created_at', { ascending: false }).range(from, to);
      
      if (error) {
        console.error('Supabase error:', error);
      } else {
        if (page === 0) setMediaItems(data || []);
        else setMediaItems(prev => [...prev, ...(data || [])]);

        if (!data || data.length < 50) setHasMore(false);
      }
      setIsLoading(false);
    }
    fetchMedia();
  }, [page]);

  const filteredMedia = useMemo(() => {
    return mediaItems.filter(item => {
      const matchesSearch = item.filename.toLowerCase().includes(search.toLowerCase()) || 
                            (item.tags || []).some(tag => tag.toLowerCase().includes(search.toLowerCase()));
      const matchesType = activeType === 'ALL' || item.type === activeType;
      const matchesTier = activeTier === 'ALL' || item.tier === activeTier;
      
      return matchesSearch && matchesType && matchesTier;
    });
  }, [search, activeType, activeTier, mediaItems]);

  const handlePromote = async (id) => {
    setIsProcessing(true);
    try {
      const res = await fetch('http://localhost:3002/api/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const result = await res.json();
      if (result.success) {
        setMediaItems(prev => prev.map(m => m.id === id ? { ...m, tier: result.tier, telegram_url: result.url, tags: result.tags } : m));
        setSelectedMedia(prev => ({ ...prev, tier: result.tier, telegram_url: result.url, tags: result.tags }));
      } else {
        alert("Promote failed: " + result.error);
      }
    } catch (e) {
      alert("Error: " + e.message);
    }
    setIsProcessing(false);
  };

  const handleCache = async (id) => {
    setIsProcessing(true);
    try {
      const res = await fetch('http://localhost:3002/api/cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const result = await res.json();
      if (result.success) {
        setMediaItems(prev => prev.map(m => m.id === id ? { ...m, tier: result.tier, discord_url: result.url, tags: result.tags } : m));
        setSelectedMedia(prev => ({ ...prev, tier: result.tier, discord_url: result.url, tags: result.tags }));
      } else {
        alert("Cache failed: " + result.error);
      }
    } catch (e) {
      alert("Error: " + e.message);
    }
    setIsProcessing(false);
  };

  return (
    <div className="min-h-screen bg-vault-bg text-vault-text flex selection:bg-vault-accent/30 font-sans">
      
      {/* Sidebar Navigation */}
      <aside className="w-64 border-r border-vault-border bg-[#101014] p-6 hidden md:flex flex-col gap-8 h-screen sticky top-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-vault-accent to-[#ec4899] flex items-center justify-center shadow-[0_0_20px_rgba(139,92,246,0.3)]">
            <Filter className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-2xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">VAULT</h1>
        </div>

        {/* Connection Status Badge */}
        <div className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 border ${isConnected ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-amber-500/10 border-amber-500/20 text-amber-400'}`}>
          <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${isConnected ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
          {isConnected ? 'Dual-Tier Sync: Active' : 'Local: Mock Mode'}
        </div>

        <div className="flex flex-col gap-6">
          <div>
            <h2 className="text-xs font-bold text-vault-text-muted uppercase tracking-widest mb-3">Storage Tier</h2>
            <div className="flex flex-col gap-1">
              {[
                { id: 'ALL', label: 'Everything', icon: <Hash className="w-4 h-4"/> },
                { id: 'ARCHIVE', label: 'Archive (Telegram)', icon: <HardDrive className="w-4 h-4 text-[#0088cc]"/> },
                { id: 'HOT', label: 'Hot Cache (Discord)', icon: <Zap className="w-4 h-4 text-[#5865F2]"/> },
                { id: 'BOTH', label: 'Fully Synced', icon: <RefreshCw className="w-4 h-4 text-emerald-400"/> },
                { id: 'EXPIRED', label: 'Expired Links', icon: <AlertTriangle className="w-4 h-4 text-red-500"/> }
              ].map(tier => (
                <button 
                  key={tier.id}
                  onClick={() => setActiveTier(tier.id)}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTier === tier.id ? 'bg-vault-surface text-white' : 'text-vault-text-muted hover:text-white hover:bg-vault-surface/50'}`}
                >
                  {tier.icon}
                  {tier.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-xs font-bold text-vault-text-muted uppercase tracking-widest mb-3">Categories</h2>
            <div className="flex flex-col gap-1">
              {[
                { id: 'ALL', label: 'All Files', icon: Filter },
                { id: 'IMG', label: 'Images', icon: Image },
                { id: 'VID', label: 'Videos', icon: Video },
                { id: 'AUDIO', label: 'Audio', icon: Music },
                { id: 'DOC', label: 'Documents', icon: FileText }
              ].map(cat => {
                const Icon = cat.icon;
                return (
                  <button 
                    key={cat.id}
                    onClick={() => setActiveType(cat.id)}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeType === cat.id ? 'bg-vault-surface text-white' : 'text-vault-text-muted hover:text-white hover:bg-vault-surface/50'}`}
                  >
                    <Icon className="w-4 h-4 opacity-70" />
                    {cat.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 lg:p-10 flex flex-col min-h-screen w-full relative">
        <header className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center mb-8">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Your Media</h2>
            <p className="text-vault-text-muted text-sm mt-1">Manage unified files across Archive & Hot Cache</p>
          </div>
          
          <div className="relative w-full md:w-80 group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-vault-text-muted group-focus-within:text-vault-accent transition-colors" />
            <input 
              type="text" 
              placeholder="Search by name or config tag..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-vault-surface border border-vault-border rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:border-vault-accent/50 focus:ring-1 focus:ring-vault-accent/50 transition-all shadow-inner text-white placeholder:text-vault-text-muted"
            />
          </div>
        </header>

        {/* Media Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 flex-1 content-start">
          {isLoading && page === 0 ? (
             <div className="col-span-full h-64 flex flex-col items-center justify-center text-vault-text-muted">
               <div className="w-8 h-8 border-2 border-vault-accent border-t-transparent rounded-full animate-spin mb-4"></div>
               <p>Searching the two-tier vault...</p>
             </div>
          ) : filteredMedia.length > 0 ? (
            <>
              {filteredMedia.map(item => (
                <MediaCard key={item.id} item={item} onClick={setSelectedMedia} />
              ))}
              {hasMore && (
                <div ref={observerTarget} className="col-span-full py-8 flex justify-center text-vault-text-muted">
                  <RefreshCw className="w-6 h-6 animate-spin opacity-50" />
                </div>
              )}
            </>
          ) : (
            <div className="col-span-full h-64 flex flex-col items-center justify-center text-vault-text-muted border border-dashed border-vault-border rounded-2xl">
              <Search className="w-12 h-12 mb-4 opacity-20" />
              <p>{search ? 'No files found matching your search.' : 'Your vault is currently empty.'}</p>
            </div>
          )}
        </div>
      </main>

      {/* Preview Modal */}
      {selectedMedia && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setSelectedMedia(null)}></div>
          <div className="relative bg-[#18181b] border border-[#27272a] rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            
            <div className="flex items-center justify-between p-4 border-b border-[#27272a]">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-[#27272a] rounded-lg text-vault-text-muted relative">
                  <TypeIcon type={selectedMedia.type} />
                  <div className="absolute -bottom-1 -right-1 bg-[#18181b] rounded-full p-0.5 border border-[#27272a]">
                    <TierIcon tier={selectedMedia.tier} />
                  </div>
                </div>
                <div>
                  <h3 className="font-bold text-lg leading-none">{selectedMedia.filename}</h3>
                  <div className="text-sm text-vault-text-muted mt-1 uppercase text-[10px] tracking-widest font-bold flex items-center gap-2">
                    <span className="text-vault-accent">{selectedMedia.tier} TIER</span>
                    <span>•</span>
                    <span>{selectedMedia.size_bytes}</span>
                    <span>•</span>
                    <span>{selectedMedia.date_added}</span>
                  </div>
                </div>
              </div>
              <button 
                onClick={() => setSelectedMedia(null)}
                className="p-2 hover:bg-[#27272a] rounded-xl transition-colors text-vault-text-muted hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {selectedMedia.tier === 'HOT' && (
              <div className="bg-amber-500/10 border-y border-amber-500/20 px-4 py-2 flex items-center justify-between">
                <p className="text-xs text-amber-400 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> This file is in Hot Cache only. Discord links may expire!
                </p>
                <button 
                  onClick={() => handlePromote(selectedMedia.id)}
                  disabled={isProcessing}
                  className="text-xs bg-amber-500 text-[#18181b] font-bold px-3 py-1 rounded-md hover:bg-amber-400 disabled:opacity-50 flex items-center gap-1"
                >
                  {isProcessing ? <RefreshCw className="w-3 h-3 animate-spin"/> : <HardDrive className="w-3 h-3"/>}
                  Promote to Archive
                </button>
              </div>
            )}

            {selectedMedia.tier === 'ARCHIVE' && (
              <div className="bg-[#0088cc]/10 border-y border-[#0088cc]/20 px-4 py-2 flex items-center justify-between">
                <p className="text-xs text-[#0088cc] flex items-center gap-2">
                  <CloudRain className="w-4 h-4" /> This file is cold. Caching to Discord unlocks faster delivery!
                </p>
                <button 
                  onClick={() => handleCache(selectedMedia.id)}
                  disabled={isProcessing}
                  className="text-xs bg-[#0088cc] text-white font-bold px-3 py-1 rounded-md hover:brightness-110 disabled:opacity-50 flex items-center gap-1"
                >
                  {isProcessing ? <RefreshCw className="w-3 h-3 animate-spin"/> : <Zap className="w-3 h-3"/>}
                  Cache to Hot
                </button>
              </div>
            )}

            <div className="flex-1 overflow-auto p-0 bg-black/50 min-h-[300px] flex items-center justify-center relative w-full">
              {selectedMedia.type === 'IMG' && (selectedMedia.discord_url || selectedMedia.telegram_url) ? (
                 <ImageFallback item={selectedMedia} className="max-w-full max-h-[50vh] object-contain" />
              ) : selectedMedia.type === 'VID' && (selectedMedia.discord_url || selectedMedia.telegram_url) ? (
                 <video controls autoPlay src={selectedMedia.discord_url || selectedMedia.telegram_url} className="max-w-full max-h-[60vh] object-contain w-full outline-none bg-black/20" />
              ) : selectedMedia.type === 'AUDIO' && (selectedMedia.discord_url || selectedMedia.telegram_url) ? (
                 <div className="flex flex-col items-center justify-center w-full p-8">
                   <Music className="w-32 h-32 mb-8 text-vault-accent opacity-80 drop-shadow-2xl" />
                   <audio controls autoPlay src={selectedMedia.discord_url || selectedMedia.telegram_url} className="w-full max-w-md" />
                 </div>
              ) : (
                <div className="flex flex-col items-center justify-center text-vault-text-muted opacity-50">
                  <TypeIcon type={selectedMedia.type} className="w-24 h-24 mb-4" />
                  <p>Preview not available for this type</p>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-[#27272a] bg-[#101014] flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex flex-wrap gap-2">
                {selectedMedia.tags?.map(tag => (
                  <span key={tag} className="text-xs px-2.5 py-1 rounded bg-[#27272a] text-vault-text-muted flex items-center gap-1 hover:text-white cursor-pointer transition-colors border border-transparent hover:border-vault-accent/30">
                    <Hash className="w-3 h-3" />{tag}
                  </span>
                ))}
              </div>
              
              <div className="flex items-center gap-2 shrink-0">
                <button 
                  onClick={() => navigator.clipboard.writeText(selectedMedia.discord_url || selectedMedia.telegram_url)}
                  className="flex items-center gap-2 px-4 py-2 hover:bg-[#27272a] rounded-lg text-sm font-medium transition-colors border border-transparent"
                >
                  <LinkIcon className="w-4 h-4" /> Copy Link
                </button>
                <a 
                  href={selectedMedia.discord_url || selectedMedia.telegram_url}
                  target="_blank" rel="noreferrer"
                  className="flex items-center gap-2 px-4 py-2 bg-vault-accent hover:bg-vault-accent-hover text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-vault-accent/20"
                >
                  <Download className="w-4 h-4" /> Download URL
                </a>
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
