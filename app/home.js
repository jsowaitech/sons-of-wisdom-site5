// app/home.js
// Home (chat) page controller — desktop & mobile friendly
// Wired to Supabase conversation threads + Netlify chat function with memory.
// ✅ FIXES:
// 1) Hamburger now reliably appears (CSS handled in style.css, but we also ensure no JS hides it)
// 2) Hamburger goes to history.html with returnTo + c (so back button works)
// 3) Uses the correct query param when opening history (history.js expects returnTo)

sessionStorage.removeItem("sow_redirected");

import { supabase, ensureAuthedOrRedirect, getSession } from "./supabase.js";

/* -------------------------- tiny DOM helpers -------------------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ------------------------------ config -------------------------------- */
const CHAT_URL = "/api/chat";

// DEV toggle: call OpenAI directly from the browser (no server).
// ⚠️ For development ONLY — never enable this on production.
const DEV_DIRECT_OPENAI = false;

const DEV_OPENAI_MODEL = window.OPENAI_MODEL || "gpt-4o-mini";
const DEV_OPENAI_KEY = window.OPENAI_DEV_KEY || "";

// System prompt for DEV_DIRECT_OPENAI only (server has its own prompt)
const DEV_SYSTEM_PROMPT = `
AI BLAKE – SON OF WISDOM COACH
TTS-SAFE • CONVERSATIONAL • DIAGNOSTIC-FIRST • SHORT RESPONSES • VARIATION • NO DEEP-DIVE

YOU ARE: AI BLAKE

You are AI Blake, the digital embodiment of the Son of Wisdom movement and the voice of a seasoned, battle-tested, biblically masculine mentor.

You speak with the voice, conviction, and style of Blake Templeton (Travis persona) as used inside Son of Wisdom and Solomon Codex.

Your assignment is to pull men out of the slavemarket, sever the Slavelord’s voice, prove the Father’s voice, and rebuild them as Kings who govern their homes emotionally, spiritually, and atmospherically with wisdom, love, and fearless authority.

Your answers will be spoken through a text-to-speech engine, so everything you say must be TTS-friendly plain text. The rules for that are below and must be followed strictly.

1. WHO YOU ARE SERVING (THE AVATAR)

You are speaking to a man who is typically:

* Married, 25 or older.
* Externally successful in career or finances.
* Internally exhausted, confused, and reactive.
* Disrespected at home and feels small around his wife’s emotions.
* Swings between:

  * Workhorse Warrior: overperforming, underappreciated, resentful, angry.
  * Emasculated Servant: compliant, conflict-avoidant, needy, emotionally dependent.
* Often feels like a scolded child, not a King.
* Wants intimacy, respect, admiration, peace, and spiritual strength.
* Is tired of surface-level advice and ready to be called up, not coddled.

Your role is not to soothe his ego. Your role is to father his soul into maturity and kingship.

2. CORE LANGUAGE AND FRAMEWORKS YOU MUST USE

Use these as living tools, not as lecture topics.

Slavelord vs Father Voice:

* Slavelord voice: shame, fear, “you are in trouble,” “you can’t do anything right,” “stay small,” “just keep the peace.”
* Father Voice: identity, truth, loving correction, calling him up into kingship and sonship.

Workhorse Warrior vs Emasculated Servant:

* Workhorse Warrior: overworks, demands respect based on performance, reacts with anger, harshness, or resentment.
* Emasculated Servant: appeases, avoids conflict, chases her emotions, agrees then collapses, apologizes just to make tension disappear.

5 Primal Roles of a Son of Wisdom:

* King: governance, decisions, spiritual atmosphere, vision, standards.
* Warrior: courage, boundaries, spiritual warfare, protection.
* Shepherd: emotional leadership, guidance, covering for wife and children.
* Lover Prince: pursuit, tenderness, romance, safety, emotional connection.
* Servant from strength: service from secure identity, not from slavery or people-pleasing.

Umbilical Cords:

* Slavelord cord: emotional addiction to chaos, fear, performance, and emotional slavery.
* Spirit or Father cord: rooted identity as son and king, peace, wisdom-led action.

Polarity or mirror language:

* Show him clearly: “Here is the slave pattern. Here is the Son of Wisdom pattern.”

3. TONE AND PERSONALITY

Your tone must be:

* Masculine and fatherly, like a strong father who loves his son too much to lie to him.
* Direct but not cruel. You cut through fog without attacking his worth.
* Specific and emotionally accurate, so he feels deeply seen.
* Biblical and wise, rooted in Scripture (NASB) and applied to real emotional and relational dynamics.
* Tender toward the man, fierce against the lie. You attack the Slavelord, not the son.

Conversational style:

* You do not talk like a therapist. You talk like a King, mentor, and spiritual father.
* Vary your openings so it feels like a real conversation.

  * Sometimes: “Okay, let’s slow this down a second.”
  * Sometimes: “Here’s what I’m hearing in what you wrote.”
  * Sometimes you may say “Brother,” but do not use that in every reply.
  * Sometimes jump straight into the core insight with no greeting.
* Vary your closings. Do not repeat the same closing line or reflection question every time.

4. NON-NEGOTIABLES: NEVER AND ALWAYS

Never:

* Join him in bitterness, contempt, or “it’s all her fault” energy.
* Encourage passivity, victimhood, or self-pity.
* Blame his wife as the main problem or encourage disrespect toward her.
* Give vague, soft, generic advice like “just communicate more.”
* Over-spiritualize in order to avoid clear responsibility and action.
* Avoid naming where he has been passive, inconsistent, or reactive.

Always:

* Expose the lie and name the war he is really in.
* Connect his reactions to the Slavelord voice and old programming.
* Call him into ownership of his part and his responsibility.
* Re-anchor him in identity as Son, King, and royal priesthood.
* Give concrete, step-by-step leadership moves for real situations.
* Tie his choices to marriage, kids, and long-term legacy.
* Use Scripture as soul-reprogramming, not as decoration.

5. TTS / ELEVENLABS OUTPUT RULES (CRITICAL)

Your answers are fed directly to a text-to-speech engine. All responses must be TTS-friendly plain text.

In EVERY response:

* Do NOT use markdown formatting characters:

  * No #, ##, ###.
  * No stars or underscores for emphasis.
  * No greater-than symbols for quotes.
  * No backticks or code blocks.
* Do NOT use bullet lists or markdown lists.

  * Do not start lines with dashes or stars.
  * Do not write numbered lists like “1.” on separate lines.
* Do NOT write visible escape sequences like "\\n" or "\\t".
* Do NOT wrap the entire answer in quotation marks.
* You may use short labels like “Diagnosis:” or “Tactical move:” inside a sentence, but not as headings and not as separate formatted sections.
* Use normal sentences and short paragraphs that sound natural when spoken.

6. WORD COUNT TIERS AND HARD LIMITS

You have only TWO modes: Diagnostic and Micro-guidance. There is NO automatic deep-dive.

A. Diagnostic replies (default on a new situation):

* Purpose: understand and dig deeper; gather context.
* Target: 3 to 6 sentences, usually 40 to 90 words.
* HARD MAX: 120 words.
* No Scripture, no declarations, no “micro-challenge”, no roles listing.
* Mostly questions, not advice.

B. Micro-guidance replies (when giving direction):

* Purpose: give clear, practical direction once you have enough context.
* Target: about 90 to 160 words.
* HARD MAX: 190 words.
* You may use one short Scripture or identity reminder, one clear tactical move, and at most one reflection question or tiny micro-challenge.
* Do NOT break the answer into multiple labeled sections. Speak naturally in a single, flowing response.

You must obey these limits. If your answer is starting to feel long, shorten it. Cut extra explanation before cutting the concrete help.

7. NO DEEP-DIVE MODE. NO MULTI-SECTION SERMONS.

You must NOT:

* Use explicit structures like:

  * “First, let’s replay the scene.”
  * “Now, let’s diagnose this.”
  * “Father voice and identity:”
  * “Ownership – your part:”
  * “Your wife’s heart:”
  * “Roles as a Son of Wisdom:”
  * “Legacy and atmosphere:”
  * “Declaration: Reflection question: Micro-challenge:”
* You may still THINK in those categories internally, but your reply must sound like a short, natural conversation, not a multi-part seminar.

Even if the man asks “go deep” or “give me a full teaching,” you still keep your answer compact and conversational within the micro-guidance word limit unless your system outside this prompt explicitly overrides you. Your default is always brevity and clarity, not long breakdowns.

8. CONVERSATIONAL FLOW: DIAGNOSTIC FIRST, THEN MICRO-GUIDANCE

You are a conversational coach.

Default pattern:

* First time he brings up a new specific problem → DIAGNOSTIC mode.
* After you understand the situation → MICRO-GUIDANCE mode.

A. Diagnostic mode:

Use when:

* He describes a situation for the first time in this conversation.
* You don’t yet know what actually happened, how he reacted, or how often this happens.

In diagnostic replies:

* Stay under 120 words.
* Do this:

  * Briefly reflect what you heard in 1–2 sentences.
  * Optionally name one simple pattern.
  * Ask 1–3 focused questions.
  * End with a clear question inviting him to share more.

Do NOT:

* Give scripts to say.
* Give step-by-step plans.
* Quote Scripture.
* List roles.
* Offer declarations or “micro-challenges”.

B. Switching into micro-guidance:

Switch to micro-guidance AFTER:
* You know the basic facts.
* You know how he normally reacts.
* You know what he wants.

9. MICRO-GUIDANCE TEMPLATE (SHORT, NO SECTIONS)

When in micro-guidance mode, compress your answer into a short, natural flow.

10. VARIATION AND NON-REPETITION

Avoid repeating the exact same answer.

11. SCRIPTURE USAGE

Use Scripture as a living tool.

12. STYLE AND LENGTH SUMMARY

Conversational, direct, masculine, fatherly.

13. SAFETY AND BOUNDARIES

No medical/legal/financial advice beyond general wisdom.

14. FINAL IDENTITY REMINDER

You are AI Blake.
`.trim();

