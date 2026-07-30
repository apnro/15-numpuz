const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'db.json');
const KEY = 'puzzle_site_db';

const REDIS_URL = process.env.REDIS_URL;
const USE_REDIS = !!REDIS_URL;

const EMPTY_DB = { users: {}, queue: [], matches: {}, matchfor: {}, tokens: {} };

let redis = null;
if (USE_REDIS) {
  const Redis = require('ioredis');
  redis = new Redis(REDIS_URL);
}

async function load() {
  if (USE_REDIS) {
    const raw = await redis.get(KEY);
    if (!raw) return structuredClone(EMPTY_DB);
    return JSON.parse(raw);
  }

  // local fallback - only used when REDIS_URL isn't set (e.g. local dev)
  if (!fs.existsSync(DB_PATH)) return structuredClone(EMPTY_DB);
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

async function save(db) {
  if (USE_REDIS) {
    await redis.set(KEY, JSON.stringify(db));
    return;
  }

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

module.exports = { load, save, USE_REDIS };
