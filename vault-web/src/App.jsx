import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  Search, Image, Video, FileText, Music, Hash, Download, Link as LinkIcon,
  X, Filter, HardDrive, RefreshCw, CloudRain, AlertTriangle, Trash2,
  UploadCloud, Plus, CheckCircle, Edit3, Save, BarChart2, ShieldCheck, RotateCcw
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// ── Tier Icon ─────────────────────────────────────────────────────────────────
const TierIcon = ({ tier }) => {
  if (tier === 'ARCHIVE') return <HardDrive className="w-3 h-3 text-[#0088cc]" />;
  if (tier === 'EXPIRED') return <AlertTriangle className="w-3 h-3 text-red-500" />;
  return <HardDrive className="w-3 h-3 text-[#0088cc]" />;
};

// ── Image with fallback ───────────────────────────────────────────────────────
const ImageFallback = ({ item, className }) => {
  const [src, setSrc] = useState(item.telegram_url);
  const [err, setErr] = useState(false);
  if (err || !src)
    return <div className="absolute inset-0 bg-red-500/10 flex flex-col items-center justify-center text-red-400 text-xs"><AlertTriangle className="w-6 h-6 mb-1 opacity-50"/>Link Expired</div>;
  return <img src={src} alt={item.filename} onError={() => setErr(true)} className={className} />;
};

// ── Type Icon ─────────────────────────────────────────────────────────────────
const TypeIcon = ({ type, className = '' }) => {
  switch (type) {
    case 'IMG':   return <Image    className={className} />;
    case 'VID':   return <Video    className={className} />;
    case 'AUDIO': return <Music    className={className} />;
    default:      return <FileText className={className} />;
  }
};