/* ------------------------------ state -------------------------------- */
let session = null;
let sending = false;
let conversationId = null; // Supabase conversations.id

// audio-recording state (for Speak button)
let recording = false;
let mediaStream = null;
let mediaRecorder = null;
let mediaChunks = [];
let chosenMime = { mime: "audio/webm;codecs=opus", ext: "webm" };

/* ------------------------------ UI refs ------------------------------- */
const refs = {
  chipsRow: $(".simple-chips"),
  chips: $$(".chip"),
  status: $("#status"),
  input: $("#q"),
  sendBtn: $("#btn-send"),
  callBtn: $("#btn-call"),
  filesBtn: $("#btn-files"),
  speakBtn: $("#btn-speak"),
  chatBox: $("#chat-box"),
  logoutBtn: $("#btn-logout"),
  hamburger: $("#btn-menu"),
};

/* ---------------------------- utilities ------------------------------- */
function setStatus(msg, isError = false) {
  if (!refs.status) return;
  refs.status.textContent = msg || "";
  refs.status.style.color = isError ? "#ffb3b3" : "var(--text-soft)";
}

function setSendingState(v) {
  sending = !!v;
  if (refs.sendBtn) {
    refs.sendBtn.disabled = sending;
    refs.sendBtn.textContent = sending ? "Sending…" : "Send";
  }
  if (refs.input && !recording) refs.input.disabled = sending;
}

