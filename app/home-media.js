// app/home-media.js
// Son of Wisdom — media helpers for upload / extract / voice

export function createHomeMedia(config = {}) {
  const {
    transcribeUrl,
    uploadUrl,
    extractUrl,
    processUploadUrl,
  } = config;

  let mediaRecorder = null;
  let chunks = [];
  let currentStream = null;
  let audioUnlocked = false;

  function supportsMediaRecorder() {
    return !!(navigator.mediaDevices && window.MediaRecorder);
  }

  async function unlockAudioSystem() {
    if (audioUnlocked) return true;

    try {
      const audio = new Audio();
      audio.volume = 0;
      await audio.play().catch(() => {});
      audio.pause();
      audioUnlocked = true;
      return true;
    } catch {
      return false;
    }
  }

  function stopStreamTracks(stream) {
    if (!stream) return;
    stream.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {}
    });
  }

  async function startRecording() {
    if (!supportsMediaRecorder()) {
      throw new Error("This browser does not support audio recording.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    currentStream = stream;
    chunks = [];

    const preferredMime =
      MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";

    mediaRecorder = new MediaRecorder(
      stream,
      preferredMime ? { mimeType: preferredMime } : undefined
    );

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.start();
    return true;
  }

  async function stopRecording() {
    if (!mediaRecorder) return null;

    const recorder = mediaRecorder;

    const blob = await new Promise((resolve) => {
      recorder.onstop = () => {
        const mime = recorder.mimeType || "audio/webm";
        resolve(new Blob(chunks, { type: mime }));
      };
      recorder.stop();
    });

    stopStreamTracks(currentStream);
    currentStream = null;
    mediaRecorder = null;
    chunks = [];

    return blob;
  }

  function isRecording() {
    return !!mediaRecorder && mediaRecorder.state === "recording";
  }

  async function transcribeAudioBlob(blob) {
    if (!blob) throw new Error("Missing audio blob");

    const fd = new FormData();
    fd.append("file", blob, "voice.webm");
    fd.append("language", "en");

    const res = await fetch(transcribeUrl, {
      method: "POST",
      body: fd,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Transcription failed (${res.status}): ${txt || res.statusText}`);
    }

    return await res.json().catch(() => ({}));
  }

  function pickFileOnce() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".pdf,.txt,.jpg,.jpeg,.png,text/plain,application/pdf,image/jpeg,image/png";
      input.style.display = "none";

      input.addEventListener("change", () => {
        const file = input.files?.[0] || null;
        input.remove();
        resolve(file);
      });

      document.body.appendChild(input);
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
      bucket: meta.bucket || "uploads",
      storage_path: meta.storage_path,
      filename: meta.filename || "file",
      content_type: meta.content_type || "",
      bytes: meta.bytes || 0,
      conversation_id: meta.conversation_id || null,
      user_id: meta.user_id || null,
    };

    const res = await fetch(processUploadUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Process upload ${res.status}: ${t || res.statusText}`);
    }

    return await res.json().catch(() => ({}));
  }

  function normalizeArtifactText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function classifyImageText(text, fileName = "") {
    const s = normalizeArtifactText(text);
    const name = normalizeArtifactText(fileName);

    const hasChatMarkers =
      /\bmessage\b/.test(s) ||
      /\bmessages\b/.test(s) ||
      /\btext message\b/.test(s) ||
      /\bimessage\b/.test(s) ||
      /\bwhatsapp\b/.test(s) ||
      /\btelegram\b/.test(s) ||
      /\bmessenger\b/.test(s) ||
      /\bchat\b/.test(s) ||
      /\breplied\b/.test(s) ||
      /\bdelivered\b/.test(s) ||
      /\bseen\b/.test(s) ||
      /\btyping\b/.test(s) ||
      /\byou:\b/.test(s) ||
      /\bthem:\b/.test(s) ||
      /\bsaid:\b/.test(s) ||
      /\bpm\b/.test(s) ||
      /\bam\b/.test(s);

    const hasTeachingMarkers =
      /\bancient wisdom\b/.test(s) ||
      /\bslavelord\b/.test(s) ||
      /\bfather voice\b/.test(s) ||
      /\bson of wisdom\b/.test(s) ||
      /\bsolomon codex\b/.test(s) ||
      /\bdominion\b/.test(s) ||
      /\bkingship\b/.test(s) ||
      /\bthrone room\b/.test(s) ||
      /\bmegiddo\b/.test(s) ||
      /\bheart\b/.test(s) ||
      /\bsoul\b/.test(s);

    const fileSuggestsScreenshot =
      /\bscreenshot\b/.test(name) ||
      /\bscreen shot\b/.test(name) ||
      /\bchat\b/.test(name) ||
      /\bmessage\b/.test(name) ||
      /\bwhatsapp\b/.test(name);

    const hasDenseTeachingLayout =
      (s.match(/\b[a-z]{4,}\b/g) || []).length > 25 && hasTeachingMarkers;

    if (hasChatMarkers || fileSuggestsScreenshot) return "message_screenshot";
    if (hasTeachingMarkers || hasDenseTeachingLayout) return "teaching_graphic";
    return "general_image";
  }

  function classifyDocumentText(text, fileName = "") {
    const s = normalizeArtifactText(text);
    const name = normalizeArtifactText(fileName);

    const hasStructure =
      /\bsection\b/.test(s) ||
      /\bterms\b/.test(s) ||
      /\bagreement\b/.test(s) ||
      /\bpolicy\b/.test(s) ||
      /\bclause\b/.test(s) ||
      /\barticle\b/.test(s) ||
      /\bliability\b/.test(s) ||
      /\bobligation\b/.test(s) ||
      /\btermination\b/.test(s) ||
      /\bgoverning law\b/.test(s) ||
      /\bprivacy\b/.test(s);

    const hasTeaching =
      /\bancient wisdom\b/.test(s) ||
      /\bslavelord\b/.test(s) ||
      /\bfather voice\b/.test(s) ||
      /\bson of wisdom\b/.test(s) ||
      /\bsolomon codex\b/.test(s) ||
      /\bdominion\b/.test(s) ||
      /\bkingship\b/.test(s) ||
      /\bthrone room\b/.test(s) ||
      /\bmegiddo\b/.test(s);

    const hasCreative =
      /\bverse\b/.test(s) ||
      /\bchorus\b/.test(s) ||
      /\blyrics\b/.test(s) ||
      /\bpoem\b/.test(s) ||
      /\bbridge\b/.test(s) ||
      /\bintro\b/.test(s) ||
      /\boutro\b/.test(s);

    const fileSuggestsCreative =
      /\blyrics\b/.test(name) ||
      /\bpoem\b/.test(name) ||
      /\bsong\b/.test(name);

    const fileSuggestsStructure =
      /\bpolicy\b/.test(name) ||
      /\bagreement\b/.test(name) ||
      /\bterms\b/.test(name) ||
      /\bcontract\b/.test(name);

    if (hasStructure || fileSuggestsStructure) return "structured_document";
    if (hasTeaching) return "teaching_text";
    if (hasCreative || fileSuggestsCreative) return "creative_text";
    return "general_text";
  }

  function getArtifactConfidence({ text, fileName = "", isImage = false }) {
    const s = normalizeArtifactText(text);
    const name = normalizeArtifactText(fileName);

    const wordCount = (s.match(/\b[a-z]{2,}\b/g) || []).length;
    const charCount = s.length;

    const messageSignals = [
      /\bmessage\b/,
      /\bmessages\b/,
      /\bimessage\b/,
      /\bwhatsapp\b/,
      /\bmessenger\b/,
      /\bchat\b/,
      /\breplied\b/,
      /\bseen\b/,
      /\btyping\b/,
      /\byou:\b/,
      /\bthem:\b/,
    ].filter((re) => re.test(s)).length;

    const teachingSignals = [
      /\bancient wisdom\b/,
      /\bslavelord\b/,
      /\bfather voice\b/,
      /\bson of wisdom\b/,
      /\bsolomon codex\b/,
      /\bdominion\b/,
      /\bkingship\b/,
      /\bthrone room\b/,
      /\bmegiddo\b/,
    ].filter((re) => re.test(s)).length;

    const structureSignals = [
      /\bsection\b/,
      /\bterms\b/,
      /\bagreement\b/,
      /\bpolicy\b/,
      /\bclause\b/,
      /\barticle\b/,
      /\bliability\b/,
      /\bobligation\b/,
      /\btermination\b/,
      /\bprivacy\b/,
    ].filter((re) => re.test(s)).length;

    const creativeSignals = [
      /\bverse\b/,
      /\bchorus\b/,
      /\blyrics\b/,
      /\bpoem\b/,
      /\bbridge\b/,
      /\bintro\b/,
      /\boutro\b/,
    ].filter((re) => re.test(s)).length;

    const fileHints = [
      /\bscreenshot\b/.test(name),
      /\bmessage\b/.test(name),
      /\bwhatsapp\b/.test(name),
      /\blyrics\b/.test(name),
      /\bpolicy\b/.test(name),
      /\bagreement\b/.test(name),
      /\bcontract\b/.test(name),
    ].filter(Boolean).length;

    const strongest = Math.max(
      messageSignals,
      teachingSignals,
      structureSignals,
      creativeSignals,
      fileHints
    );

    const lowText = charCount < 80 || wordCount < 14;
    const mediumText = charCount < 180 || wordCount < 30;

    if (lowText && strongest <= 1) {
      return { ambiguous: true, confidence: "low" };
    }

    if (mediumText && strongest <= 1) {
      return { ambiguous: true, confidence: "medium" };
    }

    if (isImage && wordCount < 10 && strongest === 0) {
      return { ambiguous: true, confidence: "low" };
    }

    return {
      ambiguous: false,
      confidence: strongest >= 3 ? "high" : "medium",
    };
  }

  function buildArtifactClarifyChoices(isImage = false) {
    return isImage
      ? [
          { label: "Message screenshot", value: "message_screenshot" },
          { label: "Teaching graphic", value: "teaching_graphic" },
          { label: "General image", value: "general_image" },
        ]
      : [
          { label: "Structured document", value: "structured_document" },
          { label: "Teaching text", value: "teaching_text" },
          { label: "Creative text", value: "creative_text" },
          { label: "General document", value: "general_text" },
        ];
  }

  function buildArtifactUserLabel({ fileName, kind, mode }) {
    const safeName = String(fileName || "file").trim() || "file";
    const k = String(kind || "").toLowerCase();
    const m = String(mode || "").toLowerCase();

    const imageModes = new Set([
      "image",
      "message_screenshot",
      "teaching_graphic",
      "general_image",
    ]);

    if (imageModes.has(k) || imageModes.has(m)) {
      return `Uploaded image: ${safeName}`;
    }

    return `Uploaded file: ${safeName}`;
  }

  function buildImageCoachingPrompt({ fileName, text }) {
    const mode = classifyImageText(text, fileName);
    const safeName = String(fileName || "image").trim() || "image";
    const visibleExtract = String(text || "").trim();

    if (mode === "message_screenshot") {
      return `
ARTIFACT MODE: message_screenshot

The user uploaded an image file named "${safeName}".
This appears to be a screenshot of a message or chat exchange.

Your job:
- respond like Blake
- help the user discern what is happening relationally
- focus on emotional subtext, power, truth, confusion, avoidance, pressure, or manipulation when present
- do not reduce this to a plain summary
- do not sound like an OCR tool
- do not say "key takeaways"
- give relational clarity, not generic communication advice
- if appropriate, name the lie, the hijack, or the pressure in the exchange

Visible extracted content:
${visibleExtract}

Respond briefly, clearly, and with weight.
`.trim();
    }

    if (mode === "teaching_graphic") {
      return `
ARTIFACT MODE: teaching_graphic

The user uploaded an image file named "${safeName}".
This appears to be a teaching graphic, slide, or formation image.

Your job:
- respond like Blake
- reflect on the spiritual meaning, weight, and implications of what is shown
- do not flatten this into a generic summary
- do not sound like a document assistant
- connect to Son of Wisdom / Solomon Codex language where it fits naturally

Visible extracted content:
${visibleExtract}

Respond briefly but with living weight.
`.trim();
    }

    return `
ARTIFACT MODE: general_image

The user uploaded an image file named "${safeName}".

Your job:
- respond like Blake
- interpret what matters in the image
- be practical, direct, and clear
- do not sound robotic
- do not default to summary-bot language

Visible extracted content:
${visibleExtract}

Respond in a short, useful way.
`.trim();
  }

  function buildFilePrompt({ fileName, text, pages = null }) {
    const mode = classifyDocumentText(text, fileName);
    const safeName = String(fileName || "document").trim() || "document";
    const visibleExtract = String(text || "").trim();
    const pageHint = pages ? `Page count: ${pages}\n` : "";

    if (mode === "structured_document") {
      return `
ARTIFACT MODE: structured_document

The user uploaded a document named "${safeName}".

This appears to be a structured, formal, legal, policy, or practical document.

Your job:
- explain what matters in plain language
- highlight obligations, risks, decisions, restrictions, deadlines, or consequences
- be practical and clear
- do not turn this into spiritual commentary unless the content itself calls for it
- do not sound robotic

${pageHint}Document text:
${visibleExtract}

Respond briefly and clearly.
`.trim();
    }

    if (mode === "teaching_text") {
      return `
ARTIFACT MODE: teaching_text

The user uploaded a document named "${safeName}".

This appears to be teaching or formation material.

Your job:
- respond like Blake
- engage the substance, not just summarize it
- reflect weight, clarity, discernment, and spiritual implications
- use Son of Wisdom / Solomon Codex language where appropriate
- avoid summary-bot tone
- do not say "key takeaways include"

${pageHint}Document text:
${visibleExtract}

Respond with brief but meaningful commentary.
`.trim();
    }

    if (mode === "creative_text") {
      return `
ARTIFACT MODE: creative_text

The user uploaded a document named "${safeName}".

This appears to be lyrics, poetry, or creative writing.

Your job:
- respond like Blake
- reflect on meaning, tone, imagery, and spiritual or emotional weight
- do not flatten this into a dry summary
- do not sound like a study assistant

${pageHint}Document text:
${visibleExtract}

Respond briefly but with depth.
`.trim();
    }

    return `
ARTIFACT MODE: general_text

The user uploaded a document named "${safeName}".

Your job:
- read the content and respond helpfully
- be concise, human, and clear
- do not sound robotic
- do not default to summary-bot phrasing

${pageHint}Document text:
${visibleExtract}

Respond in a short useful way.
`.trim();
  }

  return {
    supportsMediaRecorder,
    unlockAudioSystem,
    startRecording,
    stopRecording,
    isRecording,
    transcribeAudioBlob,
    pickFileOnce,
    isImageFile,
    isPdfOrTextFile,
    uploadFileToStorage,
    extractFileText,
    processUploadIndex,
    classifyImageText,
    classifyDocumentText,
    getArtifactConfidence,
    buildArtifactClarifyChoices,
    buildArtifactUserLabel,
    buildImageCoachingPrompt,
    buildFilePrompt,
  };
}