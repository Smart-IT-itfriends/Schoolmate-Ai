/**
 * Simple SSE load test for global chat server.
 * Usage: node scripts/load-test-global-chat.js [connections] [port]
 */
const http = require('http');

const connections = Number(process.argv[2] || 20);
const port = Number(process.argv[3] || 3002);
let open = 0;
let errors = 0;
let heartbeats = 0;

console.log(`Connecting ${connections} SSE clients to port ${port}...`);

for (let i = 0; i < connections; i += 1) {
  const req = http.get(`http://127.0.0.1:${port}/global-chat/api/events`, (res) => {
    if (res.statusCode !== 200) {
      errors += 1;
      return;
    }
    open += 1;
    res.on('data', (chunk) => {
      if (String(chunk).includes('event: heartbeat')) {
        heartbeats += 1;
      }
    });
  });
  req.on('error', () => {
    errors += 1;
  });
}

setTimeout(() => {
  console.log(JSON.stringify({ connections, open, errors, heartbeats }, null, 2));
  process.exit(errors > 0 ? 1 : 0);
}, 5000);