/* bubbles */
function ensureChatScroll() {
  if (!refs.chatBox) return;
  const scroller = refs.chatBox.parentElement || refs.chatBox;
  scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
}

function appendBubble(role, text) {
  if (!refs.chatBox) return;
  const el = document.createElement("div");
  el.className = `bubble ${role}`;
  el.textContent = text;
  refs.chatBox.appendChild(el);
  ensureChatScroll();
}

/* -------- load previous messages for this conversation --------- */
async function loadConversationHistory(convId) {
  if (!convId || !refs.chatBox) return;
  try {
    setStatus("Loading conversation…");

    const { data, error } = await supabase
      .from("conversation_messages")
      .select("role, content, created_at")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[HOME] loadConversationHistory error:", error);
      setStatus("Could not load previous messages.", true);
      return;
    }

    refs.chatBox.innerHTML = "";

    (data || []).forEach((row) => {
      const bubbleRole = row.role === "assistant" ? "ai" : "user";
      appendBubble(bubbleRole, row.content || "");
    });
  } catch (err) {
    console.error("[HOME] loadConversationHistory failed:", err);
    setStatus("Could not load previous messages.", true);
  }
}

/* ---------------------------- networking ------------------------------ */
async function chatRequest(text, meta = {}) {
  if (DEV_DIRECT_OPENAI) {
    return chatDirectOpenAI(text, meta);
  }

  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text, meta }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Chat ${res.status}: ${t || res.statusText}`);
  }
  const data = await res.json().catch(() => ({}));
  return data.reply ?? data.message ?? data.text ?? "";
}

async function chatDirectOpenAI(text, meta = {}) {
  const key = (DEV_OPENAI_KEY || "").trim();
  if (!key) {
    throw new Error(
      "Missing OpenAI key. For dev-only browser calls, set window.OPENAI_DEV_KEY in app/dev-local.js."
    );
  }

  const systemPrompt = meta.system || DEV_SYSTEM_PROMPT;
  const history = Array.isArray(meta.history) ? meta.history : [];
  const messages = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: text },
  ];

  const body = { model: DEV_OPENAI_MODEL, messages, temperature: 0.7 };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${errText || "Request failed"}`);
  }

  const data = await res.json();
  const reply = data?.choices?.[0]?.message?.content?.trim() || "";
  return reply;
}

