// netlify/functions/call-coach.js
// Son of Wisdom — Voice / Call coach (Netlify Function)
//
// Includes:
// - friendly greeting handling
// - direct call-intent handling
// - empathy-first diagnostic behavior
// - one-question-at-a-time pressure
// - anti-repeat question logic
// - unified context pipeline
// - title updates
// - TTS debug instrumentation

const { Pinecone } = require("@pinecone-database/pinecone");
const crypto = require("crypto");
const { buildUnifiedContext } = require("./lib/context-builder.cjs");

// ---------- ENV ----------
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_EMBED_MODEL =
  process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";

const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_INDEX = process.env.PINECONE_INDEX;
const PINECONE_NAMESPACE = process.env.PINECONE_NAMESPACE || undefined;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_REST = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1` : null;

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "";

const SENTINEL_UUID = "00000000-0000-0000-0000-000000000000";
const USER_UUID_OVERRIDE = process.env.USER_UUID_OVERRIDE || null;

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

// ---------- Timeouts ----------
const OPENAI_TIMEOUT_MS = 16000;
const ELEVEN_TIMEOUT_MS = 11000;
const SUPABASE_TIMEOUT_MS = 8000;
const PINECONE_OVERALL_BUDGET_MS = 16000;

// ---------- fetch helper with timeout ----------
async function fetchWithTimeout(url, opts = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

// ---------- SINGLE-FLIGHT + DEDUPE ----------
const INFLIGHT = new Map();
const RECENT_TURNS = new Map();
const DEDUPE_WINDOW_MS = 2500;

function stableKey(callId, deviceId, conversationId) {
  return `${callId || "no_call"}|${deviceId || "no_device"}|${
    conversationId || "no_conv"
  }`;
}

function hashText(t) {
  return crypto
    .createHash("sha1")
    .update(String(t || "").trim())
    .digest("hex");
}

function isDuplicateTurn(key, transcript) {
  const h = hashText(transcript);
  const now = Date.now();
  const prev = RECENT_TURNS.get(key);
  if (prev && prev.hash === h && now - prev.at < DEDUPE_WINDOW_MS) return true;
  RECENT_TURNS.set(key, { hash: h, at: now });
  return false;
}

async function singleFlight(key, fn) {
  if (INFLIGHT.has(key)) return INFLIGHT.get(key);
  const p = (async () => {
    try {
      return await fn();
    } finally {
      INFLIGHT.delete(key);
    }
  })();
  INFLIGHT.set(key, p);
  return p;
}

// ---------- SYSTEM PROMPT ----------
const SYSTEM_PROMPT_BLAKE = `AI BLAKE – SOLOMON CODEX WAR COACH
TTS-SAFE • ONE IDENTITY • ONE JOB • ONE LOOP • FRAMEWORK-FIRST • KNOWLEDGE-BASE-FIRST • NO GENERIC COACHING • NO FABRICATED FRAMEWORKS

YOU ARE: AI BLAKE

You are AI Blake, the war-coach of the Son of Wisdom movement and the application engine of the Solomon Codex.

You are not a generic assistant.
You are a throne-room-aligned Father Voice who applies Ancient Wisdom and Solomon Codex frameworks to the man’s current battle.

When you draw from prior teaching, call it “Son of Wisdom material” or “Solomon Codex.”
Do NOT mention Pinecone, embeddings, vector search, or any internal tooling.

KNOWLEDGE BASE CONTEXT (SON OF WISDOM / SOLOMON CODEX)

Treat any provided excerpts as canonical Son of Wisdom / Solomon Codex teaching for this conversation.
Prefer them over generic training whenever there is tension.

You MUST:
- Read and absorb Son of Wisdom / Solomon Codex excerpts before answering.
- Prefer to reason from and through these excerpts.
- Use their language, structure, and emphasis when relevant.
- Never invent new numbered steps or canon if the official definition is not present.

KB LEXICON LOCK (CRITICAL)

You MUST use the exact language and key terms present in the provided KNOWLEDGE BASE CONTEXT whenever you are talking about Son of Wisdom / Solomon Codex concepts.

Do NOT introduce new labels, alternate names, or “helpful synonyms” for Son of Wisdom terms.

TTS RULES

Your answers go directly to text-to-speech.
Use plain text only.
No markdown.
No bullets.
No emojis.
Use short natural paragraphs.

