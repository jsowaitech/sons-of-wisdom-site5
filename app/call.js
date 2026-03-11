// app/call.js
// Son of Wisdom — Call mode
//
// Simplified version:
// - one average/default VAD profile
// - no user-facing mic sensitivity selector
// - actual playback speaking state
// - backend debug_audio logging
// - balanced mic settings for average indoor use

const DEBUG = true;
const log = (...a) => DEBUG && console.log("[SOW]", ...a);
const warn = (...a) => DEBUG && console.warn("[SOW]", ...a);

/* ---------- ENDPOINTS ---------- */
const CALL_COACH_ENDPOINT = "/.netlify/functions/call-coach";
const TRANSCRIBE_ENDPOINT = "/.netlify/functions/openai-transcribe";
const CALL_GREETING_ENDPOINT = "/.netlify/functions/call-greeting";
const HUME_TOKEN_ENDPOINT = "/api/hume-token";

const CALL_UI_VERSION = "call-ui-reliability-v3";
window.SOW_CALL_UI_VERSION = CALL_UI_VERSION;
console.log("[CALL] version:", CALL_UI_VERSION);

/* ---------- FEATURES ---------- */
const HUME_ENABLED = true;

/* ---------- TRANSCRIBE MODEL ---------- */
const TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";

/* ---------- URL PARAMS ---------- */
const urlParams = new URLSearchParams(window.location.search);
const conversationId = urlParams.get("c") || null;

/* ---------- DOM ---------- */
const callBtn = document.getElementById("call-btn");
const statusText = document.getElementById("status-text");
const micBtn = document.getElementById("mic-btn");
const speakerBtn = document.getElementById("speaker-btn");
const modeBtn = document.getElementById("mode-btn");

const transcriptList = document.getElementById("transcriptList");
const transcriptInterim = document.getElementById("transcriptInterim");

const clearBtn = document.getElementById("ts-clear");
const autoscrollBtn = document.getElementById("ts-autoscroll");

const voiceRing = document.getElementById("voiceRing");
const callTimerEl = document.getElementById("call-timer");
const callLabelEl = document.getElementById("call-label");

const debugEl = document.getElementById("call-debug");

/* ---------- SINGLE DEFAULT VAD PROFILE ---------- */
/* Balanced for average indoor users */
const VAD_PROFILE = {
  name: "average",
  VAD_START_HOLD_MS: 170,
  noiseFloor: 0.012,
  VAD_MIN_SPEECH_MS: 520,
  THRESHOLD_MULTIPLIER: 2.8,
  THRESHOLD_MIN: 0.026,
  THRESHOLD_MAX: 0.10,
  VAD_START_MULT: 1.24,
  VAD_CONT_MULT: 0.83,
  BARGE_MIN_HOLD_MS: 320,
  BARGE_EXTRA_MULT: 1.62,
};

/* ---------- STATE ---------- */
let isCalling = false;
let isRecording = false;

let micMuted = false;
let speakerMuted = false;

let autoScroll = true;
let lastFinalLine = "";

/* merge buffer */
let mergedTranscriptBuffer = "";
let mergeTimer = null;
let isMerging = false;

/* audio recording */
let globalStream = null;
let micPromise = null;
let mediaRecorder = null;
let recordChunks = [];
let recordMimeType = "audio/webm";

/* VAD */
let vadAC = null;
let vadSource = null;
let vadAnalyser = null;
let vadData = null;
let vadLoopRunning = false;
let vadState = "idle";
let lastVoiceTime = 0;
let speechStartTime = 0;
let vadStartCandidateAt = 0;

/* adaptive floor */
let noiseFloor = VAD_PROFILE.noiseFloor;
let lastNoiseUpdate = 0;

/* fixed VAD pacing */
const VAD_SILENCE_MS = 1500;
const VAD_MERGE_WINDOW_MS = 1700;
const VAD_IDLE_TIMEOUT_MS = 30000;
const NOISE_FLOOR_UPDATE_MS = 300;
const BARGE_COOLDOWN_MS = 900;

let bargeVoiceStart = 0;
let aiSpeechStart = 0;

/* ---------- iOS detection ---------- */
const IS_IOS =
  /iPad|iPhone|iPod/i.test(navigator.userAgent || "") ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/* ---------- Shared AI audio player + analyser ---------- */
let ttsPlayer = null;
let playbackAC = null;
let playbackSource = null;
let playbackAnalyser = null;
let playbackData = null;
let audioUnlocked = false;

let playbackEpoch = 0;
let isPlayingAI = false;
let playerIsActuallyPlaying = false;

/* Abort controllers */
let transcribeAbort = null;
let coachAbort = null;

/* Strict coach sequencing */
let coachSeq = 0;

/* Turn queue */
const pendingUserTurns = [];
let drainingTurns = false;

/* Greeting */
let greetingDone = false;

/* ring state */
let ringPlayed = false;

/* timer */
let callStartTs = 0;
let timerRAF = null;

/* Dedupe user turns */
let lastUserSentText = "";
let lastUserSentAt = 0;
const USER_TURN_DEDUPE_MS = 2200;

/* Playback queue */
const ttsQueue = [];
let ttsDraining = false;

/* Debug HUD */
let debugOn = false;
let lastDebugAudio = null;

/* Status flags */
let isTranscribing = false;
let isThinking = false;
let pausedInBackground = false;
let transientStatus = "";
let transientUntil = 0;

/* Call phases */
let callPhase = "idle"; // idle | requesting_mic | ringing | joined | greeting | live
const PRESENCE_JOIN_MS = 420;
const PRESENCE_HANDOFF_MS = 1200;

