// app/home.js
// Son of Wisdom — Home (chat) page controller
// Unified with backend context pipeline metadata:
// - surfaces usedKnowledge / usedFileContext
// - injects a lightweight context strip above chat
// - keeps chat, speak, file upload, history, and optional voice replies

sessionStorage.removeItem("sow_redirected");

import { supabase, ensureAuthedOrRedirect, getSession } from "./supabase.js";

/* -------------------------- tiny DOM helpers -------------------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ------------------------------ config -------------------------------- */
const CHAT_URL = "/.netlify/functions/call-coach";
const TRANSCRIBE_URL = "/.netlify/functions/openai-transcribe";

// File pipeline
const UPLOAD_URL = "/.netlify/functions/upload-file";
const EXTRACT_URL = "/.netlify/functions/file-extract";
const PROCESS_UPLOAD_URL = "/.netlify/functions/process-upload";

// DEV toggle: call OpenAI directly from the browser (no server).
// Never enable this on production.
const DEV_DIRECT_OPENAI = false;
const DEV_OPENAI_MODEL = window.OPENAI_MODEL || "gpt-4o-mini";
const DEV_OPENAI_KEY = window.OPENAI_DEV_KEY || "";

// System prompt for DEV_DIRECT_OPENAI only
const DEV_SYSTEM_PROMPT = `
AI BLAKE – SON OF WISDOM COACH
TTS-SAFE • CONVERSATIONAL • DIAGNOSTIC-FIRST • SHORT RESPONSES • VARIATION • NO DEEP-DIVE
YOU ARE: AI BLAKE
`.trim();

/* ------------------------------ state -------------------------------- */
let session = null;
let sending = false;
let conversationId = null;

let recording = false;
let mediaStream = null;
let mediaRecorder = null;
let mediaChunks = [];
let chosenMime = { mime: "audio/webm;codecs=opus", ext: "webm" };

let voiceRepliesEnabled = false;

const contextState = {
  conversationTitle: "New conversation",
  lastMode: "chat",
  lastUsedKnowledge: false,
  lastUsedFileContext: false,
  attachedArtifacts: [],
  fileIndexingInFlight: false,
  lastUpdatedAt: null,
};

/* ------------------------------ UI refs ------------------------------- */
const refs = {
  chipsRow: $(".simple-chips"),
  chips: $$(".chip"),
  status: $("#status"),
  input: $("#q"),
  sendBtn: $("#btn-send"),
  callBtn: $("#btn-call"),
  filesBtn: $("#btn-files"),
  speakBtn: $("#btn-speak"),
  chatBox: $("#chat-box"),
  logoutBtn: $("#btn-logout"),
  hamburger: $("#btn-menu"),
  content: $(".content"),
  chatPanel: $("#chat-panel"),
};

/* =========================================================
   iOS Safari-safe audio playback
   ========================================================= */
const IS_IOS =
  /iPad|iPhone|iPod/i.test(navigator.userAgent || "") ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

let ttsPlayer = null;
let audioUnlocked = false;

function ensureSharedAudio() {
  if (ttsPlayer) return ttsPlayer;
  ttsPlayer = new Audio();
  ttsPlayer.preload = "auto";
  ttsPlayer.playsInline = true;
  ttsPlayer.crossOrigin = "anonymous";
  ttsPlayer.muted = false;
  ttsPlayer.volume = 1;
  return ttsPlayer;
}

// Must be called on a user gesture on iOS
async function unlockAudioSystem() {
  try {
    ensureSharedAudio();

    if (IS_IOS && !audioUnlocked) {
      const a = ensureSharedAudio();
      a.src =
        "data:audio/mp3;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCA" +
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
      a.volume = 0;
      await a.play().catch(() => {});
      a.pause();
      a.currentTime = 0;
      a.volume = 1;
      audioUnlocked = true;
    } else {
      audioUnlocked = true;
    }
  } catch {
    // ignore
  }
}

function base64ToBlobUrl(b64, mime = "audio/mpeg") {
  const raw = b64.includes(",") ? b64.split(",").pop() : b64;
  const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: mime || "audio/mpeg" });
  const url = URL.createObjectURL(blob);
  return { url, blob };
}