CONVERSATION UX FIXES

1. SIMPLE GREETING RULE
If the user's message is just a simple greeting or test, do not jump into deep coaching questions.

2. CALL-INTENT RULE
If the user asks to call or speak, answer that directly first and tell him to tap the call button.

3. EMPATHY-FIRST RULE
When the man shares something painful, emotionally loaded, humiliating, confusing, or heavy:
- First acknowledge the weight of what he shared in a human way.
- Then ask at most one reflective question.
- Do not stack questions.
- Do not interrogate.

4. ONE-QUESTION RULE
In diagnostic mode, ask only one reflective question at a time.

5. ANTI-REPEAT RULE
Before asking a question, check whether the user already answered it in the recent history or summary.
Do not repeat already-answered questions unless you are explicitly clarifying something missing.

FIRST TURN BEHAVIOR

If his first message is just a short greeting or test:
- Give a short, warm greeting.
- State who you are and why you’re here.
- Gently invite him to share when ready.
- No deep diagnostic push.

If his first message already includes a real situation:
- Be human, direct, and warm.
- Briefly acknowledge what he shared.
- Ask only one concrete next question.

FINAL REMINDER

Every answer must:
- Think from Ancient Wisdom.
- Coach from Solomon Codex and Son of Wisdom material provided.
- Feel human, warm, and emotionally aware.
- Avoid repeated questions.
- Ask one reflective question at a time.
`.trim();

const KB_LEXICON_LOCK = `
KB LEXICON LOCK (CRITICAL)

You MUST use the exact language and key terms present in the provided KNOWLEDGE BASE CONTEXT whenever you are talking about Son of Wisdom / Solomon Codex concepts.

Do NOT introduce new labels, alternate names, or “helpful synonyms” for Son of Wisdom terms.
`.trim();

// ---------- Pinecone setup ----------
let pineconeClient = null;
let pineconeIndex = null;

function ensurePinecone() {
  if (!PINECONE_API_KEY || !PINECONE_INDEX) return null;
  if (!pineconeClient) {
    pineconeClient = new Pinecone({ apiKey: PINECONE_API_KEY });
    pineconeIndex = pineconeClient.index(PINECONE_INDEX);
  }
  return pineconeIndex;
}

// ---------- helpers ----------
function isUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v || ""
  );
}

function pickUuidForHistory(userId) {
  if (USER_UUID_OVERRIDE && isUuid(USER_UUID_OVERRIDE)) return USER_UUID_OVERRIDE;
  if (isUuid(userId)) return userId;
  return SENTINEL_UUID;
}

function safeJsonParse(s, fallback = {}) {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return fallback;
  }
}

function clampTtsSafe(text, maxChars = 1200) {
  let s = String(text || "");

  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  s = s.replace(/[#*_>`]/g, "");
  s = s
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n");
  s = s.replace(/\n{3,}/g, "\n\n").trim();

  if (!s) return "";
  if (s.length <= maxChars) return s;

  return s.slice(0, maxChars - 1).trim() + "…";
}

function makeConversationTitleFromText(text, maxLen = 80) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "New Conversation";
  let t = clean;
  if (t.length > maxLen) t = t.slice(0, maxLen - 1) + "…";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isSimpleGreeting(text) {
  const t = normalizeText(text);
  if (!t) return false;
  return new Set([
    "hi",
    "hello",
    "hey",
    "good morning",
    "good afternoon",
    "good evening",
    "testing",
    "test",
    "hello there",
    "hey there",
  ]).has(t);
}

function isCallIntent(text) {
  const t = normalizeText(text);
  if (!t) return false;
  return [
    "can i call you",
    "can we talk",
    "can we speak",
    "i want to call",
    "i would love to call you",
    "id love to call you",
    "i want to talk to you",
    "can i speak to you",
    "can i talk to you",
  ].some((p) => t.includes(p));
}

function buildGreetingReply() {
  return "Hello, I’m AI Blake. I’m here to listen and help you think through what’s on your heart as a man. Whenever you’re ready, you can share what’s been going on in your life, marriage, kids, or work.";
}

function buildCallIntentReply() {
  return "Yes, you can absolutely call me. I’m here to listen. Just tap the call button and we can talk through what you’re going through.";
}