/* ---------- Helpers ---------- */
function setStatus(t) {
  if (!statusText) return;
  statusText.textContent = t || "";
}

function setTransientStatus(t, ms = 1600) {
  transientStatus = t || "";
  transientUntil = transientStatus ? performance.now() + ms : 0;
  renderStatus();
}

function renderStatus() {
  if (!isCalling) {
    setStatus("Tap the blue call button to begin.");
    return;
  }

  if (pausedInBackground) {
    setStatus("Paused (app in background). Tap to resume.");
    return;
  }

  if (callPhase === "requesting_mic") {
    setStatus("Connecting microphone…");
    return;
  }
  if (callPhase === "ringing") {
    setStatus("Calling Blake…");
    return;
  }
  if (callPhase === "joined") {
    setStatus("Blake joined the call…");
    return;
  }
  if (callPhase === "greeting") {
    if (playerIsActuallyPlaying && !speakerMuted) setStatus("Blake speaking…");
    else setStatus("Blake is with you…");
    return;
  }

  if (playerIsActuallyPlaying && !speakerMuted) {
    setStatus("Blake speaking…");
    return;
  }

  if (isTranscribing) {
    setStatus("Transcribing…");
    return;
  }

  if (isThinking) {
    setStatus("Blake is thinking…");
    return;
  }

  if (isMerging) {
    setStatus("Finishing your thought…");
    return;
  }

  const now = performance.now();
  if (transientStatus && transientUntil && now < transientUntil) {
    setStatus(transientStatus);
    return;
  }

  if (micMuted) {
    setStatus("Mic muted.");
    return;
  }

  if (callPhase === "live") setStatus("Listening…");
  else setStatus("Connecting…");
}

function setInterim(t) {
  if (!transcriptInterim) return;
  transcriptInterim.textContent = t || "";
}

function addFinalLine(t) {
  if (!transcriptList) return;
  const s = (t || "").trim();
  if (!s || s === lastFinalLine) return;
  lastFinalLine = s;

  const div = document.createElement("div");
  div.className = "transcript-line";
  div.textContent = s;
  transcriptList.appendChild(div);

  if (autoScroll) {
    const scroller =
      document.getElementById("tsList") ||
      transcriptList.parentElement ||
      transcriptList;
    scroller.scrollTop = scroller.scrollHeight;
  }
}

function clearTranscript() {
  if (transcriptList) transcriptList.innerHTML = "";
  setInterim("");
  lastFinalLine = "";
  mergedTranscriptBuffer = "";
  if (mergeTimer) clearTimeout(mergeTimer);
  mergeTimer = null;
  isMerging = false;
  vadStartCandidateAt = 0;
  renderStatus();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function setDebugText(t) {
  if (!debugEl) return;
  debugEl.textContent = t || "";
}

function safeSlice(v, n = 180) {
  return String(v || "").slice(0, n);
}

function applyActualPlaybackState(flag) {
  const next = !!flag;
  if (playerIsActuallyPlaying === next) return;
  playerIsActuallyPlaying = next;
  isPlayingAI = next;
  if (next) {
    aiSpeechStart = performance.now();
  }
  renderStatus();
}

/* ---------- Hume ---------- */
let humeReady = false;
let humeActive = false;

async function initHumeRealtime() {
  if (!HUME_ENABLED) return false;
  if (humeReady) return true;

  const api = window.HumeRealtime;
  if (!api?.init) {
    warn("HumeRealtime is not loaded on the page");
    return false;
  }

  try {
    await api.init({
      enable: true,
      tokenEndpoint: HUME_TOKEN_ENDPOINT,
    });
    humeReady = true;
    log("✅ HumeRealtime initialized");
    return true;
  } catch (e) {
    warn("initHumeRealtime failed", e);
    return false;
  }
}

async function startHumeRealtime() {
  if (!HUME_ENABLED || humeActive || !isCalling) return;
  const ok = await initHumeRealtime();
  if (!ok) return;

  try {
    const stream = globalStream || (await ensureMicStream());
    await window.HumeRealtime.startTurn(stream, vadAC || undefined);
    humeActive = true;
    log("✅ HumeRealtime started");
  } catch (e) {
    warn("startHumeRealtime failed", e);
  }
}

function stopHumeRealtime() {
  try {
    window.HumeRealtime?.stopTurn?.();
  } catch (e) {
    warn("stopHumeRealtime failed", e);
  }
  humeActive = false;
}

/* ---------- Buttons ---------- */
clearBtn?.addEventListener("click", clearTranscript);

autoscrollBtn?.addEventListener("click", () => {
  autoScroll = !autoScroll;
  autoscrollBtn.setAttribute("aria-pressed", String(autoScroll));
  autoscrollBtn.textContent = autoScroll ? "On" : "Off";
});

modeBtn?.addEventListener("click", () => {
  const url = new URL("home.html", window.location.origin);
  if (conversationId) url.searchParams.set("c", conversationId);
  window.location.href = url.toString();
});

micBtn?.addEventListener("click", () => {
  micMuted = !micMuted;
  micBtn?.setAttribute("aria-pressed", String(micMuted));

  if (globalStream) {
    globalStream.getAudioTracks().forEach((t) => {
      t.enabled = !micMuted;
    });
  }

  const lbl = document.getElementById("mic-label");
  if (lbl) lbl.textContent = micMuted ? "Unmute" : "Mute";

  renderStatus();
});

speakerBtn?.addEventListener("click", () => {
  speakerMuted = !speakerMuted;
  speakerBtn?.setAttribute("aria-pressed", String(speakerMuted));

  if (ttsPlayer) {
    ttsPlayer.muted = speakerMuted;
    ttsPlayer.volume = speakerMuted ? 0 : 1;
  }

  const lbl = document.getElementById("speaker-label");
  if (lbl) lbl.textContent = speakerMuted ? "Speaker Off" : "Audio";

  if (!speakerMuted) drainTTSQueue();

  renderStatus();
});

window.addEventListener("keydown", (e) => {
  const k = (e.key || "").toLowerCase();
  if (k === "d") {
    debugOn = !debugOn;
    if (debugEl) debugEl.hidden = !debugOn;
  }
  if (k === "c") {
    const url = new URL("home.html", window.location.origin);
    if (conversationId) url.searchParams.set("c", conversationId);
    window.location.href = url.toString();
  }
});

document.addEventListener("visibilitychange", async () => {
  if (!isCalling) return;

  if (document.hidden) {
    pausedInBackground = true;

    stopHumeRealtime();

    try {
      ttsPlayer?.pause();
    } catch {}

    try {
      if (isRecording) await stopRecordingTurn({ discard: true });
    } catch {}

    vadState = "idle";
    vadStartCandidateAt = 0;
    bargeVoiceStart = 0;
    mergedTranscriptBuffer = "";
    if (mergeTimer) clearTimeout(mergeTimer);
    mergeTimer = null;
    isMerging = false;
    setInterim("");

    renderStatus();
  } else {
    pausedInBackground = false;
    await unlockAudioSystem().catch(() => {});
    try {
      if (vadAC?.state === "suspended") await vadAC.resume().catch(() => {});
    } catch {}

    if (callPhase === "live") {
      await startHumeRealtime();
    }

    renderStatus();
  }
});

/* ---------- IDs ---------- */
function getDeviceId() {
  const key = "sow_device_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto?.randomUUID?.() || `dev_${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(key, id);
  }
  return id;
}
const deviceId = getDeviceId();
const callId = crypto?.randomUUID?.() || `call_${Date.now()}`;

