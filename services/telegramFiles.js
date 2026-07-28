const https = require('https');
const http = require('http');

function getBotToken(bot) {
  return bot.token || process.env.TELEGRAM_TOKEN || process.env.BOT_TOKEN;
}

function downloadUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to download file: ${res.statusCode}`));
          res.resume();
          return;
        }

        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject);
  });
}

async function downloadTelegramFile(bot, fileId) {
  const file = await bot.getFile(fileId);
  const token = getBotToken(bot);
  const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  const buffer = await downloadUrl(url);

  return {
    buffer,
    filePath: file.file_path || '',
    fileSize: file.file_size || buffer.length,
  };
}

function guessMimeFromPath(filePath, fallback) {
  const lower = String(filePath || '').toLowerCase();

  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.m4a')) return 'audio/mp4';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mkv')) return 'video/x-matroska';

  return fallback;
}

module.exports = {
  downloadTelegramFile,
  guessMimeFromPath,
};
