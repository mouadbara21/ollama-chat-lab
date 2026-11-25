import express from "express";

const app = express();
const PORT = process.env.PORT ?? 3000;
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:e2b";

app.use(express.json());
app.use(express.static("public"));

app.post("/api/chat", async (req, res) => {
  const { messages, model = DEFAULT_MODEL } = req.body ?? {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages must be a non-empty array" });
  }

    try {
    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false }),
    });

    const data = await r.json();

    if (!r.ok) {
      return res.status(r.status).json({ error: data.error ?? "Ollama error" });
    }

    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "Cannot reach Ollama: " + err.message });
  }
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
