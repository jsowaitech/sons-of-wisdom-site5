// app/home.js
// Son of Wisdom — Home page controller
// Orchestration only.
// UI rendering lives in home-ui.js.
// Media/file/audio helpers live in home-media.js.
// Network/data calls live in home-api.js.

sessionStorage.removeItem("sow_redirected");

import { supabase, ensureAuthedOrRedirect, getSession } from "./supabase.js";
import { createHomeUI } from "./home-ui.js";
import { createHomeMedia } from "./home-media.js";
import { createHomeApi } from "./home-api.js";

/* -------------------------- tiny DOM helpers -------------------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ------------------------------ config -------------------------------- */
const CHAT_URL = "/.netlify/functions/call-coach";
const TRANSCRIBE_URL = "/.netlify/functions/openai-transcribe";
const UPLOAD_URL = "/.netlify/functions/upload-file";
const EXTRACT_URL = "/.netlify/functions/file-extract";
const PROCESS_UPLOAD_URL = "/.netlify/functions/process-upload";

const DEV_DIRECT_OPENAI = false;
const DEV_OPENAI_MODEL = window.OPENAI_MODEL || "gpt-4o-mini";
const DEV_OPENAI_KEY = window.OPENAI_DEV_KEY || "";

const DEV_SYSTEM_PROMPT = `
AI BLAKE – SON OF WISDOM COACH
TTS-SAFE • CONVERSATIONAL • DIAGNOSTIC-FIRST • SHORT RESPONSES • VARIATION • NO DEEP-DIVE
YOU ARE: AI BLAKE
`.trim();

/* ------------------------------ state -------------------------------- */
let session = null;
let sending = false;
let conversationId = null;
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

const ui = createHomeUI(refs, contextState, () => voiceRepliesEnabled);

const media = createHomeMedia({
  transcribeUrl: TRANSCRIBE_URL,
  uploadUrl: UPLOAD_URL,
  extractUrl: EXTRACT_URL,
  processUploadUrl: PROCESS_UPLOAD_URL,
});

const api = createHomeApi({
  supabase,
  chatUrl: CHAT_URL,
  devDirectOpenAI: DEV_DIRECT_OPENAI,
  devOpenAIModel: DEV_OPENAI_MODEL,
  devOpenAIKey: DEV_OPENAI_KEY,
  devSystemPrompt: DEV_SYSTEM_PROMPT,
});

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

  const data = await api.createConversation(userId);

  conversationId = data?.id || null;
  contextState.conversationTitle = data?.title || "New conversation";
  setConversationIdInUrl(conversationId);
  ui.refreshContextUI();

  return conversationId;
}

async function refreshConversationTitle() {
  if (!conversationId) return;

  try {
    const data = await api.fetchConversation(conversationId);
    contextState.conversationTitle =
      String(data?.title || "").trim() || "New conversation";
    contextState.lastUpdatedAt = data?.updated_at || null;
    ui.refreshContextUI();
  } catch (err) {
    console.warn("[HOME] refreshConversationTitle failed:", err);
  }
}

async function hydrateConversationArtifacts() {
  if (!conversationId) return;

  try {
    const data = await api.fetchConversationDocuments(conversationId);
    contextState.attachedArtifacts = (data || []).map((row) => ({
      filename: row.filename || "file",
      content_type: row.content_type || null,
      bytes: row.bytes || null,
      created_at: row.created_at || null,
    }));
    ui.refreshContextUI();
  } catch (err) {
    console.warn("[HOME] hydrateConversationArtifacts failed:", err);
  }
}

async function hydrateConversationMeta() {
  await refreshConversationTitle();
  await hydrateConversationArtifacts();
}

/* -------------------- load previous messages -------------------- */
async function loadConversationHistory(convId) {
  if (!convId || !refs.chatBox) return;

  try {
    ui.setStatus("Loading conversation…");

    const data = await api.fetchConversationMessages(convId);
    refs.chatBox.innerHTML = "";

    (data || []).forEach((row) => {
      const bubbleRole = row.role === "assistant" ? "ai" : "user";
      ui.appendBubble(bubbleRole, row.content || "");
    });

    await hydrateConversationMeta();
    ui.setStatus("Ready.");
  } catch (err) {
    console.error("[HOME] loadConversationHistory failed:", err);
    ui.setStatus("Could not load previous messages.", true);
  }
}

/* ----------------------------- helpers ----------------------------- */
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
    created_at: new Date().toISOString(),
  });

  ui.refreshContextUI();
}

function setRecordingUi(flag) {
  if (flag) {
    refs.speakBtn?.classList.add("recording");
    if (refs.speakBtn) refs.speakBtn.textContent = "Stop";
    ui.setStatus("Recording…");
  } else {
    refs.speakBtn?.classList.remove("recording");
    if (refs.speakBtn) refs.speakBtn.textContent = "Speak";
  }
}

function appendFileNotice(filename) {
  ui.appendBubble("user", `Uploaded: ${filename}`);
}

