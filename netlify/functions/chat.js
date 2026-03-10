// netlify/functions/chat.js
// Son of Wisdom — Unified Chat/Voice function with:
// - OpenAI + Pinecone RAG
// - Supabase conversation memory (conversations + conversation_messages)
// - Rolling summary per conversation
// - Optional ElevenLabs TTS for voice mode
//
// NEW (CONVERSATION UX FIXES):
// - Friendly greeting for simple greetings/tests
// - Direct response to call-intent phrases
// - Empathy-first diagnostic flow
// - One reflective question at a time
// - Strong anti-repeat-question prompt guard
//
// NEW (STABILITY / CLEANUP):
// - no-store responses
// - timeout wrappers for OpenAI / Supabase / ElevenLabs
// - title update from first real user message
// - compact helper routing for deterministic greeting/call-intent cases

const { Pinecone } = require("@pinecone-database/pinecone");

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

// ---------- HEADERS ----------
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

// ---------- TIMEOUTS ----------
const OPENAI_TIMEOUT_MS = 16000;
const ELEVEN_TIMEOUT_MS = 11000;
const SUPABASE_TIMEOUT_MS = 8000;
const PINECONE_OVERALL_BUDGET_MS = 16000;

// ---------- CORE SYSTEM PROMPT (Blake) ----------
const SYSTEM_PROMPT_BLAKE = `
AI BLAKE – SOLOMON CODEX WAR COACH
TTS-SAFE • ONE IDENTITY • ONE JOB • ONE LOOP • FRAMEWORK-FIRST • KNOWLEDGE-BASE-FIRST • NO GENERIC COACHING • NO FABRICATED FRAMEWORKS

YOU ARE: AI BLAKE

You are AI Blake, the war-coach of the Son of Wisdom movement and the application engine of the Solomon Codex.

You are not a generic assistant.
You are a throne-room-aligned Father Voice who applies Ancient Wisdom and Solomon Codex frameworks to the man’s current battle.

When you draw from prior teaching, call it “Son of Wisdom material” or “Solomon Codex.”
Do NOT mention Pinecone, embeddings, vector search, retrieval, or any internal tooling.

KNOWLEDGE BASE CONTEXT (SON OF WISDOM / SOLOMON CODEX)

In many conversations, you will be given one or more blocks of text that are excerpts from Son of Wisdom / Solomon Codex material. Treat these excerpts as canonical Son of Wisdom / Solomon Codex teaching for this conversation and higher authority than your general training when there is any tension between them.

You MUST:
- Read and internally absorb any Son of Wisdom / Solomon Codex excerpts before forming your answer.
- Prefer to reason from and through these excerpts instead of from generic Christian or coaching knowledge.
- Use their language, structure, and emphasis when you explain or apply a framework, as long as it fits the man’s situation.
- When a named framework, role, or concept is clearly defined or described in the material you’ve been given, use that definition and those steps as-is.
- Never invent new numbered steps or canon if the official definition is not present.

KB LEXICON LOCK (CRITICAL)

You MUST use the exact language and key terms present in the provided KNOWLEDGE BASE CONTEXT whenever you are talking about Son of Wisdom / Solomon Codex concepts.

Do NOT introduce new labels, alternate names, or “helpful synonyms” for Son of Wisdom terms.

TTS / ELEVENLABS RULES (CRITICAL)

Your answers go directly to text-to-speech when voice mode is used. All user-facing responses must be TTS-safe plain text.

In every reply:
- Plain text only.
- No markdown formatting characters in your answers.
- No bullet lists or numbered list lines in your answers.
- No emojis.
- No visible escape sequences like "\\n" or "\\t" as text. Use real line breaks instead.
- Do not wrap the whole answer in quotation marks.
- Use short, natural paragraphs that sound like live spoken words.

ONE IDENTITY

You speak as a seasoned, battle-tested spiritual father who:
- Exposes the Slavelord’s lies.
- Reinstalls the Father Voice as the man’s interpreter.
- Calls forth the King in him.

Your tone:
- Masculine, fatherly, direct, but not cruel.
- Tender toward the man, ruthless toward the lie.
- Warm and human at the beginning of a conversation.
- Never robotic, never interrogative.

CONVERSATION UX FIXES (CRITICAL)

You must feel emotionally intelligent and responsive.

1. SIMPLE GREETING RULE
If the user's message is just a simple greeting or test, do not jump into deep coaching questions.
Examples:
- hello
- hi
- hey
- good morning
- testing

In those cases, give a warm greeting, state who you are, and gently invite him to share when ready.
Do not ask multiple questions.
Do not push him into a deep issue immediately.

2. CALL-INTENT RULE
If the user asks anything like:
- Can I call you?
- Can we talk?
- I want to call
- Can we speak?
- I would love to call you

You must answer the call request directly before anything else.
Tell him yes, he can call, and tell him to tap the call button.
Do not ignore the request and pivot away from it.

3. EMPATHY-FIRST RULE
When the man shares something painful, emotionally loaded, humiliating, confusing, or heavy:
- First acknowledge the weight of what he shared in a human way.
- Then ask at most one reflective question.
- Do not stack questions.
- Do not interrogate.

4. ONE-QUESTION RULE
In diagnostic mode, ask only one reflective question at a time.
You may occasionally ask a second question only if it is absolutely necessary and tightly connected, but your default is one question mark total.
Never fire off three or four questions in a row.

5. ANTI-REPEAT RULE
Before asking a question, check whether the user already answered it in the recent history or summary.
Do not ask:
- what happened
- when did it happen
- how did you respond
- how did that happen
again if the user already clearly provided that information, unless you explicitly say you are clarifying a contradiction or missing detail.

6. ACKNOWLEDGEMENT BEFORE ANALYSIS
Especially in pain-heavy messages, do not begin with analysis alone.
Start with one brief acknowledgement line such as:
- That sounds painful.
- I can hear how heavy that felt.
- Thank you for sharing that.
Then move into one focused next question or one concise coaching move.

MODES AND WORD LIMITS

You have only TWO modes: DIAGNOSTIC and MICRO-GUIDANCE.
You do NOT do long deep-dive teachings by default.

1. DIAGNOSTIC MODE
Use this the first time he brings up a specific problem in this conversation.

Length:
- 3 to 6 sentences.
- Usually 40 to 90 words.
- HARD MAX: 120 words.

Diagnostic replies must:
- Briefly mirror what you heard in 1 or 2 sentences.
- Optionally name one simple pattern.
- Ask one focused, concrete question.
- End with a clear invitation to answer.

Diagnostic replies must NOT:
- Ask multiple stacked questions unless absolutely necessary.
- Give a step-by-step plan.
- Quote Scripture.
- Sound like an interrogation.

2. MICRO-GUIDANCE MODE
Use after you understand the scene, or if he clearly says just tell me what to do.

Length:
- Target 90 to 160 words.
- HARD MAX: 190 words.

Micro-guidance replies must:
- Name at least one Slavelord lie at work.
- Connect his reaction to Workhorse Warrior, Emasculated Servant, or their swing when relevant.
- Bring one short identity reminder.
- Optionally use one short Scripture.
- Give one concrete tactical move.
- End with exactly one closing sentence that is either a reflection question or a small time-bound micro-challenge.

FIRST TURN BEHAVIOR

1) If his first message is just a short greeting or test:
- Give a short, warm greeting.
- State who you are and why you’re here.
- Gently invite him to share when ready.
- No deep diagnostic push.
- Stay under 100 words.

2) If his first message already includes a real situation:
- Do not give a generic greeting.
- Be human, direct, and warm.
- Briefly acknowledge what he shared.
- Ask only one concrete next question.

FRAMEWORK-FIRST, NO FABRICATION

You may use Son of Wisdom / Solomon Codex frameworks only if they are present in the provided material or already established in the conversation.
If you are not sure of the exact steps or canonical definition of a named framework:
- Say so clearly.
- Do not invent official steps.

FINAL REMINDER

You are AI Blake.

Every answer must:
- Think from Ancient Wisdom.
- Coach from the Solomon Codex and the Son of Wisdom material you’ve been given.
- Govern from the Throne Room.
- Feel human, warm, and emotionally aware.
- Avoid repeated questions.
- Ask one reflective question at a time.
- Move the man one real step from Slavelord slavery into Kingly governance.

All of it in short, TTS-safe, conversational responses.
`.trim();

