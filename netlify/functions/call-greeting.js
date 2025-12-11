// netlify/functions/call-greeting.js
// Son of Wisdom — Dynamic AI greeting (ALWAYS transcribable)
// Returns JSON: { text, assistant_text, audio_base64, mime, call_id }
//
// ✅ No static mp3 fallback.
// If ElevenLabs is not configured or fails, returns an error so the client can retry.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "";

function mustHave(value, name) {
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function openaiChat(messages, opts = {}) {
  mustHave(OPENAI_API_KEY, "OPENAI_API_KEY");

  const body = {
    model: OPENAI_MODEL,
    messages,
    temperature: opts.temperature ?? 0.9,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenAI chat ${res.status}: ${t || res.statusText}`);
  }

  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim() || "";
}

async function elevenLabsTTS(text) {
  mustHave(ELEVENLABS_API_KEY, "ELEVENLABS_API_KEY");
  mustHave(ELEVENLABS_VOICE_ID, "ELEVENLABS_VOICE_ID");

  const trimmed = (text || "").trim();
  if (!trimmed) throw new Error("Empty greeting text");

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: trimmed,
      model_id: "eleven_turbo_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.8 },
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS ${res.status}: ${t || res.statusText}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  return { audio_base64: buf.toString("base64"), mime: "audio/mpeg" };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const userId = (body.user_id || "").toString().trim();
    const deviceId = (body.device_id || "").toString().trim();
    const callId = (body.call_id || body.callId || "").toString().trim();

    // 🚀 More varied, in-character, TTS-safe greeting
    const system = `
You are AI Blake, the masculine Christian mentor for Son of Wisdom, speaking in a calm, fatherly, confident tone.

Task:
Generate ONE short spoken greeting to start a live voice call.

Hard rules:
- 1 short sentence, at most 18 words.
- No lists, no markdown, no bullets, no headings.
- Plain conversational text only, TTS friendly.
- Do NOT say "Hello, I'm here to listen and guide you".
- Do NOT say "I'm AI Blake" or explain who you are.
- Avoid repeating the same structure each time (do not always start with "Hello" or "Hi").
- Sound like a seasoned mentor inviting a man to open up.

Style:
- Masculine, warm, direct.
- You can say things like "Alright, let’s slow this down" or "Take a breath, you made it here".
- Invite him to share what is heavy, tense, or on his heart right now.

Output:
Reply with ONLY the greeting sentence, nothing before or after it.
    `.trim();

    const user = `
Generate a fresh greeting for call mode for this user and device.
User: ${userId || "unknown"}
Device: ${deviceId || "unknown"}

Internally, come up with a few different possible greetings and choose one that is not generic or bland.
Remember: output only that one chosen greeting sentence.
    `.trim();

    const text = await openaiChat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { temperature: 0.95, maxTokens: 60 }
    );

    const audio = await elevenLabsTTS(text);

    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        assistant_text: text,
        audio_base64: audio.audio_base64,
        mime: audio.mime || "audio/mpeg",
        call_id: callId || null,
      }),
    };
  } catch (err) {
    console.error("[call-greeting] error:", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: "Server error",
        detail: String(err),
        hint:
          "Greeting has no static fallback now. Ensure OPENAI_API_KEY, ELEVENLABS_API_KEY, and ELEVENLABS_VOICE_ID are set in Netlify env.",
      }),
    };
  }
};