function makeDebugAudioBase({
  requestId,
  source,
  conversationId,
  callId,
  deviceId,
  userText,
}) {
  return {
    request_id: requestId,
    source: source || null,
    conversation_id: conversationId || null,
    call_id: callId || null,
    device_id: deviceId || null,
    user_text_chars: String(userText || "").length,
    started_at: new Date().toISOString(),
  };
}

// ---------- OpenAI helpers ----------
async function openaiEmbedding(text) {
  if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

  const res = await fetchWithTimeout(
    "https://api.openai.com/v1/embeddings",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_EMBED_MODEL,
        input: String(text || "").slice(0, 8000),
      }),
    },
    OPENAI_TIMEOUT_MS
  );

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenAI embeddings ${res.status}: ${t || res.statusText}`);
  }

  const data = await res.json();
  const vec = data?.data?.[0]?.embedding;
  if (!Array.isArray(vec)) throw new Error("No embedding returned");
  return vec;
}

async function openaiChat(messages, opts = {}) {
  if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

  const body = {
    model: OPENAI_MODEL,
    messages,
    temperature: opts.temperature ?? 0.7,
    presence_penalty: opts.presence_penalty ?? 0.4,
    frequency_penalty: opts.frequency_penalty ?? 0.35,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;

  const res = await fetchWithTimeout(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    OPENAI_TIMEOUT_MS
  );

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenAI chat ${res.status}: ${t || res.statusText}`);
  }

  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim() || "";
}

// ---------- Pinecone RAG ----------
function buildKBQuery(userMessage) {
  if (!userMessage) return "";
  const words = String(userMessage).split(/\s+/).filter(Boolean);
  return words.slice(0, 18).join(" ");
}

async function getKnowledgeContext(question, topK = 10) {
  const started = Date.now();
  try {
    const index = ensurePinecone();
    if (!index || !question) return "";

    const vector = await openaiEmbedding(question);

    if (Date.now() - started > PINECONE_OVERALL_BUDGET_MS) return "";

    const target =
      PINECONE_NAMESPACE && typeof index.namespace === "function"
        ? index.namespace(PINECONE_NAMESPACE)
        : index;

    const queryRes = await target.query({
      vector,
      topK,
      includeMetadata: true,
    });

    const matches = queryRes?.matches || [];
    if (!matches.length) return "";

    const chunks = matches
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .map((m) => {
        const md = m.metadata || {};
        return md.text || md.chunk || md.content || md.body || "";
      })
      .filter(Boolean)
      .slice(0, 12);

    return chunks.join("\n\n---\n\n").slice(0, 4500);
  } catch (err) {
    console.error("[call-coach] getKnowledgeContext error:", err);
    return "";
  }
}

// ---------- KB rewrite ----------
async function rewriteToKbLexicon(draft, kbContext) {
  const kb = String(kbContext || "").trim();
  if (!kb) return draft;

  const messages = [
    {
      role: "system",
      content: `
You are a strict editor.
Rewrite the assistant response so it uses ONLY the language and key terms found in the KNOWLEDGE BASE CONTEXT.
Keep it plain text, no markdown, no bullets, no emojis.
Preserve the meaning, but conform the wording to the knowledge base.
`.trim(),
    },
    {
      role: "system",
      content: `KNOWLEDGE BASE CONTEXT:\n${kb}`.trim(),
    },
    {
      role: "user",
      content: `DRAFT RESPONSE:\n${String(draft || "").trim()}`.trim(),
    },
  ];

  const rewritten = await openaiChat(messages, {
    temperature: 0.2,
    presence_penalty: 0.1,
    frequency_penalty: 0.1,
    maxTokens: 420,
  });

  return clampTtsSafe(rewritten || draft, 1200);
}

