const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const globalChatService = require('./globalChatService');
const userService = require('./userService');

const sseClients = new Set();
let heartbeatTimer = null;
let cleanupTimer = null;

function getWebSecret() {
  return process.env.CHAT_WEB_SECRET || process.env.TELEGRAM_TOKEN || 'schoolmate-chat-dev-secret';
}

function createWebToken(userId) {
  return crypto
    .createHmac('sha256', getWebSecret())
    .update(String(userId))
    .digest('hex')
    .slice(0, 24);
}

function verifyWebToken(userId, token) {
  if (!userId || !token) {
    return false;
  }
  const expected = createWebToken(userId);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(token)));
}

function safeEqual(a, b) {
  try {
    return crypto.timingSafeEqual(Buffer.from(String(a)), Buffer.from(String(b)));
  } catch {
    return false;
  }
}

function verifyWebTokenSafe(userId, token) {
  if (!userId || !token) {
    return false;
  }
  return safeEqual(createWebToken(userId), token);
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcastSse(event) {
  for (const client of sseClients) {
    try {
      writeSse(client.res, event.type, event.payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(payload));
}

function getProfile(userId) {
  const session = userService.getSession(userId) || {};
  return {
    name: session.name || 'Користувач',
    username: session.username || null,
    class: session.class || null,
  };
}

function createGlobalChatServer(config, port = 3002) {
  globalChatService.init(config);

  const unsubscribe = globalChatService.subscribe((event) => {
    broadcastSse(event);
  });

  const publicDir = path.join(__dirname, '..', 'public');
  const htmlPath = path.join(publicDir, 'global-chat.html');

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end();
        return;
      }

      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/global-chat')) {
        if (fs.existsSync(htmlPath)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(fs.readFileSync(htmlPath, 'utf8'));
          return;
        }
        sendJson(res, 404, { error: 'UI not found' });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/global-chat/api/history') {
        sendJson(res, 200, {
          messages: globalChatService.getHistory(),
          online: globalChatService.getOnlineCount(),
          slowModeSeconds: config.globalChat?.slowModeSeconds || 4,
          maxMessageLength: config.globalChat?.maxMessageLength || 250,
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/global-chat/api/online') {
        sendJson(res, 200, { count: globalChatService.getOnlineCount() });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/global-chat/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });
        res.write(': connected\n\n');

        const client = { res, connectedAt: Date.now() };
        sseClients.add(client);

        writeSse(res, 'online', { count: globalChatService.getOnlineCount() });
        writeSse(res, 'history', { messages: globalChatService.getHistory() });

        req.on('close', () => {
          sseClients.delete(client);
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/global-chat/api/send') {
        const raw = await readBody(req);
        let body = {};
        try {
          body = JSON.parse(raw || '{}');
        } catch {
          sendJson(res, 400, { error: 'Invalid JSON' });
          return;
        }

        const userId = body.userId;
        const token = body.token;
        const text = body.text;

        if (!verifyWebTokenSafe(userId, token)) {
          sendJson(res, 401, { error: 'Unauthorized' });
          return;
        }

        const profile = getProfile(userId);
        globalChatService.touchPresence(userId, userId, profile);

        const result = globalChatService.addMessage(userId, profile, text, config);
        if (!result.ok) {
          sendJson(res, 429, {
            error: result.error.code,
            message: result.error.message,
            retryAfterMs: result.error.retryAfterMs || 0,
            retryAfterSec: result.error.retryAfterSec || 0,
          });
          return;
        }

        sendJson(res, 200, { ok: true, message: result.message });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/global-chat/api/token') {
        const userId = url.searchParams.get('userId');
        if (!userId) {
          sendJson(res, 400, { error: 'userId required' });
          return;
        }
        sendJson(res, 200, { userId: String(userId), token: createWebToken(userId) });
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      sendJson(res, 500, { error: err.message || 'Server error' });
    }
  });

  server.listen(port, () => {
    console.log(`Global Chat realtime (SSE) on http://localhost:${port}/global-chat`);
  });

  server.on('error', (error) => {
    console.error('Global Chat server error:', error.message || error);
  });

  const heartbeatSec = config.globalChat?.heartbeatIntervalSeconds || 25;
  heartbeatTimer = setInterval(() => {
    globalChatService.emitHeartbeat();
    broadcastSse({ type: 'heartbeat', payload: { ts: Date.now(), online: globalChatService.getOnlineCount() } });
  }, heartbeatSec * 1000);

  cleanupTimer = setInterval(() => {
    globalChatService.cleanupPresence();
  }, 30 * 1000);

  server.destroyGlobalChat = () => {
    clearInterval(heartbeatTimer);
    clearInterval(cleanupTimer);
    unsubscribe();
    for (const client of sseClients) {
      try {
        client.res.end();
      } catch {
        // ignore
      }
    }
    sseClients.clear();
  };

  return server;
}

module.exports = {
  createGlobalChatServer,
  createWebToken,
  verifyWebTokenSafe,
};
