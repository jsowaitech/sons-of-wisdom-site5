// app/home-media.js
// Son of Wisdom — Home media/helpers
// Audio playback, mic recording, transcription, file selection/upload/extract/index

export function createHomeMedia(config = {}) {
  const {
    transcribeUrl,
    uploadUrl,
    extractUrl,
    processUploadUrl,
  } = config;

  const IS_IOS =
    /iPad|iPhone|iPod/i.test(navigator.userAgent || "") ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  let ttsPlayer = null;
  let audioUnlocked = false;

  let recording = false;
  let mediaStream = null;
  let mediaRecorder = null;
  let mediaChunks = [];
  let chosenMime = { mime: "audio/webm;codecs=opus", ext: "webm" };

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

  async function startRecording(onStateChange) {
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
    if (typeof onStateChange === "function") onStateChange(true);
  }

  async function stopRecording(onStateChange) {
    if (!recording || !mediaRecorder) return null;

    return new Promise((resolve) => {
      mediaRecorder.onstop = async () => {
        recording = false;
        if (typeof onStateChange === "function") onStateChange(false);

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
        if (typeof onStateChange === "function") onStateChange(false);
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

    const res = await fetch(transcribeUrl, {
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

  function pickFileOnce() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept =
        ".pdf,.txt,.jpg,.jpeg,.png,text/plain,application/pdf,image/jpeg,image/png";
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

  function isImageFile(file) {
    if (!file) return false;
    const type = String(file.type || "").toLowerCase();
    const name = String(file.name || "").toLowerCase();
    return (
      type.startsWith("image/") ||
      name.endsWith(".jpg") ||
      name.endsWith(".jpeg") ||
      name.endsWith(".png")
    );
  }

  function isPdfOrTextFile(file) {
    if (!file) return false;
    const type = String(file.type || "").toLowerCase();
    const name = String(file.name || "").toLowerCase();
    return (
      type === "application/pdf" ||
      type.startsWith("text/") ||
      name.endsWith(".pdf") ||
      name.endsWith(".txt")
    );
  }

  async function uploadFileToStorage(file, meta = {}) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("user_id", meta.user_id || "anon");
    fd.append("conversation_id", meta.conversation_id || "");
    fd.append("device_id", meta.device_id || "");
    fd.append("page", meta.page || "home");
    fd.append("timestamp", meta.timestamp || new Date().toISOString());

    const res = await fetch(uploadUrl, { method: "POST", body: fd });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Upload ${res.status}: ${t || res.statusText}`);
    }

    return await res.json().catch(() => ({}));
  }

  async function extractFileText(file) {
    const fd = new FormData();
    fd.append("file", file);

    const res = await fetch(extractUrl, { method: "POST", body: fd });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Extract ${res.status}: ${t || res.statusText}`);
    }
    return await res.json().catch(() => ({}));
  }

  async function processUploadIndex(meta) {
    const payload = {
      storage_path: meta.storage_path || meta.path || meta.storagePath || "",
      filename: meta.filename || meta.fileName || "",
      content_type: meta.content_type || meta.mime || meta.contentType || "",
      bytes: meta.bytes || meta.size || null,
      conversation_id: meta.conversation_id || null,
      user_id: meta.user_id || null,
      bucket: meta.bucket || "uploads",
    };

    const res = await fetch(processUploadUrl, {
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

  function buildFilePrompt({ fileName, text, pages }) {
    const safeName = fileName || "file";
    const pageNote = pages ? ` (${pages} pages)` : "";

    return `
You received an uploaded document: "${safeName}"${pageNote}.

Do these:
1. Give a concise summary.
2. Pull out key takeaways and action items.
3. If it's a contract, policy, or plan, list risks and missing info.
4. End with 3 questions to ask the user next.

Document text:
${text}
`.trim();
  }

  function buildImageCoachingPrompt({ fileName, text }) {
  const safeName = fileName || "image";

  return `
The user uploaded an image or screenshot named "${safeName}".

Below is the extracted visible content from that image.

You are AI Blake.

Treat this as real-life relational coaching context, not like a document summary.

If this appears to be:
- a hard text exchange
- a spouse message
- a conflict screenshot
- an emotionally loaded conversation
then respond like Blake would respond to a man showing him something that landed hard in his heart.

Your job:
- Briefly acknowledge the emotional weight or relational tension that appears to be present
- Do not overclaim certainty about motive, tone, or intent
- Do not summarize like a report
- Do not sound like customer support
- Do not sound like a document analyst
- If something is clearly visible, reference it naturally
- Help the user locate what happened in him when he saw or read it
- Ask only ONE grounded follow-up question
- Sound warm, fatherly, direct, and human
- Stay concise

Better tone:
- I can see why that would land heavy.
- There is weight in that exchange.
- I can see how that could stir something in you.
- That message carries tension.

Avoid tone like:
- Here is a summary of the uploaded content
- The screenshot appears to contain
- The document indicates
- This image shows

Visible extracted content:
${text}
`.trim();
}

  function getRecordingState() {
    return recording;
  }

  function getChosenMime() {
    return chosenMime;
  }

  return {
    unlockAudioSystem,
    base64ToBlobUrl,
    playAudioUrl,
    startRecording,
    stopRecording,
    transcribeAudio,
    pickFileOnce,
    uploadFileToStorage,
    extractFileText,
    processUploadIndex,
    buildFilePrompt,
    buildImageCoachingPrompt,
    getRecordingState,
    getChosenMime,
    isImageFile,
    isPdfOrTextFile,
  };
}