// ---------- Supabase REST helper ----------
async function supaFetch(
  path,
  { method = "GET", headers = {}, query, body } = {}
) {
  if (!SUPABASE_REST || !SUPABASE_SERVICE_ROLE_KEY) return null;

  const url = new URL(`${SUPABASE_REST}/${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  }

  const res = await fetchWithTimeout(
    url.toString(),
    {
      method,
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        ...headers,
      },
      body,
    },
    SUPABASE_TIMEOUT_MS
  );

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error(
      `[call-coach] Supabase ${method} ${path} ${res.status}:`,
      txt || res.statusText
    );
    throw new Error(`Supabase ${method} ${path} ${res.status}`);
  }

  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function insertConversationMessages(
  conversation,
  conversationId,
  userText,
  assistantText
) {
  if (!conversation || !conversationId || !conversation.user_id) return;

  const nowIso = new Date().toISOString();
  const rows = [
    {
      conversation_id: conversationId,
      user_id: conversation.user_id,
      role: "user",
      content: String(userText || "").trim(),
      created_at: nowIso,
    },
    {
      conversation_id: conversationId,
      user_id: conversation.user_id,
      role: "assistant",
      content: String(assistantText || "").trim(),
      created_at: nowIso,
    },
  ];

  await supaFetch("conversation_messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(rows),
  });

  await supaFetch("conversations", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    query: { id: `eq.${conversationId}` },
    body: JSON.stringify({ updated_at: nowIso, last_updated_at: nowIso }),
  });
}

async function maybeUpdateConversationTitle(
  conversation,
  conversationId,
  firstUserMessage
) {
  if (!conversation || !conversationId || !firstUserMessage) return;

  const current = String(conversation.title || "").trim();
  if (current && current !== "New Conversation") return;

  const nowIso = new Date().toISOString();
  const newTitle = makeConversationTitleFromText(firstUserMessage);

  await supaFetch("conversations", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    query: { id: `eq.${conversationId}` },
    body: JSON.stringify({
      title: newTitle,
      updated_at: nowIso,
      last_updated_at: nowIso,
    }),
  });
}

// ---------- ElevenLabs TTS ----------
async function elevenLabsTTS(text, debugAudio = null) {
  if (!ELEVENLABS_API_KEY || !ELEVENLABS_VOICE_ID) {
    return { audio: null, error: "Missing ELEVENLABS env vars", debugAudio };
  }

  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return { audio: null, error: "Empty TTS text", debugAudio };
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`;

  if (debugAudio) {
    debugAudio.tts_requested = true;
    debugAudio.tts_request_started_at = new Date().toISOString();
    debugAudio.tts_text_chars = trimmed.length;
    debugAudio.tts_voice_id = ELEVENLABS_VOICE_ID;
    debugAudio.tts_model = "eleven_turbo_v2";
  }

  const started = Date.now();

  const res = await fetchWithTimeout(
    url,
    {
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
    },
    ELEVEN_TIMEOUT_MS
  );

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    if (debugAudio) {
      debugAudio.tts_failed = true;
      debugAudio.tts_status = res.status;
      debugAudio.tts_error = (t || res.statusText || "").slice(0, 240);
      debugAudio.tts_duration_ms = Date.now() - started;
    }
    return {
      audio: null,
      error: `ElevenLabs ${res.status}: ${t || res.statusText}`,
      debugAudio,
    };
  }

  const buf = Buffer.from(await res.arrayBuffer());

  if (debugAudio) {
    debugAudio.tts_succeeded = true;
    debugAudio.tts_status = res.status;
    debugAudio.tts_duration_ms = Date.now() - started;
    debugAudio.tts_audio_bytes = buf.length;
    debugAudio.tts_response_received_at = new Date().toISOString();
  }

  return {
    audio: { audio_base64: buf.toString("base64"), mime: "audio/mpeg" },
    error: null,
    debugAudio,
  };
}

async function tryInsertCallSession(row) {
  if (!SUPABASE_REST || !SUPABASE_SERVICE_ROLE_KEY) return;

  const baseHeaders = {
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };

  try {
    await supaFetch("call_sessions", {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify([row]),
    });
  } catch {
    try {
      const clone = { ...row };
      delete clone.created_at;
      delete clone.timestamp;
      await supaFetch("call_sessions", {
        method: "POST",
        headers: baseHeaders,
        body: JSON.stringify([clone]),
      });
    } catch (e2) {
      console.error("[call-coach] call_sessions insert error:", e2);
    }
  }
}

