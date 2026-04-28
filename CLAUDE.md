# Project Notes for Claude

## Monorepo structure
- `backend/` — Express + Node.js API, entry point `backend/app.js`
- `frontend/` — Vite + React SPA
- Railway runs a single service: builds frontend then starts backend

## Frontend deployment (IMPORTANT)
`frontend/dist` is **committed to git** and must be kept up to date.

Railway's Nixpacks build cache was serving stale bundles that didn't include
new frontend code. The fix was to commit the compiled dist so Railway serves
it directly without rebuilding.

**After any frontend change:**
1. Run `npm run build --prefix frontend` from the repo root
2. `git add frontend/dist`
3. Commit dist together with the source changes
4. Push

Backend-only changes do not need a frontend rebuild.

## Railway deploy config
- Build command: `npm run build` (root package.json — builds frontend)
- Start command: `node --max-old-space-size=768 backend/app.js`
- Express serves `frontend/dist` as static files with `no-store` on index.html

## Key services
- `backend/src/services/quantumCode.js` — Aura (Gemini Vision) + Quantum Code math + Sinhala reading
- `backend/src/services/horoscope.js` — Full horoscope pipeline (freeastroapi → Gemini sections → PDF)
- `backend/src/controllers/plugins.controller.js` — HTTP handlers for horoscope/tarot/quantum endpoints