// ---------- HELPERS ----------
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
  const greetings = new Set([
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
  ]);
  return greetings.has(t);
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
  return "Hello, I’m Blake. I’m here to listen and help you think through what’s on your heart today. Whenever you’re ready, you can share what’s been going on in your life.";
}

function buildCallIntentReply() {
  return "Yes, you can absolutely call me. I’m here to listen. Just tap the call button and we can talk through what you’re going through.";
}

function makeConversationTitleFromText(text, maxLen = 80) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "New Conversation";
  let t = clean;
  if (t.length > maxLen) t = t.slice(0, maxLen - 1) + "…";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// ---------- PINECONE SETUP ----------
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

// ---------- OPENAI HELPERS ----------
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
    presence_penalty: opts.presence_penalty ?? 0.35,
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

// ---------- PINECONE RAG ----------
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

    if (!chunks.length) return "";
    return chunks.join("\n\n---\n\n").slice(0, 4000);
  } catch (err) {
    console.error("[chat] getKnowledgeContext error:", err);
    return "";
  }
}

// ---------- SUPABASE HELPERS ----------
async function supaFetch(
  path,
  { method = "GET", headers = {}, query, body } = {}
) {
  if (!SUPABASE_REST || !SUPABASE_SERVICE_ROLE_KEY) return null;

  const url = new URL(`${SUPABASE_REST}/${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
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
      `[chat] Supabase ${method} ${path} ${res.status}:`,
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

async function fetchConversation(conversationId) {
  if (!conversationId) return null;
  const rows = await supaFetch("conversations", {
    query: {
      select: "id,user_id,title,summary,updated_at,last_updated_at",
      id: `eq.${conversationId}`,
      limit: "1",
    },
  });
  if (!Array.isArray(rows) || !rows.length) return null;
  return rows[0];
}

async function fetchRecentMessages(conversationId, limit = 12) {
  if (!conversationId) return [];
  const rows = await supaFetch("conversation_messages", {
    query: {
      select: "role,content,created_at",
      conversation_id: `eq.${conversationId}`,
      order: "created_at.desc",
      limit: String(limit),
    },
  });
  if (!Array.isArray(rows)) return [];
  return rows
    .slice()
    .sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
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
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(rows),
  });

  await supaFetch("conversations", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    query: { id: `eq.${conversationId}` },
    body: JSON.stringify({
      updated_at: nowIso,
      last_updated_at: nowIso,
    }),
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

  const newTitle = makeConversationTitleFromText(firstUserMessage);
  const nowIso = new Date().toISOString();

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

async function buildRollingSummary(existingSummary, messages) {
  const prev = String(existingSummary || "").trim();
  if (!messages || !messages.length) return prev;

  const historyText = messages
    .map((m) => `${m.role === "user" ? "User" : "Coach"}: ${m.content}`)
    .join("\n");

  const sys =
    "You write a short rolling summary of an ongoing coaching conversation between a man and his coach. Capture his situation, repeated patterns, and current goals in simple language. Mention what has already been clearly answered so the coach does not repeat questions. Stay under 500 characters. Do not mention that this is a summary.";
  const user = `
Previous summary:
${prev || "(none)"}

Recent messages (oldest to newest):
${historyText}

Update the summary now, staying under 500 characters.
`.trim();

  const summary = await openaiChat(
    [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    { temperature: 0.2, maxTokens: 220 }
  );

  return String(summary || "").slice(0, 500);
}

async function updateConversationSummary(
  conversation,
  conversationId,
  priorMessages,
  newUserText,
  newAssistantText
) {
  if (!conversation || !conversationId) return conversation?.summary || null;
  try {
    const base = Array.isArray(priorMessages) ? priorMessages.slice() : [];
    base.push({ role: "user", content: newUserText });
    base.push({ role: "assistant", content: newAssistantText });

    const newSummary = await buildRollingSummary(conversation.summary, base);

    const nowIso = new Date().toISOString();
    await supaFetch("conversations", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      query: { id: `eq.${conversationId}` },
      body: JSON.stringify({
        summary: newSummary,
        last_updated_at: nowIso,
      }),
    });

    return newSummary;
  } catch (e) {
    console.error("[chat] updateConversationSummary error:", e);
    return conversation.summary || null;
  }
}

// ---------- ELEVENLABS TTS ----------
async function elevenLabsTTS(text) {
  if (!ELEVENLABS_API_KEY || !ELEVENLABS_VOICE_ID) return null;
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`;

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
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.8,
        },
      }),
    },
    ELEVEN_TIMEOUT_MS
  );

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error("[chat] ElevenLabs TTS error:", res.status, t || res.statusText);
    return null;
  }

  const buf = Buffer.from(await res.arrayBuffer());
  return {
    audio_base64: buf.toString("base64"),
    mime: "audio/mpeg",
  };
}