async function playAudioUrl(url) {
  const a = ensureSharedAudio();
  try {
    a.pause();
  } catch {}
  a.src = url;
  a.preload = "auto";
  try {
    const p = a.play();
    if (p?.catch) await p.catch(() => false);
    return true;
  } catch {
    return false;
  }
}

/* --------------------------- context strip ---------------------------- */
function ensureContextStrip() {
  if ($("#context-strip")) return $("#context-strip");

  const strip = document.createElement("section");
  strip.id = "context-strip";
  strip.setAttribute("aria-label", "Conversation context");
  strip.style.cssText = [
    "display:flex",
    "flex-wrap:wrap",
    "align-items:center",
    "gap:0.55rem",
    "margin:0 0 0.9rem",
    "padding:0.7rem 0.85rem",
    "border-radius:16px",
    "background:rgba(10,18,34,0.88)",
    "border:1px solid rgba(148,163,184,0.22)",
    "box-shadow:0 12px 32px rgba(0,0,0,0.35)",
  ].join(";");

  strip.innerHTML = `
    <div id="ctx-conversation" class="ctx-pill">Conversation: New conversation</div>
    <div id="ctx-memory" class="ctx-pill">Memory: on</div>
    <div id="ctx-kb" class="ctx-pill">KB: idle</div>
    <div id="ctx-files" class="ctx-pill">Artifacts: 0</div>
    <div id="ctx-voice" class="ctx-pill">Voice replies: off</div>
    <div id="ctx-mode" class="ctx-pill">Mode: chat</div>
  `;

  if (refs.chatPanel?.parentElement) {
    refs.chatPanel.parentElement.insertBefore(strip, refs.chatPanel);
  } else if (refs.content) {
    refs.content.appendChild(strip);
  } else {
    document.body.appendChild(strip);
  }

  addContextStripStyles();
  return strip;
}

function addContextStripStyles() {
  if ($("#context-strip-inline-styles")) return;

  const style = document.createElement("style");
  style.id = "context-strip-inline-styles";
  style.textContent = `
    #context-strip .ctx-pill{
      display:inline-flex;
      align-items:center;
      gap:.35rem;
      padding:.36rem .72rem;
      border-radius:999px;
      font-size:.78rem;
      line-height:1;
      color:#e5edf8;
      border:1px solid rgba(148,163,184,.24);
      background:rgba(15,23,42,.72);
      white-space:nowrap;
    }
    #context-strip .ctx-pill[data-state="active"]{
      border-color:rgba(246,201,121,.58);
      background:rgba(246,201,121,.12);
      color:#f6d99a;
    }
    #context-strip .ctx-pill[data-state="good"]{
      border-color:rgba(74,222,128,.5);
      background:rgba(74,222,128,.12);
      color:#baf5c8;
    }
    #context-strip .ctx-pill[data-state="warn"]{
      border-color:rgba(248,113,113,.55);
      background:rgba(248,113,113,.12);
      color:#fecaca;
    }
  `;
  document.head.appendChild(style);
}

function updateContextStrip() {
  ensureContextStrip();

  const convEl = $("#ctx-conversation");
  const memEl = $("#ctx-memory");
  const kbEl = $("#ctx-kb");
  const filesEl = $("#ctx-files");
  const voiceEl = $("#ctx-voice");
  const modeEl = $("#ctx-mode");

  if (convEl) {
    convEl.textContent = `Conversation: ${
      contextState.conversationTitle || "New conversation"
    }`;
  }

  if (memEl) {
    memEl.textContent = "Memory: on";
    memEl.dataset.state = "good";
  }

  if (kbEl) {
    kbEl.textContent = `KB: ${
      contextState.lastUsedKnowledge ? "used" : "idle"
    }`;
    kbEl.dataset.state = contextState.lastUsedKnowledge ? "active" : "";
  }

  if (filesEl) {
    const count = contextState.attachedArtifacts.length || 0;
    const suffix = contextState.fileIndexingInFlight ? " (indexing…)" : "";
    filesEl.textContent = `Artifacts: ${count}${suffix}`;
    filesEl.dataset.state =
      count > 0 ? (contextState.lastUsedFileContext ? "active" : "good") : "";
  }

  if (voiceEl) {
    voiceEl.textContent = `Voice replies: ${voiceRepliesEnabled ? "on" : "off"}`;
    voiceEl.dataset.state = voiceRepliesEnabled ? "active" : "";
  }

  if (modeEl) {
    modeEl.textContent = `Mode: ${contextState.lastMode || "chat"}`;
    modeEl.dataset.state =
      contextState.lastMode === "files" || contextState.lastMode === "voice"
        ? "active"
        : "";
  }
}