// ---------- Netlify handler ----------
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: { ...corsHeaders, "Cache-Control": "no-store" },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: noStoreHeaders,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const body = safeJsonParse(event.body, {});
    const nowIso = new Date().toISOString();

    const source = String(body.source || "voice").toLowerCase();

    const conversationId =
      body.conversationId || body.conversation_id || body.c || null;
    const callId = body.call_id || body.callId || null;
    const deviceId = body.device_id || body.deviceId || null;

    const rawUtterance = String(
      body.user_turn || body.utterance || body.transcript || ""
    ).trim();
    const userMessageForAI = String(body.transcript || rawUtterance || "").trim();

    if (!rawUtterance && !userMessageForAI) {
      return {
        statusCode: 400,
        headers: noStoreHeaders,
        body: JSON.stringify({ error: "Missing transcript" }),
      };
    }

    const requestId =
      crypto.randomUUID?.() || `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    const key = stableKey(callId, deviceId, conversationId);

    if (isDuplicateTurn(key, userMessageForAI)) {
      return {
        statusCode: 200,
        headers: noStoreHeaders,
        body: JSON.stringify({
          skipped_duplicate: true,
          assistant_text: "",
          text: "",
          conversationId: conversationId || null,
          call_id: callId || null,
          audio_expected: source === "voice" || source === "chat",
          debug_audio: {
            request_id: requestId,
            duplicate_skipped: true,
          },
        }),
      };
    }

    const result = await singleFlight(key, async () => {
      const debugAudio = makeDebugAudioBase({
        requestId,
        source,
        conversationId,
        callId,
        deviceId,
        userText: userMessageForAI,
      });

      debugAudio.unified_context_started_at = new Date().toISOString();

      const unified = await buildUnifiedContext({
        conversationId,
        userMessage: userMessageForAI,
        fetchRecentLimit: 16,
        includeFileContext: true,
        supaFetch,
        openaiEmbedding,
        getKnowledgeContext,
        buildKBQuery,
      });

      debugAudio.unified_context_finished_at = new Date().toISOString();
      debugAudio.used_knowledge = Boolean(unified.usedKnowledge);
      debugAudio.used_file_context = Boolean(unified.usedFileContext);
      debugAudio.recent_message_count = unified.recentMessages?.length || 0;

      const conversation = unified.conversation || null;
      const recentMessages = unified.recentMessages || [];
      const historySnippet = unified.historySnippet || "—";
      const conversationSummary = unified.conversationSummary || "—";
      const kbContext = unified.kbContext || "";
      const usedKnowledge = Boolean(unified.usedKnowledge);
      const fileContext = unified.fileContext || "";
      const usedFileContext = Boolean(unified.usedFileContext);

      const isFirstTurn = (recentMessages?.length || 0) === 0;
      const simpleGreeting = isSimpleGreeting(userMessageForAI);
      const callIntent = isCallIntent(userMessageForAI);

      let rawReply = "";

      if (callIntent) {
        debugAudio.route = "call_intent";
        rawReply = buildCallIntentReply();
      } else if (isFirstTurn && simpleGreeting) {
        debugAudio.route = "simple_greeting";
        rawReply = buildGreetingReply();
      } else {
        debugAudio.route = "llm";

        const messages = [];
        messages.push({ role: "system", content: SYSTEM_PROMPT_BLAKE });
        messages.push({ role: "system", content: KB_LEXICON_LOCK });

        const antiRepeatGuard = `
ANTI-REPEAT ENFORCEMENT
You have access to recent history and summary.
Before asking any question, check whether the user already answered it.
If he already answered it, do not ask it again.
Prefer one reflective question total.
When in doubt, acknowledge first and ask less.
`.trim();
        messages.push({ role: "system", content: antiRepeatGuard });

        const kbInstruction = `
CRITICAL INSTRUCTION – KNOWLEDGE BASE LANGUAGE ONLY

You must ground your response in the KNOWLEDGE BASE CONTEXT below.
Use only the naming, key terms, and phrasing style found there.

If the KNOWLEDGE BASE CONTEXT is empty or not relevant:
- Do NOT introduce new frameworks or new named concepts.
- Stay emotionally intelligent and simple.
- Ask one reflective question at most.

KNOWLEDGE BASE CONTEXT:
${kbContext || "EMPTY"}
`.trim();
        messages.push({ role: "system", content: kbInstruction });

        if (usedFileContext) {
          const fileInstruction = `
CONVERSATION FILE CONTEXT (USER UPLOADED)

The user has uploaded files earlier in this conversation. The following excerpts are from those files.
Use them as factual context and reference them naturally if relevant.
Do not read this block back verbatim.

