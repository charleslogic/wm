# Worry Meter

Private worry tracker. Log worries for yourself and the people around you — category, intensity, and an optional note. A decay-based meter (0–100%) reflects current worry load. Resolving entries (happened / didn't happen) removes them from the meter and builds a long-term "didn't happen %" stat.

## Deploy Workflow

Commit → push to GitHub → Vercel auto-deploys. Do not use `vercel --prod` directly.

## Architecture

Static `index.html` + one Vercel serverless function. No build step.

```
index.html          — full app (Supabase auth, people grid, meters, detail view, modals)
api/index.js        — single Vercel function, all actions via ?action=
package.json        — @supabase/supabase-js dependency
manifest.json       — PWA manifest
sw.js               — service worker (precaches supabase.umd.js + index.html)
supabase.umd.js     — self-hosted Supabase client (never CDN-import)
wm.svg              — app icon
supabase-setup.sql  — run once in Supabase SQL editor
wm-guide.html       — user guide (linked from user menu in app)
```

## Auth

Single-user in practice (personal tool). Any existing CharlesLogic account can sign in — `shouldCreateUser: false` so OTP won't create new accounts. Google OAuth open. No approval or invite gate.

Same Supabase project as all other apps (`nfvxmkknkxysjksyhbek`).

## Environment Variables

Set in Vercel dashboard:

| Variable | Value |
|----------|-------|
| `SUPABASE_URL` | `https://nfvxmkknkxysjksyhbek.supabase.co` |
| `SUPABASE_ANON_KEY` | from Supabase → Settings → API |

## Supabase Tables (`wm_` prefix)

**`wm_people`** — roster of people being tracked.
- `id` uuid PK, `user_id` uuid (FK auth.users), `name` text, `relation` text, `emoji` text, `created_at`

**`wm_worries`** — individual worry log entries.
- `id` uuid PK, `user_id` uuid (FK auth.users), `person_id` uuid (FK wm_people CASCADE), `category` text, `description` text, `intensity` int (1–10), `logged_at` timestamptz, `outcome` text (null | `'happened'` | `'didnt_happen'`)

Both tables have RLS enabled — `user_id = auth.uid()` on all operations.

## Meter Fill Algorithm

Computed server-side in `api/index.js → computeFill()`.

```
fill = MIN(100, SUM of intensity × MAX(0, 1 − days_old/30) for all unresolved worries in last 30 days)
```

Resolved worries (`outcome` is non-null) are excluded. Decays to zero over 30 days. Cap is 100.

## API Actions (`/api?action=`)

| Action | Method | Description |
|--------|--------|-------------|
| `people` | GET | People list with `fill` computed |
| `add-person` | POST | `{name, relation, emoji}` |
| `edit-person` | POST | `{id, name, relation, emoji}` |
| `delete-person` | POST | `{id}` — cascades all their worries |
| `worries` | GET | `?person_id=` — last 100, newest first |
| `log-worry` | POST | `{person_id, category, intensity, description}` |
| `resolve` | POST | `{id, outcome}` — set `'happened'`, `'didnt_happen'`, or `null` |
| `delete-worry` | POST | `{id}` |

## UI Structure

**Main screen:** people grid (`#people-grid`) — cards with mini meter bar + "Log worry" quick button. Empty state when no people. "+ Add person" dashed button at bottom.

**Person detail overlay** (`#detail-overlay`): sticky back button + edit button → SVG semicircle gauge → stats row (total / didn't happen % / avg intensity) → worry log list with outcome buttons and ✕ delete.

**Log worry modal** (`#log-modal`): person picker (if no person pre-selected) → category chips → intensity slider (1–10) → note textarea.

**Add/edit person modal** (`#person-modal`): name, relation, emoji inputs. Edit mode shows delete button.

**User menu** (`#config-card`): name/email header → light/dark toggle → user guide link → sign out.

## Meter Colors (client-side)

| Fill | Color |
|------|-------|
| 0–29% | `#22C55E` green |
| 30–59% | `#F59E0B` amber |
| 60–79% | `#F97316` orange |
| 80–100% | `#EF4444` red |

## SVG Arc (detail view)

Center `(100, 105)`, radius 85. Background arc: `M 15 105 A 85 85 0 0 0 185 105` (CCW, top half). Fill arc endpoint for fraction `f`: `ex = 100 + 85·cos(π(1−f))`, `ey = 105 − 85·sin(π(1−f))`. Full arc (f≥1) drawn as two quarter arcs through `(100, 20)`.

## Service Worker

Cache name: `wm-v1`. Bump to `wm-v2` in `sw.js` if the precache list changes. API requests (`/api`) are always network-only.