/* ----------------------------- files flow ----------------------------- */
async function handleFilesClick() {
  if (sending) return;

  await media.unlockAudioSystem();
  await ensureConversation();

  const file = await media.pickFileOnce();
  if (!file) return;

  contextState.lastMode = "files";
  ui.refreshContextUI();

  appendFileNotice(file.name);
  const aiBubble = ui.appendBubble("ai", "Checking your file…");

  if (!media.isPdfOrTextFile(file) && !media.isImageFile(file)) {
    ui.updateBubbleText(
      aiBubble,
      "That file type is not supported in this flow yet. Please upload a PDF, TXT, JPG, JPEG, or PNG file."
    );
    ui.setStatus("Unsupported file type.", true);
    return;
  }

  sending = true;
  ui.setSendingState(true);
  ui.setStatus("Processing file…");

  let audioUrlToRevoke = null;

  try {
    ui.updateBubbleText(
      aiBubble,
      media.isImageFile(file) ? "Uploading your image…" : "Uploading…"
    );

    const uploaded = await media.uploadFileToStorage(file, {
      user_id: session?.user?.id || session?.user?.email || "anon",
      conversation_id: conversationId || "",
      device_id: localStorage.getItem("sow_device_id") || "",
      page: "home",
      timestamp: new Date().toISOString(),
    });

    addArtifact({
      filename: uploaded.filename || file.name,
      content_type: uploaded.content_type || file.type,
      bytes: uploaded.bytes || file.size,
    });

    contextState.fileIndexingInFlight = true;
    ui.refreshContextUI();

    (async () => {
      try {
        await media.processUploadIndex({
          bucket: uploaded.bucket || "uploads",
          storage_path: uploaded.storage_path || uploaded.path,
          filename: uploaded.filename || file.name,
          content_type: uploaded.content_type || file.type,
          bytes: uploaded.bytes || file.size,
          conversation_id: conversationId,
          user_id: session?.user?.id || session?.user?.email || null,
        });
        console.log("[HOME] process-upload OK");
      } catch (e) {
        console.warn("[HOME] process-upload failed (non-blocking):", e);
      } finally {
        contextState.fileIndexingInFlight = false;
        await hydrateConversationArtifacts();
        ui.refreshContextUI();
      }
    })();

    ui.updateBubbleText(
      aiBubble,
      media.isImageFile(file) ? "Reading the image…" : "Reading text…"
    );

    const extracted = await media.extractFileText(file);
    const text = String(extracted?.text || "").trim();
    const isImageFlow = media.isImageFile(file) || extracted?.kind === "image";

    if (!text) {
      ui.updateBubbleText(
        aiBubble,
        "I uploaded that file, but I could not extract enough readable content from it. Try a clearer screenshot, a cleaner PDF, or a text file."
      );
      ui.setStatus("No readable text found.", true);
      return;
    }

    ui.updateBubbleText(
      aiBubble,
      isImageFlow ? "Understanding the screenshot…" : "Summarizing…"
    );

    const wantAudio = !!voiceRepliesEnabled;
    const prompt = isImageFlow
      ? media.buildImageCoachingPrompt({
          fileName: extracted?.fileName || file.name,
          text,
        })
      : media.buildFilePrompt({
          fileName: extracted?.fileName || file.name,
          text,
          pages: extracted?.pages || null,
        });

    const res = await api.coachRequest({
      text: prompt,
      source: wantAudio ? "voice" : "chat",
      wantAudio,
      conversationId,
      userId: session?.user?.id || session?.user?.email || "",
      deviceId: localStorage.getItem("sow_device_id") || "",
      extra: {
        email: session?.user?.email ?? null,
        page: "home",
        input_mode: isImageFlow ? "image" : "files",
        file_name: file.name,
        file_type: file.type || null,
        extracted_pages: extracted?.pages ?? null,
        extracted_chars: extracted?.chars ?? null,
        extracted_kind: extracted?.kind ?? null,
        timestamp: new Date().toISOString(),
      },
    });

    contextState.lastUsedKnowledge = !!res.usedKnowledge;
    contextState.lastUsedFileContext = !!res.usedFileContext;
    contextState.lastMode = "files";
    ui.refreshContextUI();

    ui.updateBubbleText(aiBubble, res.assistant_text || "…");
    ui.addAssistantSourceMarkers(aiBubble, {
      usedKnowledge: !!res.usedKnowledge,
      usedFileContext: !!res.usedFileContext,
    });

    if (res.audio_base64 && wantAudio) {
      const { url } = media.base64ToBlobUrl(
        res.audio_base64,
        res.mime || "audio/mpeg"
      );
      audioUrlToRevoke = url;

      const audioRow = document.createElement("div");
      audioRow.className = "bubble-audio-row";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bubble-audio-btn";
      btn.textContent = "Play voice";
      btn.addEventListener("click", async () => {
        await media.unlockAudioSystem();
        await media.playAudioUrl(url);
      });

      audioRow.appendChild(btn);
      aiBubble?.wrap?.appendChild(audioRow);

      await media.playAudioUrl(url);
    }

    await hydrateConversationMeta();
    ui.setStatus("Ready.");
  } catch (err) {
    console.error("[HOME] file flow error:", err);
    ui.updateBubbleText(
      aiBubble,
      "Sorry — I could not process that file. Try a clearer screenshot, a smaller PDF, or a cleaner text file."
    );
    ui.setStatus("File processing failed. Try again.", true);
  } finally {
    sending = false;
    ui.setSendingState(false);
    if (audioUrlToRevoke) {
      setTimeout(() => URL.revokeObjectURL(audioUrlToRevoke), 60000);
    }
  }
}

