# 15 Puzzle — solo + 1v1 multiplayer

A small Node/Express app. Accounts, matchmaking, and stats are stored in a
JSON file on the server (`data/db.json`) — no external database needed.
Passwords are hashed with bcrypt; logins use a bearer token stored in the
browser's localStorage.

## Run it locally

```
npm install
npm start
```

Then open http://localhost:3000

## Put it on your own domain

Easiest path — a platform that runs Node apps for you (free/cheap tiers exist
on all of these): **Render**, **Railway**, or **Fly.io**.

1. Push this folder to a GitHub repo.
2. On Render/Railway: "New Web Service" → connect the repo.
   - Build command: `npm install`
   - Start command: `npm start`
3. Once it's deployed you'll get a URL like `puzzle-abc.onrender.com`.
4. In your domain's DNS settings, add a CNAME record pointing your domain
   (or a subdomain like `play.yourdomain.com`) to that URL. Render/Railway
   both have a "Custom Domain" screen that gives you the exact record to add.
5. HTTPS certificates are issued automatically by these platforms once the
   DNS record is verified.

If you'd rather run it on your own VPS (a $5/mo box from DigitalOcean,
Hetzner, etc.):

1. Install Node on the server, copy this folder over, `npm install`.
2. Run it persistently with `pm2 start server.js` (or a systemd service).
3. Put Nginx in front of it as a reverse proxy to `localhost:3000`, and use
   `certbot` to get a free HTTPS certificate for your domain.

## One important note on data

`data/db.json` is a flat file — completely fine for a hobby project with a
friend group, but it isn't built for heavy concurrent traffic or long-term
durability. If this grows, swap `store.js` for a real database (Postgres via
something like Supabase or Neon is a easy, still-free upgrade path) — the
rest of the app doesn't need to change, just the four functions in
`store.js`.

## Files

- `server.js` — the whole backend: signup/login, profile, matchmaking, match
  play, all as small REST endpoints under `/api`.
- `store.js` — tiny read/write wrapper around the JSON data file.
- `public/index.html` — the entire frontend (one file, wood textures baked
  in as base64 so there's nothing else to host).
