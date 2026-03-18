import React, { useState, useMemo, useEffect } from 'react';
import { Search, Image, Video, FileText, Music, Hash, Download, Link as LinkIcon, X, Filter } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase. Replace these placeholders with `.env.local`
// environment variables in Vercel/Netlify for production.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

const MOCK_MEDIA = [
  { id: 1, filename: 'project_blueprint.pdf', type: 'DOC', source: 'telegram', size: '2.4 MB', date: '2026-03-17', tags: ['work', 'planning'], url: '#' },
  { id: 2, filename: 'vacation_photo.jpg', type: 'IMG', source: 'discord', size: '4.1 MB', date: '2026-03-16', tags: ['personal', 'travel'], url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800' },
  { id: 3, filename: 'demo_recording.mp4', type: 'VID', source: 'discord', size: '150 MB', date: '2026-03-15', tags: ['work', 'demo'], url: '#' },
  { id: 4, filename: 'voice_memo.mp3', type: 'AUDIO', source: 'telegram', size: '1.2 MB', date: '2026-03-14', tags: ['ideas'], url: '#' },
  { id: 5, filename: 'meeting_notes.docx', type: 'DOC', source: 'telegram', size: '45 KB', date: '2026-03-12', tags: ['work'], url: '#' },
  { id: 6, filename: 'design_mockup.png', type: 'IMG', source: 'discord', size: '8.5 MB', date: '2026-03-10', tags: ['design'], url: 'https://images.unsplash.com/photo-1561070791-2526d30994b5?w=800' },
];

const FilterChip = ({ label, active, onClick }) => (
  <button
    onClick={onClick}
    className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
      active 
        ? 'bg-vault-accent text-white shadow-[0_0_15px_rgba(139,92,246,0.5)]' 
        : 'bg-vault-surface text-vault-text-muted hover:bg-vault-surface-hover hover:text-white border border-vault-border'
    }`}
  >
    {label}
  </button>
);

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
        {item.type === 'IMG' && item.url && item.url !== '#' ? (
          <img src={item.url} alt={item.filename} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        ) : (
          <TypeIcon type={item.type} className="w-16 h-16 opacity-50 group-hover:scale-110 transition-transform duration-300 group-hover:text-vault-accent" />
        )}
        
        {/* Source Badge */}
        <div className="absolute top-3 right-3 px-2 py-1 rounded bg-black/60 backdrop-blur-md text-xs font-bold border border-white/10 uppercase tracking-wider flex items-center gap-1">
          <span className={`w-2 h-2 rounded-full ${item.source === 'telegram' ? 'bg-[#0088cc]' : 'bg-[#5865F2]'}`}></span>
          {item.source}
        </div>
      </div>
      
      <div className="p-4 flex-1 flex flex-col gap-2">
        <h3 className="font-semibold text-sm truncate text-vault-text group-hover:text-vault-accent transition-colors" title={item.filename}>{item.filename}</h3>
        <div className="flex justify-between items-center text-xs text-vault-text-muted">
          <span>{item.date_added || item.date}</span>
          <span>{item.size_bytes || item.size}</span>
        </div>
        <div className="mt-auto pt-3 flex flex-wrap gap-1.5">
          {item.tags?.map(tag => (
            <span key={tag} className="text-[10px] px-2 py-0.5 rounded-md bg-vault-border text-vault-text-muted uppercase tracking-wider font-semibold">
              <Hash className="w-2 h-2 inline mr-0.5 opacity-70" />{tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [search, setSearch] = useState('');
  const [activeType, setActiveType] = useState('ALL');
  const [activeSource, setActiveSource] = useState('ALL');
  const [selectedMedia, setSelectedMedia] = useState(null);
  const [mediaItems, setMediaItems] = useState(MOCK_MEDIA);

  useEffect(() => {
    async function fetchMedia() {
      if (!supabase) return;
      const { data, error } = await supabase.from('vault_media').select('*').order('created_at', { ascending: false });
      if (!error && data && data.length > 0) {
        setMediaItems(data);
      }
    }
    fetchMedia();
  }, []);

  const filteredMedia = useMemo(() => {
    return mediaItems.filter(item => {
      const matchesSearch = item.filename.toLowerCase().includes(search.toLowerCase()) || 
                            (item.tags || []).some(tag => tag.toLowerCase().includes(search.toLowerCase()));
      const matchesType = activeType === 'ALL' || item.type === activeType;
      const matchesSource = activeSource === 'ALL' || item.source.toLowerCase() === activeSource.toLowerCase();
      
      return matchesSearch && matchesType && matchesSource;
    });
  }, [search, activeType, activeSource, mediaItems]);

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

        <div className="flex flex-col gap-6">
          <div>
            <h2 className="text-xs font-bold text-vault-text-muted uppercase tracking-widest mb-3">Sources</h2>
            <div className="flex flex-col gap-1">
              {['ALL', 'Telegram', 'Discord'].map(src => (
                <button 
                  key={src}
                  onClick={() => setActiveSource(src)}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeSource === src ? 'bg-vault-surface text-white' : 'text-vault-text-muted hover:text-white hover:bg-vault-surface/50'}`}
                >
                  {src === 'Telegram' && <span className="w-2 h-2 rounded-full bg-[#0088cc]"></span>}
                  {src === 'Discord' && <span className="w-2 h-2 rounded-full bg-[#5865F2]"></span>}
                  {src === 'ALL' && <span className="w-2 h-2 rounded-full border border-current"></span>}
                  {src}
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
            <p className="text-vault-text-muted text-sm mt-1">Manage files from all your connected platforms</p>
          </div>
          
          <div className="relative w-full md:w-80 group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-vault-text-muted group-focus-within:text-vault-accent transition-colors" />
            <input 
              type="text" 
              placeholder="Search by name or tag..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-vault-surface border border-vault-border rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:border-vault-accent/50 focus:ring-1 focus:ring-vault-accent/50 transition-all shadow-inner text-white placeholder:text-vault-text-muted"
            />
          </div>
        </header>

        {/* Filter Chips - Mobile Mainly / Extra Filters */}
        <div className="flex flex-wrap items-center gap-2 mb-8 md:hidden">
          {['ALL', 'IMG', 'VID', 'AUDIO', 'DOC'].map(type => (
            <FilterChip key={type} label={type} active={activeType === type} onClick={() => setActiveType(type)} />
          ))}
        </div>

        {/* Media Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 flex-1 content-start">
          {filteredMedia.length > 0 ? (
            filteredMedia.map(item => (
              <MediaCard key={item.id} item={item} onClick={setSelectedMedia} />
            ))
          ) : (
            <div className="col-span-full h-64 flex flex-col items-center justify-center text-vault-text-muted border border-dashed border-vault-border rounded-2xl">
              <Search className="w-12 h-12 mb-4 opacity-20" />
              <p>No files found matching your criteria.</p>
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
                <div className="p-2 bg-[#27272a] rounded-lg text-vault-text-muted">
                  <TypeIcon type={selectedMedia.type} />
                </div>
                <div>
                  <h3 className="font-bold text-lg leading-none">{selectedMedia.filename}</h3>
                  <div className="text-sm text-vault-text-muted mt-1 uppercase text-[10px] tracking-widest font-bold flex gap-2">
                    <span className={selectedMedia.source === 'telegram' ? 'text-[#0088cc]' : 'text-[#5865F2]'}>
                      {selectedMedia.source}
                    </span>
                    <span>•</span>
                    <span>{selectedMedia.size}</span>
                    <span>•</span>
                    <span>{selectedMedia.date}</span>
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

            <div className="flex-1 overflow-auto p-0 bg-black/50 min-h-[300px] flex items-center justify-center relative">
              {selectedMedia.type === 'IMG' && selectedMedia.url !== '#' ? (
                <img src={selectedMedia.url} alt={selectedMedia.filename} className="max-w-full max-h-[50vh] object-contain" />
              ) : (
                <div className="flex flex-col items-center justify-center text-vault-text-muted opacity-50">
                  <TypeIcon type={selectedMedia.type} className="w-24 h-24 mb-4" />
                  <p>Preview not available</p>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-[#27272a] bg-[#101014] flex items-center justify-between">
              <div className="flex gap-2">
                {selectedMedia.tags?.map(tag => (
                  <span key={tag} className="text-xs px-2.5 py-1 rounded bg-[#27272a] text-vault-text-muted flex items-center gap-1 hover:text-white cursor-pointer transition-colors border border-transparent hover:border-vault-accent/30">
                    <Hash className="w-3 h-3" />{tag}
                  </span>
                ))}
              </div>
              
              <div className="flex items-center gap-3">
                <button className="flex items-center gap-2 px-4 py-2 hover:bg-[#27272a] rounded-lg text-sm font-medium transition-colors border border-transparent">
                  <LinkIcon className="w-4 h-4" /> Copy Link
                </button>
                <button className="flex items-center gap-2 px-4 py-2 bg-vault-accent hover:bg-vault-accent-hover text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-vault-accent/20">
                  <Download className="w-4 h-4" /> Download
                </button>
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
