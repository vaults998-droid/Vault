require('dotenv').config();
const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const multer = require('multer');

// Multer: store uploads in memory (buffer), max 100MB
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// 1. Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.warn('⚠️  Supabase URL or Anon Key missing. Logs will only print to console for now.');
}
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// Track Telegram bot and recent chat
let tgBot = null;
let lastTelegramChatId = null;

// Helper function to save media to Supabase DB
async function saveMediaToDb({ filename, type, size, date, url, telegram_file_id, file_unique_id, tags }) {
  if (!supabase) return true;

  const hashInput  = file_unique_id ? `tg_unique:${file_unique_id}` : (filename + size);
  const file_hash  = crypto.createHash('sha256').update(hashInput).digest('hex');

  const typeTag    = type.toLowerCase();
  const uniqueTags = [...new Set([typeTag, ...tags].map(t => typeof t === 'string' ? t.toLowerCase() : t))];

  try {
    const { data: existing } = await supabase
      .from('vault_media').select('*').eq('file_hash', file_hash).limit(1).maybeSingle();

    if (existing) {
      let updatePayload = { tags: [...new Set([...(existing.tags || []), ...uniqueTags])] };

      if (!existing.telegram_url) {
        updatePayload.telegram_url = url;
      }
      if (telegram_file_id && !existing.telegram_file_id) {
        updatePayload.telegram_file_id = telegram_file_id;
      }

      const { error } = await supabase.from('vault_media').update(updatePayload).eq('id', existing.id);
      if (error) throw error;
      return true;
    } else {
      const insertPayload = {
        file_hash, filename, type,
        tier:             'ARCHIVE',
        size_bytes:       size,
        date_added:       date,
        telegram_url:     url,
        telegram_file_id: telegram_file_id || null,
        tags:             uniqueTags
      };
      const { error } = await supabase.from('vault_media').insert([insertPayload]);
      if (error) throw error;
      return true;
    }
  } catch (err) {
    console.error('Error inserting/updating DB:', err);
    return false;
  }
}