/* ---------------------------- UI helpers ------------------------------ */
function setStatus(text, isError = false) {
  if (!refs.status) return;
  refs.status.textContent = text || "";
  refs.status.dataset.kind = isError ? "error" : "normal";
}

function setSendingState(flag) {
  sending = !!flag;
  if (refs.sendBtn) refs.sendBtn.disabled = sending;
  if (refs.filesBtn) refs.filesBtn.disabled = sending;
  if (refs.speakBtn) refs.speakBtn.disabled = sending;
  if (refs.input) refs.input.disabled = sending;
}

function scrollChatToBottom() {
  if (!refs.chatBox) return;
  const scroller = refs.chatBox.parentElement || refs.chatBox;
  scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
}

function updateBubbleText(bubbleRef, text) {
  if (!bubbleRef?.bubble) return;
  bubbleRef.bubble.textContent = text || "";
  scrollChatToBottom();
}

function appendBubble(role, text, { audio } = {}) {
  if (!refs.chatBox) return null;

  const wrap = document.createElement("div");
  wrap.className = `bubble-wrap ${role}`;

  const bubble = document.createElement("div");
  bubble.className = `bubble ${role}`;
  bubble.textContent = text || "";

  wrap.appendChild(bubble);

  if (audio?.url) {
    const row = document.createElement("div");
    row.className = "bubble-audio-row";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bubble-audio-btn";
    btn.textContent = "Play voice";
    btn.addEventListener("click", async () => {
      await unlockAudioSystem();
      await playAudioUrl(audio.url);
    });

    row.appendChild(btn);
    wrap.appendChild(row);
  }

  refs.chatBox.appendChild(wrap);
  scrollChatToBottom();

  return { wrap, bubble };
}

/* ------------------------- conversation utils ------------------------- */
function getConversationIdFromUrl() {
  const url = new URL(window.location.href);
  return url.searchParams.get("c") || null;
}

function setConversationIdInUrl(id) {
  if (!id) return;
  const url = new URL(window.location.href);
  url.searchParams.set("c", id);
  window.history.replaceState({}, "", url.toString());
}

function getDeviceId() {
  const key = "sow_device_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto?.randomUUID?.() || `dev_${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(key, id);
  }
  return id;
}

async function ensureConversation() {
  if (conversationId) return conversationId;

  const userId = session?.user?.id;
  if (!userId) throw new Error("No authenticated user");

  const { data, error } = await supabase
    .from("conversations")
    .insert([
      {
        user_id: userId,
        title: "New Conversation",
        summary: null,
      },
    ])
    .select("id, title")
    .single();

  if (error) throw error;

  conversationId = data?.id || null;
  contextState.conversationTitle = data?.title || "New conversation";
  setConversationIdInUrl(conversationId);
  updateContextStrip();

  return conversationId;
}

async function refreshConversationTitle() {
  if (!conversationId) return;

  try {
    const { data, error } = await supabase
      .from("conversations")
      .select("title, updated_at")
      .eq("id", conversationId)
      .single();

    if (error) return;

    contextState.conversationTitle =
      String(data?.title || "").trim() || "New conversation";
    contextState.lastUpdatedAt = data?.updated_at || null;
    updateContextStrip();
  } catch {
    // ignore
  }
}

/* -------------------- load previous messages -------------------- */
async function loadConversationHistory(convId) {
  if (!convId || !refs.chatBox) return;

  try {
    setStatus("Loading conversation…");

    const { data, error } = await supabase
      .from("conversation_messages")
      .select("role, content, created_at")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[HOME] loadConversationHistory error:", error);
      setStatus("Could not load previous messages.", true);
      return;
    }

    refs.chatBox.innerHTML = "";

    (data || []).forEach((row) => {
      const bubbleRole = row.role === "assistant" ? "ai" : "user";
      appendBubble(bubbleRole, row.content || "");
    });

    await refreshConversationTitle();
    setStatus("Ready.");
  } catch (err) {
    console.error("[HOME] loadConversationHistory failed:", err);
    setStatus("Could not load previous messages.", true);
  }
}

