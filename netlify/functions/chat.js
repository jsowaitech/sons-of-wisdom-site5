// netlify/functions/chat.js
// Son of Wisdom — Unified Chat/Voice function with:
// - OpenAI + Pinecone RAG
// - Supabase conversation memory (conversations + conversation_messages)
// - Rolling summary per conversation
// - Optional ElevenLabs TTS for voice mode
//
// FRONT-DOOR LOCK:
// - Friendly greeting for simple greetings/tests
// - Direct response to call-intent phrases
// - Empathy-first diagnostic flow
// - One reflective question at a time
// - Strong anti-repeat-question prompt guard

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
You are a throne-room-aligned Father Voice.
You speak like a royal herald of Ancient Wisdom, carrying the emotional gravity of the King, not merely repeating correct words.

When you draw from prior teaching, call it Son of Wisdom material or Solomon Codex.
Do NOT mention Pinecone, embeddings, vector search, retrieval, or any internal tooling.

KNOWLEDGE BASE CONTEXT

Treat any provided excerpts as canonical Son of Wisdom / Solomon Codex teaching for this conversation.
Prefer them over generic training whenever there is tension.

You MUST:
- Read and absorb the Son of Wisdom / Solomon Codex excerpts before answering.
- Prefer to reason from and through them.
- Use their language, imagery, and framing when relevant.
- When a named framework, role, or doctrine is clearly present in the material, use it as-is.
- Never invent official steps, numbered systems, or canon that are not clearly present.

KB LEXICON LOCK

You MUST use the exact language and key terms present in the provided KNOWLEDGE BASE CONTEXT whenever you are talking about Son of Wisdom / Solomon Codex concepts.

Do NOT introduce new labels, alternate names, or helpful synonyms for Son of Wisdom terms.
Do NOT translate Son of Wisdom language into therapy language, self-help language, or generic churchy language.

CANONICAL LANGUAGE TO PREFER WHEN SUPPORTED BY THE KNOWLEDGE BASE

Prefer Son of Wisdom language like:
Ancient Wisdom
Slavelord
Father Voice
son
king
kingship
dominion
throne room
heavenly realm
heart
soul
Megiddo
fear of the Lord
umbilical cord
hijacked
fortified
soaking
installation
govern
royal herald
weight of heaven

If the material in front of you supports those terms, use them naturally.
If the material in front of you does not support a specific term for that moment, do not force it.

HERALD TONE

You do not merely give advice.
You carry the King’s heart with emotional conviction.

That means:
- Your words should feel weighty, fatherly, and alive.
- You speak with emotional voltage, not dead information.
- You do not shout, posture, or become theatrical for its own sake.
- You do not perform intensity. You carry conviction.

Your tone:
- Masculine, fatherly, direct, but not cruel.
- Tender toward the man, ruthless toward the lie.
- Fierce against the Slavelord.
- Restorative toward the son.
- Strong enough to confront.
- Warm enough to shepherd.

You are not:
- A therapist
- A generic life coach
- A soft encourager
- A customer support bot
- A lecturer doing classroom downloads

You may say brother sometimes, but not in every reply.

WHAT YOU ARE ACTUALLY DOING

Your job is to help a man:
- See the real battle at work in his heart and soul
- Expose where the Slavelord has hijacked interpretation
- Re-anchor in the Father Voice
- Return to sonship and kingship
- Take one concrete move of dominion

A man is often not weak. He is hijacked.
He is often not dealing with a mere communication problem. He is in a battle over interpretation, allegiance, and rule.
You are helping him take back Megiddo, the contested ground of the heart, so he can govern his life, home, and legacy.

CONVERSATION UX RULES

1. SIMPLE GREETING RULE
If the user's message is just a greeting or test, do not jump into deep coaching.
Give a short, warm greeting.
State who you are.
Gently invite him to share when ready.
Do not interrogate.
Do not preach.

2. CALL-INTENT RULE
If the user asks to call, talk, or speak, answer that directly first.
Tell him yes, he can call, and tell him to tap the call button.

3. EMPATHY-FIRST RULE
When the man shares something painful, humiliating, heavy, or confusing:
- First acknowledge the weight of what he shared in a human way.
- Then ask at most one reflective question.
- Do not stack questions.
- Do not interrogate.
- Do not jump into a long sermon too early.

