// netlify/functions/openai-transcribe.js
export async function handler(event) {
  try {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    };

    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: { ...cors, "Cache-Control": "no-store" }, body: "" };
    }

    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: { ...cors, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Method not allowed" }),
      };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { ...cors, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing OPENAI_API_KEY env var" }),
      };
    }

    // Expect multipart/form-data from the browser
    // Netlify provides raw body; we forward it to OpenAI as-is.
    const contentType = event.headers["content-type"] || event.headers["Content-Type"];
    if (!contentType?.includes("multipart/form-data")) {
      return {
        statusCode: 400,
        headers: { ...cors, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Expected multipart/form-data" }),
      };
    }

    const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        // IMPORTANT: keep the boundary from the incoming request
        "Content-Type": contentType,
      },
      body: event.isBase64Encoded ? Buffer.from(event.body, "base64") : event.body,
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      return {
        statusCode: resp.status,
        headers: { ...cors, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "OpenAI transcribe failed", details: txt || resp.statusText }),
      };
    }

    const data = await resp.json();
    return {
      statusCode: 200,
      headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ text: data.text || "" }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Server error", details: String(e?.message || e) }),
    };
  }
}