/* ---------------------------- networking ------------------------------ */
async function coachRequest({ text, source = "chat", wantAudio = false, extra = {} }) {
  if (DEV_DIRECT_OPENAI) {
    const reply = await chatDirectOpenAI(text, extra);
    return {
      assistant_text: reply,
      audio_base64: null,
      mime: null,
      usedKnowledge: false,
      usedFileContext: false,
      conversationId: conversationId || null,
    };
  }

  const payload = {
    source,
    conversationId: conversationId || null,
    transcript: text,
    utterance: text,
    user_turn: text,
    user_id: session?.user?.id || session?.user?.email || "",
    device_id: localStorage.getItem("sow_device_id") || "",
    want_audio: !!wantAudio,
    ...extra,
  };

  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Coach ${res.status}: ${t || res.statusText}`);
  }

  const data = await res.json().catch(() => ({}));

  return {
    assistant_text: data.assistant_text ?? data.text ?? data.reply ?? "",
    audio_base64: data.audio_base64 ?? null,
    mime: data.mime ?? data.audio_mime ?? "audio/mpeg",
    usedKnowledge: !!data.usedKnowledge,
    usedFileContext: !!data.usedFileContext,
    conversationId: data.conversationId ?? conversationId ?? null,
    audio_missing: !!data.audio_missing,
    audio_error: data.audio_error ?? null,
  };
}

async function chatDirectOpenAI(text, meta = {}) {
  const key = (DEV_OPENAI_KEY || "").trim();
  if (!key) {
    throw new Error(
      "Missing OpenAI key. For dev-only browser calls, set window.OPENAI_DEV_KEY in app/dev-local.js."
    );
  }

  const systemPrompt = meta.system || DEV_SYSTEM_PROMPT;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: DEV_OPENAI_MODEL,
      temperature: 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: String(text || "").trim() },
      ],
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${t || res.statusText}`);
  }

  const data = await res.json().catch(() => ({}));
  return data?.choices?.[0]?.message?.content?.trim() || "";
}

/* ------------------------ speak / transcription ----------------------- */
function detectRecordingMime() {
  const candidates = [
    { mime: "audio/webm;codecs=opus", ext: "webm" },
    { mime: "audio/webm", ext: "webm" },
    { mime: "audio/mp4", ext: "m4a" },
    { mime: "audio/ogg;codecs=opus", ext: "ogg" },
  ];

  for (const c of candidates) {
    if (window.MediaRecorder?.isTypeSupported?.(c.mime)) return c;
  }

  return { mime: "", ext: "webm" };
}

async function ensureMicStream() {
  if (mediaStream) return mediaStream;

  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  return mediaStream;
}

async function startRecording() {
  if (recording) return;

  await unlockAudioSystem();
  await ensureMicStream();

  chosenMime = detectRecordingMime();
  mediaChunks = [];

  mediaRecorder = new MediaRecorder(
    mediaStream,
    chosenMime.mime ? { mimeType: chosenMime.mime } : undefined
  );

  mediaRecorder.ondataavailable = (e) => {
    if (e.data?.size > 0) mediaChunks.push(e.data);
  };

  mediaRecorder.start();
  recording = true;

  refs.speakBtn?.classList.add("recording");
  refs.speakBtn && (refs.speakBtn.textContent = "Stop");
  setStatus("Recording…");
}

async function stopRecording() {
  if (!recording || !mediaRecorder) return null;

  return new Promise((resolve) => {
    mediaRecorder.onstop = async () => {
      recording = false;
      refs.speakBtn?.classList.remove("recording");
      refs.speakBtn && (refs.speakBtn.textContent = "Speak");

      const blob = new Blob(mediaChunks, {
        type: chosenMime.mime || "audio/webm",
      });

      mediaChunks = [];
      resolve(blob);
    };

    try {
      mediaRecorder.stop();
    } catch {
      recording = false;
      refs.speakBtn?.classList.remove("recording");
      refs.speakBtn && (refs.speakBtn.textContent = "Speak");
      resolve(null);
    }
  });
}