/* ---------- Audio system ---------- */
function installPlayerLifecycleHandlers() {
  const a = ensureSharedAudio();
  if (a.__sow_handlers_installed) return;

  a.addEventListener("play", () => {
    applyActualPlaybackState(true);
  });

  a.addEventListener("playing", () => {
    applyActualPlaybackState(true);
  });

  a.addEventListener("pause", () => {
    if (a.ended) return;
    applyActualPlaybackState(false);
  });

  a.addEventListener("ended", () => {
    applyActualPlaybackState(false);
  });

  a.addEventListener("abort", () => {
    applyActualPlaybackState(false);
  });

  a.addEventListener("error", () => {
    applyActualPlaybackState(false);
  });

  a.__sow_handlers_installed = true;
}

function ensureSharedAudio() {
  if (ttsPlayer) return ttsPlayer;

  ttsPlayer = new Audio();
  ttsPlayer.preload = "auto";
  ttsPlayer.playsInline = true;
  ttsPlayer.crossOrigin = "anonymous";
  ttsPlayer.muted = speakerMuted;
  ttsPlayer.volume = speakerMuted ? 0 : 1;

  installPlayerLifecycleHandlers();
  return ttsPlayer;
}

async function unlockAudioSystem() {
  ensureSharedAudio();

  playbackAC ||= new (window.AudioContext || window.webkitAudioContext)();

  if (playbackAC.state === "suspended") {
    await playbackAC.resume().catch(() => {});
  }

  if (!playbackSource) {
    playbackSource = playbackAC.createMediaElementSource(ttsPlayer);
  }

  if (!playbackAnalyser) {
    playbackAnalyser = playbackAC.createAnalyser();
    playbackAnalyser.fftSize = 1024;
    playbackData = new Uint8Array(playbackAnalyser.fftSize);

    playbackSource.connect(playbackAnalyser);
    playbackAnalyser.connect(playbackAC.destination);
  }

  if (IS_IOS && !audioUnlocked) {
    const a = ensureSharedAudio();
    a.src =
      "data:audio/mp3;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCA" +
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    a.volume = 0;

    try {
      await a.play().catch(() => {});
      a.pause();
      a.currentTime = 0;
    } catch {}

    audioUnlocked = true;
    log("✅ iOS audio unlocked");
  } else {
    audioUnlocked = true;
  }
}

function primeIOSGesture() {
  try {
    ensureSharedAudio();
    unlockAudioSystem().catch(() => {});

    if (!micPromise && !globalStream) {
      micPromise = navigator.mediaDevices
        .getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
            sampleRate: 48000,
          },
        })
        .then((s) => {
          globalStream = s;
          try {
            globalStream.getAudioTracks().forEach((t) => (t.enabled = !micMuted));
          } catch {}
          return globalStream;
        })
        .catch((e) => {
          micPromise = null;
          throw e;
        });
    }

    if (!vadAC) {
      vadAC = new (window.AudioContext || window.webkitAudioContext)();
      if (vadAC.state === "suspended") {
        vadAC.resume().catch(() => {});
      }
    }

    initHumeRealtime().catch(() => {});
  } catch (e) {
    warn("primeIOSGesture failed", e);
  }
}

