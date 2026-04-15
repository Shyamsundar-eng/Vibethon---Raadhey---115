## Architecture (prototype → “real” full-stack)

### Prototype (current repo)
- **Frontend**: static HTML/CSS/JS (`index.html`, `styles.css`, `app.js`)
- **Storage**: `localStorage` (users, session, activity)
- **Auth**: email/password with SHA-256 password hash (demo-grade, not production)
- **Interactive components**:
  - Quiz engine (MCQ + instant feedback)
  - Coding playground (safe, Python-like subset runner)
  - Simulation (toy spam detector + live precision/recall)
- **Progress + gamification**:
  - points, badges, streak
  - completion checklist mapped to Vibethon minimum criteria

### Production-worthy full-stack (recommended upgrade path)
If you have time after the working prototype, migrate incrementally:

#### Data model (DB tables)
- `users`: id, email, password_hash, created_at
- `module_progress`: user_id, module_id, completed_at
- `quiz_attempts`: id, user_id, module_id, score, max_score, created_at
- `activity_events`: id, user_id, type, payload_json, created_at

#### API surface
- `POST /api/auth/register` (email/password)
- `POST /api/auth/login` (session cookie)
- `POST /api/auth/logout`
- `GET /api/modules` (structured content)
- `POST /api/modules/:id/complete`
- `POST /api/quiz/:moduleId/submit`
- `POST /api/simulations/spam/label` (store TP/FP/TN/FN updates per user)
- `GET /api/progress/me`
- `GET /api/leaderboard`

#### Frontend
- Keep the same route structure:
  - `/learn`, `/quiz`, `/playground`, `/simulate`, `/progress`, `/leaderboard`
- Swap storage calls from localStorage → API calls.
- Replace the playground runner with **Pyodide** (in-browser Python) or a remote sandbox service.

## Milestones (thin vertical slices)

### Slice 1 (minimum criteria fast)
- Auth + session
- 1 module page
- 1 interactive feature (quiz)
- Progress dashboard

### Slice 2 (wow-factor + “experiential learning”)
- Coding playground
- Real-world simulation

### Slice 3 (shortlisting signals)
- Leaderboard + badges + streak
- Demo mode seed + guided demo flow
- README + screenshots

## Standout differentiators (safe within 4 hours)
- **Live metric visualization** (precision/recall) tied to simulation actions.
- **Demo mode** for judges (one-click seeded data + pre-baked leaderboard).
- **Offline-first** fallback (still runs even if internet is flaky).