async function transcribeAudio(blob) {
  if (!blob) return "";

  const fd = new FormData();
  fd.append("audio", blob, `user.${chosenMime.ext || "webm"}`);
  fd.append("model", "gpt-4o-mini-transcribe");
  fd.append("response_format", "json");

  const res = await fetch(TRANSCRIBE_URL, {
    method: "POST",
    body: fd,
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Transcribe ${res.status}: ${t || res.statusText}`);
  }

  const data = await res.json().catch(() => ({}));
  return String(data?.text || data?.transcript || "").trim();
}

/* ----------------------------- files flow ----------------------------- */
function pickFileOnce() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,.txt,text/plain,application/pdf";
    input.style.display = "none";
    document.body.appendChild(input);

    input.value = "";
    const onChange = () => {
      input.removeEventListener("change", onChange);
      const f = input.files?.[0] || null;
      input.remove();
      resolve(f);
    };

    input.addEventListener("change", onChange, { once: true });
    input.click();
  });
}

async function uploadFileToStorage(file) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("user_id", session?.user?.id || session?.user?.email || "anon");
  fd.append("conversation_id", conversationId || "");
  fd.append("device_id", localStorage.getItem("sow_device_id") || "");
  fd.append("page", "home");
  fd.append("timestamp", new Date().toISOString());

  const res = await fetch(UPLOAD_URL, { method: "POST", body: fd });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Upload ${res.status}: ${t || res.statusText}`);
  }

  return await res.json().catch(() => ({}));
}

async function extractFileText(file) {
  const fd = new FormData();
  fd.append("file", file);

  const res = await fetch(EXTRACT_URL, { method: "POST", body: fd });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Extract ${res.status}: ${t || res.statusText}`);
  }
  return await res.json().catch(() => ({}));
}

function buildFilePrompt({ fileName, text, pages }) {
  const safeName = fileName || "file";
  const pageNote = pages ? ` (${pages} pages)` : "";

  return `
You received an uploaded file: "${safeName}"${pageNote}.

Do these:
1) Give a concise summary (5-10 bullets).
2) Pull out key takeaways and action items.
3) If it's a contract, policy, or plan, list risks and missing info.
4) End with 3 questions to ask the user next.

File text:
${text}
`.trim();
}

async function processUploadIndex(meta) {
  const payload = {
    storage_path: meta.storage_path || meta.path || meta.storagePath || "",
    filename: meta.filename || meta.fileName || "",
    content_type: meta.content_type || meta.mime || meta.contentType || "",
    bytes: meta.bytes || meta.size || null,
    conversation_id: conversationId,
    user_id: session?.user?.id || session?.user?.email || null,
    bucket: meta.bucket || "uploads",
  };

  const res = await fetch(PROCESS_UPLOAD_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Process-upload ${res.status}: ${t || res.statusText}`);
  }

  return await res.json().catch(() => ({}));
}

function addArtifact(meta) {
  const cleanName = String(meta?.filename || meta?.fileName || "").trim();
  if (!cleanName) return;

  const exists = contextState.attachedArtifacts.some(
    (a) => a.filename === cleanName
  );
  if (exists) return;

  contextState.attachedArtifacts.push({
    filename: cleanName,
    content_type: meta?.content_type || meta?.mime || null,
    bytes: meta?.bytes || meta?.size || null,
  });

  updateContextStrip();
}