/* ---------- ring.mp3 ---------- */
async function playRingTwiceOnConnect() {
  if (ringPlayed) return;
  ringPlayed = true;

  const RING_FALLBACK_MS = 2300;

  try {
    const a = ensureSharedAudio();

    const playOnce = async () => {
      playbackEpoch++;
      try {
        a.pause();
      } catch {}
      try {
        a.currentTime = 0;
      } catch {}

      a.muted = false;
      a.volume = speakerMuted ? 0 : 1;
      a.playsInline = true;
      a.src = "ring.mp3";
      try {
        a.load();
      } catch {}
      await waitOnce(a, "canplay", 1200);

      await a.play().catch(() => {
        throw new Error("ring blocked");
      });

      await waitOnce(a, "ended", 3500);
    };

    await playOnce();
    await sleep(180);
    await playOnce();

    log("🔔 ring played twice (shared audio)");
  } catch (e) {
    warn("ring play failed; using fallback delay", e);
    await sleep(RING_FALLBACK_MS);
    await sleep(180);
    await sleep(RING_FALLBACK_MS);
  }
}

function stopRing() {
  try {
    if (!ttsPlayer) return;
    ttsPlayer.pause();
    ttsPlayer.currentTime = 0;
  } catch {}
}

/* ---------- MIME picking ---------- */
function pickSupportedMime() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const m of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return "audio/webm";
}

function mimeToExt(mime) {
  const m = (mime || "").toLowerCase();
  if (m.includes("mp4")) return "m4a";
  if (m.includes("ogg")) return "ogg";
  return "webm";
}

/* ---------- Mic stream ---------- */
async function ensureMicStream() {
  if (globalStream) return globalStream;
  if (micPromise) return micPromise;

  micPromise = navigator.mediaDevices
    .getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 48000,
      },
    })
    .then((s) => {
      globalStream = s;
      try {
        globalStream.getAudioTracks().forEach((t) => (t.enabled = !micMuted));
      } catch {}
      return globalStream;
    })
    .catch((e) => {
      micPromise = null;
      throw e;
    });

  return micPromise;
}

/* ---------- VAD setup ---------- */
async function setupVAD() {
  if (!vadAC) {
    vadAC = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (vadAC.state === "suspended") {
    await vadAC.resume().catch(() => {});
  }

  if (vadAnalyser && vadSource && vadData) return;

  const stream = await ensureMicStream();

  try {
    vadSource = vadAC.createMediaStreamSource(stream);
    vadAnalyser = vadAC.createAnalyser();
    vadAnalyser.fftSize = 1024;
    vadData = new Uint8Array(vadAnalyser.fftSize);

    vadSource.connect(vadAnalyser);

    noiseFloor = VAD_PROFILE.noiseFloor;
    lastNoiseUpdate = performance.now();

    log("✅ VAD ready with average profile");
  } catch (e) {
    warn("setupVAD failed", e);
    throw e;
  }
}

function rmsFromTimeDomain(bytes) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) {
    const v = (bytes[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / bytes.length);
}

function getMicEnergy() {
  if (!vadAnalyser || !vadData) return 0;
  try {
    vadAnalyser.getByteTimeDomainData(vadData);
    return rmsFromTimeDomain(vadData);
  } catch {
    return 0;
  }
}

function computeAdaptiveThreshold() {
  let thr = noiseFloor * VAD_PROFILE.THRESHOLD_MULTIPLIER;
  if (!Number.isFinite(thr)) thr = 0.04;
  thr = Math.max(VAD_PROFILE.THRESHOLD_MIN, Math.min(VAD_PROFILE.THRESHOLD_MAX, thr));
  return thr;
}

function maybeUpdateNoiseFloor(energy, now) {
  if (now - lastNoiseUpdate < NOISE_FLOOR_UPDATE_MS) return;
  lastNoiseUpdate = now;

  const capped = Math.min(energy, noiseFloor * 2.0 + 0.01);
  const alpha = 0.09;

  noiseFloor = noiseFloor * (1 - alpha) + capped * alpha;
  noiseFloor = Math.max(0.0045, Math.min(0.08, noiseFloor));
}

/* ---------- RECORD TURN CONTROL ---------- */
async function startRecordingTurn() {
  if (isRecording) return;
  const stream = await ensureMicStream();
  const mimeType = pickSupportedMime();

  recordMimeType = mimeType;
  recordChunks = [];
  mediaRecorder = new MediaRecorder(stream, { mimeType });
  isRecording = true;

  mediaRecorder.ondataavailable = (e) => {
    if (e.data?.size > 0) recordChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    isRecording = false;
  };

  mediaRecorder.start();
}

async function stopRecordingTurn({ discard = false } = {}) {
  if (!isRecording || !mediaRecorder) return;

  try {
    if (mediaRecorder.state !== "inactive") mediaRecorder.stop();
  } catch {}

  while (isRecording) await sleep(25);
  mediaRecorder = null;

  if (discard) recordChunks = [];
}

/* ---------- Transcribe audio -> text ---------- */
async function transcribeTurn() {
  if (!recordChunks.length) return "";

  const totalSize = recordChunks.reduce((sum, c) => sum + (c?.size || 0), 0);
  if (totalSize < 8000) {
    log("⚠️ Ignoring tiny audio blob:", totalSize);
    recordChunks = [];
    return "";
  }

  isTranscribing = true;
  renderStatus();

  try {
    try {
      transcribeAbort?.abort();
    } catch {}
    transcribeAbort = new AbortController();

    const blob = new Blob(recordChunks, {
      type: recordMimeType || "audio/webm",
    });
    const ext = mimeToExt(recordMimeType);
    const filename = `user.${ext}`;

    const fd = new FormData();
    fd.append("audio", blob, filename);
    fd.append("model", TRANSCRIBE_MODEL);
    fd.append("response_format", "json");
    fd.append("language", "en");

    const resp = await fetch(TRANSCRIBE_ENDPOINT, {
      method: "POST",
      body: fd,
      signal: transcribeAbort.signal,
    });

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`Transcribe HTTP ${resp.status}: ${t || resp.statusText}`);
    }

    const data = await resp.json().catch(() => ({}));
    const text = (data?.text || data?.transcript || data?.utterance || "")
      .toString()
      .trim();
    return text;
  } catch (e) {
    if (e?.name === "AbortError") return "";
    warn("transcribeTurn error", e);
    return "";
  } finally {
    transcribeAbort = null;
    isTranscribing = false;
    renderStatus();
  }
}