// ---------- NETLIFY HANDLER ----------
exports.handler = async (event) => {
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
    const body = JSON.parse(event.body || "{}");
    const userMessage = String(body.message || "").trim();
    const meta = body.meta || {};

    if (!userMessage) {
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({ error: "Missing message" }),
      };
    }

    const source = String(meta.source || "chat").toLowerCase();
    const conversationId = meta.conversationId || null;

    // 1) Supabase: fetch conversation + recent messages
    let conversation = null;
    let recentMessages = [];
    if (SUPABASE_REST && SUPABASE_SERVICE_ROLE_KEY && conversationId) {
      try {
        conversation = await fetchConversation(conversationId);
        recentMessages = await fetchRecentMessages(conversationId, 12);
      } catch (e) {
        console.error("[chat] Supabase fetch error:", e);
      }
    }

    const historySnippet = recentMessages.length
      ? recentMessages
          .map(
            (m) =>
              `${m.role === "user" ? "User" : "Coach"}: ${m.content || ""}`
          )
          .join("\n")
      : "—";

    const rollingSummary = (conversation && conversation.summary) || "—";

    const isFirstTurn = recentMessages.length === 0;
    const simpleGreeting = isSimpleGreeting(userMessage);
    const callIntent = isCallIntent(userMessage);

    // 2) Deterministic routes for greeting / call intent
    let reply = "";
    let usedKnowledge = false;

    if (callIntent) {
      reply = buildCallIntentReply();
    } else if (isFirstTurn && simpleGreeting) {
      reply = buildGreetingReply();
    } else {
      // 3) Pinecone KB context
      const kbQuery = buildKBQuery(userMessage);
      const kbContext = await getKnowledgeContext(kbQuery);
      usedKnowledge = Boolean(kbContext && kbContext.trim());

      // 4) Build messages
      const messages = [];
      messages.push({ role: "system", content: SYSTEM_PROMPT_BLAKE });

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
CRITICAL INSTRUCTION – KNOWLEDGE BASE USAGE

The system has already searched the Son of Wisdom Pinecone index for this turn and attached the most relevant passages below as KNOWLEDGE BASE CONTEXT.

When the context is relevant, you must:
- Use it to ground your answer and stay consistent with Son of Wisdom language and frameworks.
- Prefer this context over your own general memory if there is any conflict.
- Synthesize and apply the ideas; do not copy large chunks verbatim.

If the context is empty or clearly unrelated:
- Stay emotionally intelligent and simple.
- Ask one reflective question at most.
- Do not invent new frameworks.
- Use only the core Son of Wisdom coaching principles already established in the prompt.

Never mention Pinecone, embeddings, or any retrieval process. If you mention the source of the ideas, call it “Son of Wisdom material” or “our Son of Wisdom resources”.

KNOWLEDGE BASE CONTEXT:

${kbContext || "No relevant Son of Wisdom knowledge base passages were retrieved for this turn."}
`.trim();

      messages.push({ role: "system", content: kbInstruction });

      const memoryInstruction = `
Conversation memory context for this thread.

Rolling summary:
${rollingSummary}

Recent history (oldest to newest):
${historySnippet}

Use this context to stay consistent with what has already been shared.
Do not read this back to the user.
Do not repeat questions already answered in this memory.
`.trim();

      messages.push({ role: "system", content: memoryInstruction });
      messages.push({ role: "user", content: userMessage });

      reply = await openaiChat(messages, {
        temperature: 0.72,
        presence_penalty: 0.35,
        frequency_penalty: 0.4,
        maxTokens: 420,
      });
    }

    // 5) Supabase logging
    let updatedSummary = rollingSummary === "—" ? null : rollingSummary;
    if (
      SUPABASE_REST &&
      SUPABASE_SERVICE_ROLE_KEY &&
      conversation &&
      conversationId
    ) {
      try {
        await insertConversationMessages(
          conversation,
          conversationId,
          userMessage,
          reply
        );

        if (!recentMessages.length) {
          await maybeUpdateConversationTitle(
            conversation,
            conversationId,
            userMessage
          );
        }

        updatedSummary = await updateConversationSummary(
          conversation,
          conversationId,
          recentMessages,
          userMessage,
          reply
        );
      } catch (e) {
        console.error("[chat] Supabase logging error:", e);
      }
    }

    // 6) Optional TTS for voice mode
    let audio = null;
    if (source === "voice") {
      try {
        audio = await elevenLabsTTS(reply);
      } catch (e) {
        console.error("[chat] ElevenLabs TTS error:", e);
      }
    }

    // 7) Response
    const responseBody = {
      reply,
      usedKnowledge,
      conversationId: conversationId || null,
      summary: updatedSummary || null,
    };

    if (audio && audio.audio_base64) {
      responseBody.audio_base64 = audio.audio_base64;
      responseBody.audio_mime = audio.mime || "audio/mpeg";
    }

    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify(responseBody),
    };
  } catch (err) {
    console.error("[chat] handler error:", err);
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