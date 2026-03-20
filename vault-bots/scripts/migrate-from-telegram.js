require('dotenv').config();
const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

const telegrafToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_ARCHIVE_CHAT_ID;

if (!telegrafToken || !chatId) {
  console.error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_ARCHIVE_CHAT_ID');
  process.exit(1);
}

const tgBot = new Telegraf(telegrafToken);

async function callTelegramApi(method, params) {
  return tgBot.telegram.callApi(method, params);
}

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

async function rebuildDatabase() {
  console.log(`Scanning Telegram chat ${chatId} for files...`);

  try {
    const chatInfo = await callTelegramApi('getChat', { chat_id: chatId });
    console.log(`Connected to chat: ${chatInfo.title || chatInfo.first_name} (type: ${chatInfo.type})`);

    let messages = [];
    let offsetId = 0;
    let hasMore = true;
    const batchSize = 100;

    while (hasMore) {
      const result = await callTelegramApi('getChatHistory', { 
        chat_id: chatId, 
        limit: batchSize,
        offset_id: offsetId
      });
      
      if (result.messages && result.messages.length > 0) {
        messages.push(...result.messages);
        offsetId = result.messages[result.messages.length - 1].message_id;
        hasMore = result.messages.length === batchSize;
        console.log(`Fetched ${messages.length} messages so far...`);
      } else {
        hasMore = false;
      }
    }

    console.log(`Found ${messages.length} messages to scan`);

    let added = 0;
    let skipped = 0;
    let errors = 0;

    for (const msg of messages) {
      try {
        let fileId, file_unique_id, filename, mime, size, date;

        if (msg.document) {
          fileId = msg.document.file_id;
          file_unique_id = msg.document.file_unique_id;
          filename = msg.document.file_name || 'document';
          mime = msg.document.mime_type;
          size = msg.document.file_size ?? 0;
          date = new Date(msg.date * 1000).toISOString().split('T')[0];
        } else if (msg.photo && msg.photo.length > 0) {
          const photo = msg.photo[msg.photo.length - 1];
          fileId = photo.file_id;
          file_unique_id = photo.file_unique_id;
          filename = `photo_${msg.date}.jpg`;
          mime = 'image/jpeg';
          size = photo.file_size ?? 0;
          date = new Date(msg.date * 1000).toISOString().split('T')[0];
        } else if (msg.video) {
          fileId = msg.video.file_id;
          file_unique_id = msg.video.file_unique_id;
          filename = msg.video.file_name || `video_${msg.date}.mp4`;
          mime = msg.video.mime_type;
          size = msg.video.file_size ?? 0;
          date = new Date(msg.date * 1000).toISOString().split('T')[0];
        } else if (msg.audio) {
          fileId = msg.audio.file_id;
          file_unique_id = msg.audio.file_unique_id;
          filename = msg.audio.file_name || `audio_${msg.date}.mp3`;
          mime = msg.audio.mime_type;
          size = msg.audio.file_size ?? 0;
          date = new Date(msg.date * 1000).toISOString().split('T')[0];
        } else if (msg.voice) {
          fileId = msg.voice.file_id;
          file_unique_id = msg.voice.file_unique_id;
          filename = `voice_${msg.date}.ogg`;
          mime = 'audio/ogg';
          size = msg.voice.file_size ?? 0;
          date = new Date(msg.date * 1000).toISOString().split('T')[0];
        } else if (msg.sticker) {
          fileId = msg.sticker.file_id;
          file_unique_id = msg.sticker.file_unique_id;
          filename = `sticker_${msg.date}.webp`;
          mime = 'image/webp';
          size = msg.sticker.file_size ?? 0;
          date = new Date(msg.date * 1000).toISOString().split('T')[0];
        } else {
          continue;
        }

        if (!file_unique_id) {
          console.log(`Skipping ${filename} - no file_unique_id`);
          skipped++;
          continue;
        }

        const fileUrl = await tgBot.telegram.getFileLink(fileId);
        const hashInput = `tg_unique:${file_unique_id}`;
        const file_hash = crypto.createHash('sha256').update(hashInput).digest('hex');

        const { data: existing } = await supabase
          .from('vault_media')
          .select('id')
          .eq('file_hash', file_hash)
          .maybeSingle();

        if (existing) {
          skipped++;
          continue;
        }

        const caption = msg.caption || '';
        const tags = caption.match(/#[\w-]+/g)?.map(t => t.replace('#', '').toLowerCase()) || [];
        const type = getFileType(mime);
        const sizeStr = formatSize(size);

        const { error } = await supabase.from('vault_media').insert([{
          file_hash,
          filename,
          type,
          tier: 'ARCHIVE',
          size_bytes: sizeStr,
          date_added: date,
          telegram_url: fileUrl.href,
          telegram_file_id: fileId,
          tags
        }]);

        if (error) {
          console.error(`Error inserting ${filename}:`, error.message);
          errors++;
        } else {
          added++;
          if (added % 50 === 0) {
            console.log(`Added ${added} files so far...`);
          }
        }

      } catch (e) {
        console.error(`Error processing message:`, e.message);
        errors++;
      }
    }

    console.log('\n=== Migration Complete ===');
    console.log(`Added: ${added}`);
    console.log(`Skipped (duplicate): ${skipped}`);
    console.log(`Errors: ${errors}`);

  } catch (e) {
    console.error('Migration failed:', e);
  }

  process.exit(0);
}

rebuildDatabase();