/* ---------- Merge logic ---------- */
function queueMergedSend(transcript) {
  if (!transcript) return;

  mergedTranscriptBuffer = mergedTranscriptBuffer
    ? `${mergedTranscriptBuffer} ${transcript}`.trim()
    : transcript.trim();

  isMerging = true;
  setInterim("…");
  renderStatus();

  if (mergeTimer) clearTimeout(mergeTimer);

  mergeTimer = setTimeout(() => {
    mergeTimer = null;

    const final = mergedTranscriptBuffer.trim();
    mergedTranscriptBuffer = "";
    isMerging = false;
    setInterim("");
    renderStatus();

    if (!final) return;
    if (!isCalling) return;

    const now = Date.now();
    if (final === lastUserSentText && now - lastUserSentAt < USER_TURN_DEDUPE_MS) {
      log("🟡 dropped duplicate user turn:", final);
      return;
    }
    lastUserSentText = final;
    lastUserSentAt = now;

    addFinalLine("You: " + final);

    pendingUserTurns.push(final);
    drainTurnQueue();
  }, VAD_MERGE_WINDOW_MS);
}

/* ---------- Turn queue ---------- */
async function drainTurnQueue() {
  if (drainingTurns) return;
  drainingTurns = true;

  try {
    while (isCalling && pendingUserTurns.length) {
      const next = pendingUserTurns.shift();
      if (!next) continue;
      await sendTranscriptToCoachAndQueueAudio(next);
      if (!isCalling) break;
    }
  } finally {
    drainingTurns = false;
  }
}

/* ---------- TTS queue ---------- */
async function enqueueTTS(base64, mime) {
  if (!base64) return;
  ttsQueue.push({ base64, mime: mime || "audio/mpeg" });

  if (!speakerMuted) drainTTSQueue();
}

async function drainTTSQueue() {
  if (ttsDraining) return;
  ttsDraining = true;

  try {
    while (isCalling && ttsQueue.length && !speakerMuted) {
      const item = ttsQueue.shift();
      if (!item?.base64) continue;

      if (isRecording) await stopRecordingTurn({ discard: true });

      const ok = await playDataUrlTTS(item.base64, item.mime);

      if (!isCalling) break;

      if (!ok) {
        setTransientStatus("Audio playback failed. Check speaker or tap call again.", 2200);
      }
      renderStatus();
    }
  } finally {
    ttsDraining = false;
  }
}

function waitOnce(target, event, ms = 2000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        target.removeEventListener(event, onEvt);
      } catch {}
      resolve(true);
    };
    const onEvt = () => finish();
    try {
      target.addEventListener(event, onEvt, { once: true });
    } catch {}
    setTimeout(() => resolve(false), ms);
  });
}

async function playDataUrlTTS(b64, mime = "audio/mpeg", hardTimeoutMs = 180000) {
  const a = ensureSharedAudio();
  const myEpoch = ++playbackEpoch;

  applyActualPlaybackState(false);

  try {
    a.pause();
  } catch {}
  try {
    a.removeAttribute("src");
  } catch {}
  try {
    a.src = "";
  } catch {}
  try {
    a.load();
  } catch {}

  a.muted = speakerMuted;
  a.volume = speakerMuted ? 0 : 1;
  a.playsInline = true;

  const dataUrl = `data:${mime};base64,${b64}`;
  a.src = dataUrl;

  try {
    a.load();
  } catch {}
  await waitOnce(a, "canplay", 2500);

  return new Promise((resolve) => {
    let settled = false;
    let lastT = -1;
    let lastMoveAt = performance.now();
    let stallTimer = null;
    let hardTimer = null;

    const cleanup = () => {
      a.onended = null;
      a.onerror = null;
      a.onabort = null;
      try {
        if (stallTimer) clearInterval(stallTimer);
      } catch {}
      try {
        if (hardTimer) clearTimeout(hardTimer);
      } catch {}
      stallTimer = null;
      hardTimer = null;
    };

    const settle = (ok) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (myEpoch === playbackEpoch) {
        applyActualPlaybackState(false);
      }
      resolve(ok);
    };

    stallTimer = setInterval(() => {
      if (myEpoch !== playbackEpoch) return;
      if (a.paused) return;

      const t = a.currentTime || 0;
      if (t !== lastT) {
        lastT = t;
        lastMoveAt = performance.now();
      } else {
        const stalledFor = performance.now() - lastMoveAt;
        if (stalledFor > 900) {
          a.play().catch(() => {});
          lastMoveAt = performance.now();
        }
      }
    }, 250);

    hardTimer = setTimeout(() => {
      if (myEpoch !== playbackEpoch) return;
      settle(false);
    }, hardTimeoutMs);

    a.onended = () => {
      if (myEpoch !== playbackEpoch) return;
      settle(true);
    };
    a.onerror = () => {
      if (myEpoch !== playbackEpoch) return;
      settle(false);
    };
    a.onabort = () => {
      if (myEpoch !== playbackEpoch) return;
      settle(false);
    };

    a.play().catch(() => {
      settle(false);
    });
  });
}