// ── Media Card ────────────────────────────────────────────────────────────────
const MediaCard = ({ item, onClick, isSelected, isSelectMode, onToggle }) => (
  <div
    onClick={() => isSelectMode ? onToggle(item.id) : onClick(item)}
    className={`group relative flex flex-col bg-vault-surface rounded-xl overflow-hidden cursor-pointer transition-all duration-300 ${isSelected ? 'border-2 border-vault-accent ring-2 ring-vault-accent/30 scale-[0.98]' : 'border border-vault-border hover:border-vault-accent/50 hover:shadow-[0_8px_30px_rgb(0,0,0,0.5)] hover:-translate-y-1'}`}
  >
    {/* Checkbox Toggle */}
    <div onClick={(e) => { e.stopPropagation(); onToggle(item.id); }}
         className={`absolute top-3 left-3 z-10 w-6 h-6 rounded flex items-center justify-center transition-all ${isSelected ? 'bg-vault-accent text-black scale-100 shadow-md' : 'bg-black/50 border border-white/30 text-transparent opacity-0 group-hover:opacity-100 hover:scale-110'} ${isSelectMode && !isSelected ? 'opacity-100' : ''}`}>
      <CheckCircle className="w-4 h-4 pointer-events-none" />
    </div>

    <div className="h-48 w-full bg-[#1e1e24] flex items-center justify-center relative overflow-hidden text-vault-text-muted">
      {item.type === 'IMG' && item.telegram_url
        ? <ImageFallback item={item} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        : <TypeIcon type={item.type} className="w-16 h-16 opacity-50 group-hover:scale-110 transition-transform duration-300 group-hover:text-vault-accent" />
      }
      <div className="absolute top-3 right-3 px-2 py-1 rounded bg-black/80 backdrop-blur-md text-xs font-bold border border-white/10 tracking-wider flex items-center gap-1.5 shadow-lg">
        <TierIcon tier={item.tier} />
        <span className="text-[10px] uppercase text-vault-text-muted">{item.tier}</span>
      </div>
    </div>
    <div className="p-4 flex-1 flex flex-col gap-2">
      <h3 className="font-semibold text-sm truncate text-vault-text group-hover:text-vault-accent transition-colors" title={item.filename}>
        {item.display_name || item.filename}
      </h3>
      <div className="flex justify-between items-center text-xs text-vault-text-muted">
        <span>{item.date_added}</span>
        <span>{item.size_bytes}</span>
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

// ═════════════════════════════════════════════════════════════════════════════
export default function App() {
  // ── Core state ──────────────────────────────────────────────────────────────
  const [search,        setSearch]        = useState('');
  const [activeType,    setActiveType]    = useState('ALL');
  const [activeTier,    setActiveTier]    = useState('ALL');
  const [activeTag,     setActiveTag]     = useState(null);
  const [selectedMedia, setSelectedMedia] = useState(null);
  const [mediaItems,    setMediaItems]    = useState([]);
  const [isLoading,     setIsLoading]     = useState(true);
  const [fetchError,    setFetchError]    = useState(null); // FIX #8: surface DB errors to UI
  const [isConnected,   setIsConnected]   = useState(false);
  const [isProcessing,  setIsProcessing]  = useState(false);

  // ── Multi-select state ──────────────────────────────────────────────────────
  const [selectedIds,       setSelectedIds]       = useState(new Set());
  const [isSelectionMode,  setIsSelectionMode]    = useState(false);
  const [batchProgress,    setBatchProgress]      = useState(null);

  // ── Pagination ──────────────────────────────────────────────────────────────
  const [page,    setPage]    = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const observerTarget = useRef(null);

  // ── Upload state ────────────────────────────────────────────────────────────
  const [showUpload,   setShowUpload]   = useState(false);
  const [isDragOver,   setIsDragOver]   = useState(false);
  const [uploadQueue,  setUploadQueue]  = useState([]);
  const [uploadTags,   setUploadTags]   = useState('');
  const fileInputRef = useRef(null);

  // ── Edit / Meta state ───────────────────────────────────────────────────────
  const [editMode,     setEditMode]     = useState(false);
  const [editName,     setEditName]     = useState('');
  const [editNotes,    setEditNotes]    = useState('');
  const [editTags,     setEditTags]     = useState('');
  const [isSavingMeta, setIsSavingMeta] = useState(false);

  // ── Stats ────────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const activeItems = mediaItems.filter(m => m.tier !== 'TRASH');
    const total       = activeItems.length;
    const archive     = activeItems.filter(m => m.tier === 'ARCHIVE').length;
    const expired     = activeItems.filter(m => m.tier === 'EXPIRED').length;
    const trash       = mediaItems.filter(m => m.tier === 'TRASH').length;
    const byType      = { IMG: 0, VID: 0, AUDIO: 0, DOC: 0 };
    activeItems.forEach(m => { if (byType[m.type] !== undefined) byType[m.type]++; else byType.DOC++; });
    return { total, archive, expired, trash, byType };
  }, [mediaItems]);

  // ── Tag Cloud ────────────────────────────────────────────────────────────────
  const tagCloud = useMemo(() => {
    const counts = {};
    mediaItems.filter(m => m.tier !== 'TRASH').forEach(m => (m.tags || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 20);
  }, [mediaItems]);

  // ── Supabase Realtime ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    try {
      const channel = supabase
        .channel('vault_realtime')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'vault_media' }, payload => {
          setMediaItems(prev =>
            prev.some(m => m.id === payload.new.id) ? prev : [payload.new, ...prev]
          );
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'vault_media' }, payload => {
          setMediaItems(prev => prev.map(m => m.id === payload.new.id ? payload.new : m));
          setSelectedMedia(prev => prev && prev.id === payload.new.id ? { ...prev, ...payload.new } : prev);
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'vault_media' }, payload => {
          setMediaItems(prev => prev.filter(m => m.id !== payload.old.id));
          setSelectedMedia(prev => prev && prev.id === payload.old.id ? null : prev);
        })
        .subscribe();
      return () => { try { supabase.removeChannel(channel); } catch(e) {} };
    } catch(e) {
      console.error('Supabase realtime error:', e);
    }
  }, []);

  // ── Intersection Observer (infinite scroll) ──────────────────────────────────
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting && hasMore && !isLoading && isConnected) setPage(p => p + 1); },
      { threshold: 1.0 }
    );
    if (observerTarget.current) observer.observe(observerTarget.current);
    return () => observer.disconnect();
  }, [hasMore, isLoading, isConnected]);

  // ── Fetch media (paginated) ──────────────────────────────────────────────────
  useEffect(() => {
    async function fetchMedia() {
      if (!supabase) { setIsLoading(false); setHasMore(false); return; }
      setIsConnected(true);
      setFetchError(null); // FIX #8: clear any prior error before each attempt
      if (page === 0) setIsLoading(true);
      const from = page * 50, to = from + 49;
      const { data, error } = await supabase.from('vault_media').select('*').order('created_at', { ascending: false }).range(from, to);
      if (error) {
        // FIX #8: Surface DB errors in the UI instead of showing an empty grid
        console.error('[Fetch] Supabase error:', error.message);
        setFetchError(error.message);
      } else {
        if (page === 0) setMediaItems(data || []);
        else setMediaItems(prev => [...prev, ...(data || [])]);
        if (!data || data.length < 50) setHasMore(false);
      }
      setIsLoading(false);
    }
    fetchMedia();
  }, [page]);

  // ── Filtered media ───────────────────────────────────────────────────────────
  const filteredMedia = useMemo(() => mediaItems.filter(item => {
    const matchSearch = item.filename.toLowerCase().includes(search.toLowerCase()) ||
                        (item.display_name || '').toLowerCase().includes(search.toLowerCase()) ||
                        (item.tags || []).some(t => t.toLowerCase().includes(search.toLowerCase()));
    const matchType   = activeType === 'ALL' || item.type === activeType;
    let matchTier     = false;
    
    if (activeTier === 'ALL')          matchTier = item.tier !== 'TRASH';
    else if (activeTier === 'TRASH')   matchTier = item.tier === 'TRASH';
    else if (activeTier === 'ARCHIVE') matchTier = item.tier === 'ARCHIVE';
    else                               matchTier = item.tier === activeTier;

    const matchTag    = !activeTag  || (item.tags || []).includes(activeTag);
    return matchSearch && matchType && matchTier && matchTag;
  }), [search, activeType, activeTier, activeTag, mediaItems]);

  // ── Save metadata ────────────────────────────────────────────────────────────
  const handleSaveMeta = async () => {
    if (!selectedMedia) return;
    setIsSavingMeta(true);
    const tags = editTags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    try {
      const res = await fetch('http://localhost:3002/api/update-meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedMedia.id, display_name: editName || null, notes: editNotes || null, tags })
      });
      const result = await res.json();
      if (result.success) {
        setSelectedMedia(prev => ({ ...prev, display_name: editName || null, notes: editNotes || null, tags }));
        setMediaItems(prev => prev.map(m => m.id === selectedMedia.id ? { ...m, display_name: editName || null, notes: editNotes || null, tags } : m));
        setEditMode(false);
      } else alert('Save failed: ' + result.error);
    } catch(e) { alert('Error: ' + e.message); }
    setIsSavingMeta(false);
  };

  // ── Delete / Trash / Restore ─────────────────────────────────────────────────
  const handleSoftDelete = async () => {
    if (!selectedMedia || isProcessing) return;
    setIsProcessing(true);
    const idToDelete = selectedMedia.id;
    // Optimistically close modal
    setSelectedMedia(null); setEditMode(false); setVerifyStatus(null);
    try {
      const res = await fetch(`http://localhost:3002/api/delete/${idToDelete}`, { method: 'DELETE' });
      const result = await res.json();
      if (!result.success) alert('Move to Trash failed: ' + result.error);
    } catch(e) { alert('Error: ' + e.message); }
    setIsProcessing(false);
  };

  const handleHardDelete = async (id) => {
    if (isProcessing) return;
    if (!window.confirm('Are you sure you want to delete this file forever? This action cannot be undone.')) return;
    setIsProcessing(true);
    // Optimistically close modal if it's the current one
    if (selectedMedia && selectedMedia.id === id) { setSelectedMedia(null); setEditMode(false); setVerifyStatus(null); }
    try {
      const res = await fetch(`http://localhost:3002/api/hard-delete/${id}`, { method: 'DELETE' });
      const result = await res.json();
      if (!result.success) alert('Hard delete failed: ' + result.error);
    } catch(e) { alert('Error: ' + e.message); }
    setIsProcessing(false);
  };

  const handleRestore = async (id) => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      const res = await fetch(`http://localhost:3002/api/restore/${id}`, { method: 'POST' });
      const result = await res.json();
      if (!result.success) alert('Restore failed: ' + result.error);
    } catch(e) { alert('Error: ' + e.message); }
    setIsProcessing(false);
  };

  // ── Batch Actions ────────────────────────────────────────────────────────────
  const toggleSelection = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleCardClick = (item) => {
    if (isSelectionMode) toggleSelection(item.id);
    else setSelectedMedia(item);
  };

  const handleSelectAll = () => {
    if (selectedIds.size === filteredMedia.length) setSelectedIds(new Set()); // Deselect all
    else setSelectedIds(new Set(filteredMedia.map(m => m.id)));
  };

  const handleBatchAction = async (actionType) => {
    if (actionType === 'hard-delete' && !window.confirm(`Permanently delete ${selectedIds.size} items?`)) return;
    
    setBatchProgress({ current: 0, total: selectedIds.size, action: actionType });
    let count = 0;
    const ids = Array.from(selectedIds);
    
    for (const id of ids) {
      count++;
      setBatchProgress({ current: count, total: ids.length, action: actionType });
      try {
        if (actionType === 'delete') await fetch(`http://localhost:3002/api/delete/${id}`, { method: 'DELETE' });
        else if (actionType === 'restore') await fetch(`http://localhost:3002/api/restore/${id}`, { method: 'POST' });
        else if (actionType === 'hard-delete') await fetch(`http://localhost:3002/api/hard-delete/${id}`, { method: 'DELETE' });
      } catch (e) { console.error('Batch error on', id, e); }
    }
    
    setBatchProgress(null);
    setSelectedIds(new Set());
  };

  // ── Verify Links (FIX #7) ────────────────────────────────────────────────────
  const [verifyStatus, setVerifyStatus] = useState(null); // null | 'checking' | {telegram, discord}
  const handleVerify = async () => {
    if (!selectedMedia) return;
    setVerifyStatus('checking');
    try {
      const res = await fetch('http://localhost:3002/api/verify-links', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedMedia.id })
      });
      const result = await res.json();
      if (result.success) {
        setVerifyStatus(result.results);
        // Realtime will handle the tier update via supabase channel
      } else {
        setVerifyStatus({ error: result.error });
      }
    } catch(e) { setVerifyStatus({ error: e.message }); }
  };

  // ── Refresh Telegram URL (FIX #1) ────────────────────────────────────────────
  const [isRefreshing, setIsRefreshing] = useState(false);
  const handleRefreshUrl = async () => {
    if (!selectedMedia) return;
    setIsRefreshing(true);
    try {
      const res = await fetch('http://localhost:3002/api/refresh-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedMedia.id })
      });
      const result = await res.json();
      if (result.success) {
        setSelectedMedia(prev => ({ ...prev, telegram_url: result.url }));
        setMediaItems(prev => prev.map(m => m.id === selectedMedia.id ? { ...m, telegram_url: result.url } : m));
      } else alert('Refresh failed: ' + result.error);
    } catch(e) { alert('Error: ' + e.message); }
    setIsRefreshing(false);
  };

  // ── Upload handlers ──────────────────────────────────────────────────────────
  const handleUploadFiles = useCallback(async (files) => {
    const fileArray = Array.from(files);
    setUploadQueue(prev => [...prev, ...fileArray.map(f => ({ file: f, status: 'pending', error: null }))]);
    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      setUploadQueue(prev => prev.map(e => e.file === file ? { ...e, status: 'uploading' } : e));
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('tags', uploadTags);
        const res = await fetch('http://localhost:3002/api/upload', { method: 'POST', body: formData });

        // FIX #6: Guard against non-JSON error responses (e.g. 413, 500 HTML error pages)
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          const text = await res.text();
          throw new Error(`Server error (${res.status}): ${text.slice(0, 100)}`);
        }
        const result = await res.json();
        setUploadQueue(prev => prev.map(e => e.file === file ? { ...e, status: result.success ? 'done' : 'error', error: result.error || null } : e));
      } catch(e) {
        setUploadQueue(prev => prev.map(en => en.file === file ? { ...en, status: 'error', error: e.message } : en));
      }
    }
  }, [uploadTags]);

  const handleDrop      = useCallback((e) => { e.preventDefault(); setIsDragOver(false); if (e.dataTransfer.files.length) handleUploadFiles(e.dataTransfer.files); }, [handleUploadFiles]);
  const handleDragOver  = useCallback((e) => { e.preventDefault(); setIsDragOver(true); }, []);
  const handleDragLeave = useCallback(() => setIsDragOver(false), []);

  const openEdit = (item) => {
    setEditMode(true);
    setVerifyStatus(null); // FIX #7: Clear stale verify result when entering edit mode
    setEditName(item.display_name || '');
    setEditNotes(item.notes || '');
    setEditTags((item.tags || []).join(', '));
  };

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-vault-bg text-vault-text flex selection:bg-vault-accent/30 font-sans">

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside className="w-64 border-r border-vault-border bg-[#101014] p-6 hidden md:flex flex-col gap-6 h-screen sticky top-0 overflow-y-auto">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-vault-accent to-[#ec4899] flex items-center justify-center shadow-[0_0_20px_rgba(139,92,246,0.3)]">
            <Filter className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-2xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">VAULT</h1>
        </div>

        {/* Connection badge */}
        <div className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 border ${isConnected ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-amber-500/10 border-amber-500/20 text-amber-400'}`}>
          <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${isConnected ? 'bg-emerald-400' : 'bg-amber-400'}`} />
          {isConnected ? '⚡ Realtime: Active' : 'Offline / Mock'}
        </div>

        {/* Storage Tier */}
        <div>
          <h2 className="text-xs font-bold text-vault-text-muted uppercase tracking-widest mb-2">Storage Tier</h2>
          <div className="flex flex-col gap-1">
            {[
              { id: 'ALL',     label: 'Everything',          icon: <Hash className="w-4 h-4"/> },
              { id: 'ARCHIVE', label: 'Archive (Telegram)',   icon: <HardDrive className="w-4 h-4 text-[#0088cc]"/> },
              { id: 'EXPIRED', label: 'Expired Links',        icon: <AlertTriangle className="w-4 h-4 text-red-500"/> },
              { id: 'TRASH',   label: 'Recently Deleted',     icon: <Trash2 className="w-4 h-4 text-zinc-500"/> },
            ].map(t => (
              <button key={t.id} onClick={() => setActiveTier(t.id)}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTier === t.id ? 'bg-vault-surface text-white' : 'text-vault-text-muted hover:text-white hover:bg-vault-surface/50'}`}>
                {t.icon}{t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Categories */}
        <div>
          <h2 className="text-xs font-bold text-vault-text-muted uppercase tracking-widest mb-2">Categories</h2>
          <div className="flex flex-col gap-1">
            {[
              { id: 'ALL', label: 'All Files', Icon: Filter },
              { id: 'IMG', label: 'Images',    Icon: Image  },
              { id: 'VID', label: 'Videos',    Icon: Video  },
              { id: 'AUDIO',label:'Audio',     Icon: Music  },
              { id: 'DOC', label: 'Documents', Icon: FileText },
            ].map(({ id, label, Icon }) => (
              <button key={id} onClick={() => setActiveType(id)}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeType === id ? 'bg-vault-surface text-white' : 'text-vault-text-muted hover:text-white hover:bg-vault-surface/50'}`}>
                <Icon className="w-4 h-4 opacity-70" />{label}
              </button>
            ))}
          </div>
        </div>

        {/* Tag Cloud */}
        {tagCloud.length > 0 && (
          <div>
            <h2 className="text-xs font-bold text-vault-text-muted uppercase tracking-widest mb-2">Tag Cloud</h2>
            <div className="flex flex-wrap gap-1.5">
              {activeTag && (
                <button onClick={() => setActiveTag(null)}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-vault-accent text-white font-bold flex items-center gap-1">
                  <X className="w-2.5 h-2.5"/> Clear
                </button>
              )}
              {tagCloud.map(([tag, count]) => (
                <button key={tag} onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                  className={`text-[10px] px-2 py-0.5 rounded-full font-semibold transition-colors ${activeTag === tag ? 'bg-vault-accent text-white' : 'bg-vault-border text-vault-text-muted hover:bg-vault-accent/20 hover:text-white'}`}>
                  #{tag} <span className="opacity-60">{count}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* ── Main Content ─────────────────────────────────────────────────────── */}
      <main className="flex-1 p-6 lg:p-10 flex flex-col min-h-screen w-full relative"
        onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}>

        {/* Drag overlay */}
        {isDragOver && (
          <div className="absolute inset-0 z-40 bg-vault-accent/10 border-2 border-dashed border-vault-accent rounded-2xl flex flex-col items-center justify-center pointer-events-none">
            <UploadCloud className="w-20 h-20 text-vault-accent mb-4 animate-bounce" />
            <p className="text-vault-accent font-bold text-xl">Drop files to upload to Archive</p>
          </div>
        )}

        {/* Header */}
        <header className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center mb-6">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Your Media</h2>
            <p className="text-vault-text-muted text-sm mt-1">Manage your files in the Telegram Archive</p>
          </div>
          <div className="flex items-center gap-3 w-full md:w-auto">
            <div className="relative flex-1 md:w-72 group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-vault-text-muted group-focus-within:text-vault-accent transition-colors" />
              <input type="text" placeholder="Search by name or tag..." value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-vault-surface border border-vault-border rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:border-vault-accent/50 focus:ring-1 focus:ring-vault-accent/50 transition-all text-white placeholder:text-vault-text-muted" />
            </div>
            <button onClick={() => { setShowUpload(true); setUploadQueue([]); setUploadTags(''); }}
              className="flex items-center gap-2 px-4 py-2.5 bg-vault-accent hover:brightness-110 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-vault-accent/20 shrink-0">
              <Plus className="w-4 h-4" /> Upload
            </button>
          </div>
        </header>

        {/* ── Stats Bar ─────────────────────────────────────────────────────── */}
        {isConnected && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
            {[
              { label: 'Total Files',   value: stats.total,   color: 'text-white',         icon: <BarChart2 className="w-4 h-4"/> },
              { label: 'In Archive',    value: stats.archive, color: 'text-[#0088cc]',     icon: <HardDrive className="w-4 h-4"/> },
              { label: 'In Trash',      value: stats.trash,   color: 'text-zinc-400',      icon: <Trash2 className="w-4 h-4"/> },
            ].map(s => (
              <div key={s.label} className="bg-vault-surface border border-vault-border rounded-xl px-4 py-3 flex items-center gap-3">
                <span className={`${s.color} opacity-70`}>{s.icon}</span>
                <div>
                  <p className={`text-xl font-black ${s.color}`}>{s.value}</p>
                  <p className="text-[10px] text-vault-text-muted uppercase tracking-wider">{s.label}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Hidden file input */}
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={e => handleUploadFiles(e.target.files)} />

        {/* ── Upload Modal ───────────────────────────────────────────────────── */}
        {showUpload && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowUpload(false)} />
            <div className="relative bg-[#18181b] border border-[#27272a] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden z-10">
              <div className="flex items-center justify-between p-5 border-b border-[#27272a]">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-vault-accent/20 rounded-lg"><UploadCloud className="w-5 h-5 text-vault-accent" /></div>
                  <div>
                    <h3 className="font-bold text-lg leading-none">Upload to Vault</h3>
                    <p className="text-xs text-vault-text-muted mt-0.5">Files go to Telegram Archive permanently</p>
                  </div>
                </div>
                <button onClick={() => setShowUpload(false)} className="p-2 hover:bg-[#27272a] rounded-xl transition-colors text-vault-text-muted hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-5 flex flex-col gap-4">
                <div onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-[#27272a] hover:border-vault-accent/50 rounded-xl p-10 flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors text-vault-text-muted hover:text-white group">
                  <UploadCloud className="w-12 h-12 opacity-40 group-hover:opacity-80 group-hover:text-vault-accent transition-all" />
                  <p className="text-sm font-medium">Click to choose multiple files, or drag &amp; drop anywhere</p>
                  <p className="text-xs opacity-50">Images, Videos, Audio, Documents — up to 100 MB each</p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-vault-text-muted uppercase tracking-widest">Tags <span className="font-normal normal-case">(comma-separated, optional)</span></label>
                  <input type="text" placeholder="e.g. work, design, memes" value={uploadTags} onChange={e => setUploadTags(e.target.value)}
                    className="w-full bg-[#27272a] border border-[#3f3f46] rounded-lg px-3 py-2 text-sm outline-none focus:border-vault-accent/50 text-white placeholder:text-vault-text-muted" />
                </div>
                {uploadQueue.length > 0 && (
                  <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
                    {uploadQueue.map((entry, i) => (
                      <div key={i} className="flex items-center gap-3 bg-[#27272a] rounded-lg px-3 py-2 text-sm">
                        <div className="shrink-0">
                          {entry.status === 'done'      && <CheckCircle className="w-4 h-4 text-emerald-400" />}
                          {entry.status === 'uploading' && <RefreshCw   className="w-4 h-4 text-vault-accent animate-spin" />}
                          {entry.status === 'pending'   && <div className="w-4 h-4 rounded-full border border-[#52525b]" />}
                          {entry.status === 'error'     && <AlertTriangle className="w-4 h-4 text-red-400" />}
                        </div>
                        <span className="flex-1 truncate text-vault-text">{entry.file.name}</span>
                        <span className={`text-xs font-bold uppercase ${
                          entry.status === 'done' ? 'text-emerald-400'
                          : entry.status === 'error' ? 'text-red-400'
                          : entry.status === 'uploading' ? 'text-vault-accent'
                          : 'text-vault-text-muted'
                        }`}>{entry.status === 'error' ? (entry.error?.slice(0, 25) || 'Error') : entry.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Media Grid ────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-bold text-vault-text-muted uppercase tracking-widest">{filteredMedia.length} results{isSelectionMode && selectedIds.size > 0 && ` • ${selectedIds.size} selected`}</span>
          {filteredMedia.length > 0 && (
            <div className="flex items-center gap-2">
              <button onClick={() => setIsSelectionMode(!isSelectionMode)}
                className={`text-xs font-bold hover:text-white transition-colors uppercase px-3 py-1 rounded-lg ${isSelectionMode ? 'bg-vault-accent text-black' : 'text-vault-accent bg-vault-accent/10'}`}>
                {isSelectionMode ? 'Cancel Selection' : 'Select Multiple'}
              </button>
              {isSelectionMode && selectedIds.size > 0 && (
                <button onClick={handleSelectAll} className="text-xs font-bold hover:text-white transition-colors text-vault-accent uppercase px-3 py-1 bg-vault-accent/10 rounded-lg">
                  {selectedIds.size === filteredMedia.length ? 'Deselect All' : 'Select All'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Batch Action Bar ──────────────────────────────────────────────── */}
        {isSelectionMode && selectedIds.size > 0 && (
          <div className="mb-6 p-4 bg-vault-surface border border-vault-border rounded-xl flex items-center justify-between gap-4 flex-wrap">
            <span className="text-sm font-medium text-vault-text">{selectedIds.size} item{selectedIds.size > 1 ? 's' : ''} selected</span>
            <div className="flex items-center gap-2 flex-wrap">
              {activeTier === 'TRASH' ? (
                <>
                  <button onClick={() => handleBatchAction('restore')}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 rounded-lg text-sm font-bold transition-colors">
                    <RotateCcw className="w-4 h-4" /> Restore All
                  </button>
                  <button onClick={() => handleBatchAction('hard-delete')}
                    className="flex items-center gap-2 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-sm font-bold transition-colors">
                    <Trash2 className="w-4 h-4" /> Hard Delete All
                  </button>
                </>
              ) : (
                <button onClick={() => handleBatchAction('delete')}
                  className="flex items-center gap-2 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-sm font-bold transition-colors">
                  <Trash2 className="w-4 h-4" /> Move to Trash
                </button>
              )}
            </div>
          </div>
        )}

        {/* Batch Progress */}
        {batchProgress && (
          <div className="mb-4 p-4 bg-vault-surface border border-vault-accent/50 rounded-xl">
            <div className="flex items-center justify-between mb-2 text-sm">
              <span className="font-medium text-vault-text capitalize">{batchProgress.action.replace('-', ' ')}...</span>
              <span className="text-vault-accent">{batchProgress.current} / {batchProgress.total}</span>
            </div>
            <div className="w-full h-2 bg-vault-border rounded-full overflow-hidden">
              <div className="h-full bg-vault-accent transition-all duration-300" style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }} />
            </div>
          </div>
        )}
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 flex-1 content-start">
          {isLoading && page === 0 ? (
            <div className="col-span-full h-64 flex flex-col items-center justify-center text-vault-text-muted">
              <div className="w-8 h-8 border-2 border-vault-accent border-t-transparent rounded-full animate-spin mb-4" />
              <p>Loading your vault...</p>
            </div>
          // FIX #8: Show real error message instead of misleading empty vault state
          ) : fetchError ? (
            <div className="col-span-full h-64 flex flex-col items-center justify-center text-red-400 border border-dashed border-red-500/30 rounded-2xl">
              <AlertTriangle className="w-10 h-10 mb-3 opacity-60" />
              <p className="font-semibold text-sm">Failed to load vault</p>
              <p className="text-xs text-red-400/60 mt-1 max-w-xs text-center">{fetchError}</p>
              <button onClick={() => { setPage(0); setHasMore(true); setFetchError(null); }}
                className="mt-4 text-xs px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-lg transition-colors">
                Retry
              </button>
            </div>
          ) : filteredMedia.length > 0 ? (
            <>
              {filteredMedia.map(item => (
                <MediaCard 
                  key={item.id} 
                  item={item} 
                  onClick={setSelectedMedia} 
                  isSelected={selectedIds.has(item.id)}
                  isSelectMode={isSelectionMode}
                  onToggle={toggleSelection}
                />
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
              <p>{search || activeTag ? 'No files match this filter.' : 'Your vault is currently empty.'}</p>
              {activeTag && <button onClick={() => setActiveTag(null)} className="mt-2 text-xs text-vault-accent underline">Clear tag filter</button>}
            </div>
          )}
        </div>
      </main>

      {/* ── Preview / Edit Modal ─────────────────────────────────────────────── */}
      {selectedMedia && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => {
            setSelectedMedia(null);
            setEditMode(false);
            setVerifyStatus(null); // FIX #3: clear stale verify badges when closing via backdrop
          }} />
          <div className="relative bg-[#18181b] border border-[#27272a] rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">

            {/* Modal header */}
            <div className="flex items-center justify-between p-4 border-b border-[#27272a]">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="p-2 bg-[#27272a] rounded-lg text-vault-text-muted relative shrink-0">
                  <TypeIcon type={selectedMedia.type} />
                  <div className="absolute -bottom-1 -right-1 bg-[#18181b] rounded-full p-0.5 border border-[#27272a]">
                    <TierIcon tier={selectedMedia.tier} />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  {editMode
                    ? <input value={editName} onChange={e => setEditName(e.target.value)}
                        placeholder={selectedMedia.filename}
                        className="font-bold text-lg leading-none w-full bg-transparent border-b border-vault-accent/50 outline-none text-white pb-0.5" />
                    : <h3 className="font-bold text-lg leading-none truncate">{selectedMedia.display_name || selectedMedia.filename}</h3>
                  }
                  <div className="text-[10px] tracking-widest font-bold flex items-center gap-2 mt-1">
                    <span className="text-vault-accent">{selectedMedia.tier} TIER</span>
                    <span className="text-vault-text-muted">•</span>
                    <span className="text-vault-text-muted">{selectedMedia.size_bytes}</span>
                    <span className="text-vault-text-muted">•</span>
                    <span className="text-vault-text-muted">{selectedMedia.date_added}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {!editMode
                  ? <>
                      {selectedMedia.tier !== 'TRASH' && (
                        <button onClick={handleSoftDelete} disabled={isProcessing} className="p-2 hover:bg-red-500/20 rounded-xl transition-colors text-vault-text-muted hover:text-red-400 disabled:opacity-50" title="Move to Trash">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                      <button onClick={() => openEdit(selectedMedia)} className="p-2 hover:bg-[#27272a] rounded-xl transition-colors text-vault-text-muted hover:text-vault-accent" title="Edit metadata">
                        <Edit3 className="w-4 h-4" />
                      </button>
                    </>
                  : <button onClick={handleSaveMeta} disabled={isSavingMeta} className="p-2 hover:bg-emerald-500/20 rounded-xl transition-colors text-emerald-400 disabled:opacity-50">
                      {isSavingMeta ? <RefreshCw className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4"/>}
                    </button>
                }
                {editMode && <button onClick={() => setEditMode(false)} className="p-2 hover:bg-[#27272a] rounded-xl text-vault-text-muted hover:text-white"><X className="w-4 h-4"/></button>}
                <button onClick={() => { setSelectedMedia(null); setEditMode(false); }} className="p-2 hover:bg-[#27272a] rounded-xl transition-colors text-vault-text-muted hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Tier alert banners */}
            {selectedMedia.tier === 'TRASH' && (
              <div className="bg-red-500/10 border-y border-red-500/20 px-4 py-3 flex items-center justify-between">
                <p className="text-xs text-red-400 font-medium">
                  🗑️ This file is in the Trash. It will be permanently deleted 30 days after it was trashed.
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => handleRestore(selectedMedia.id)} disabled={isProcessing} className="text-xs px-3 py-1.5 bg-zinc-700/50 hover:bg-zinc-700 text-white font-bold rounded-lg transition-colors">
                    ♻️ Restore
                  </button>
                  <button onClick={() => handleHardDelete(selectedMedia.id)} disabled={isProcessing} className="text-xs px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white font-bold rounded-lg transition-colors">
                    💀 Hard Delete
                  </button>
                </div>
              </div>
            )}
            {selectedMedia.tier === 'ARCHIVE' && (
              <div className="bg-[#0088cc]/10 border-y border-[#0088cc]/20 px-4 py-2 flex items-center justify-between">
                <p className="text-xs text-[#0088cc] flex items-center gap-2"><CloudRain className="w-4 h-4" /> Stored in Telegram Archive</p>
              </div>
            )}

            {/* Preview area */}
            <div className="flex-1 overflow-auto bg-black/50 min-h-[250px] flex items-center justify-center relative w-full">
              {selectedMedia.type === 'IMG' && selectedMedia.telegram_url
                ? <ImageFallback item={selectedMedia} className="max-w-full max-h-[50vh] object-contain" />
                : selectedMedia.type === 'VID' && selectedMedia.telegram_url
                ? <video controls autoPlay src={selectedMedia.telegram_url} className="max-w-full max-h-[50vh] w-full outline-none bg-black" />
                : selectedMedia.type === 'AUDIO' && selectedMedia.telegram_url
                ? <div className="flex flex-col items-center justify-center w-full p-8">
                    <Music className="w-28 h-28 mb-6 text-vault-accent opacity-80" />
                    <audio controls autoPlay src={selectedMedia.telegram_url} className="w-full max-w-md" />
                  </div>
                : <div className="flex flex-col items-center justify-center text-vault-text-muted opacity-40">
                    <TypeIcon type={selectedMedia.type} className="w-20 h-20 mb-3" />
                    <p className="text-sm">Preview not available</p>
                  </div>
              }
            </div>

            {/* Footer — tags / notes / actions */}
            <div className="p-4 border-t border-[#27272a] bg-[#101014] flex flex-col gap-3">
              {/* Edit fields */}
              {editMode && (
                <div className="flex flex-col gap-2">
                  <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={2}
                    placeholder="Add notes about this file..."
                    className="w-full bg-[#27272a] border border-[#3f3f46] rounded-lg px-3 py-2 text-sm outline-none focus:border-vault-accent/50 text-white placeholder:text-vault-text-muted resize-none" />
                  <input value={editTags} onChange={e => setEditTags(e.target.value)} placeholder="comma-separated tags..."
                    className="w-full bg-[#27272a] border border-[#3f3f46] rounded-lg px-3 py-2 text-sm outline-none focus:border-vault-accent/50 text-white placeholder:text-vault-text-muted" />
                </div>
              )}

              {/* Notes display */}
              {!editMode && selectedMedia.notes && (
                <p className="text-xs text-vault-text-muted italic border-l-2 border-vault-accent/30 pl-3">{selectedMedia.notes}</p>
              )}

              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  {selectedMedia.tags?.map(tag => (
                    <span key={tag} className="text-xs px-2.5 py-1 rounded bg-[#27272a] text-vault-text-muted flex items-center gap-1 border border-transparent hover:border-vault-accent/30 hover:text-white cursor-pointer transition-colors"
                      onClick={() => { setActiveTag(tag); setSelectedMedia(null); setEditMode(false); setVerifyStatus(null); }}>
                      <Hash className="w-3 h-3" />{tag}
                    </span>
                  ))}
                </div>

                {/* Verify status pill */}
                {verifyStatus && verifyStatus !== 'checking' && !verifyStatus.error && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`px-2 py-0.5 rounded-full font-bold ${verifyStatus.telegram === 'ok' ? 'bg-emerald-500/20 text-emerald-400' : verifyStatus.telegram === 'none' ? 'bg-zinc-700 text-zinc-400' : 'bg-red-500/20 text-red-400'}`}>
                      TG: {verifyStatus.telegram}
                    </span>
                  </div>
                )}
                {verifyStatus?.error && <p className="text-xs text-red-400">{verifyStatus.error}</p>}

                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  {selectedMedia.tier === 'ARCHIVE' && (
                    <button onClick={handleRefreshUrl} disabled={isRefreshing}
                      title="Regenerate fresh Telegram URL from permanent file_id"
                      className="flex items-center gap-1.5 px-3 py-2 hover:bg-[#27272a] rounded-lg text-sm font-medium transition-colors text-vault-text-muted hover:text-[#0088cc] disabled:opacity-40">
                      {isRefreshing ? <RefreshCw className="w-4 h-4 animate-spin"/> : <RotateCcw className="w-4 h-4" />} Refresh URL
                    </button>
                  )}
                  <button onClick={handleVerify} disabled={verifyStatus === 'checking'}
                    title="Check if stored link is still reachable"
                    className="flex items-center gap-1.5 px-3 py-2 hover:bg-[#27272a] rounded-lg text-sm font-medium transition-colors text-vault-text-muted hover:text-emerald-400 disabled:opacity-40">
                    {verifyStatus === 'checking' ? <RefreshCw className="w-4 h-4 animate-spin"/> : <ShieldCheck className="w-4 h-4" />} Verify
                  </button>
                  <button onClick={() => navigator.clipboard.writeText(selectedMedia.telegram_url || '')}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-[#27272a] rounded-lg text-sm font-medium transition-colors">
                    <LinkIcon className="w-4 h-4" /> Copy
                  </button>
                  <a href={selectedMedia.telegram_url} target="_blank" rel="noreferrer"
                    className="flex items-center gap-2 px-4 py-2 bg-vault-accent hover:brightness-110 text-white rounded-lg text-sm font-medium shadow-lg shadow-vault-accent/20">
                    <Download className="w-4 h-4" /> Download
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
