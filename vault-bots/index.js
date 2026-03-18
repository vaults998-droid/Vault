require('dotenv').config();
const { Telegraf } = require('telegraf');
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const cors = require('cors');

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
async function saveMediaToDb({ filename, type, source, size, date, url, tags }) {
  if (!supabase) return true;

  // Auto-tagging logic based on tier
  const tierTag = source === 'telegram' ? 'archive' : 'hot';
  const typeTag = type.toLowerCase();
  const uniqueTags = [...new Set([tierTag, typeTag, ...tags].map(t => typeof t === 'string' ? t.toLowerCase() : t))];

  try {
    const { data: existing } = await supabase
      .from('vault_media')
      .select('*')
      .eq('filename', filename)
      .limit(1)
      .maybeSingle();

    if (existing) {
      // UPGRADE IT
      let newTier = existing.tier;
      let updatePayload = { tags: [...new Set([...(existing.tags || []), ...uniqueTags])] };
      
      if (source === 'telegram') {
        if (existing.tier === 'HOT') newTier = 'BOTH';
        updatePayload.telegram_url = url;
      } else {
        if (existing.tier === 'ARCHIVE') newTier = 'BOTH';
        updatePayload.discord_url = url;
      }
      
      updatePayload.tier = newTier;
      updatePayload.size_bytes = size; 
      updatePayload.date_added = date; 
      
      const { error: updateError } = await supabase
        .from('vault_media')
        .update(updatePayload)
        .eq('id', existing.id);

      if (updateError) throw updateError;
      return true;
    } else {
      // NEW ENTRY
      const isTelegram = source === 'telegram';
      const insertPayload = {
        filename,
        type,
        tier: isTelegram ? 'ARCHIVE' : 'HOT',
        size_bytes: size,
        date_added: date,
        telegram_url: isTelegram ? url : null,
        discord_url: isTelegram ? null : url,
        tags: uniqueTags
      };

      const { error: insertError } = await supabase
        .from('vault_media')
        .insert([insertPayload]);

      if (insertError) throw insertError;
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
    lastTelegramChatId = ctx.message.chat.id;
    ctx.reply('Welcome to the VAULT Bot! Send me any file, photo, video, or audio to save it to your dashboard. You can add tags in the caption.');
  });

  tgBot.on(['document', 'photo', 'video', 'audio', 'voice'], async (ctx) => {
    try {
      lastTelegramChatId = ctx.message.chat.id; // Record where the message came from
      let fileId, filename, mime, size;

      if (ctx.message.document) {
        fileId = ctx.message.document.file_id;
        filename = ctx.message.document.file_name || 'document';
        mime = ctx.message.document.mime_type;
        size = ctx.message.document.file_size;
      } else if (ctx.message.photo) {
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        fileId = photo.file_id;
        filename = `photo_${Date.now()}.jpg`;
        mime = 'image/jpeg';
        size = photo.file_size;
      } else if (ctx.message.video) {
        fileId = ctx.message.video.file_id;
        filename = ctx.message.video.file_name || `video_${Date.now()}.mp4`;
        mime = ctx.message.video.mime_type;
        size = ctx.message.video.file_size;
      } else if (ctx.message.audio) {
        fileId = ctx.message.audio.file_id;
        filename = ctx.message.audio.file_name || `audio_${Date.now()}.mp3`;
        mime = ctx.message.audio.mime_type;
        size = ctx.message.audio.file_size;
      } else if (ctx.message.voice) {
        fileId = ctx.message.voice.file_id;
        filename = `voice_${Date.now()}.ogg`;
        mime = ctx.message.voice.mime_type;
        size = ctx.message.voice.file_size;
      }

      const fileUrl = await ctx.telegram.getFileLink(fileId);
      const caption = ctx.message.caption || '';
      const tags = caption.match(/#[\w-]+/g)?.map(t => t.replace('#', '')) || [];
      const dateStr = new Date().toISOString().split('T')[0];
      const type = getFileType(mime);

      const success = await saveMediaToDb({
        filename,
        type,
        source: 'telegram',
        size: formatSize(size),
        date: dateStr,
        url: fileUrl.href,
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

    lastDiscordChannelId = message.channel.id;

    if (message.attachments.size > 0) {
      for (const [id, attachment] of message.attachments) {
        const content = message.content || '';
        const tags = content.match(/#[\w-]+/g)?.map(t => t.replace('#', '')) || [];
        const dateStr = new Date().toISOString().split('T')[0];
        const type = getFileType(attachment.contentType);
        const sizeStr = formatSize(attachment.size);

        const success = await saveMediaToDb({
          filename: attachment.name,
          type: type,
          source: 'discord',
          size: sizeStr,
          date: dateStr,
          url: attachment.url,
          tags
        });

        if (success) {
          message.reply(`✅ Saved to Hot Cache: \`${attachment.name}\` (${sizeStr})`);
        }
      }
    }
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
    const { data: file } = await supabase.from('vault_media').select('*').eq('id', id).single();
    
    if (!file || !file.discord_url) return res.status(400).json({ error: 'Valid HOT file not found.' });
    if (!lastTelegramChatId || !tgBot) return res.status(400).json({ error: 'No Telegram active chat to upload to! Send a random message to the bot first.' });
    
    // Telegram will download the Discord URL implicitly internally or we stream it
    const msg = await tgBot.telegram.sendDocument(lastTelegramChatId, file.discord_url, {
      caption: `[PROMOTED TO ARCHIVE] ${file.filename}`
    });
    
    const fileId = msg.document?.file_id || msg.video?.file_id || msg.audio?.file_id || msg.photo?.[msg.photo.length-1].file_id;
    const fileUrl = await tgBot.telegram.getFileLink(fileId);

    const updatedTags = [...new Set([...file.tags, 'archive'])];

    await supabase.from('vault_media').update({
      telegram_url: fileUrl.href,
      tier: 'BOTH',
      tags: updatedTags
    }).eq('id', file.id);

    res.json({ success: true, url: fileUrl.href, tier: 'BOTH', tags: updatedTags });
  } catch(e) {
    console.error('Promote failed:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/cache', async (req, res) => {
  try {
    const { id } = req.body;
    const { data: file } = await supabase.from('vault_media').select('*').eq('id', id).single();
    
    if (!file || !file.telegram_url) return res.status(400).json({ error: 'Valid ARCHIVE file not found.' });
    if (!lastDiscordChannelId || !discordClient) return res.status(400).json({ error: 'No Discord active channel to upload to! Send a message to the channel first.' });

    const channel = await discordClient.channels.fetch(lastDiscordChannelId);
    if (!channel) return res.status(400).json({ error: 'Could not fetch discord channel.' });

    const msg = await channel.send({
      content: `[CACHED TO HOT] ${file.filename}`,
      files: [file.telegram_url]
    });
    
    const uploadedAttachment = msg.attachments.first();
    
    if(uploadedAttachment) {
      const updatedTags = [...new Set([...file.tags, 'hot'])];
      
      await supabase.from('vault_media').update({
        discord_url: uploadedAttachment.url,
        tier: 'BOTH',
        tags: updatedTags
      }).eq('id', file.id);
      
      return res.json({ success: true, url: uploadedAttachment.url, tier: 'BOTH', tags: updatedTags });
    }
    res.status(500).json({ error: 'Failed to extract attachment URL' });
  } catch(e) {
    console.error('Cache failed:', e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(3002, () => console.log('✅ Vault API Server running on port 3002.'));
