// app/home.js
sessionStorage.removeItem("sow_redirected");

import { supabase, ensureAuthedOrRedirect, getSession } from "./supabase.js";
import { createHomeUI } from "./home-ui.js";
import { createHomeMedia } from "./home-media.js";
import { createHomeApi } from "./home-api.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const CHAT_URL = "/.netlify/functions/call-coach";
const TRANSCRIBE_URL = "/.netlify/functions/openai-transcribe";
const UPLOAD_URL = "/.netlify/functions/upload-file";
const EXTRACT_URL = "/.netlify/functions/file-extract";
const PROCESS_UPLOAD_URL = "/.netlify/functions/process-upload";

const HOME_VERSION = "home-artifact-ux-v3";
window.SOW_HOME_VERSION = HOME_VERSION;
console.log("[HOME] version:", HOME_VERSION);

const DEV_DIRECT_OPENAI = false;
const DEV_OPENAI_MODEL = window.OPENAI_MODEL || "gpt-4o-mini";
const DEV_OPENAI_KEY = window.OPENAI_DEV_KEY || "";

const DEV_SYSTEM_PROMPT = `
AI BLAKE – SON OF WISDOM COACH
TTS-SAFE • CONVERSATIONAL • DIAGNOSTIC-FIRST • SHORT RESPONSES • VARIATION • NO DEEP-DIVE
YOU ARE: AI BLAKE
`.trim();

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

function appendFileNotice(filename, kind = "file") {
  const label =
    typeof media.buildArtifactUserLabel === "function"
      ? media.buildArtifactUserLabel({ fileName: filename, kind })
      : `Uploaded ${kind}: ${filename}`;

  ui.appendBubble("user", label);
}

async function handleFilesClick() {
  if (sending) return;

  await media.unlockAudioSystem();
  await ensureConversation();

  const file = await media.pickFileOnce();
  if (!file) return;

  contextState.lastMode = "files";
  ui.refreshContextUI();

  appendFileNotice(file.name, media.isImageFile(file) ? "image" : "file");
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
  ui.setStatus("Processing upload…");

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
      media.isImageFile(file) ? "Reading the screenshot or image…" : "Reading the document…"
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
      isImageFlow ? "Understanding the image content…" : "Understanding the document…"
    );

    let artifactMode = isImageFlow
      ? media.classifyImageText(text, extracted?.fileName || file.name)
      : media.classifyDocumentText(text, extracted?.fileName || file.name);

    const artifactFamily = isImageFlow ? "image" : "document";

    const confidenceInfo =
      typeof media.getArtifactConfidence === "function"
        ? media.getArtifactConfidence({
            text,
            fileName: extracted?.fileName || file.name,
            isImage: isImageFlow,
          })
        : { ambiguous: false, confidence: "medium" };

    if (confidenceInfo?.ambiguous) {
      const choices =
        typeof media.buildArtifactClarifyChoices === "function"
          ? media.buildArtifactClarifyChoices(isImageFlow)
          : [];

      const choiceText = choices.length
        ? choices.map((c, i) => `${i + 1}. ${c.label}`).join("\n")
        : "";

      ui.updateBubbleText(
        aiBubble,
        `I read the file, but the content is thin, so I may classify it wrong.\n\nReply with one of these:\n${choiceText}\n\nOr just type what it is in a few words.`
      );

      ui.setStatus("Artifact type unclear.", true);
      sending = false;
      ui.setSendingState(false);
      return;
    }

    const hiddenPrompt = isImageFlow
      ? media.buildImageCoachingPrompt({
          fileName: extracted?.fileName || file.name,
          text,
        })
      : media.buildFilePrompt({
          fileName: extracted?.fileName || file.name,
          text,
          pages: extracted?.pages || null,
        });

    const visibleArtifactText =
      typeof media.buildArtifactUserLabel === "function"
        ? media.buildArtifactUserLabel({
            fileName: extracted?.fileName || file.name,
            kind: extracted?.kind || artifactFamily,
            mode: artifactMode,
          })
        : `Uploaded: ${extracted?.fileName || file.name}`;

    const wantAudio = !!voiceRepliesEnabled;

    const res = await api.coachRequest({
      text: visibleArtifactText,
      hiddenPrompt,
      source: wantAudio ? "voice" : "chat",
      wantAudio,
      conversationId,
      userId: session?.user?.id || session?.user?.email || "",
      deviceId: getDeviceId(),
      extra: {
        input_mode: isImageFlow ? "image" : "files",
        file_name: extracted?.fileName || file.name,
        extracted_kind: extracted?.kind || artifactFamily,
        artifact_family: artifactFamily,
        artifact_mode: artifactMode,
        pages: extracted?.pages || null,
      },
    });

    if (res?.debug?.version) {
      console.log("[HOME] backend version:", res.debug.version);
    }

    const assistantText = String(res?.assistant_text || "").trim();
    ui.updateBubbleText(
      aiBubble,
      assistantText || "I read it, but I don’t have a strong response yet."
    );

    contextState.lastUsedKnowledge = !!res?.usedKnowledge;
    contextState.lastUsedFileContext = !!res?.usedFileContext;
    ui.refreshContextUI();

    if (wantAudio && res?.audio_base64) {
      const mime = res?.mime || "audio/mpeg";
      const blob = media.base64ToBlob
        ? media.base64ToBlob(res.audio_base64, mime)
        : new Blob(
            [Uint8Array.from(atob(res.audio_base64), (c) => c.charCodeAt(0))],
            { type: mime }
          );

      audioUrlToRevoke = URL.createObjectURL(blob);
      await media.playAudioUrl?.(audioUrlToRevoke);
    }

    await hydrateConversationMeta();
    ui.setStatus("Done.");
  } catch (err) {
    console.error("[HOME] handleFilesClick failed:", err);
    ui.updateBubbleText(
      aiBubble,
      "That upload hit a problem while I was processing it. Check the function logs and try again."
    );
    ui.setStatus("File processing failed.", true);
  } finally {
    if (audioUrlToRevoke) {
      setTimeout(() => URL.revokeObjectURL(audioUrlToRevoke), 4000);
    }
    sending = false;
    ui.setSendingState(false);
  }
}