async function handleFilesClick() {
  if (sending) return;

  await unlockAudioSystem();
  await ensureConversation();

  const file = await pickFileOnce();
  if (!file) return;

  contextState.lastMode = "files";
  updateContextStrip();

  appendBubble("user", `Uploaded: ${file.name}`);
  const aiBubble = appendBubble("ai", "Uploading your file…");

  setSendingState(true);
  setStatus("Processing file…");

  let audioUrlToRevoke = null;

  try {
    updateBubbleText(aiBubble, "Uploading…");
    const uploaded = await uploadFileToStorage(file);

    addArtifact({
      filename: uploaded.filename || file.name,
      content_type: uploaded.content_type || file.type,
      bytes: uploaded.bytes || file.size,
    });

    contextState.fileIndexingInFlight = true;
    updateContextStrip();

    (async () => {
      try {
        await processUploadIndex({
          bucket: uploaded.bucket || "uploads",
          storage_path: uploaded.storage_path || uploaded.path,
          filename: uploaded.filename || file.name,
          content_type: uploaded.content_type || file.type,
          bytes: uploaded.bytes || file.size,
        });
        console.log("[HOME] process-upload OK");
      } catch (e) {
        console.warn("[HOME] process-upload failed (non-blocking):", e);
      } finally {
        contextState.fileIndexingInFlight = false;
        updateContextStrip();
      }
    })();

    updateBubbleText(aiBubble, "Reading text…");
    const extracted = await extractFileText(file);
    const text = String(extracted?.text || "").trim();

    if (!text) {
      updateBubbleText(aiBubble, "I couldn’t find readable text in that file.");
      setStatus("No readable text found.", true);
      return;
    }

    updateBubbleText(aiBubble, "Summarizing…");

    const wantAudio = !!voiceRepliesEnabled;
    const prompt = buildFilePrompt({
      fileName: extracted?.fileName || file.name,
      text,
      pages: extracted?.pages || null,
    });

    const res = await coachRequest({
      text: prompt,
      source: wantAudio ? "voice" : "chat",
      wantAudio,
      extra: {
        email: session?.user?.email ?? null,
        page: "home",
        input_mode: "files",
        file_name: file.name,
        file_type: file.type || null,
        extracted_pages: extracted?.pages ?? null,
        extracted_chars: extracted?.chars ?? null,
        timestamp: new Date().toISOString(),
      },
    });

    contextState.lastUsedKnowledge = !!res.usedKnowledge;
    contextState.lastUsedFileContext = !!res.usedFileContext;
    contextState.lastMode = "files";
    updateContextStrip();

    updateBubbleText(aiBubble, res.assistant_text || "…");

    if (res.audio_base64 && wantAudio) {
      const { url } = base64ToBlobUrl(res.audio_base64, res.mime || "audio/mpeg");
      audioUrlToRevoke = url;

      const audioRow = document.createElement("div");
      audioRow.className = "bubble-audio-row";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bubble-audio-btn";
      btn.textContent = "Play voice";
      btn.addEventListener("click", async () => {
        await unlockAudioSystem();
        await playAudioUrl(url);
      });

      audioRow.appendChild(btn);
      aiBubble?.wrap?.appendChild(audioRow);

      await playAudioUrl(url);
    }

    await refreshConversationTitle();
    setStatus("Ready.");
  } catch (err) {
    console.error("[HOME] file flow error:", err);
    updateBubbleText(aiBubble, "Sorry — I couldn’t process that file.");
    setStatus("File processing failed. Try again.", true);
  } finally {
    setSendingState(false);
    if (audioUrlToRevoke) {
      setTimeout(() => URL.revokeObjectURL(audioUrlToRevoke), 60_000);
    }
  }
}

/* ---------------------------- main chat send -------------------------- */
async function sendCurrentInput() {
  if (sending) return;

  const text = String(refs.input?.value || "").trim();
  if (!text) return;

  await unlockAudioSystem();
  await ensureConversation();

  refs.input.value = "";
  appendBubble("user", text);

  const aiBubble = appendBubble("ai", "Thinking…");
  setSendingState(true);
  setStatus("Thinking…");

  let audioUrlToRevoke = null;

  try {
    const wantAudio = !!voiceRepliesEnabled;

    const res = await coachRequest({
      text,
      source: wantAudio ? "voice" : "chat",
      wantAudio,
      extra: {
        email: session?.user?.email ?? null,
        page: "home",
        input_mode: "text",
        timestamp: new Date().toISOString(),
      },
    });

    contextState.lastUsedKnowledge = !!res.usedKnowledge;
    contextState.lastUsedFileContext = !!res.usedFileContext;
    contextState.lastMode = wantAudio ? "voice" : "chat";

    if (res.conversationId && !conversationId) {
      conversationId = res.conversationId;
      setConversationIdInUrl(conversationId);
    }

    updateContextStrip();
    updateBubbleText(aiBubble, res.assistant_text || "…");

    if (res.audio_base64 && wantAudio) {
      const { url } = base64ToBlobUrl(res.audio_base64, res.mime || "audio/mpeg");
      audioUrlToRevoke = url;

      const audioRow = document.createElement("div");
      audioRow.className = "bubble-audio-row";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bubble-audio-btn";
      btn.textContent = "Play voice";
      btn.addEventListener("click", async () => {
        await unlockAudioSystem();
        await playAudioUrl(url);
      });

      audioRow.appendChild(btn);
      aiBubble?.wrap?.appendChild(audioRow);

      await playAudioUrl(url);
    }

    await refreshConversationTitle();
    setStatus("Ready.");
  } catch (err) {
    console.error("[HOME] sendCurrentInput error:", err);
    updateBubbleText(aiBubble, "Sorry — something went wrong.");
    setStatus("Request failed. Try again.", true);
  } finally {
    setSendingState(false);
    if (audioUrlToRevoke) {
      setTimeout(() => URL.revokeObjectURL(audioUrlToRevoke), 60_000);
    }
  }
}

