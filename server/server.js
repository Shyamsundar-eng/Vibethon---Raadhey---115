import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
// Keep this list to models that actually exist for v1beta generateContent.
// Older model aliases (ex: gemini-1.5-*) may return 404 depending on project/API state.
const MODELS = ["gemini-2.0-flash-lite", "gemini-2.0-flash"];

function geminiUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
}

app.post("/api/gemini", async (req, res) => {
  if (!GEMINI_API_KEY) return res.status(500).json({ error: "Server missing GEMINI_API_KEY" });

  const prompt = String(req.body?.prompt ?? "");
  const maxTokens = Math.max(1, Math.min(4096, Number(req.body?.maxTokens ?? 1024)));
  const temperature = Math.max(0, Math.min(1, Number(req.body?.temperature ?? 0.7)));
  if (!prompt.trim()) return res.status(400).json({ error: "Missing prompt" });

  let lastStatus = 500;
  let lastText = "";

  for (const model of MODELS) {
    let hitRateLimit = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(geminiUrl(model), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: maxTokens, temperature },
          }),
        });

        if (r.status === 429) {
          await new Promise((x) => setTimeout(x, (attempt + 1) * 1500 + Math.random() * 800));
          lastStatus = 429;
          hitRateLimit = true;
          continue;
        }

        if (!r.ok) {
          lastStatus = r.status;
          lastText = await r.text().catch(() => "");
          break;
        }

        const data = await r.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (text) return res.json({ text, model });
        lastStatus = 502;
        lastText = "Empty model response";
      } catch (e) {
        lastStatus = 502;
        lastText = String(e?.message || e);
        await new Promise((x) => setTimeout(x, (attempt + 1) * 800));
      }
    }
    if (hitRateLimit && lastStatus === 429) {
      return res.status(429).json({ error: "Rate limited by Gemini. Please retry in a few seconds." });
    }
  }

  return res.status(lastStatus || 500).json({ error: "Gemini request failed", detail: lastText });
});

// Serve the static app (index.html, app.js, styles.css)
app.use(express.static(rootDir));
app.get("*", (_, res) => res.sendFile(path.join(rootDir, "index.html")));

const port = Number(process.env.PORT || 5174);
app.listen(port, () => {
  console.log(`AIML Quest server running on http://localhost:${port}`);
});