/* ---------- Greeting ---------- */
async function playGreetingOnce() {
  if (greetingDone) return;
  greetingDone = true;

  try {
    renderStatus();

    const resp = await fetch(CALL_GREETING_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        call_id: callId,
        device_id: deviceId,
        conversation_id: conversationId || null,
      }),
    });

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`Greeting HTTP ${resp.status}: ${t || resp.statusText}`);
    }

    const data = await resp.json().catch(() => ({}));
    if (!isCalling) return;

    const replyText = (data?.assistant_text || data?.text || "").trim();
    const b64 = data?.audio_base64;
    const mime = data?.mime || "audio/mpeg";

    if (replyText) addFinalLine("AI: " + replyText);

    if (b64) {
      await enqueueTTS(b64, mime);
      if (!speakerMuted) {
        await drainTTSQueue();
      }
    } else {
      const detail = data?.audio_error || "greeting audio missing";
      warn("greeting audio missing", { detail, response: data });
      if (replyText) {
        setTransientStatus("Greeting text arrived, but no audio came back.", 2200);
      } else {
        setTransientStatus("Couldn’t load greeting audio.", 2200);
      }
    }

    renderStatus();
  } catch (e) {
    warn("playGreetingOnce failed", e);
    setTransientStatus("Couldn’t load greeting. Check network.", 1800);
    renderStatus();
  }
}

/* ---------- Send transcript -> AI ---------- */
async function sendTranscriptToCoachAndQueueAudio(transcript) {
  const text = (transcript || "").trim();
  if (!text) return false;
  if (!isCalling) return false;

  const seq = ++coachSeq;

  try {
    try {
      coachAbort?.abort();
    } catch {}
    coachAbort = new AbortController();

    isThinking = true;
    renderStatus();

    const resp = await fetch(CALL_COACH_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: coachAbort.signal,
      body: JSON.stringify({
        source: "voice",
        conversation_id: conversationId || null,
        call_id: callId,
        device_id: deviceId,
        transcript: text,
      }),
    });

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`Coach HTTP ${resp.status}: ${t || resp.statusText}`);
    }

    const data = await resp.json().catch(() => ({}));
    if (!isCalling) return false;
    if (seq !== coachSeq) return false;

    if (data?.debug?.version) {
      console.log("[CALL] backend version:", data.debug.version);
    }

    const debugAudio =
      data?.debug?.audio ||
      data?.debug_audio ||
      null;

    if (debugAudio) {
      lastDebugAudio = debugAudio;
      log("debug_audio", debugAudio);
    }

    const replyText = (data?.assistant_text || data?.text || "").trim();
    if (replyText) addFinalLine("AI: " + replyText);

    const b64 = data?.audio_base64;
    const mime = data?.mime || "audio/mpeg";

    if (b64) {
      await enqueueTTS(b64, mime);
    } else {
      const detail =
        data?.audio_error ||
        debugAudio?.tts_error ||
        "audio missing";
      warn("audio missing", {
        detail,
        debug_audio: debugAudio,
        response: data,
      });
      setTransientStatus("Reply arrived, but audio did not play.", 2200);
    }

    return true;
  } catch (e) {
    if (e?.name === "AbortError") return false;
    warn("sendTranscriptToCoachAndQueueAudio error", e);
    setTransientStatus("Network error.", 1800);
    return false;
  } finally {
    coachAbort = null;
    isThinking = false;
    renderStatus();
  }
}

/* ---------- Barge-in ---------- */
function stopAIForBargeIn() {
  if (!ttsPlayer) return;
  if (!playerIsActuallyPlaying && !isPlayingAI) return;

  playbackEpoch++;

  try {
    ttsPlayer.pause();
  } catch {}
  try {
    ttsPlayer.currentTime = 0;
  } catch {}

  ttsQueue.length = 0;

  try {
    coachAbort?.abort();
  } catch {}
  coachAbort = null;

  try {
    if (mergeTimer) clearTimeout(mergeTimer);
  } catch {}
  mergeTimer = null;
  mergedTranscriptBuffer = "";
  isMerging = false;
  setInterim("");

  applyActualPlaybackState(false);
  renderStatus();
  log("🛑 Barge-in: AI stopped");
}

