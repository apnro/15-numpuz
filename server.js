const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const { load, save } = require('./store');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname)));

function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

function publicUser(u) {
  return {
    username: u.username,
    avatar: u.avatar,
    wins: u.wins,
    soloBest: u.soloBest,
    duoBest: u.duoBest
  };
}

function auth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const db = load();
  const username = token && db.tokens[token];
  if (!username || !db.users[username]) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  req.username = username;
  req.db = db;
  next();
}

/* ---------- auth ---------- */

app.post('/api/signup', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  const key = username.trim().toLowerCase();
  const db = load();
  if (db.users[key]) return res.status(409).json({ error: 'That username is taken' });

  db.users[key] = {
    username: username.trim(),
    passwordHash: bcrypt.hashSync(password, 10),
    avatar: '',
    wins: 0,
    soloBest: null,
    duoBest: null
  };
  const token = newToken();
  db.tokens[token] = key;
  save(db);
  res.json({ token, user: publicUser(db.users[key]) });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const key = (username || '').trim().toLowerCase();
  const db = load();
  const user = db.users[key];
  if (!user || !bcrypt.compareSync(password || '', user.passwordHash)) {
    return res.status(401).json({ error: 'Wrong username or password' });
  }
  const token = newToken();
  db.tokens[token] = key;
  save(db);
  res.json({ token, user: publicUser(user) });
});

app.get('/api/me', auth, (req, res) => {
  res.json({ user: publicUser(req.db.users[req.username]) });
});

/* ---------- profile ---------- */

app.post('/api/avatar', auth, (req, res) => {
  const { dataUrl } = req.body || {};
  const db = req.db;
  db.users[req.username].avatar = dataUrl || '';
  save(db);
  res.json({ user: publicUser(db.users[req.username]) });
});

app.post('/api/solo/finish', auth, (req, res) => {
  const time = Number(req.body && req.body.time);
  const db = req.db;
  const u = db.users[req.username];
  if (Number.isFinite(time) && (u.soloBest === null || time < u.soloBest)) {
    u.soloBest = time;
  }
  save(db);
  res.json({ user: publicUser(u) });
});

/* ---------- matchmaking ---------- */

function tryMatch(db) {
  while (db.queue.length >= 2) {
    const a = db.queue.shift();
    const b = db.queue.shift();
    if (a === b) continue;
    const matchId = Date.now() + '_' + a + '_' + b;
    const seed = Math.floor(Math.random() * 1e9);
    db.matches[matchId] = { players: [a, b], seed, progress: {}, finished: {} };
    db.matchfor[a] = matchId;
    db.matchfor[b] = matchId;
  }
}

function matchInfo(db, matchId) {
  const m = db.matches[matchId];
  const playersDisplay = m.players.map(k => (db.users[k] ? db.users[k].username : k));
  return { matchId, seed: m.seed, players: m.players, playersDisplay };
}

app.post('/api/queue/join', auth, (req, res) => {
  const db = req.db;
  if (!db.queue.includes(req.username)) db.queue.push(req.username);
  tryMatch(db);
  save(db);
  const matchId = db.matchfor[req.username];
  res.json(matchId ? { matched: true, ...matchInfo(db, matchId) } : { matched: false });
});

app.post('/api/queue/leave', auth, (req, res) => {
  const db = req.db;
  db.queue = db.queue.filter(u => u !== req.username);
  save(db);
  res.json({ ok: true });
});

app.get('/api/queue/status', auth, (req, res) => {
  const db = req.db;
  const matchId = db.matchfor[req.username];
  if (matchId) return res.json({ matched: true, ...matchInfo(db, matchId) });
  res.json({ matched: false });
});

/* ---------- match play ---------- */

app.get('/api/match/:id', auth, (req, res) => {
  const m = req.db.matches[req.params.id];
  if (!m) return res.status(404).json({ error: 'Match not found' });
  res.json({ match: m });
});

app.post('/api/match/:id/progress', auth, (req, res) => {
  const db = req.db;
  const m = db.matches[req.params.id];
  if (!m) return res.status(404).json({ error: 'Match not found' });
  const { moves, time } = req.body || {};
  m.progress[req.username] = { moves, time };
  save(db);
  res.json({ ok: true });
});

app.post('/api/match/:id/finish', auth, (req, res) => {
  const db = req.db;
  const m = db.matches[req.params.id];
  if (!m) return res.status(404).json({ error: 'Match not found' });
  const { moves, time } = req.body || {};
  const alreadyFinished = Object.keys(m.finished).length > 0;
  m.finished[req.username] = { time, moves, at: Date.now() };

  const u = db.users[req.username];
  if (u.duoBest === null || time < u.duoBest) u.duoBest = time;
  let winner = false;
  if (!alreadyFinished) {
    u.wins = (u.wins || 0) + 1;
    winner = true;
  }
  save(db);
  res.json({ winner, user: publicUser(u) });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Puzzle site listening on port ' + PORT));