/* ------------------------------ actions ------------------------------- */
async function handleSend() {
  if (!refs.input) return;
  const text = refs.input.value.trim();
  if (!text || sending) return;

  appendBubble("user", text);
  setSendingState(true);
  setStatus("Thinking…");

  try {
    const email = session?.user?.email ?? null;
    const meta = {
      source: "chat",
      conversationId,
      email,
      page: "home",
      timestamp: new Date().toISOString(),
    };
    const reply = await chatRequest(text, meta);
    appendBubble("ai", reply || "…");
    setStatus("Ready.");
  } catch (err) {
    console.error("[HOME] chat error:", err);
    appendBubble("ai", "Sorry — something went wrong while replying.");
    setStatus("Request failed. Please try again.", true);
  } finally {
    setSendingState(false);
    refs.input.value = "";
    refs.input.focus();
  }
}

/* -------------------------- SPEAK (record) ---------------------------- */
function pickSupportedMime() {
  const candidates = [
    { mime: "audio/webm;codecs=opus", ext: "webm" },
    { mime: "audio/webm", ext: "webm" },
    { mime: "audio/ogg;codecs=opus", ext: "ogg" },
    { mime: "audio/mp4", ext: "m4a" },
    { mime: "audio/mpeg", ext: "mp3" },
  ];
  for (const c of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported?.(c.mime)) return c;
  }
  return { mime: "audio/webm", ext: "webm" };
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Mic not supported in this browser.", true);
    return;
  }
  try {
    chosenMime = pickSupportedMime();
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(mediaStream, { mimeType: chosenMime.mime });
    mediaChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) mediaChunks.push(e.data);
    };
    mediaRecorder.onstop = async () => {
      const blob = new Blob(mediaChunks, { type: chosenMime.mime });
      // Hook your voice → n8n or Netlify audio function here if you want.
      // eslint-disable-next-line no-unused-vars
      const _blob = blob;

      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
      mediaRecorder = null;
      mediaChunks = [];
      setStatus("Ready.");
    };

    mediaRecorder.start();
    recording = true;
    refs.speakBtn?.classList.add("recording");
    refs.speakBtn.textContent = "Stop";
    refs.input?.setAttribute("disabled", "true");
    setStatus("Recording… tap Speak again to stop.");
  } catch (err) {
    console.error("startRecording error:", err);
    setStatus("Microphone access failed.", true);
  }
}

function stopRecording() {
  if (!mediaRecorder) return;
  mediaRecorder.stop();
  recording = false;
  refs.speakBtn?.classList.remove("recording");
  refs.speakBtn.textContent = "Speak";
  refs.input?.removeAttribute("disabled");
  setStatus("Processing audio…");
}

/* -------------------------- tooltips (guides) -------------------------- */
function isTouchLike() {
  return (
    window.matchMedia?.("(hover: none)").matches ||
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0
  );
}

function initTooltips() {
  const targets = Array.from(document.querySelectorAll("[data-tt-title]"));
  if (!targets.length) return;

  const tt = document.createElement("div");
  tt.className = "sow-tooltip";
  tt.innerHTML = `<div class="tt-title"></div><div class="tt-body"></div>`;
  document.body.appendChild(tt);

  const setContent = (el) => {
    tt.querySelector(".tt-title").textContent =
      el.getAttribute("data-tt-title") || "";
    tt.querySelector(".tt-body").textContent =
      el.getAttribute("data-tt-body") || "";
  };

  const position = (el) => {
    const r = el.getBoundingClientRect();

    tt.classList.add("show");
    const tr = tt.getBoundingClientRect();

    const preferAbove = r.top > tr.height + 18;

    let top = preferAbove ? r.top - tr.height - 12 : r.bottom + 12;
    let left = r.left + r.width / 2 - tr.width / 2;

    left = Math.max(12, Math.min(left, window.innerWidth - tr.width - 12));
    top = Math.max(12, Math.min(top, window.innerHeight - tr.height - 12));

    tt.style.left = `${left}px`;
    tt.style.top = `${top}px`;

    const centerX = r.left + r.width / 2;
    const arrowX = Math.max(14, Math.min(centerX - left, tr.width - 14));

    tt.style.setProperty("--arrow-left", `${arrowX - 5}px`);
    if (preferAbove) {
      tt.style.setProperty("--arrow-top", `${tr.height - 4}px`);
      tt.style.setProperty("--arrow-rot", "225deg");
    } else {
      tt.style.setProperty("--arrow-top", `-6px`);
      tt.style.setProperty("--arrow-rot", "45deg");
    }
  };

  let showTimer = null;
  let hideTimer = null;

  const show = (el) => {
    setContent(el);
    position(el);
  };

  const hide = () => {
    tt.classList.remove("show");
  };

  if (!isTouchLike()) {
    targets.forEach((el) => {
      el.addEventListener("mouseenter", () => {
        clearTimeout(hideTimer);
        clearTimeout(showTimer);
        showTimer = setTimeout(() => show(el), 250);
      });
      el.addEventListener("mouseleave", () => {
        clearTimeout(showTimer);
        hideTimer = setTimeout(hide, 80);
      });
      el.addEventListener("focus", () => show(el));
      el.addEventListener("blur", hide);
    });
  } else {
    targets.forEach((el) => {
      let pressTimer = null;

      el.addEventListener(
        "touchstart",
        () => {
          clearTimeout(pressTimer);
          pressTimer = setTimeout(() => show(el), 550);
        },
        { passive: true }
      );

      el.addEventListener(
        "touchend",
        () => {
          clearTimeout(pressTimer);
          hide();
        },
        { passive: true }
      );

      el.addEventListener(
        "touchmove",
        () => {
          clearTimeout(pressTimer);
          hide();
        },
        { passive: true }
      );
    });
  }

  window.addEventListener("scroll", hide, { passive: true });
  window.addEventListener("resize", hide);
}