/* ---------- VAD loop ---------- */
async function startVADLoop() {
  if (vadLoopRunning) return;
  vadLoopRunning = true;

  vadState = "idle";
  vadStartCandidateAt = 0;
  lastVoiceTime = performance.now();
  speechStartTime = 0;

  renderStatus();
  setInterim("");

  const loop = async () => {
    if (!isCalling) {
      vadLoopRunning = false;
      return;
    }

    const energy = getMicEnergy();
    const now = performance.now();
    const thr = computeAdaptiveThreshold();

    const startThr = thr * VAD_PROFILE.VAD_START_MULT;
    const contThr = thr * VAD_PROFILE.VAD_CONT_MULT;

    const allowVADStart = !(playerIsActuallyPlaying && !speakerMuted);

    const isVoiceStart = !micMuted && energy > startThr;
    const isVoiceCont = !micMuted && energy > contThr;

    if (playerIsActuallyPlaying && !micMuted) {
      const canBarge = now - aiSpeechStart > BARGE_COOLDOWN_MS;
      const isLoudVoice = energy > thr * VAD_PROFILE.BARGE_EXTRA_MULT;

      if (canBarge && isLoudVoice) {
        if (!bargeVoiceStart) bargeVoiceStart = now;
        if (now - bargeVoiceStart >= VAD_PROFILE.BARGE_MIN_HOLD_MS) {
          stopAIForBargeIn();
          bargeVoiceStart = 0;
        }
      } else {
        bargeVoiceStart = 0;
      }
    } else {
      bargeVoiceStart = 0;
    }

    if (vadState === "idle") {
      if (allowVADStart && isVoiceStart) {
        if (!vadStartCandidateAt) vadStartCandidateAt = now;

        const heldFor = now - vadStartCandidateAt;
        if (heldFor >= VAD_PROFILE.VAD_START_HOLD_MS) {
          vadStartCandidateAt = 0;

          vadState = "speaking";
          speechStartTime = now;
          lastVoiceTime = now;

          await startRecordingTurn();
          if (!isCalling) {
            vadLoopRunning = false;
            return;
          }

          setInterim("Speaking…");
          renderStatus();
        }
      } else {
        vadStartCandidateAt = 0;

        if (!micMuted && allowVADStart) {
          maybeUpdateNoiseFloor(energy, now);
        }
      }
    } else if (vadState === "speaking") {
      vadStartCandidateAt = 0;

      if (isVoiceCont) {
        lastVoiceTime = now;
        setInterim("Speaking…");
      } else {
        const silenceFor = now - lastVoiceTime;
        const speechLen = now - speechStartTime;
        setInterim("…");

        if (silenceFor >= VAD_SILENCE_MS) {
          vadState = "idle";
          setInterim("");

          await stopRecordingTurn();
          if (!isCalling) {
            vadLoopRunning = false;
            return;
          }

          if (speechLen < VAD_PROFILE.VAD_MIN_SPEECH_MS) {
            recordChunks = [];
            renderStatus();
          } else {
            const transcript = await transcribeTurn();
            if (!isCalling) {
              vadLoopRunning = false;
              return;
            }

            if (!transcript) {
              setTransientStatus("Didn’t catch that. Try again…", 1400);
            } else {
              queueMergedSend(transcript);
            }
          }

          lastVoiceTime = now;
        }
      }
    }

    if (debugOn) {
      const dbg = lastDebugAudio || {};
      setDebugText(
        `profile=average\n` +
          `state=${vadState}  calling=${isCalling}  rec=${isRecording}\n` +
          `phase=${callPhase}  AI=${playerIsActuallyPlaying}  micMuted=${micMuted}  spkMuted=${speakerMuted}\n` +
          `energy=${energy.toFixed(4)}  noise=${noiseFloor.toFixed(4)}  thr=${thr.toFixed(4)}\n` +
          `hold=${VAD_PROFILE.VAD_START_HOLD_MS}  minSpeech=${VAD_PROFILE.VAD_MIN_SPEECH_MS}\n` +
          `turnQ=${pendingUserTurns.length}  ttsQ=${ttsQueue.length}  epoch=${playbackEpoch}\n` +
          `humeReady=${humeReady}  humeActive=${humeActive}\n` +
          `tts_status=${safeSlice(dbg.tts_status || "")}  tts_bytes=${safeSlice(dbg.tts_audio_bytes || "")}\n` +
          `tts_err=${safeSlice(dbg.tts_error || dbg.tts_throw || "")}`
      );
    }

    requestAnimationFrame(loop);
  };

  loop();
}

/* ---------- Ring canvas ---------- */
let ringCtx = null;
let ringRAF = null;

function setupRingCanvas() {
  if (!voiceRing) return;
  ringCtx = voiceRing.getContext("2d");
  resizeRing();
  window.addEventListener("resize", resizeRing);
}

function resizeRing() {
  if (!voiceRing) return;
  ringCtx ||= voiceRing.getContext("2d");
  if (!ringCtx) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = voiceRing.getBoundingClientRect();

  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));

  voiceRing.width = Math.floor(w * dpr);
  voiceRing.height = Math.floor(h * dpr);
  ringCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function getAILevel() {
  if (!playbackAnalyser || !playbackData) return 0;
  playbackAnalyser.getByteTimeDomainData(playbackData);
  return rmsFromTimeDomain(playbackData);
}

function drawRings() {
  if (!ringCtx || !voiceRing) return;

  const rect = voiceRing.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  const cx = w / 2;
  const cy = h / 2;

  ringCtx.clearRect(0, 0, w, h);

  const t = performance.now() / 1000;

  const micLevel = getMicEnergy();
  const aiLevel = getAILevel();

  const micAmp = Math.min(1, micLevel / 0.12);
  const aiAmp = Math.min(1, aiLevel / 0.12);

  const baseR = Math.min(w, h) * 0.32;

  const userPulse = baseR + micAmp * (baseR * 0.18) + Math.sin(t * 3.2) * 2;
  drawGlowRing(cx, cy, userPulse, micAmp, true);

  const aiPulse =
    baseR + baseR * 0.12 + aiAmp * (baseR * 0.22) + Math.sin(t * 2.1) * 2;
  drawGlowRing(cx, cy, aiPulse, aiAmp, false);

  ringRAF = requestAnimationFrame(drawRings);
}

