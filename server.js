const express = require('express');
const cors = require('cors');
const multer = require('multer');
const QRCode = require('qrcode');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 8787);
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:5500').replace(/\/$/, '');
const CORS_ORIGIN = process.env.CORS_ORIGIN || new URL(FRONTEND_URL).origin;
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB || 200);
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
// A restart invalidates the in-memory room index, so remove orphaned payloads.
for (const entry of fs.readdirSync(UPLOAD_DIR, { withFileTypes: true })) {
  if (entry.isFile()) fs.unlinkSync(path.join(UPLOAD_DIR, entry.name));
}
const rooms = new Map();
const items = new Map();
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, done) => done(null, UPLOAD_DIR),
    filename: (_req, _file, done) => done(null, crypto.randomUUID())
  }),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 }
});

app.use(cors({ origin: CORS_ORIGIN, methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }));
app.use(express.json({ limit: '256kb' }));

function getRoom(code) {
  const room = rooms.get(code);
  if (!room || room.expiresAt <= Date.now()) return null;
  return room;
}
function publicItem(item) {
  const result = { id: item.id, kind: item.kind, name: item.name };
  if (item.kind === 'text') { result.text = item.text; result.remainingMs = Math.max(0, item.expiresAt - Date.now()); }
  else {
    result.sizeLabel = `${(item.size / 1024 / 1024).toFixed(2)} MB`;
    result.remainingMs = Math.max(0, (item.deleteAt || item.expiresAt) - Date.now());
  }
  return result;
}
function removeItem(id) {
  const item = items.get(id);
  if (!item) return;
  clearTimeout(item.deleteTimer);
  items.delete(id);
  if (item.path) fs.promises.unlink(item.path).catch(() => {});
}
function code() { return crypto.randomBytes(5).toString('hex').toUpperCase(); }

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/rooms/:code/qr', async (req, res, next) => {
  if (!getRoom(req.params.code)) return res.status(404).json({ error: 'Room expired or not found.' });
  try {
    const joinUrl = `${FRONTEND_URL}/?room=${encodeURIComponent(req.params.code)}`;
    res.json({ qr: await QRCode.toDataURL(joinUrl, { margin: 2, width: 190, color: { dark: '#17202f', light: '#ffffff' } }) });
  } catch (error) { next(error); }
});
app.post('/api/rooms', async (_req, res, next) => {
  try {
    let roomCode; do { roomCode = code(); } while (rooms.has(roomCode));
    const room = { code: roomCode, expiresAt: Date.now() + 60 * 60 * 1000, guests: new Map() };
    rooms.set(roomCode, room);
    const joinUrl = `${FRONTEND_URL}/?room=${roomCode}`;
    res.json({ code: roomCode, joinUrl, qr: await QRCode.toDataURL(joinUrl, { margin: 2, width: 190, color: { dark: '#17202f', light: '#ffffff' } }) });
  } catch (error) { next(error); }
});
app.get('/api/rooms/:code/items', (req, res) => {
  if (!getRoom(req.params.code)) return res.status(404).json({ error: 'Room expired or not found. Create a new room.' });
  const list = [...items.values()].filter(item => item.room === req.params.code && item.expiresAt > Date.now()).map(publicItem);
  res.json({ items: list });
});
app.post('/api/rooms/:code/text', (req, res) => {
  if (!getRoom(req.params.code)) return res.status(404).json({ error: 'Room expired or not found.' });
  if (typeof req.body.text !== 'string' || !req.body.text.trim()) return res.status(400).json({ error: 'Text is empty.' });
  if (Buffer.byteLength(req.body.text, 'utf8') > 100_000) return res.status(413).json({ error: 'Text is too long (100 KB max).' });
  const id = crypto.randomUUID();
  items.set(id, { id, room: req.params.code, kind: 'text', name: 'Text snippet', text: req.body.text, expiresAt: Date.now() + 3 * 60 * 1000 });
  res.status(201).json({ id });
});
app.post('/api/rooms/:code/files', (req, res, next) => {
  if (!getRoom(req.params.code)) return res.status(404).json({ error: 'Room expired or not found.' });
  upload.single('file')(req, res, error => {
    if (error) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? `File is larger than ${MAX_FILE_MB} MB.` : error.message });
    if (!req.file) return res.status(400).json({ error: 'Choose a file first.' });
    const id = crypto.randomUUID();
    const safeName = path.basename(req.file.originalname).replace(/[\r\n\0]/g, '_').slice(0, 240) || 'download';
    items.set(id, { id, room: req.params.code, kind: 'file', name: safeName, path: req.file.path, size: req.file.size, expiresAt: Date.now() + 30 * 60 * 1000, deleteAt: null, deleteTimer: null });
    res.status(201).json({ id });
  });
});
app.get('/api/items/:id/download', (req, res) => {
  const item = items.get(req.params.id);
  if (!item || item.kind !== 'file' || item.expiresAt <= Date.now() || (item.deleteAt && item.deleteAt <= Date.now())) return res.status(404).send('This file has expired or was deleted.');
  res.download(item.path, item.name, error => { if (error && !res.headersSent) res.status(404).send('File is no longer available.'); });
  res.once('finish', () => {
    if (!item.deleteAt) {
      item.deleteAt = Date.now() + 3 * 60 * 1000;
      item.deleteTimer = setTimeout(() => removeItem(item.id), 3 * 60 * 1000);
      item.deleteTimer.unref?.();
    }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [id, item] of items) if (item.expiresAt <= now || (item.deleteAt && item.deleteAt <= now)) removeItem(id);
  for (const [id, room] of rooms) if (room.expiresAt <= now) rooms.delete(id);
}, 60_000).unref();

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'Unexpected server error.' });
});
app.listen(PORT, '0.0.0.0', () => console.log(`SendGet API listening on 0.0.0.0:${PORT}; GitHub Pages origin: ${CORS_ORIGIN}`));


app.post('/api/rooms/:code/join', (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'Room expired or not found.' });
  const clientId = typeof req.body.clientId === 'string' ? req.body.clientId.slice(0, 80) : '';
  if (!clientId) return res.status(400).json({ error: 'A client ID is required.' });
  room.guests.set(clientId, Date.now());
  res.json({ connected: true });
});
app.get('/api/rooms/:code/status', (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'Room expired or not found.' });
  const cutoff = Date.now() - 20_000;
  for (const [clientId, lastSeen] of room.guests) if (lastSeen < cutoff) room.guests.delete(clientId);
  res.json({ connected: room.guests.size > 0, activeSenders: room.guests.size });
});
