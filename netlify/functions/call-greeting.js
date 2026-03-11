// netlify/functions/call-greeting.js
// Son of Wisdom — Dynamic AI greeting (front-door locked)
// Returns JSON: { text, assistant_text, audio_base64?, mime, call_id, audio_expected, audio_missing?, audio_error? }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const noStoreHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

const CALL_SESSIONS_TABLE = "call_sessions";
const CONVERSATION_MESSAGES_TABLE = "conversation_messages";
const SENTINEL_UUID = "00000000-0000-0000-0000-000000000000";

/* ---------- Utilities ---------- */
function safeJsonParse(str) {
  try {
    return JSON.parse(str || "{}");
  } catch {
    return {};
  }
}

function isUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v || ""
  );
}

function pickUuidForHistory(userId) {
  if (!userId) return SENTINEL_UUID;
  if (isUuid(userId)) return userId;
  return SENTINEL_UUID;
}

function randomSeed() {
  return Math.random().toString(36).slice(2) + "-" + Date.now();
}

function withTimeout(ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  return { signal: ac.signal, clear: () => clearTimeout(t) };
}

function clampPlainText(s, maxChars = 220) {
  const clean = String(s || "")
    .replace(/[#*_>`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  if (clean.length <= maxChars) return clean;
  return clean.slice(0, maxChars - 1).trim() + "…";
}

function fallbackGreeting() {
  const options = [
    "Hey brother. I’m Blake. Take a breath and settle in. I’m here with you. When you’re ready, tell me what’s been weighing on you.",
    "Hey. I’m Blake. Take a breath and settle in for a second. You don’t have to carry this alone. When you’re ready, tell me what’s sitting heavy on your heart.",
    "Hey brother. I’m Blake. Settle in and take one breath. I’m here with you, and when you’re ready, you can tell me what’s going on.",
  ];
  return options[Math.floor(Math.random() * options.length)];
}

/* ---------- OpenAI ---------- */
async function openaiChat(messages, opts = {}) {
  if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

  const body = {
    model: OPENAI_MODEL,
    messages,
    temperature: opts.temperature ?? 0.72,
    presence_penalty: opts.presence_penalty ?? 0.35,
    frequency_penalty: opts.frequency_penalty ?? 0.4,
    max_tokens: opts.maxTokens ?? 90,
  };

  if (opts.user) body.user = opts.user;

  const to = withTimeout(opts.timeoutMs ?? 18000);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: to.signal,
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`OpenAI chat ${res.status}: ${t || res.statusText}`);
    }

    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || "";
  } finally {
    to.clear();
  }
}

/* ---------- ElevenLabs ---------- */
async function elevenLabsTTS(text, opts = {}) {
  if (!ELEVENLABS_API_KEY || !ELEVENLABS_VOICE_ID) {
    return {
      audio_base64: null,
      mime: "audio/mpeg",
      error: "Missing ELEVENLABS env vars",
    };
  }

  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return {
      audio_base64: null,
      mime: "audio/mpeg",
      error: "Empty greeting text",
    };
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`;
  const to = withTimeout(opts.timeoutMs ?? 22000);

  try {
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
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.8,
        },
      }),
      signal: to.signal,
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return {
        audio_base64: null,
        mime: "audio/mpeg",
        error: `ElevenLabs ${res.status}: ${t || res.statusText}`,
      };
    }

    const buf = Buffer.from(await res.arrayBuffer());
    return {
      audio_base64: buf.toString("base64"),
      mime: "audio/mpeg",
      error: null,
    };
  } catch (e) {
    const msg =
      e?.name === "AbortError" ? "ElevenLabs timeout" : String(e?.message || e);
    return { audio_base64: null, mime: "audio/mpeg", error: msg };
  } finally {
    to.clear();
  }
}

/* ---------- Supabase best-effort logging ---------- */
async function supabaseInsert(table, rows) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;

  const payload = Array.isArray(rows) ? rows : [rows];

  try {
    const url = `${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.warn("[call-greeting] Supabase insert error", table, res.status, t);
    }
  } catch (err) {
    console.warn("[call-greeting] Supabase insert failed", table, err);
  }
}