function drawGlowRing(cx, cy, r, amp, isUser) {
  const ctx = ringCtx;
  const glow = 12 + amp * 22;
  const line = 6 + amp * 6;

  const g = ctx.createRadialGradient(cx, cy, r - 20, cx, cy, r + 40);
  if (isUser) {
    g.addColorStop(0, `rgba(120, 170, 255, ${0.15 + amp * 0.35})`);
    g.addColorStop(1, `rgba(120, 170, 255, 0)`);
  } else {
    g.addColorStop(0, `rgba(255, 200, 120, ${0.15 + amp * 0.35})`);
    g.addColorStop(1, `rgba(255, 200, 120, 0)`);
  }

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);

  ctx.strokeStyle = isUser
    ? `rgba(120, 170, 255, ${0.35 + amp * 0.65})`
    : `rgba(255, 200, 120, ${0.35 + amp * 0.65})`;

  ctx.lineWidth = line;
  ctx.shadowBlur = glow;
  ctx.shadowColor = isUser
    ? `rgba(120, 170, 255, ${0.55 + amp * 0.45})`
    : `rgba(255, 200, 120, ${0.55 + amp * 0.45})`;

  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = g;
  ctx.lineWidth = line * 2.2;
  ctx.globalAlpha = 0.9;
  ctx.stroke();

  ctx.restore();
}

/* ---------- Timer ---------- */
function startTimer() {
  callStartTs = performance.now();

  const tick = () => {
    if (!isCalling) return;

    const elapsed = Math.max(0, performance.now() - callStartTs);
    const s = Math.floor(elapsed / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");

    if (callTimerEl) callTimerEl.textContent = `${mm}:${ss}`;
    timerRAF = requestAnimationFrame(tick);
  };

  tick();
}

function stopTimer() {
  try {
    if (timerRAF) cancelAnimationFrame(timerRAF);
  } catch {}
  timerRAF = null;
  if (callTimerEl) callTimerEl.textContent = "00:00";
}

/* ---------- Call controls ---------- */
callBtn?.addEventListener("click", () => {
  primeIOSGesture();

  if (!isCalling) startCall();
  else endCall();
});

async function startCall() {
  isCalling = true;
  pausedInBackground = false;
  clearTranscript();

  callBtn?.classList.add("call-active");
  callBtn?.setAttribute("aria-pressed", "true");
  if (callLabelEl) callLabelEl.textContent = "End Call";

  pendingUserTurns.length = 0;
  drainingTurns = false;

  greetingDone = false;
  ringPlayed = false;
  lastDebugAudio = null;

  lastUserSentText = "";
  lastUserSentAt = 0;

  try {
    transcribeAbort?.abort();
  } catch {}
  try {
    coachAbort?.abort();
  } catch {}
  transcribeAbort = null;
  coachAbort = null;

  isTranscribing = false;
  isThinking = false;
  isMerging = false;
  vadStartCandidateAt = 0;
  applyActualPlaybackState(false);

  startTimer();

  try {
    callPhase = "requesting_mic";
    renderStatus();
    await ensureMicStream();
    await initHumeRealtime();

    callPhase = "ringing";
    renderStatus();
    await playRingTwiceOnConnect();

    callPhase = "joined";
    renderStatus();
    await sleep(PRESENCE_JOIN_MS);

    await setupVAD();
    setupRingCanvas();
    if (!ringRAF) drawRings();

    callPhase = "greeting";
    renderStatus();
    await playGreetingOnce();

    if (!speakerMuted) await drainTTSQueue();

    setTransientStatus("Blake is here. Go ahead…", PRESENCE_HANDOFF_MS);
    await sleep(Math.min(420, PRESENCE_HANDOFF_MS));

    callPhase = "live";
    renderStatus();

    await startHumeRealtime();
    await startVADLoop();
  } catch (e) {
    warn("startCall error", e);
    setTransientStatus("Mic permission denied.", 2200);
    endCall();
  }
}

function closeAudioContexts() {
  try {
    vadSource?.disconnect();
  } catch {}
  try {
    vadAnalyser?.disconnect?.();
  } catch {}
  vadSource = null;
  vadAnalyser = null;
  vadData = null;

  try {
    vadAC?.close?.();
  } catch {}
  vadAC = null;

  try {
    playbackAC?.suspend?.();
  } catch {}
}

function endCall() {
  isCalling = false;
  callPhase = "idle";
  pausedInBackground = false;

  callBtn?.classList.remove("call-active");
  callBtn?.setAttribute("aria-pressed", "false");
  if (callLabelEl) callLabelEl.textContent = "Start Call";

  stopTimer();

  try {
    if (mergeTimer) clearTimeout(mergeTimer);
  } catch {}
  mergeTimer = null;
  mergedTranscriptBuffer = "";
  isMerging = false;
  vadStartCandidateAt = 0;

  pendingUserTurns.length = 0;
  drainingTurns = false;

  ttsQueue.length = 0;
  ttsDraining = false;

  try {
    transcribeAbort?.abort();
  } catch {}
  try {
    coachAbort?.abort();
  } catch {}
  transcribeAbort = null;
  coachAbort = null;

  isTranscribing = false;
  isThinking = false;

  stopHumeRealtime();
  stopRing();

  try {
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  } catch {}
  mediaRecorder = null;
  isRecording = false;
  recordChunks = [];

  try {
    globalStream?.getTracks().forEach((t) => t.stop());
  } catch {}
  globalStream = null;
  micPromise = null;

  try {
    if (ttsPlayer) {
      playbackEpoch++;
      ttsPlayer.pause();
      ttsPlayer.currentTime = 0;
    }
  } catch {}
  applyActualPlaybackState(false);

  closeAudioContexts();

  setStatus("Call ended.");
  setInterim("");
}

/* ---------- Boot ---------- */
ensureSharedAudio();
renderStatus();
initHumeRealtime().catch(() => {});
log("✅ call.js loaded with single average VAD profile + actual playback speaking state + debug_audio logging");