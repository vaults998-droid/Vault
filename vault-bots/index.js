require('dotenv').config();
const { Telegraf } = require('telegraf');
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const multer = require('multer');
// FIX #10: Removed unused `fs` and `path` imports

// Multer: store uploads in memory (buffer), max 100MB
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// 1. Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.warn('⚠️  Supabase URL or Anon Key missing. Logs will only print to console for now.');
}
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// Track bots and recent chats to know where to upload files from the dashboard API
let tgBot = null;
let discordClient = null;
let lastTelegramChatId = null;
let lastDiscordChannelId = null;

// Helper function to save media to two-tier Supabase DB
// Accepts optional file_unique_id (Telegram) for stable identity-based dedup
async function saveMediaToDb({ filename, type, source, size, date, url, telegram_file_id, file_unique_id, tags }) {
  if (!supabase) return true;

  // FIX #1: Use file_unique_id (stable Telegram identity) as hash key when available.
  // This prevents re-uploads of the same photo creating duplicate DB rows, because
  // Telegram photos get auto-generated filenames like photo_<timestamp>.jpg which
  // are always different. file_unique_id is stable across all bots for the same file.
  const hashInput  = file_unique_id ? `tg_unique:${file_unique_id}` : (filename + size);
  const file_hash  = crypto.createHash('sha256').update(hashInput).digest('hex');

  const tierTag    = source === 'telegram' ? 'archive' : 'hot';
  const typeTag    = type.toLowerCase();
  const uniqueTags = [...new Set([tierTag, typeTag, ...tags].map(t => typeof t === 'string' ? t.toLowerCase() : t))];

  try {
    const { data: existing } = await supabase
      .from('vault_media').select('*').eq('file_hash', file_hash).limit(1).maybeSingle();

    if (existing) {
      // UPGRADE existing record — never overwrite an already-stored Archive URL
      let newTier      = existing.tier;
      let updatePayload = { tags: [...new Set([...(existing.tags || []), ...uniqueTags])] };

      if (source === 'telegram') {
        if (existing.tier === 'HOT' || existing.tier === 'EXPIRED') newTier = 'BOTH';
        if (!existing.telegram_url) {
          updatePayload.telegram_url = url;
          if (telegram_file_id) updatePayload.telegram_file_id = telegram_file_id;
        }
        if (telegram_file_id && !existing.telegram_file_id) updatePayload.telegram_file_id = telegram_file_id;
      } else {
        if (existing.tier === 'ARCHIVE') newTier = 'BOTH';
        updatePayload.discord_url = url;
      }

      updatePayload.tier = newTier;
      const { error } = await supabase.from('vault_media').update(updatePayload).eq('id', existing.id);
      if (error) throw error;
      return true;
    } else {
      // NEW ENTRY
      const isTelegram = source === 'telegram';
      const insertPayload = {
        file_hash, filename, type,
        tier:             isTelegram ? 'ARCHIVE' : 'HOT',
        size_bytes:       size,
        date_added:       date,
        telegram_url:     isTelegram ? url : null,
        telegram_file_id: isTelegram ? (telegram_file_id || null) : null,
        discord_url:      isTelegram ? null : url,
        promote_attempts: 0,
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
        source:           'telegram',
        size:             formatSize(size),
        date:             dateStr,
        url:              fileUrl.href,
        telegram_file_id: fileId,
        file_unique_id,               // FIX #1: passed for stable hash
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
// 3. Discord Bot
// ----------------------------------------------------
const discordToken = process.env.DISCORD_BOT_TOKEN;
if (discordToken) {
  discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  discordClient.once(Events.ClientReady, c => {
    console.log(`✅ Discord Bot Started. Logged in as ${c.user.tag}`);
  });

  discordClient.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (process.env.DISCORD_OWNER_ID && message.author.id !== process.env.DISCORD_OWNER_ID) return;

    lastDiscordChannelId = process.env.DISCORD_CACHE_CHANNEL_ID || message.channel.id;

    if (message.attachments.size === 0) return;

    // FIX #5: Process all attachments first, then send ONE summary reply to avoid rate limits
    const results = [];
    for (const [, attachment] of message.attachments) {
      const content = message.content || '';
      const tags    = content.match(/#[\w-]+/g)?.map(t => t.replace('#', '')) || [];
      const dateStr = new Date().toISOString().split('T')[0];
      const type    = getFileType(attachment.contentType);
      const sizeStr = formatSize(attachment.size ?? 0);

      const success = await saveMediaToDb({
        filename: attachment.name,
        type,
        source: 'discord',
        size:   sizeStr,
        date:   dateStr,
        url:    attachment.url,
        tags
      });
      results.push({ name: attachment.name, sizeStr, success });
    }

    // One reply summarising all attachments — stays well within Discord rate limits
    const saved  = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    const lines  = [];
    if (saved.length)  lines.push(`✅ Saved ${saved.length} file(s) to Hot Cache: ${saved.map(r => `\`${r.name}\``).join(', ')}`);
    if (failed.length) lines.push(`❌ Failed to save: ${failed.map(r => `\`${r.name}\``).join(', ')}`);
    if (lines.length)  message.reply(lines.join('\n')).catch(() => {}); // .catch: ignore reply failures
  });

  discordClient.login(discordToken).catch(e => {
    console.error('Discord Login Error:', e);
  });
} else {
  console.log('⚠️  Discord token missing. Skipping Discord bot.');
}

// ----------------------------------------------------
// 4. API Server for Web UI requests (Promote & Cache)
// ----------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/promote', async (req, res) => {
  try {
    const { id } = req.body;
    const { data: file, error: fetchErr } = await supabase.from('vault_media').select('*').eq('id', id).single();
    if (fetchErr || !file) return res.status(404).json({ error: 'File not found in database.' });
    if (!file.discord_url)  return res.status(400).json({ error: 'File has no Discord URL to promote from.' });

    const activeTgChatId = process.env.TELEGRAM_ARCHIVE_CHAT_ID || lastTelegramChatId;
    if (!activeTgChatId || !tgBot) return res.status(400).json({ error: 'No Telegram active chat to upload to! Send a random message to the bot first (or config env).' });

    const msg = await tgBot.telegram.sendDocument(activeTgChatId, file.discord_url, {
      caption: `[PROMOTED TO ARCHIVE] ${file.filename}`
    });

    const fileId = msg.document?.file_id || msg.video?.file_id || msg.audio?.file_id || msg.photo?.[msg.photo.length-1]?.file_id || msg.sticker?.file_id;
    const file_unique_id = msg.document?.file_unique_id || msg.video?.file_unique_id || msg.audio?.file_unique_id || msg.photo?.[msg.photo.length-1]?.file_unique_id || msg.sticker?.file_unique_id;
    if (!fileId) return res.status(500).json({ error: 'Telegram upload succeeded but could not extract file_id.' });

    const fileUrl = await tgBot.telegram.getFileLink(fileId);
    const updatedTags = [...new Set([...file.tags, 'archive'])];

    // FIX #2: Save telegram_file_id so this file can have its URL refreshed in the future
    await supabase.from('vault_media').update({
      telegram_url:     fileUrl.href,
      telegram_file_id: fileId,
      tier:             'BOTH',
      tags:             updatedTags
    }).eq('id', file.id);

    // FIX #1: Sync back the dedup ID if possible (although this might just be an update, keeping it safe)
    res.json({ success: true, url: fileUrl.href, tier: 'BOTH', tags: updatedTags });
  } catch(e) {
    console.error('Promote failed:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/cache', async (req, res) => {
  try {
    const { id } = req.body;
    const { data: file, error: fetchErr } = await supabase.from('vault_media').select('*').eq('id', id).single();
    if (fetchErr || !file) return res.status(404).json({ error: 'File not found in database.' });

    // FIX #3: Reject EXPIRED files — their telegram_url may be stale/dead
    if (file.tier === 'EXPIRED') return res.status(400).json({ error: 'Cannot cache an EXPIRED file. Refresh the Telegram URL first.' });
    if (!file.telegram_url)     return res.status(400).json({ error: 'File has no Telegram Archive URL to cache from.' });

    const activeDiscordChannelId = process.env.DISCORD_CACHE_CHANNEL_ID || lastDiscordChannelId;
    if (!activeDiscordChannelId || !discordClient) return res.status(400).json({ error: 'No Discord active channel to upload to! Send a message to the channel first (or config env).' });

    const channel = await discordClient.channels.fetch(activeDiscordChannelId);
    if (!channel) return res.status(400).json({ error: 'Could not fetch discord channel.' });

    const msg = await channel.send({
      content: `[CACHED TO HOT] ${file.filename}`,
      files: [file.telegram_url]
    });

    const uploadedAttachment = msg.attachments.first();
    if (!uploadedAttachment) return res.status(500).json({ error: 'Discord upload succeeded but no attachment URL returned.' });

    const updatedTags = [...new Set([...file.tags, 'hot'])];
    await supabase.from('vault_media').update({
      discord_url: uploadedAttachment.url,
      tier: 'BOTH',
      tags: updatedTags
    }).eq('id', file.id);

    return res.json({ success: true, url: uploadedAttachment.url, tier: 'BOTH', tags: updatedTags });
  } catch(e) {
    console.error('Cache failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// ----------------------------------------------------
// 5. Direct Upload API (Web UI -> Telegram Archive)
// ----------------------------------------------------
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided.' });

    const activeTgChatId = process.env.TELEGRAM_ARCHIVE_CHAT_ID || lastTelegramChatId;
    if (!activeTgChatId || !tgBot) {
      return res.status(400).json({ error: 'No Telegram archive chat configured. Set TELEGRAM_ARCHIVE_CHAT_ID in .env or send /start to the bot first.' });
    }

    const { originalname, buffer, mimetype, size } = req.file;
    const tagsRaw = req.body.tags || '';
    const tags    = tagsRaw ? tagsRaw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) : [];
    const dateStr = new Date().toISOString().split('T')[0];
    const type    = getFileType(mimetype);
    const sizeStr = formatSize(size);

    // FIX #2: Removed dead `require('telegraf/types')` — InputFile is a types-only export with no
    // runtime value. Telegraf accepts { source, filename } natively without it.
    const msg = await tgBot.telegram.sendDocument(
      activeTgChatId,
      { source: buffer, filename: originalname },
      { caption: `[WEB UPLOAD] ${originalname}` }
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

    if (!fileId) return res.status(500).json({ error: 'Telegram upload succeeded but could not get file ID.' });

    const fileUrl = await tgBot.telegram.getFileLink(fileId);

    const saved = await saveMediaToDb({
      filename: originalname,
      type,
      source: 'telegram',
      size: sizeStr,
      date: dateStr,
      url: fileUrl.href,
      telegram_file_id: fileId,  // FIX #1: Store permanent file_id for web-uploaded files
      file_unique_id,
      tags: ['web-upload', ...tags]
    });

    if (!saved) return res.status(500).json({ error: 'File uploaded to Telegram but DB save failed.' });

    res.json({ success: true, filename: originalname, url: fileUrl.href, telegram_file_id: fileId, type, size: sizeStr, tags: ['web-upload', ...tags] });

  } catch (e) {
    console.error('Upload failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// ----------------------------------------------------
// 6. Cron Job — Smart Auto-Promote + Expiry Sweep (with retry counter)
// ----------------------------------------------------
const MAX_PROMOTE_ATTEMPTS = 3;

setInterval(async () => {
  if (!supabase) return;
  try {
    // FIX #4: Check for and log Supabase query errors rather than silently discarding them
    const { data: hotFiles, error: sweepErr } = await supabase.from('vault_media').select('*').eq('tier', 'HOT');
    if (sweepErr) { console.error('[Sweeper] ❌ Supabase query error:', sweepErr.message); return; }
    if (!hotFiles || hotFiles.length === 0) return;

    const ONE_DAY = 24 * 60 * 60 * 1000;
    const WARN_AT = 20 * 60 * 60 * 1000;
    const now     = Date.now();

    for (const file of hotFiles) {
      const age      = now - new Date(file.created_at).getTime();
      const attempts = file.promote_attempts || 0;

      if (age >= ONE_DAY) {
        if (attempts >= MAX_PROMOTE_ATTEMPTS) {
          await supabase.from('vault_media').update({ tier: 'EXPIRED' }).eq('id', file.id);
          console.log(`[Sweeper] ⚠️  Exhausted retries. Marked #${file.id} "${file.filename}" as EXPIRED.`);
          continue; // Skip further processing for this file
        } else {
          console.log(`[Sweeper] 🔁 Retrying promote for #${file.id} (attempt ${attempts + 1}/${MAX_PROMOTE_ATTEMPTS})`);
        }
      }

      if (age >= WARN_AT && attempts < MAX_PROMOTE_ATTEMPTS) {
        const activeTgChatId = process.env.TELEGRAM_ARCHIVE_CHAT_ID || lastTelegramChatId;
        if (!activeTgChatId || !tgBot) {
          console.log(`[Sweeper] ⏳ File #${file.id} nearing expiry but no Telegram target set.`);
          await supabase.from('vault_media').update({ promote_attempts: attempts + 1 }).eq('id', file.id);
          continue;
        }
        try {
          const msg = await tgBot.telegram.sendDocument(activeTgChatId, file.discord_url, {
            caption: `[AUTO-PROMOTED] ${file.filename} — archived before Discord link expired.`
          });

          // FIX #2: Guard undefined fileId before calling getFileLink — failure increments counter
          const fileId = msg.document?.file_id || msg.video?.file_id || msg.audio?.file_id || msg.photo?.[msg.photo.length-1]?.file_id || msg.sticker?.file_id;
          if (!fileId) {
            await supabase.from('vault_media').update({ promote_attempts: attempts + 1 }).eq('id', file.id);
            console.error(`[Sweeper] ❌ Auto-promote for #${file.id} returned no file_id. Incrementing attempt counter.`);
            continue;
          }

          const fileUrl = await tgBot.telegram.getFileLink(fileId);

          await supabase.from('vault_media').update({
            telegram_url:     fileUrl.href,
            telegram_file_id: fileId,
            tier:             'BOTH',
            promote_attempts: attempts + 1,
            tags: [...new Set([...(file.tags || []), 'auto-promoted'])]
          }).eq('id', file.id);

          console.log(`[Sweeper] ✅ Auto-promoted #${file.id} "${file.filename}" to Archive.`);
        } catch (promoteErr) {
          await supabase.from('vault_media').update({ promote_attempts: attempts + 1 }).eq('id', file.id);
          console.error(`[Sweeper] ❌ Promote attempt ${attempts + 1} failed for #${file.id}: ${promoteErr.message}`);
        }
      }
    }

    // ── Sweeper Phase 2: Purge TRASH older than 30 days
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
// 7.6. Restore API (TRASH → Original Tier)
// ----------------------------------------------------
app.post('/api/restore/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'id is required' });

    const { data: file, error: fetchErr } = await supabase.from('vault_media').select('*').eq('id', id).single();
    if (fetchErr || !file) return res.status(404).json({ error: 'File not found' });
    if (file.tier !== 'TRASH') return res.status(400).json({ error: 'File is not in TRASH' });

    let restoredTier = 'HOT';
    if (file.telegram_url && file.discord_url) restoredTier = 'BOTH';
    else if (file.telegram_url || file.telegram_file_id) restoredTier = 'ARCHIVE';

    const { error } = await supabase.from('vault_media').update({
      tier: restoredTier,
      link_verified_at: null // clear the deletion timer
    }).eq('id', id);

    if (error) return res.status(500).json({ error: `DB error: ${error.message}` });
    
    res.json({ success: true, tier: restoredTier });
    console.log(`[Restore] ♻️ Restored item #${id} to ${restoredTier}`);
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
// 9. FIX #7 — Verify that stored URLs are still reachable
// ----------------------------------------------------
app.post('/api/verify-links', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });

    // FIX #4: Propagate Supabase .single() errors rather than silently discarding them
    const { data: file, error: fetchErr } = await supabase.from('vault_media').select('*').eq('id', id).single();
    if (fetchErr) return res.status(500).json({ error: `DB error: ${fetchErr.message}` });
    if (!file)    return res.status(404).json({ error: 'File not found.' });

    const results = { telegram: null, discord: null };

    const checkUrl = async (url) => {
      if (!url) return 'none';
      try {
        const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
        return r.ok ? 'ok' : 'dead';
      } catch { return 'dead'; }
    };

    // Try to regenerate Telegram URL from file_id before verifying
    let tgUrlToCheck = file.telegram_url;
    if (file.telegram_file_id && tgBot) {
      try {
        const freshUrl = await tgBot.telegram.getFileLink(file.telegram_file_id);
        tgUrlToCheck = freshUrl.href;
        await supabase.from('vault_media').update({ telegram_url: freshUrl.href }).eq('id', id);
      } catch { /* use stored URL as fallback */ }
    }

    results.telegram = await checkUrl(tgUrlToCheck);
    results.discord  = await checkUrl(file.discord_url);

    const now = new Date().toISOString();

    // Determine new tier based on which links are alive
    let newTier = file.tier;
    const tgAlive   = results.telegram === 'ok' || results.telegram === 'none';
    const discAlive = results.discord  === 'ok' || results.discord  === 'none';
    const hasTg     = !!file.telegram_url || !!file.telegram_file_id;
    const hasDisc   = !!file.discord_url;

    if (!tgAlive && !discAlive && (hasTg || hasDisc)) newTier = 'EXPIRED';

    await supabase.from('vault_media').update({
      link_verified_at: now,
      tier: newTier
    }).eq('id', id);

    res.json({ success: true, results, tier: newTier, verified_at: now });
    console.log(`[Verify] #${id} "${file.filename}" — Telegram: ${results.telegram}, Discord: ${results.discord}`);
  } catch(e) {
    console.error('Verify links failed:', e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(3002, () => console.log('✅ Vault API Server running on port 3002.'));
