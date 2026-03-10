// netlify/functions/openai-transcribe.js
// Son of Wisdom — OpenAI Transcribe proxy (Netlify Function, Node 18+)
//
// FIX:
// - defaults transcription language to English
// - accepts optional multipart field: language
// - returns debug info for language/model when useful
// - keeps tiny-blob guard and timeout behavior

import Busboy from "busboy";

function withTimeout(ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  return { signal: ac.signal, clear: () => clearTimeout(t) };
}

function normalizeMime(m) {
  const mime = String(m || "").toLowerCase();
  if (
    mime.includes("mp4") ||
    mime.includes("m4a") ||
    mime.includes("quicktime")
  ) {
    return "audio/mp4";
  }
  if (mime.includes("ogg")) return "audio/ogg";
  return mime || "audio/webm";
}

function normalizeLanguage(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "en";

  const allowed = new Set([
    "en",
    "en-us",
    "en-gb",
    "ko",
    "ja",
    "es",
    "fr",
    "de",
    "pt",
    "it",
    "tl",
    "fil",
  ]);

  if (allowed.has(raw)) {
    if (raw === "en-us" || raw === "en-gb") return "en";
    if (raw === "fil") return "tl";
    return raw;
  }

  return "en";
}

export const handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  const jsonHeaders = {
    ...cors,
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: jsonHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: jsonHeaders,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ error: "Missing OPENAI_API_KEY env var" }),
    };
  }

  const MODEL =
    process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";

  try {
    const contentType =
      event.headers["content-type"] || event.headers["Content-Type"] || "";

    if (!String(contentType).includes("multipart/form-data")) {
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({ error: "Expected multipart/form-data" }),
      };
    }

    const bb = Busboy({ headers: { "content-type": contentType } });

    let audioBuffer = null;
    let audioFilename = "audio.webm";
    let audioMime = "audio/webm";
    let gotFileField = "";
    let requestedLanguage = "en";

    bb.on("file", (fieldname, file, info) => {
      if (fieldname !== "audio" && fieldname !== "file") {
        file.resume();
        return;
      }

      gotFileField = fieldname;

      const { filename, mimeType } = info || {};
      if (filename) audioFilename = filename;
      if (mimeType) audioMime = mimeType;

      const chunks = [];
      file.on("data", (d) => chunks.push(d));
      file.on("end", () => {
        audioBuffer = Buffer.concat(chunks);
      });
    });

    bb.on("field", (fieldname, value) => {
      if (fieldname === "language") {
        requestedLanguage = normalizeLanguage(value);
      }
    });

    const finished = new Promise((resolve, reject) => {
      bb.on("finish", resolve);
      bb.on("error", reject);
    });

    const bodyBuf = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64")
      : Buffer.from(event.body || "", "utf8");

    bb.end(bodyBuf);
    await finished;

    if (!audioBuffer || !audioBuffer.length) {
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({
          error: "Missing audio file",
          hint: "Send multipart/form-data with 'audio' or 'file'.",
        }),
      };
    }

    if (audioBuffer.length < 8000) {
      return {
        statusCode: 200,
        headers: jsonHeaders,
        body: JSON.stringify({
          text: "",
          skipped: true,
          reason: "audio_too_small",
          bytes: audioBuffer.length,
          language: requestedLanguage,
        }),
      };
    }

    audioMime = normalizeMime(audioMime);

    const fd = new FormData();
    fd.append(
      "file",
      new Blob([audioBuffer], { type: audioMime }),
      audioFilename
    );
    fd.append("model", MODEL);
    fd.append("language", requestedLanguage);
    fd.append("response_format", "json");

    const timeout = withTimeout(25000);

    let resp;
    try {
      resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: fd,
        signal: timeout.signal,
      });
    } finally {
      timeout.clear();
    }

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      return {
        statusCode: resp.status,
        headers: jsonHeaders,
        body: JSON.stringify({
          error: "OpenAI transcribe failed",
          details: txt || resp.statusText,
          model: MODEL,
          language: requestedLanguage,
          field: gotFileField || null,
        }),
      };
    }

    const data = await resp.json().catch(() => ({}));

    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({
        text: data?.text || "",
        language: requestedLanguage,
        model: MODEL,
      }),
    };
  } catch (e) {
    const msg =
      e?.name === "AbortError"
        ? "Transcription timeout"
        : String(e?.message || e);

    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({
        error: "Server error",
        details: msg,
      }),
    };
  }
};