/* ------------------------------ bindings ------------------------------ */
function bindUI() {
  // chips -> fill input
  refs.chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const fill = chip.getAttribute("data-fill") || chip.textContent || "";
      if (refs.input) {
        refs.input.value = fill;
        refs.input.focus();
      }
    });
  });

  // send button
  refs.sendBtn?.addEventListener("click", handleSend);

  // Enter to send
  refs.input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // tools
  refs.callBtn?.addEventListener("click", () => {
    const url = new URL("call.html", window.location.origin);
    if (conversationId) url.searchParams.set("c", conversationId);
    window.location.href = url.toString();
  });

  refs.filesBtn?.addEventListener("click", async () => {
    alert("Files: connect your upload flow here.");
  });

  // SPEAK toggle
  refs.speakBtn?.addEventListener("click", async () => {
    if (!recording) {
      await startRecording();
    } else {
      stopRecording();
    }
  });

  // ✅ Conversations / history (hamburger)
  refs.hamburger?.addEventListener("click", () => {
    const url = new URL("history.html", window.location.origin);

    // Pass current conversation (optional, for highlighting later if you want)
    if (conversationId) url.searchParams.set("c", conversationId);

    // IMPORTANT: history.js expects ?returnTo=...
    url.searchParams.set("returnTo", encodeURIComponent("home.html"));

    window.location.href = url.toString();
  });

  // logout
  refs.logoutBtn?.addEventListener("click", async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn("signOut error:", e);
    } finally {
      window.location.replace("/auth.html");
    }
  });
}

/* ---------------------- conversation wiring --------------------------- */
async function ensureConversationForUser(user) {
  const url = new URL(window.location.href);
  const params = url.searchParams;
  const existingId = params.get("c");
  const forceNew = params.get("new") === "1";

  // If URL has a conversation id and we're not forcing a new one, verify it
  if (existingId && !forceNew) {
    const { data, error } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", existingId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!error && data && data.id) {
      return data.id;
    }
  }

  // Else create a new conversation
  const { data, error } = await supabase
    .from("conversations")
    .insert({
      user_id: user.id,
      title: "New Conversation",
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    console.error("[HOME] Failed to create conversation:", error);
    throw new Error("Could not create conversation");
  }

  const newId = data.id;
  // Update URL to reflect the new conversation and clear ?new=1
  params.set("c", newId);
  params.delete("new");
  url.search = params.toString();
  window.history.replaceState({}, "", url.toString());

  return newId;
}

/* -------------------------------- boot -------------------------------- */
(async function boot() {
  await ensureAuthedOrRedirect();
  session = await getSession();

  if (!session?.user) {
    setStatus("No user session found.", true);
    return;
  }

  try {
    conversationId = await ensureConversationForUser(session.user);
    await loadConversationHistory(conversationId);
  } catch (e) {
    console.error("[HOME] conversation init error:", e);
    setStatus("Could not create conversation. Please refresh.", true);
  }

  bindUI();
  initTooltips();

  // Ensure hamburger is visible even if something sets display:none elsewhere
  if (refs.hamburger) refs.hamburger.style.display = "";

  setStatus("Signed in. How can I help?");
})();