// Map MIME types to Vault Types
function getFileType(mime) {
  if (!mime) return 'DOC';
  if (mime.startsWith('image/')) return 'IMG';
  if (mime.startsWith('video/')) return 'VID';
  if (mime.startsWith('audio/')) return 'AUDIO';
  return 'DOC';
}

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ----------------------------------------------------
// 2. Telegram Bot
// ----------------------------------------------------
const telegrafToken = process.env.TELEGRAM_BOT_TOKEN;
if (telegrafToken) {
  tgBot = new Telegraf(telegrafToken);

  tgBot.start((ctx) => {
    lastTelegramChatId = process.env.TELEGRAM_ARCHIVE_CHAT_ID || ctx.message.chat.id;
    ctx.reply('Welcome to the VAULT Bot! Send me any file, photo, video, or audio to save it to your dashboard. You can add tags in the caption.');
  });

  tgBot.on(['document', 'photo', 'video', 'audio', 'voice', 'sticker'], async (ctx) => {
    if (process.env.TELEGRAM_OWNER_ID && ctx.from.id.toString() !== process.env.TELEGRAM_OWNER_ID) return;

    try {
      lastTelegramChatId = process.env.TELEGRAM_ARCHIVE_CHAT_ID || ctx.message.chat.id; // Record where the message came from
      let fileId, file_unique_id, filename, mime, size;

      if (ctx.message.document) {
        fileId      = ctx.message.document.file_id;
        file_unique_id = ctx.message.document.file_unique_id; // FIX #1
        filename    = ctx.message.document.file_name || 'document';
        mime        = ctx.message.document.mime_type;
        size        = ctx.message.document.file_size ?? 0;
      } else if (ctx.message.photo) {
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        fileId      = photo.file_id;
        file_unique_id = photo.file_unique_id;               // FIX #1: stable identity for dedup
        filename    = `photo_${Date.now()}.jpg`;              // still human-readable
        mime        = 'image/jpeg';
        size        = photo.file_size ?? 0;
      } else if (ctx.message.video) {
        fileId      = ctx.message.video.file_id;
        file_unique_id = ctx.message.video.file_unique_id;   // FIX #1
        filename    = ctx.message.video.file_name || `video_${Date.now()}.mp4`;
        mime        = ctx.message.video.mime_type;
        size        = ctx.message.video.file_size ?? 0;
      } else if (ctx.message.audio) {
        fileId      = ctx.message.audio.file_id;
        file_unique_id = ctx.message.audio.file_unique_id;   // FIX #1
        filename    = ctx.message.audio.file_name || `audio_${Date.now()}.mp3`;
        mime        = ctx.message.audio.mime_type;
        size        = ctx.message.audio.file_size ?? 0;
      } else if (ctx.message.voice) {
        fileId      = ctx.message.voice.file_id;
        file_unique_id = ctx.message.voice.file_unique_id;   // FIX #1
        filename    = `voice_${Date.now()}.ogg`;
        mime        = ctx.message.voice.mime_type;
        size        = ctx.message.voice.file_size ?? 0;
      } else if (ctx.message.sticker) {
        // FIX: handle webp/webm stickers
        fileId      = ctx.message.sticker.file_id;
        file_unique_id = ctx.message.sticker.file_unique_id;
        filename    = `sticker_${Date.now()}.webp`;
        mime        = 'image/webp';
        size        = ctx.message.sticker.file_size ?? 0;
      }

      const fileUrl = await ctx.telegram.getFileLink(fileId);
      const caption = ctx.message.caption || '';
      const tags    = caption.match(/#[\w-]+/g)?.map(t => t.replace('#', '')) || [];
      const dateStr = new Date().toISOString().split('T')[0];
      const type    = getFileType(mime);

      const success = await saveMediaToDb({
        filename,
        type,
        size:             formatSize(size),
        date:             dateStr,
        url:              fileUrl.href,
        telegram_file_id: fileId,
        file_unique_id,
        tags
      });

      if (success) {
        ctx.reply(`✅ File saved to Archive: ${filename}`);
      } else {
        ctx.reply(`❌ Failed to save file to DB.`);
      }

    } catch (e) {
      console.error('Telegram Error:', e);
      ctx.reply('❌ An error occurred processing your file.');
    }
  });

  tgBot.launch();
  console.log('✅ Telegram Bot Started');
  
  process.once('SIGINT', () => tgBot.stop('SIGINT'));
  process.once('SIGTERM', () => tgBot.stop('SIGTERM'));
} else {
  console.log('⚠️  Telegram token missing. Skipping Telegram bot.');
}

// ----------------------------------------------------
// 3. API Server for Web UI requests
// ----------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());

// ----------------------------------------------------
// 4. Direct Upload API (Web UI -> Telegram Archive) - Parallel
// ----------------------------------------------------
const CONCURRENCY_LIMIT = 3;

async function uploadToTelegram(buffer, filename, mimetype, tags) {
  const activeTgChatId = process.env.TELEGRAM_ARCHIVE_CHAT_ID || lastTelegramChatId;
  if (!activeTgChatId || !tgBot) {
    throw new Error('No Telegram archive chat configured.');
  }

  const sizeStr = formatSize(buffer.length);
  const dateStr = new Date().toISOString().split('T')[0];
  const type = getFileType(mimetype);

  const msg = await tgBot.telegram.sendDocument(
    activeTgChatId,
    { source: buffer, filename },
    { caption: `[WEB UPLOAD] ${filename}` }
  );

  const fileId = msg.document?.file_id
              || msg.video?.file_id
              || msg.audio?.file_id
              || msg.photo?.[msg.photo.length - 1]?.file_id
              || msg.sticker?.file_id;

  const file_unique_id = msg.document?.file_unique_id
              || msg.video?.file_unique_id
              || msg.audio?.file_unique_id
              || msg.photo?.[msg.photo.length - 1]?.file_unique_id
              || msg.sticker?.file_unique_id;

  if (!fileId) throw new Error('Telegram upload succeeded but could not get file ID.');

  const fileUrl = await tgBot.telegram.getFileLink(fileId);

  const saved = await saveMediaToDb({
    filename,
    type,
    size: sizeStr,
    date: dateStr,
    url: fileUrl.href,
    telegram_file_id: fileId,
    file_unique_id,
    tags: ['web-upload', ...tags]
  });

  if (!saved) throw new Error('File uploaded to Telegram but DB save failed.');

  return { success: true, filename, url: fileUrl.href, telegram_file_id: fileId, type, size: sizeStr, tags: ['web-upload', ...tags] };
}

async function processWithConcurrency(items, processor, limit) {
  const results = [];
  const executing = [];

  for (const item of items) {
    const promise = processor(item).then(result => {
      results.push(result);
    });
    executing.push(promise);

    if (executing.length >= limit) {
      await Promise.race(executing);
      const completed = executing.filter(p => p !== promise);
      executing.length = 0;
      executing.push(...completed.filter(p => !p.then));
    }
  }

  await Promise.allSettled(executing);
  return results;
}

app.post('/api/upload', upload.array('files', 50), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files provided.' });
    }

    const tagsRaw = req.body.tags || '';
    const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) : [];

    const results = await Promise.allSettled(
      req.files.map(file => uploadToTelegram(file.buffer, file.originalname, file.mimetype, tags))
    );

    const successful = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    const failed = results.filter(r => r.status === 'rejected').map(r => r.reason.message);

    res.json({
      success: true,
      completed: successful.length,
      failed: failed.length,
      results: successful,
      errors: failed
    });

  } catch (e) {
    console.error('Upload failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// ----------------------------------------------------
// 6. Cron Job — Verify Telegram URLs and Purge Trash
// ----------------------------------------------------
setInterval(async () => {
  if (!supabase) return;
  try {
    // Phase 1: Verify EXPIRED files and try to refresh Telegram URLs
    const { data: expiredFiles, error: err } = await supabase.from('vault_media').select('*').eq('tier', 'EXPIRED');
    if (err) { console.error('[Sweeper] ❌ Supabase query error:', err.message); return; }

    if (expiredFiles && expiredFiles.length > 0 && tgBot) {
      for (const file of expiredFiles) {
        if (!file.telegram_file_id) continue;
        try {
          const freshUrl = await tgBot.telegram.getFileLink(file.telegram_file_id);
          await supabase.from('vault_media').update({ 
            telegram_url: freshUrl.href,
            tier: 'ARCHIVE'
          }).eq('id', file.id);
          console.log(`[Sweeper] ✅ Refreshed URL for #${file.id} "${file.filename}" — back to ARCHIVE`);
        } catch (refreshErr) {
          console.error(`[Sweeper] ❌ Failed to refresh #${file.id}: ${refreshErr.message}`);
        }
      }
    }

    // ── Phase 2: Purge TRASH older than 30 days
    const { data: trashFiles } = await supabase.from('vault_media').select('id, link_verified_at, filename').eq('tier', 'TRASH');
    if (trashFiles && trashFiles.length > 0) {
      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
      for (const file of trashFiles) {
        if (!file.link_verified_at) continue; // safety fallback
        const age = now - new Date(file.link_verified_at).getTime();
        if (age >= THIRTY_DAYS) {
          await supabase.from('vault_media').delete().eq('id', file.id);
          console.log(`[Sweeper] 💀 Hard-deleted #${file.id} "${file.filename}" (in TRASH > 30 days).`);
        }
      }
    }

  } catch(e) { console.error('Cron job error:', e); }
}, 3600000); // Runs every hour

// ----------------------------------------------------
// 7. Metadata Update API (rename + notes from UI)
// ----------------------------------------------------
app.post('/api/update-meta', async (req, res) => {
  try {
    const { id, display_name, notes, tags } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });

    const payload = {};
    if (display_name !== undefined) payload.display_name = display_name;
    if (notes !== undefined) payload.notes = notes;
    if (tags !== undefined) payload.tags = tags;

    const { data, error } = await supabase.from('vault_media').update(payload).eq('id', id).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch(e) {
    console.error('Meta update failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// ----------------------------------------------------
// 7.5. Delete API (Soft Delete → TRASH)
// ----------------------------------------------------
app.delete('/api/delete/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'id is required' });

    // Soft delete: set tier to TRASH and save timestamp in link_verified_at
    const { error } = await supabase.from('vault_media').update({
      tier: 'TRASH',
      link_verified_at: new Date().toISOString()
    }).eq('id', id);

    if (error) return res.status(500).json({ error: `DB error: ${error.message}` });
    
    res.json({ success: true });
    console.log(`[Delete] 🗑️ Moved item #${id} to TRASH`);
  } catch(e) {
    console.error('Delete failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// ----------------------------------------------------
// 7.6. Restore API (TRASH → ARCHIVE)
// ----------------------------------------------------
app.post('/api/restore/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'id is required' });

    const { data: file, error: fetchErr } = await supabase.from('vault_media').select('*').eq('id', id).single();
    if (fetchErr || !file) return res.status(404).json({ error: 'File not found' });
    if (file.tier !== 'TRASH') return res.status(400).json({ error: 'File is not in TRASH' });

    const { error } = await supabase.from('vault_media').update({
      tier: 'ARCHIVE',
      link_verified_at: null // clear the deletion timer
    }).eq('id', id);

    if (error) return res.status(500).json({ error: `DB error: ${error.message}` });
    
    res.json({ success: true, tier: 'ARCHIVE' });
    console.log(`[Restore] ♻️ Restored item #${id} to ARCHIVE`);
  } catch(e) {
    console.error('Restore failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// ----------------------------------------------------
// 7.7. Hard Delete API (Drop Row)
// ----------------------------------------------------
app.delete('/api/hard-delete/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'id is required' });

    const { error } = await supabase.from('vault_media').delete().eq('id', id);
    if (error) return res.status(500).json({ error: `DB error: ${error.message}` });
    
    res.json({ success: true });
    console.log(`[Delete] 💀 Hard-deleted item #${id} from database forever`);
  } catch(e) {
    console.error('Hard Delete failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// ----------------------------------------------------
// 8. FIX #1 — Refresh Telegram URL from stored file_id
// ----------------------------------------------------
app.post('/api/refresh-url', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });

    // FIX #4: Propagate Supabase .single() errors rather than silently discarding them
    const { data: file, error: fetchErr } = await supabase.from('vault_media').select('*').eq('id', id).single();
    if (fetchErr) return res.status(500).json({ error: `DB error: ${fetchErr.message}` });
    if (!file)    return res.status(404).json({ error: 'File not found.' });

    if (!file.telegram_file_id || !tgBot) {
      return res.status(400).json({ error: 'No permanent Telegram file_id stored. Cannot refresh.' });
    }

    const freshUrl = await tgBot.telegram.getFileLink(file.telegram_file_id);
    await supabase.from('vault_media').update({ telegram_url: freshUrl.href }).eq('id', id);

    res.json({ success: true, url: freshUrl.href });
    console.log(`[Refresh] 🔗 Regenerated URL for #${id} "${file.filename}"`);
  } catch(e) {
    console.error('URL refresh failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// ----------------------------------------------------
// 9. Verify that stored Telegram URL is still reachable
// ----------------------------------------------------
app.post('/api/verify-links', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });

    const { data: file, error: fetchErr } = await supabase.from('vault_media').select('*').eq('id', id).single();
    if (fetchErr) return res.status(500).json({ error: `DB error: ${fetchErr.message}` });
    if (!file)    return res.status(404).json({ error: 'File not found.' });

    const checkUrl = async (url) => {
      if (!url) return 'none';
      try {
        const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
        return r.ok ? 'ok' : 'dead';
      } catch { return 'dead'; }
    };

    let tgUrlToCheck = file.telegram_url;
    let telegramResult = 'none';

    if (file.telegram_file_id && tgBot) {
      try {
        const freshUrl = await tgBot.telegram.getFileLink(file.telegram_file_id);
        tgUrlToCheck = freshUrl.href;
        await supabase.from('vault_media').update({ telegram_url: freshUrl.href }).eq('id', id);
      } catch { /* use stored URL as fallback */ }
    }

    telegramResult = await checkUrl(tgUrlToCheck);
    const now = new Date().toISOString();

    let newTier = file.tier;
    if (telegramResult === 'dead' && (file.telegram_url || file.telegram_file_id)) {
      newTier = 'EXPIRED';
    } else if (telegramResult === 'ok') {
      newTier = 'ARCHIVE';
    }

    await supabase.from('vault_media').update({
      link_verified_at: now,
      tier: newTier
    }).eq('id', id);

    res.json({ success: true, results: { telegram: telegramResult }, tier: newTier, verified_at: now });
    console.log(`[Verify] #${id} "${file.filename}" — Telegram: ${telegramResult}`);
  } catch(e) {
    console.error('Verify links failed:', e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(3002, () => console.log('✅ Vault API Server running on port 3002.'));

// ----------------------------------------------------
// Album APIs
// ----------------------------------------------------

// Get all albums
app.get('/api/albums', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('vault_albums')
      .select('*, vault_media!vault_albums_cover_media_id_fkey(filename, telegram_url, type)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, albums: data });
  } catch(e) {
    console.error('Get albums failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// Create album
app.post('/api/albums', async (req, res) => {
  try {
    const { name, description, cover_media_id } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const { data, error } = await supabase
      .from('vault_albums')
      .insert([{ name, description, cover_media_id }])
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, album: data });
  } catch(e) {
    console.error('Create album failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// Update album
app.put('/api/albums/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { name, description, cover_media_id } = req.body;
    const payload = {};
    if (name !== undefined) payload.name = name;
    if (description !== undefined) payload.description = description;
    if (cover_media_id !== undefined) payload.cover_media_id = cover_media_id;

    const { data, error } = await supabase
      .from('vault_albums')
      .update(payload)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, album: data });
  } catch(e) {
    console.error('Update album failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// Delete album
app.delete('/api/albums/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { error } = await supabase.from('vault_albums').delete().eq('id', id);
    if (error) throw error;
    res.json({ success: true });
  } catch(e) {
    console.error('Delete album failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// Get media in album
app.get('/api/albums/:id/media', async (req, res) => {
  try {
    const id = req.params.id;
    const { data, error } = await supabase
      .from('vault_album_media')
      .select('*, vault_media(*)')
      .eq('album_id', id)
      .order('position', { ascending: true });
    if (error) throw error;
    res.json({ success: true, media: data.map(m => m.vault_media) });
  } catch(e) {
    console.error('Get album media failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// Add media to album
app.post('/api/albums/:id/media', async (req, res) => {
  try {
    const albumId = req.params.id;
    const { media_ids } = req.body;
    if (!media_ids || !Array.isArray(media_ids)) {
      return res.status(400).json({ error: 'media_ids array is required' });
    }

    // Get current max position
    const { data: existing } = await supabase
      .from('vault_album_media')
      .select('position')
      .eq('album_id', albumId)
      .order('position', { ascending: false })
      .limit(1);
    let pos = existing?.length ? existing[0].position + 1 : 0;

    const inserts = media_ids.map(mediaId => ({
      album_id: albumId,
      media_id: mediaId,
      position: pos++
    }));

    const { error } = await supabase.from('vault_album_media').insert(inserts);
    if (error) throw error;
    res.json({ success: true });
  } catch(e) {
    console.error('Add media to album failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// Remove media from album
app.delete('/api/albums/:albumId/media/:mediaId', async (req, res) => {
  try {
    const { albumId, mediaId } = req.params;
    const { error } = await supabase
      .from('vault_album_media')
      .delete()
      .eq('album_id', albumId)
      .eq('media_id', mediaId);
    if (error) throw error;
    res.json({ success: true });
  } catch(e) {
    console.error('Remove media from album failed:', e);
    res.status(500).json({ error: e.message });
  }
});
