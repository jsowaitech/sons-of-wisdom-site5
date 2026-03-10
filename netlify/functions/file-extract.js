// netlify/functions/file-extract.js
// Son of Wisdom — File Extractor (PDF + TXT + image vision)
// Node 18+ ESM
//
// Accepts: multipart/form-data
// Field: "file"
// Returns: { text, fileName, mime, pages, chars, kind }

import Busboy from "busboy";
import { extractTextFromBuffer } from "./lib/extract-text.js";

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

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_VISION_MODEL =
  process.env.OPENAI_VISION_MODEL ||
  process.env.OPENAI_MODEL ||
  "gpt-4.1-mini";

function isImage(filename = "", mime = "") {
  const fn = String(filename).toLowerCase();
  const m = String(mime).toLowerCase();
  return (
    m.startsWith("image/") ||
    fn.endsWith(".jpg") ||
    fn.endsWith(".jpeg") ||
    fn.endsWith(".png") ||
    fn.endsWith(".webp")
  );
}

function toDataUrl(buffer, mime = "image/jpeg") {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

async function visionExtractFromImage(buffer, filename, mime) {
  if (!OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY for image analysis");
  }

  const imageUrl = toDataUrl(buffer, mime || "image/jpeg");

  const prompt = `
Extract the useful readable content from this uploaded image for coaching.

Priorities:
- If it is a screenshot of messages, transcribe the visible conversation cleanly.
- If it is a document screenshot, extract the readable text.
- If it is not mainly text, describe the important visible content briefly.
- Preserve the wording as faithfully as possible when text is visible.
- Do not add commentary, therapy, or coaching.
- Return plain text only.

If names or message senders are visible, include them as they appear.
If some text is unreadable, say [unreadable].
`.trim();

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_VISION_MODEL,
      temperature: 0.1,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: imageUrl,
                detail: "high",
              },
            },
          ],
        },
      ],
      max_tokens: 1200,
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Vision extract failed ${res.status}: ${t || res.statusText}`);
  }

  const data = await res.json().catch(() => ({}));
  const text = String(data?.choices?.[0]?.message?.content || "").trim();

  return {
    text,
    pages: null,
    chars: text.length,
    kind: "image",
    fileName: filename,
    mime,
  };
}

export const handler = async (event) => {
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

    let fileBuffer = null;
    let filename = "upload";
    let mime = "application/octet-stream";

    bb.on("file", (fieldname, file, info) => {
      if (fieldname !== "file") {
        file.resume();
        return;
      }

      const { filename: fn, mimeType } = info || {};
      if (fn) filename = fn;
      if (mimeType) mime = mimeType;

      const chunks = [];
      file.on("data", (d) => chunks.push(d));
      file.on("end", () => {
        fileBuffer = Buffer.concat(chunks);
      });
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

    if (!fileBuffer || !fileBuffer.length) {
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({ error: "No file received" }),
      };
    }

    let extracted;

    if (isImage(filename, mime)) {
      extracted = await visionExtractFromImage(fileBuffer, filename, mime);
    } else {
      extracted = await extractTextFromBuffer(fileBuffer, filename, mime);
    }

    if (extracted.kind === "unsupported") {
      return {
        statusCode: 415,
        headers: jsonHeaders,
        body: JSON.stringify({
          error: "Unsupported file type",
          supported: ["pdf", "txt", "jpg", "jpeg", "png", "webp"],
          mime,
          fileName: filename,
        }),
      };
    }

    if (!extracted.text) {
      return {
        statusCode: 200,
        headers: jsonHeaders,
        body: JSON.stringify({
          text: "",
          fileName: filename,
          mime,
          pages: extracted.pages ?? null,
          chars: 0,
          kind: extracted.kind || null,
          warning: "No readable text found",
        }),
      };
    }

    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({
        text: extracted.text,
        fileName: filename,
        mime,
        pages: extracted.pages ?? null,
        chars: extracted.chars ?? extracted.text.length ?? 0,
        kind: extracted.kind || null,
      }),
    };
  } catch (err) {
    console.error("[file-extract] error:", err);
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({
        error: "Server error",
        detail: String(err?.message || err),
      }),
    };
  }
};