/* ---------------------------- main chat send -------------------------- */
async function sendCurrentInput() {
  if (sending) return;

  const text = String(refs.input?.value || "").trim();
  if (!text) return;

  await media.unlockAudioSystem();
  await ensureConversation();

  refs.input.value = "";
  ui.appendBubble("user", text);

  const aiBubble = ui.appendBubble("ai", "Thinking…");
  sending = true;
  ui.setSendingState(true);
  ui.setStatus("Thinking…");

  let audioUrlToRevoke = null;

  try {
    const wantAudio = !!voiceRepliesEnabled;

    const res = await api.coachRequest({
      text,
      source: wantAudio ? "voice" : "chat",
      wantAudio,
      conversationId,
      userId: session?.user?.id || session?.user?.email || "",
      deviceId: localStorage.getItem("sow_device_id") || "",
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

    ui.refreshContextUI();
    ui.updateBubbleText(aiBubble, res.assistant_text || "…");
    ui.addAssistantSourceMarkers(aiBubble, {
      usedKnowledge: !!res.usedKnowledge,
      usedFileContext: !!res.usedFileContext,
    });

    if (res.audio_base64 && wantAudio) {
      const { url } = media.base64ToBlobUrl(
        res.audio_base64,
        res.mime || "audio/mpeg"
      );
      audioUrlToRevoke = url;

      const audioRow = document.createElement("div");
      audioRow.className = "bubble-audio-row";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bubble-audio-btn";
      btn.textContent = "Play voice";
      btn.addEventListener("click", async () => {
        await media.unlockAudioSystem();
        await media.playAudioUrl(url);
      });

      audioRow.appendChild(btn);
      aiBubble?.wrap?.appendChild(audioRow);

      await media.playAudioUrl(url);
    }

    await hydrateConversationMeta();
    ui.setStatus("Ready.");
  } catch (err) {
    console.error("[HOME] sendCurrentInput error:", err);
    ui.updateBubbleText(aiBubble, "Sorry — something went wrong.");
    ui.setStatus("Request failed. Try again.", true);
  } finally {
    sending = false;
    ui.setSendingState(false);
    if (audioUrlToRevoke) {
      setTimeout(() => URL.revokeObjectURL(audioUrlToRevoke), 60000);
    }
  }
}

/* ------------------------------ speak flow ---------------------------- */
async function handleSpeakClick() {
  await media.unlockAudioSystem();

  if (!media.getRecordingState()) {
    try {
      await media.startRecording(setRecordingUi);
    } catch (err) {
      console.error("[HOME] startRecording error:", err);
      ui.setStatus("Mic permission denied or unavailable.", true);
    }
    return;
  }

  try {
    const blob = await media.stopRecording(setRecordingUi);
    if (!blob) {
      ui.setStatus("No audio captured.", true);
      return;
    }

    ui.setStatus("Transcribing…");
    const text = await media.transcribeAudio(blob);

    if (!text) {
      ui.setStatus("I couldn’t hear anything clear.", true);
      return;
    }

    refs.input.value = text;
    await sendCurrentInput();
  } catch (err) {
    console.error("[HOME] handleSpeakClick error:", err);
    ui.setStatus("Voice input failed. Try again.", true);
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

  refs.input?.addEventListener("focus", () => {
    media.unlockAudioSystem().catch(() => {});
  });

  refs.speakBtn?.addEventListener("dblclick", () => {
    voiceRepliesEnabled = !voiceRepliesEnabled;
    contextState.lastMode = voiceRepliesEnabled ? "voice" : "chat";
    ui.refreshContextUI();
    ui.setStatus(
      voiceRepliesEnabled ? "Voice replies enabled." : "Voice replies disabled."
    );
  });
}

async function boot() {
  try {
    ui.ensureContextStrip();
    ui.ensureArtifactRail();
    ui.refreshContextUI();

    await ensureAuthedOrRedirect();
    session = await getSession();

    if (!session?.user) {
      window.location.href = "auth.html";
      return;
    }

    getDeviceId();
    conversationId = getConversationIdFromUrl();

    bindUI();

    if (conversationId) {
      await loadConversationHistory(conversationId);
    } else {
      ui.setStatus("Signed in. How can I help?");
    }

    await hydrateConversationMeta();
    ui.refreshContextUI();
  } catch (err) {
    console.error("[HOME] boot error:", err);
    ui.setStatus("Could not load the page.", true);
  }
}

boot();