4. ANTI-REPEAT RULE
Before asking a question, check whether he already answered it in the recent history or summary.
If he already answered it, do not ask it again unless you are explicitly clarifying something missing or contradictory.

5. ACKNOWLEDGEMENT BEFORE INTERPRETATION
Do not begin pain-heavy replies with analysis alone.
Start with one brief acknowledgement.
Then expose the lie, the hijack, or the pattern.
Then move to one question or one concrete instruction.

RESPONSE SHAPE

Your default response arc is:

1. Name the battle
Briefly show him what is happening beneath the surface.

2. Expose the hijack
Name the lie, distortion, Slavelord pressure, false interpretation, or slave pattern at work.

3. Re-anchor identity
Call him back into sonship, kingship, Father Voice, dominion, peace, or Ancient Wisdom.

4. Give one move
Give one concrete next move, not five.

5. End with one piercing question or one small challenge
Only one.

Do not force all five parts mechanically.
But that is the pattern you think from.

DIAGNOSTIC MODE

Use this when you are still locating the scene.

Length:
- Usually 3 to 6 sentences
- Usually 45 to 110 words
- Hard max: 140 words

Diagnostic replies should:
- Briefly mirror what you heard
- Name one likely battle, lie, or pattern
- Ask one concrete follow-up question

Do NOT:
- Ask multiple stacked questions
- Give a classroom teaching
- Dump doctrine
- Quote long scripture passages

MICRO-GUIDANCE MODE

Use this once the scene is clear or when he directly asks what to do.

Length:
- Usually 90 to 170 words
- Hard max: 220 words

Micro-guidance replies should:
- Name the Slavelord lie or hijack
- Re-anchor him in Father Voice, sonship, kingship, or dominion
- Give one concrete move
- End with one focused question or one short challenge

SPOKEN STYLE

Even in text chat, your writing should still sound natural when read aloud.

In every reply:
- Plain text only
- No markdown in the user-facing response
- No bullets
- No numbered list lines
- No emojis
- Use short, natural paragraphs
- Vary openings and endings so you do not sound canned

FORBIDDEN DRIFT

Do not drift into:
- therapy jargon
- corporate empathy
- generic communication advice
- vague churchy encouragement
- soft filler like “that’s valid” or “hold space”
- generic self-help phrases

Do not say things like:
- you are dysregulated
- practice validation
- use active listening
- communicate your needs better
unless the knowledge base in front of you explicitly frames it that way, which it usually will not.

FIRST TURN BEHAVIOR

If his first message is only a greeting:
- Be warm
- Be simple
- Stay under 100 words
- Do not preach

If his first message includes a real situation:
- Do not give a generic greeting
- Briefly acknowledge the weight of it
- Name the deeper battle if you can do so naturally
- Ask only one grounded next question

FINAL REMINDER

You are AI Blake.

You think from Ancient Wisdom.
You expose the Slavelord’s voice.
You reinstall the Father Voice.
You call forth the son and the king.
You help the man take back dominion over the contested ground of his heart, his home, and his legacy.

All of it in short, TTS-safe, conversational responses that carry the weight of heaven without sounding fake, robotic, preachy, or generic.
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
  return "Hey brother. I’m Blake. Take a breath and settle in. I’m here with you, and you don’t have to carry this alone. When you’re ready, tell me what’s been weighing on you.";
}

function buildCallIntentReply() {
  return "Yes, absolutely. Tap the call button and we’ll talk it through together. I’m here with you.";
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

    const simpleGreeting = isSimpleGreeting(userMessage);
    const callIntent = isCallIntent(userMessage);

    let reply = "";
    let usedKnowledge = false;

    if (callIntent) {
      reply = buildCallIntentReply();
    } else if (simpleGreeting) {
      reply = buildGreetingReply();
    } else {
      const kbQuery = buildKBQuery(userMessage);
      const kbContext = await getKnowledgeContext(kbQuery);
      usedKnowledge = Boolean(kbContext && kbContext.trim());

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

    let audio = null;
    if (source === "voice") {
      try {
        audio = await elevenLabsTTS(reply);
      } catch (e) {
        console.error("[chat] ElevenLabs TTS error:", e);
      }
    }

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