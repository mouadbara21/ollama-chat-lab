import express from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const app = express();
const PORT = process.env.PORT ?? 3000;
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:e2b";

app.use(express.json());
app.use(express.static("public"));

// ---------- POST /api/chat ----------
app.post("/api/chat", async (req, res) => {
  const { messages, model = DEFAULT_MODEL, stream = true, think } = req.body ?? {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages must be a non-empty array" });
  }

  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });

  const body = { model, messages, stream };
  if (think !== undefined) body.think = think;

  try {
    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!r.ok) {
      const data = await r.json();
      return res.status(r.status).json({ error: data.error ?? "Ollama error" });
    }

    if (!stream) {
      return res.json(await r.json());
    }

    res.setHeader("Content-Type", "application/x-ndjson");
    await pipeline(Readable.fromWeb(r.body), res);
  } catch (err) {
    if (controller.signal.aborted) return;
    if (res.headersSent) return res.end();
    res.status(502).json({ error: "Cannot reach Ollama: " + (err.cause?.code ?? err.message) });
  }
});

// ---------- GET /api/models ----------
app.get("/api/models", async (req, res) => {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!r.ok) return res.status(r.status).json({ error: "Ollama error" });
    const { models } = await r.json();

    const result = await Promise.all(
      models.map(async (m) => {
        const s = await fetch(`${OLLAMA_URL}/api/show`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: m.name }),
        });
        const info = await s.json();
        return { name: m.name, capabilities: info.capabilities ?? [] };
      })
    );

    res.json(result);
  } catch (err) {
    res.status(502).json({ error: "Cannot reach Ollama: " + (err.cause?.code ?? err.message) });
  }
});

// ---------- start (always last) ----------
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));