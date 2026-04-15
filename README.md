# AIML Quest (Vibethon Prototype)

An interactive web-based platform for learning AIML concepts through **structured modules**, **quizzes**, a **coding playground**, and a **real-world mini simulation** (spam detection) — built to match the Vibethon evaluation criteria.

## What’s implemented (mapped to requirements)
- **Working prototype**: fully functional in-browser app (not just UI).
- **Structured learning module**: `Classification 101 (Spam vs Not Spam)` (Beginner).
- **Interactive features**:
  - **Quiz & instant feedback**
  - **Coding playground** (safe Python-like runner; swap to Pyodide in a production version)
  - **Simulation** (spam detection + live precision/recall)
- **Progress tracking dashboard**: modules completed, quiz score, activity counts, progress bar.
- **Leaderboard + gamification**: points, badges, streak, leaderboard table.
- **Responsive design**: works on mobile/tablet/desktop.
- **Open source runnable locally**: simple local server included.

## Run locally
### Option A: Python (recommended)

Set the Gemini key (required for the AI Tutor / AI quiz features):

```bash
# PowerShell
$env:GEMINI_KEY="YOUR_GEMINI_KEY"
```

```bash
python server.py
```

Then open `http://127.0.0.1:5173`.

### Option B: Any static server
You can host the repo root as static files; the entry is `index.html`.

## Demo mode (for judges)
- Click **Demo mode** in the top-right.
- It seeds a few sample users and logs you in as a demo user, then jumps to the **Leaderboard**.

## Notes
- Authentication and storage are implemented with `localStorage` (prototype-friendly). For a production/higher-credibility build, replace with a real backend (DB + sessions) while keeping the same UI flows.

