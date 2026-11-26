// ---------- DOM elements ----------
const messagesEl = document.getElementById("messages");
const form = document.getElementById("form");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const stopBtn = document.getElementById("stop");
const modelSelect = document.getElementById("model");
const thinkLabel = document.getElementById("think-label");
const thinkBox = document.getElementById("think");
const newChatBtn = document.getElementById("new-chat");
const errorEl = document.getElementById("error");

// ---------- state ----------
let history = [];        // the whole conversation, sent with every request
let models = [];         // [{ name, capabilities }] from /api/models
let controller = null;   // AbortController of the running request

// ---------- small helpers ----------
function showError(msg) { errorEl.textContent = msg; errorEl.hidden = false; }
function hideError() { errorEl.hidden = true; }
function scrollDown() { messagesEl.scrollTop = messagesEl.scrollHeight; }

function addBubble(role) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  messagesEl.append(div);
  return div;
}

function setBusy(busy) {
  input.disabled = busy;
  modelSelect.disabled = busy;
  thinkBox.disabled = busy;
  newChatBtn.disabled = busy;
  sendBtn.hidden = busy;
  stopBtn.hidden = !busy;
}

// ---------- models ----------
async function loadModels() {
  try {
    const r = await fetch("/api/models");
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    models = data;
    for (const m of models) {
      const opt = document.createElement("option");
      opt.value = m.name;
      opt.textContent = m.name;
      modelSelect.append(opt);
    }
    updateThinkToggle();
  } catch (err) {
    showError("Could not load models: " + err.message);
  }
}

function updateThinkToggle() {
  const m = models.find((m) => m.name === modelSelect.value);
  thinkLabel.hidden = !m?.capabilities.includes("thinking");
}

// ---------- NDJSON reader ----------
async function* readNDJSON(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();                 // last piece may be incomplete: keep it
    for (const line of lines) {
      if (line.trim()) yield JSON.parse(line);
    }
  }

  buffer += decoder.decode();             // flush the decoder
  if (buffer.trim()) yield JSON.parse(buffer);
}

// ---------- send a message ----------
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  hideError();

  // 1. user message: history + bubble
  history.push({ role: "user", content: text });
  const userBubble = addBubble("user");
  userBubble.textContent = text;

  // 2. empty assistant bubble: reasoning block + answer + stats
  const bubble = addBubble("assistant");
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Reasoning";
  const thinkingEl = document.createElement("div");
  details.append(summary, thinkingEl);
  details.hidden = true;
  const answerEl = document.createElement("div");
    answerEl.className = "answer";
  const statsEl = document.createElement("small");
  bubble.append(details, answerEl, statsEl);
  scrollDown();

  // 3. request
  const body = { model: modelSelect.value, messages: history };
  if (!thinkLabel.hidden) body.think = thinkBox.checked;

  let content = "";
  let thinking = "";
  controller = new AbortController();
  setBusy(true);

  try {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      throw new Error(data.error ?? `HTTP ${r.status}`);
    }

    // 4. read the stream chunk by chunk
    for await (const chunk of readNDJSON(r)) {
      if (chunk.error) throw new Error(chunk.error);

      if (chunk.message?.thinking) {
        thinking += chunk.message.thinking;
        thinkingEl.textContent = thinking;
        details.hidden = false;
      }
      if (chunk.message?.content) {
        content += chunk.message.content;
                answerEl.innerHTML = DOMPurify.sanitize(marked.parse(content));
      }
      if (chunk.done) {
        const tps = chunk.eval_count / (chunk.eval_duration / 1e9);
        statsEl.textContent = `${chunk.eval_count} tokens · ${tps.toFixed(1)} tokens/s`;
      }
      scrollDown();
    }

    // 5. success: save the answer in the history
    history.push({ role: "assistant", content });
  } catch (err) {
    if (err.name === "AbortError") {
      // Stop clicked: not a failure, keep the partial answer
      history.push({ role: "assistant", content });
      statsEl.textContent = "⏹ stopped";
    } else {
      // real error: remove the unanswered user message
      history.pop();
      userBubble.remove();
      bubble.remove();
      input.value = text;                 // give the text back so the user can retry
      showError(err.message);
    }
  } finally {
    controller = null;
    setBusy(false);
    input.focus();
  }
});

// ---------- buttons ----------
stopBtn.addEventListener("click", () => controller?.abort());

newChatBtn.addEventListener("click", () => {
  history = [];
  messagesEl.replaceChildren();
  hideError();
});

modelSelect.addEventListener("change", updateThinkToggle);

loadModels();