/* ---------- Greeting prompt ---------- */
function buildGreetingSystem(styleSeed) {
  return `
You are AI Blake.

Your only job right now is to speak the opening greeting for a live voice call.

IDENTITY
- masculine
- fatherly
- grounded
- warm
- direct
- present
- not generic
- not polished like customer support
- not a therapist
- not preachy

GOAL
- welcome the man into the call
- help him settle
- make him feel accompanied
- invite him to speak when ready

STRICT RULES
- 2 to 4 short sentences
- under 60 words
- plain text only
- no markdown
- no bullet points
- no emojis
- no sermon tone
- no stacked questions
- no "How can I help you today?"
- no "What challenge are you facing today?"
- no corporate empathy
- do not sound like an assistant

REQUIRED SHAPE
- begin simply
- say your name naturally
- include one settling line like "take a breath" or "settle in"
- reassure him he does not have to carry it alone
- end with one gentle invitation to share when ready

VARIATION
- vary the exact wording a little
- keep the same emotional shape every time
- optional tone seed: ${styleSeed}
`.trim();
}

/* ---------- Handler ---------- */
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: noStoreHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: noStoreHeaders,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const body = safeJsonParse(event.body);

    const userIdRaw = String(body.user_id || body.userId || "").trim();
    const deviceId = String(body.device_id || body.deviceId || "").trim();
    const callId = String(body.call_id || body.callId || "").trim() || null;
    const conversationId =
      String(body.conversationId || body.conversation_id || body.c || "").trim() ||
      null;

    const seed = randomSeed();
    const styleSeeds = [
      "steady and brotherly",
      "calm and weighty",
      "simple and fatherly",
      "warm and grounded",
    ];
    const styleSeed =
      styleSeeds[Math.floor(Math.random() * styleSeeds.length)];

    let text = "";

    try {
      const rawText = await openaiChat(
        [
          { role: "system", content: buildGreetingSystem(styleSeed) },
          {
            role: "user",
            content: `Generate the greeting now. Seed: ${seed}`,
          },
        ],
        {
          temperature: 0.78,
          maxTokens: 90,
          timeoutMs: 18000,
          user: deviceId || userIdRaw || "sow",
          presence_penalty: 0.3,
          frequency_penalty: 0.45,
        }
      );

      text = clampPlainText(rawText, 220);
    } catch (e) {
      console.warn("[call-greeting] OpenAI greeting failed, using fallback:", e);
      text = fallbackGreeting();
    }

    if (!text) text = fallbackGreeting();

    const audio_expected = true;
    const ttsRes = await elevenLabsTTS(text, { timeoutMs: 22000 });

    const nowIso = new Date().toISOString();
    const userUuid = pickUuidForHistory(userIdRaw);

    if (callId) {
      supabaseInsert(CALL_SESSIONS_TABLE, {
        call_id: callId,
        user_id_uuid: userUuid,
        input_transcript: null,
        ai_text: text,
        source: "voice_greeting",
        system_event: null,
        created_at: nowIso,
        timestamp: nowIso,
      }).catch(() => {});
    }

    if (conversationId) {
      supabaseInsert(CONVERSATION_MESSAGES_TABLE, {
        conversation_id: conversationId,
        role: "assistant",
        content: text,
        source: "voice_greeting",
        call_id: callId,
        created_at: nowIso,
      }).catch(() => {});
    }

    const resp = {
      text,
      assistant_text: text,
      call_id: callId,
      mime: "audio/mpeg",
      audio_expected,
    };

    if (ttsRes?.audio_base64) {
      resp.audio_base64 = ttsRes.audio_base64;
      resp.mime = ttsRes.mime || "audio/mpeg";
    } else {
      resp.audio_missing = true;
      if (ttsRes?.error) resp.audio_error = String(ttsRes.error).slice(0, 180);
    }

    return {
      statusCode: 200,
      headers: noStoreHeaders,
      body: JSON.stringify(resp),
    };
  } catch (err) {
    console.error("[call-greeting] error:", err);

    const fallback = fallbackGreeting();
    return {
      statusCode: 200,
      headers: noStoreHeaders,
      body: JSON.stringify({
        text: fallback,
        assistant_text: fallback,
        mime: "audio/mpeg",
        audio_expected: true,
        audio_missing: true,
        audio_error: "Greeting function error",
      }),
    };
  }
};