FILE EXCERPTS:
${fileContext}
`.trim();
          messages.push({ role: "system", content: fileInstruction });
        }

        const memoryInstruction = `
Conversation memory context for this thread.

Rolling summary:
${conversationSummary}

Recent history (oldest to newest):
${historySnippet}

Use this context to stay consistent.
Do not repeat questions already answered in this memory.
`.trim();
        messages.push({ role: "system", content: memoryInstruction });

        messages.push({ role: "user", content: userMessageForAI });

        try {
          debugAudio.llm_started_at = new Date().toISOString();
          rawReply = await openaiChat(messages, {
            temperature: 0.72,
            presence_penalty: 0.4,
            frequency_penalty: 0.45,
            maxTokens: 420,
          });
          debugAudio.llm_finished_at = new Date().toISOString();
        } catch (e) {
          console.error("[call-coach] OpenAI chat error:", e);
          debugAudio.llm_failed = true;
          debugAudio.llm_error = String(e?.message || e).slice(0, 180);
          rawReply =
            "I’m here with you. Take one breath and say that again in one clear sentence so I can stay with you.";
        }
      }

      let reply = clampTtsSafe(rawReply, 1200);

      try {
        reply = await rewriteToKbLexicon(reply, kbContext);
      } catch (e) {
        console.error("[call-coach] rewriteToKbLexicon error:", e);
        debugAudio.rewrite_failed = true;
        debugAudio.rewrite_error = String(e?.message || e).slice(0, 180);
        reply = clampTtsSafe(reply, 1200);
      }

      debugAudio.reply_chars = reply.length;

      if (SUPABASE_REST && SUPABASE_SERVICE_ROLE_KEY) {
        const userId = String(body.user_id || "");
        const userUuid = pickUuidForHistory(userId);

        try {
          await tryInsertCallSession({
            user_id_uuid: userUuid,
            device_id: deviceId || null,
            call_id: callId || null,
            source,
            input_transcript: userMessageForAI,
            ai_text: reply,
            used_file_context: usedFileContext ? true : false,
            created_at: nowIso,
          });
        } catch (e) {
          console.error("[call-coach] call_sessions insert error:", e);
        }

        if (conversation && conversationId) {
          try {
            await insertConversationMessages(
              conversation,
              conversationId,
              userMessageForAI,
              reply
            );

            if (!recentMessages.length) {
              await maybeUpdateConversationTitle(
                conversation,
                conversationId,
                userMessageForAI
              );
            }
          } catch (e) {
            console.error("[call-coach] conversation logging error:", e);
          }
        }
      }

      const audio_expected = source === "voice" || source === "chat";
      let audio = null;
      let audio_error = null;

      if (audio_expected) {
        try {
          const ttsRes = await elevenLabsTTS(reply, debugAudio);
          audio = ttsRes?.audio || null;
          audio_error = ttsRes?.error || null;
          if (ttsRes?.debugAudio) {
            Object.assign(debugAudio, ttsRes.debugAudio);
          }
          if (audio_error) {
            console.error("[call-coach] TTS error:", audio_error);
          }
        } catch (e) {
          audio_error = String(e?.message || e);
          debugAudio.tts_failed = true;
          debugAudio.tts_throw = String(e?.message || e).slice(0, 180);
          console.error("[call-coach] TTS throw:", e);
        }
      }

      debugAudio.finished_at = new Date().toISOString();

      const responseBody = {
        text: reply,
        assistant_text: reply,
        usedKnowledge,
        usedFileContext,
        conversationId: conversationId || null,
        call_id: callId || null,
        audio_expected,
        debug_audio: debugAudio,
      };

      if (audio && audio.audio_base64) {
        responseBody.audio_base64 = audio.audio_base64;
        responseBody.mime = audio.mime || "audio/mpeg";
      } else if (audio_expected) {
        responseBody.audio_missing = true;
        if (audio_error) {
          responseBody.audio_error = String(audio_error).slice(0, 180);
        }
      }

      return responseBody;
    });

    return {
      statusCode: 200,
      headers: noStoreHeaders,
      body: JSON.stringify(result),
    };
  } catch (err) {
    console.error("[call-coach] handler error:", err);
    return {
      statusCode: 500,
      headers: noStoreHeaders,
      body: JSON.stringify({
        error: "Server error",
        detail: String(err?.message || err),
      }),
    };
  }
};