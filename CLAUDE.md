# Project Notes for Claude

## Monorepo structure
- `backend/` — Express + Node.js API, entry point `backend/app.js`
- `frontend/` — Vite + React SPA (source only; dist is gitignored and built by Railway)
- Railway runs a single service: builds frontend then starts backend

## Frontend deployment
Railway's Nixpacks runs `npm run build` (root package.json) on every push, which
executes `npm install --prefix frontend && npm run build --prefix frontend`.
The compiled `frontend/dist` is produced at build time and served by Express.

`frontend/dist` is **gitignored** — never commit it.

Express serves `index.html` with `Cache-Control: no-store` (commit 87e8db8) so
browsers always fetch the latest bundle after a deploy.

## Railway deploy config
- Build command (railway.toml): `npm run build`
- Start command: `node --max-old-space-size=768 backend/app.js`
- Express serves `frontend/dist` as static files; `/assets/*` cached 1 year (immutable hashes)

## Key services
- `backend/src/services/quantumCode.js` — Aura (Gemini Vision) + Quantum Code math + Sinhala reading
- `backend/src/services/horoscope.js` — Full horoscope pipeline (freeastroapi → Gemini sections → PDF)
- `backend/src/controllers/plugins.controller.js` — HTTP handlers for horoscope/tarot/quantum endpoints
