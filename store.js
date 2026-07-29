const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'db.json');
const KEY = 'puzzle_site_db';

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const USE_REDIS = !!(REDIS_URL && REDIS_TOKEN);

const EMPTY_DB = { users: {}, queue: [], matches: {}, matchfor: {}, tokens: {} };

async function load() {
  if (USE_REDIS) {
    const res = await fetch(`${REDIS_URL}/get/${KEY}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
    if (!res.ok) throw new Error('Could not reach the database (Upstash returned ' + res.status + ')');
    const data = await res.json();
    if (!data.result) return structuredClone(EMPTY_DB);
    return JSON.parse(data.result);
  }

  // local fallback - only used when Upstash env vars aren't set (e.g. local dev)
  if (!fs.existsSync(DB_PATH)) return structuredClone(EMPTY_DB);
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

async function save(db) {
  if (USE_REDIS) {
    const res = await fetch(`${REDIS_URL}/set/${KEY}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'text/plain' },
      body: JSON.stringify(db)
    });
    if (!res.ok) throw new Error('Could not save to the database (Upstash returned ' + res.status + ')');
    return;
  }

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

module.exports = { load, save, USE_REDIS };
