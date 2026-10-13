# 🌙 Lunaria — whole-body cycle health companion

Lunaria is a menstrual health app that does much more than put period dates on a calendar. It learns from your own body signals and turns them into predictions, forecasts, nutrition coaching, health screening and timely notifications.

It's an installable PWA with a Node.js backend. There is no build step and it has only two runtime dependencies.

## What makes it different

| Feature | Typical tracker | Lunaria |
|---|---|---|
| Period prediction | Calendar average | Recency-weighted average, plus **ovulation confirmed from BBT ("three-over-six" rule) or LH tests**. Once ovulation is confirmed, the next period is predicted from your *personal* luteal length, with a confidence window and a regularity rating |
| Symptoms | A log | **Pattern mining**, for example "headaches 3× more likely in your luteal phase, ~2 days before your period", and a **personal 3–5 day symptom forecast** with relief tips |
| Lifestyle | — | **Correlation discovery** from your own data, for example "pain averages 3.2 on <7 h sleep vs 1.3 with 7 h+" (sleep, hydration, exercise, stress) |
| Nutrition | Generic tips | Food log with 70 foods and 12 nutrients (USDA-based). Targets adjust to **diet** (vegetarian/vegan iron ×1.8), **goal** (folate 600 µg and caffeine ≤200 mg when trying to conceive), **age** and **phase**. Suggestions rank foods by how well they **close today's gaps**, and there are phase-specific meal ideas you can log in one tap |
| Health | — | **Screening flags** for short/long/irregular cycles, prolonged or heavy bleeding, severe pain, bleeding between periods, 90+ days without a period, a PMDD-like mood pattern, iron-deficiency risk, and late period after unprotected sex. Each flag comes with clear "talk to a clinician" guidance |
| Doctor visit | — | A printable **clinician-ready report**: cycle stats, a cycle table with how each ovulation was determined, pain summary, symptom frequency, patterns, flags and medications |
| Coaching | — | Phase guidance (hormones, nutrition, movement, self-care, mind), tailored to your goal (track / conceive / avoid / perimenopause) and conditions (PCOS, endometriosis, thyroid, anaemia, PMDD) |
| Wellbeing | — | A transparent 0–100 **cycle health score** showing exactly how each component was scored |

### Smart notifications
These are delivered by Web Push (VAPID) even when the app is closed, and also appear in an in-app inbox:
- period coming soon / due today / late (2, 5, 10 days)
- fertile window opens, ovulation day
- **entering a new phase**, with what to eat and how to move
- **evening symptom forecast**, for example "Cramps likely tomorrow (78%)" with a tip
- daily check-in, morning BBT reminder
- **hydration nudges only when you're behind**
- **iron top-up nudges** on period days when iron intake is low
- medication, supplement and pill reminders, with taken/adherence tracking
- health-screening alerts

Every type can be switched off. There are also quiet hours (medication reminders still come through) and a **discreet mode** that hides cycle details in notification text. Each notification is deduplicated, so it fires at most once.

### Login and privacy
- Email + password accounts. Passwords are hashed with scrypt.
- Sessions use HttpOnly SameSite cookies. Only a SHA-256 hash of each session token is stored.
- Login is rate-limited. Cross-origin writes are blocked, and a strict Content Security Policy is set.
- Users can export all their data as JSON, change their password (which signs out other devices) and delete their account permanently.
- All data stays in your own SQLite database.

## Use it on your phone 📱

Lunaria is built mobile-first and installs like an app. It just has to be **hosted at an HTTPS address**: `localhost` on a phone means the phone itself.

1. **Deploy** (pick one):
   - **Render:** push this repo to GitHub, then in Render go to *New → Blueprint* and select the repo. `render.yaml` sets up the app with a 1 GB persistent disk (Starter plan, because free instances lose data on restart).
   - **Railway / Fly.io / any Docker host:** deploy the included `Dockerfile` and mount a volume at `/data`.
2. **Open the URL** you're given on your phone and create an account.
3. **Install it:**
   - **Android (Chrome):** menu ⋮ → *Add to Home screen / Install app*
   - **iPhone (Safari, iOS 16.4+):** Share → *Add to Home Screen*. Open it from the home-screen icon, then turn on notifications in *🔔 → Settings*. On iPhone, push notifications only work from the installed app.

### Quick test on a phone (no server)

`npm run build:phone` creates `dist/lunaria-phone.html`, the whole app in one file. It includes a built-in local backend that uses the same engines, validators and notification rules as the server. Open it in any phone browser: accounts and data stay on that device, and there's a one-tap **Try with demo data** button. It can't send push notifications while closed; the hosted version is needed for that.

## Run it locally

Requires **Node.js ≥ 22.13** (it uses the built-in `node:sqlite`).

```bash
npm install
npm run seed     # optional: demo account demo@lunaria.app / lunaria-demo with 7 months of data
npm start        # http://localhost:3000
npm test         # engine + API tests
```

Environment variables (all optional):

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DB_FILE` | `data/lunaria.db` | SQLite file |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | generated once and stored in the DB | Web Push keys |
| `VAPID_SUBJECT` | `mailto:admin@lunaria.local` | Push contact |
| `NOTIFY_INTERVAL_MS` | `300000` | How often the notification scheduler runs |
| `NODE_ENV=production` | — | Marks cookies `Secure` (serve over HTTPS) |
| `TRUST_PROXY` | loopback only | Set to `1` behind a hosting proxy so rate limiting sees real client IPs (preset in the Dockerfile) |

Push notifications need HTTPS, or `localhost`. On iOS, install the app to the home screen first (iOS 16.4+).

## Architecture

```
server/
  index.js, app.js        Express app, security headers, routing
  auth.js                 scrypt hashing, sessions, rate limiting
  db.js                   SQLite schema (node:sqlite)
  context.js              loads a user's data and runs the engines
  validate.js             input validation
  engine/
    cycle.js              cycle analysis, ovulation detection (BBT/LH/mucus), predictions, calendar
    insights.js           symptom patterns, forecasts, correlations, health flags, health score
    nutrition.js          food database, personalised targets, gap analysis, suggestions, meals
    phases.js             phase / goal / condition guidance
  notifications/
    scheduler.js          decides which notifications are due (pure, deduplicated, timezone-aware)
    push.js               Web Push delivery (VAPID)
  routes/                 auth, core API, notifications + medications
public/                   PWA: vanilla ES modules, service worker, manifest
scripts/                 demo data generator + seed, single-file phone build
standalone/               in-browser backend + storage for the phone build
test/                     node:test suites
```

> Lunaria provides wellness information, not medical advice. Predictions are estimates and are **not** a form of contraception.