/* ------------------------------ speak flow ---------------------------- */
async function handleSpeakClick() {
  await unlockAudioSystem();

  if (!recording) {
    try {
      await startRecording();
    } catch (err) {
      console.error("[HOME] startRecording error:", err);
      setStatus("Mic permission denied or unavailable.", true);
    }
    return;
  }

  try {
    const blob = await stopRecording();
    if (!blob) {
      setStatus("No audio captured.", true);
      return;
    }

    setStatus("Transcribing…");
    const text = await transcribeAudio(blob);

    if (!text) {
      setStatus("I couldn’t hear anything clear.", true);
      return;
    }

    refs.input.value = text;
    await sendCurrentInput();
  } catch (err) {
    console.error("[HOME] handleSpeakClick error:", err);
    setStatus("Voice input failed. Try again.", true);
  }
}

/* ---------------------------- auth / boot ----------------------------- */
async function handleLogout() {
  try {
    await supabase.auth.signOut();
  } catch (err) {
    console.warn("[HOME] signOut warning:", err);
  } finally {
    window.location.href = "auth.html";
  }
}

function bindUI() {
  refs.sendBtn?.addEventListener("click", sendCurrentInput);

  refs.input?.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      await sendCurrentInput();
    }
  });

  refs.filesBtn?.addEventListener("click", handleFilesClick);
  refs.speakBtn?.addEventListener("click", handleSpeakClick);

  refs.callBtn?.addEventListener("click", () => {
    const url = new URL("call.html", window.location.origin);
    if (conversationId) url.searchParams.set("c", conversationId);
    window.location.href = url.toString();
  });

  refs.logoutBtn?.addEventListener("click", handleLogout);

  refs.hamburger?.addEventListener("click", () => {
    const url = new URL("history.html", window.location.origin);
    if (conversationId) url.searchParams.set("c", conversationId);
    window.location.href = url.toString();
  });

  refs.chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const fill = chip.getAttribute("data-fill") || chip.textContent || "";
      if (refs.input) refs.input.value = String(fill).trim();
      refs.input?.focus();
    });
  });

  refs.input?.addEventListener("focus", () => unlockAudioSystem().catch(() => {}));

  // Double-click the Speak button to toggle voice replies on/off.
  refs.speakBtn?.addEventListener("dblclick", () => {
    voiceRepliesEnabled = !voiceRepliesEnabled;
    contextState.lastMode = voiceRepliesEnabled ? "voice" : "chat";
    updateContextStrip();
    setStatus(
      voiceRepliesEnabled ? "Voice replies enabled." : "Voice replies disabled."
    );
  });
}

async function boot() {
  try {
    ensureContextStrip();
    updateContextStrip();

    await ensureAuthedOrRedirect();
    session = await getSession();

    if (!session?.user) {
      window.location.href = "auth.html";
      return;
    }

    conversationId = getConversationIdFromUrl();

    bindUI();

    if (conversationId) {
      await loadConversationHistory(conversationId);
    } else {
      setStatus("Signed in. How can I help?");
    }

    await refreshConversationTitle();
    updateContextStrip();
  } catch (err) {
    console.error("[HOME] boot error:", err);
    setStatus("Could not load the page.", true);
  }
}

boot();