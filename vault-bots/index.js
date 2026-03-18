require('dotenv').config();
const { Telegraf } = require('telegraf');
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

// 1. Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.warn('⚠️  Supabase URL or Anon Key missing. Logs will only print to console for now.');
}
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// Helper function to save media to Supabase DB
async function saveMediaToDb({ filename, type, source, size, date, url, tags }) {
  if (!supabase) {
    console.log(`[MOCK SAVED] [${source}] ${filename} (${size} bytes)`);
    return true;
  }

  const { data, error } = await supabase
    .from('vault_media')
    .insert([{ filename, type, source, size_bytes: size, date_added: date, url, tags }]);

  if (error) {
    console.error('Error inserting into DB:', error);
    return false;
  }
  return true;
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
  const tgBot = new Telegraf(telegrafToken);

  tgBot.start((ctx) => ctx.reply('Welcome to the VAULT Bot! Send me any file, photo, video, or audio to save it to your dashboard. You can add tags in the caption.'));

  // Handler for all documents, photos, audio, videos
  tgBot.on(['document', 'photo', 'video', 'audio', 'voice'], async (ctx) => {
    try {
      let fileId, filename, mime, size;

      if (ctx.message.document) {
        fileId = ctx.message.document.file_id;
        filename = ctx.message.document.file_name || 'document';
        mime = ctx.message.document.mime_type;
        size = ctx.message.document.file_size;
      } else if (ctx.message.photo) {
        const photo = ctx.message.photo[ctx.message.photo.length - 1]; // highest resolution
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

      // Get Telegram file path to construct URL (note: TG URLs have limited lifespan or need bot download)
      const fileUrl = await ctx.telegram.getFileLink(fileId);

      // Parse tags from caption
      const caption = ctx.message.caption || '';
      const tags = caption.match(/#[\w-]+/g)?.map(t => t.replace('#', '')) || ['telegram'];

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
        ctx.reply(`✅ File saved to VAULT: ${filename}\nTags: ${tags.join(', ')}`);
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

  // Enable graceful stop
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
  const discordClient = new Client({
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
    // Ignore bots
    if (message.author.bot) return;

    if (message.attachments.size > 0) {
      for (const [id, attachment] of message.attachments) {

        // Parse tags from the message content
        const content = message.content || '';
        const tags = content.match(/#[\w-]+/g)?.map(t => t.replace('#', '')) || ['discord'];

        const dateStr = new Date().toISOString().split('T')[0];
        const type = getFileType(attachment.contentType);
        const sizeStr = formatSize(attachment.size);

        const success = await saveMediaToDb({
          filename: attachment.name,
          type: type,
          source: 'discord',
          size: sizeStr,
          date: dateStr,
          url: attachment.url, // Discord attachment URLs
          tags
        });

        if (success) {
          message.reply(`✅ Saved to VAULT: \`${attachment.name}\` (${sizeStr})`);
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

