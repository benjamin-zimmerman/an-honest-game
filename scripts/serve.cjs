const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const allowed = new Set(['index.html', 'style.css', 'app-1.js', 'app-2.js', 'app-3.js', 'app-4.js', 'engine-worker.js']);
const port = Number(process.env.PORT || 8792);
http.createServer((req, res) => {
  const file = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!allowed.has(file)) { res.writeHead(404); return res.end(); }
  const type = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
  res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(path.join(root, file)));
}).listen(port, '127.0.0.1', () => console.log('The Noble Game: http://127.0.0.1:' + port));