async function sendTextMessage(rawText, opts = {}) {
  const text = String(rawText || "").trim();
  if (!text || sending) return;

  await ensureConversation();

  const isVoice = !!opts.isVoice;
  const wantAudio = !!opts.wantAudio;

  sending = true;
  ui.setSendingState(true);

  contextState.lastMode = isVoice ? "voice" : "chat";
  ui.refreshContextUI();

  ui.appendBubble("user", text);
  const aiBubble = ui.appendBubble("ai", "Blake is thinking…");
  ui.setStatus("Waiting for Blake…");

  let audioUrlToRevoke = null;

  try {
    const res = await api.coachRequest({
      text,
      source: isVoice ? "voice" : "chat",
      wantAudio,
      conversationId,
      userId: session?.user?.id || session?.user?.email || "",
      deviceId: getDeviceId(),
      extra: {
        input_mode: isVoice ? "voice" : "chat",
      },
    });

    if (res?.debug?.version) {
      console.log("[HOME] backend version:", res.debug.version);
    }

    const assistantText = String(res?.assistant_text || "").trim();
    ui.updateBubbleText(
      aiBubble,
      assistantText || "I’m here, brother. Say that again a little more plainly."
    );

    contextState.lastUsedKnowledge = !!res?.usedKnowledge;
    contextState.lastUsedFileContext = !!res?.usedFileContext;
    ui.refreshContextUI();

    if (wantAudio && res?.audio_base64) {
      const mime = res?.mime || "audio/mpeg";
      const blob = media.base64ToBlob
        ? media.base64ToBlob(res.audio_base64, mime)
        : new Blob(
            [Uint8Array.from(atob(res.audio_base64), (c) => c.charCodeAt(0))],
            { type: mime }
          );

      audioUrlToRevoke = URL.createObjectURL(blob);
      await media.playAudioUrl?.(audioUrlToRevoke);
    }

    refs.input.value = "";
    await hydrateConversationMeta();
    ui.setStatus("Ready.");
  } catch (err) {
    console.error("[HOME] sendTextMessage failed:", err);
    ui.updateBubbleText(
      aiBubble,
      "Something broke while I was answering. Check the function logs and try again."
    );
    ui.setStatus("Send failed.", true);
  } finally {
    if (audioUrlToRevoke) {
      setTimeout(() => URL.revokeObjectURL(audioUrlToRevoke), 4000);
    }
    sending = false;
    ui.setSendingState(false);
  }
}

async function toggleVoiceInput() {
  try {
    await media.unlockAudioSystem();

    if (!media.supportsMediaRecorder()) {
      ui.setStatus("Your browser does not support voice recording.", true);
      return;
    }

    if (media.isRecording()) {
      setRecordingUi(false);
      const blob = await media.stopRecording();
      if (!blob) return;

      ui.setStatus("Transcribing…");
      const data = await media.transcribeAudioBlob(blob);
      const transcript = String(data?.text || "").trim();

      if (!transcript) {
        ui.setStatus("I could not hear a clear voice transcript.", true);
        return;
      }

      await sendTextMessage(transcript, {
        isVoice: true,
        wantAudio: true,
      });
      return;
    }

    await media.startRecording();
    setRecordingUi(true);
  } catch (err) {
    console.error("[HOME] toggleVoiceInput failed:", err);
    setRecordingUi(false);
    ui.setStatus("Voice recording failed.", true);
  }
}

function bindEvents() {
  refs.sendBtn?.addEventListener("click", () => sendTextMessage(refs.input?.value || ""));
  refs.filesBtn?.addEventListener("click", handleFilesClick);
  refs.speakBtn?.addEventListener("click", toggleVoiceInput);

  refs.input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendTextMessage(refs.input?.value || "");
    }
  });

  refs.callBtn?.addEventListener("click", () => {
    window.location.href = "/call.html";
  });

  refs.logoutBtn?.addEventListener("click", async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn("[HOME] signOut failed:", err);
    } finally {
      window.location.href = "/";
    }
  });

  refs.hamburger?.addEventListener("click", () => {
    refs.content?.classList.toggle("menu-open");
  });

  refs.chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const val = chip.dataset.value || chip.textContent || "";
      refs.input.value = String(val).trim();
      refs.input.focus();
    });
  });
}

async function boot() {
  try {
    await ensureAuthedOrRedirect();
    session = await getSession();
    if (!session?.user) {
      window.location.href = "/";
      return;
    }

    voiceRepliesEnabled = localStorage.getItem("sow_voice_replies") === "1";
    ui.refreshContextUI();

    conversationId = getConversationIdFromUrl();
    bindEvents();

    if (conversationId) {
      await loadConversationHistory(conversationId);
    } else {
      ui.setStatus("Ready.");
    }
  } catch (err) {
    console.error("[HOME] boot failed:", err);
    ui.setStatus("Could not load home.", true);
  }
}

boot();