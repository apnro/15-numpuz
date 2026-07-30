const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const { load, save, USE_REDIS } = require('./store');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname)));

app.get('/api/health', (req, res) => {
  res.json({ redisConfigured: USE_REDIS });
});

// wraps an async route handler so thrown errors/rejections become a JSON 500
// instead of crashing the process or hanging the request
function ah(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

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

const auth = ah(async (req, res, next) => {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const db = await load();
  const username = token && db.tokens[token];
  if (!username || !db.users[username]) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  req.username = username;
  req.db = db;
  next();
});

/* ---------- auth ---------- */

app.post('/api/signup', ah(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  const key = username.trim().toLowerCase();
  const db = await load();
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
  await save(db);
  res.json({ token, user: publicUser(db.users[key]) });
}));

app.post('/api/login', ah(async (req, res) => {
  const { username, password } = req.body || {};
  const key = (username || '').trim().toLowerCase();
  const db = await load();
  const user = db.users[key];
  if (!user || !bcrypt.compareSync(password || '', user.passwordHash)) {
    return res.status(401).json({ error: 'Wrong username or password' });
  }
  const token = newToken();
  db.tokens[token] = key;
  await save(db);
  res.json({ token, user: publicUser(user) });
}));

app.get('/api/me', auth, (req, res) => {
  res.json({ user: publicUser(req.db.users[req.username]) });
});

/* ---------- profile ---------- */

app.post('/api/avatar', auth, ah(async (req, res) => {
  const { dataUrl } = req.body || {};
  const db = req.db;
  db.users[req.username].avatar = dataUrl || '';
  await save(db);
  res.json({ user: publicUser(db.users[req.username]) });
}));

app.post('/api/solo/finish', auth, ah(async (req, res) => {
  const time = Number(req.body && req.body.time);
  const db = req.db;
  const u = db.users[req.username];
  if (Number.isFinite(time) && (u.soloBest === null || time < u.soloBest)) {
    u.soloBest = time;
  }
  await save(db);
  res.json({ user: publicUser(u) });
}));

/* ---------- matchmaking ---------- */

function createMatchBetween(db, a, b) {
  const matchId = Date.now() + '_' + a + '_' + b;
  const seed = Math.floor(Math.random() * 1e9);
  db.matches[matchId] = { players: [a, b], seed, progress: {}, finished: {} };
  db.matchfor[a] = matchId;
  db.matchfor[b] = matchId;
  return matchId;
}

function tryMatch(db) {
  while (db.queue.length >= 2) {
    const a = db.queue.shift();
    const b = db.queue.shift();
    if (a === b) continue;
    createMatchBetween(db, a, b);
  }
}

function matchInfo(db, matchId) {
  const m = db.matches[matchId];
  const playersDisplay = m.players.map(k => (db.users[k] ? db.users[k].username : k));
  return { matchId, seed: m.seed, players: m.players, playersDisplay };
}

app.post('/api/queue/join', auth, ah(async (req, res) => {
  const db = req.db;
  if (!db.queue.includes(req.username)) db.queue.push(req.username);
  tryMatch(db);
  await save(db);
  const matchId = db.matchfor[req.username];
  res.json(matchId ? { matched: true, ...matchInfo(db, matchId) } : { matched: false });
}));

app.post('/api/queue/leave', auth, ah(async (req, res) => {
  const db = req.db;
  db.queue = db.queue.filter(u => u !== req.username);
  await save(db);
  res.json({ ok: true });
}));

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

app.post('/api/match/:id/progress', auth, ah(async (req, res) => {
  const db = req.db;
  const m = db.matches[req.params.id];
  if (!m) return res.status(404).json({ error: 'Match not found' });
  const { moves, time } = req.body || {};
  m.progress[req.username] = { moves, time };
  await save(db);
  res.json({ ok: true });
}));

app.post('/api/match/:id/finish', auth, ah(async (req, res) => {
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
  await save(db);
  res.json({ winner, user: publicUser(u) });
}));

/* ---------- friends ---------- */

app.post('/api/friends/request', auth, ah(async (req, res) => {
  const targetKey = ((req.body && req.body.username) || '').trim().toLowerCase();
  const db = req.db;
  if (!targetKey || targetKey === req.username) {
    return res.status(400).json({ error: 'Invalid username' });
  }
  if (!db.users[targetKey]) return res.status(404).json({ error: 'No user with that name' });

  const me = db.users[req.username];
  const them = db.users[targetKey];
  me.friends = me.friends || [];
  them.friendRequests = them.friendRequests || [];

  if (me.friends.includes(targetKey)) return res.status(400).json({ error: 'Already friends' });
  if (them.friendRequests.includes(req.username)) return res.status(400).json({ error: 'Request already sent' });

  them.friendRequests.push(req.username);
  await save(db);
  res.json({ ok: true });
}));

app.post('/api/friends/accept', auth, ah(async (req, res) => {
  const otherKey = ((req.body && req.body.username) || '').trim().toLowerCase();
  const db = req.db;
  const me = db.users[req.username];
  me.friendRequests = me.friendRequests || [];
  if (!me.friendRequests.includes(otherKey)) return res.status(400).json({ error: 'No such request' });

  me.friendRequests = me.friendRequests.filter(u => u !== otherKey);
  me.friends = me.friends || [];
  if (!me.friends.includes(otherKey)) me.friends.push(otherKey);

  const other = db.users[otherKey];
  if (other) {
    other.friends = other.friends || [];
    if (!other.friends.includes(req.username)) other.friends.push(req.username);
  }
  await save(db);
  res.json({ ok: true });
}));

app.post('/api/friends/decline', auth, ah(async (req, res) => {
  const otherKey = ((req.body && req.body.username) || '').trim().toLowerCase();
  const db = req.db;
  const me = db.users[req.username];
  me.friendRequests = (me.friendRequests || []).filter(u => u !== otherKey);
  await save(db);
  res.json({ ok: true });
}));

app.get('/api/friends', auth, (req, res) => {
  const db = req.db;
  const me = db.users[req.username];
  const friends = (me.friends || []).map(k => db.users[k] ? publicUser(db.users[k]) : null).filter(Boolean);
  const requests = (me.friendRequests || []).map(k => db.users[k] ? publicUser(db.users[k]) : null).filter(Boolean);
  res.json({ friends, requests });
});

app.post('/api/friends/challenge', auth, ah(async (req, res) => {
  const targetKey = ((req.body && req.body.username) || '').trim().toLowerCase();
  const db = req.db;
  const me = db.users[req.username];
  if (!(me.friends || []).includes(targetKey)) return res.status(400).json({ error: 'Not friends' });
  if (!db.users[targetKey]) return res.status(404).json({ error: 'No user with that name' });

  const matchId = createMatchBetween(db, req.username, targetKey);
  await save(db);
  res.json(matchInfo(db, matchId));
}));

/* ---------- leaderboard ---------- */

app.get('/api/leaderboard', ah(async (req, res) => {
  const db = await load();
  const list = Object.values(db.users).map(u => ({
    username: u.username,
    avatar: u.avatar,
    wins: u.wins || 0,
    soloBest: u.soloBest,
    duoBest: u.duoBest
  }));
  list.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    const aSolo = a.soloBest === null || a.soloBest === undefined ? Infinity : a.soloBest;
    const bSolo = b.soloBest === null || b.soloBest === undefined ? Infinity : b.soloBest;
    return aSolo - bSolo;
  });
  res.json({ leaderboard: list.slice(0, 50) });
}));

// turns any uncaught error from the routes above into a clean JSON response
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Puzzle site listening on port ' + PORT));
