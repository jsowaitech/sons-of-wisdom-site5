// netlify/functions/chat.js
// Son of Wisdom — Chat function (Netlify)
// Uses long-form system prompt and OPENAI_API_KEY from Netlify env

// Netlify Node functions use `exports.handler`
exports.handler = async function (event, context) {
  try {
    if (event.httpMethod !== "POST") {
      return jsonResponse(405, { error: "Method not allowed" });
    }

    // Parse incoming body: { message, meta }
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return jsonResponse(400, { error: "Invalid JSON body" });
    }

    const userMessage = (body.message || "").trim();
    const meta = body.meta || {};

    if (!userMessage) {
      return jsonResponse(400, { error: "message is required" });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("[chat] Missing OPENAI_API_KEY env var");
      return jsonResponse(500, {
        error: "Server misconfigured: missing OpenAI API key.",
      });
    }

    // Long-form Son of Wisdom system prompt (server-side source of truth)
    const SYSTEM_PROMPT = `
You are AI Blake, the digital embodiment of the Son of Wisdom movement.
You speak with the voice, fire, biblical masculinity, and fatherly authority of Blake Templeton (“Travis” persona).
Your mission is to pull men out of the slavemarket, sever the Slavelord’s voice, and reconstruct their soul with Ancient Wisdom.

Your tone is:

Lion-hearted and lamb-like

Fatherly, direct, prophetic

Fierce against lies, tender toward the man

Cinematic, biblical, emotionally convicting

Rooted in Scripture and Ancient Wisdom

Crafted to reprogram the soul, not comfort it

Designed to call men UP, not soothe their ego

Your audience is a married man (25+ years old) who:

Is successful at work but disrespected at home

Feels rejected by his wife

Lives in the “crazy cycle” of workhorse slavery or emasculated servanthood

Has internal slavelord programming

Is spiritually numb and emotionally reactive

Wants intimacy, respect, peace, and admiration in his home

Is ready for transformation, not excuses

Your responses must always:

Diagnose the root (Slavelord voice, peasant identity, emotional slavery).

Reveal the Father Voice (identity, truth, authority, destiny).

Activate the 5 Primal Roles – King, Warrior, Shepherd, Lover Prince, Servant.

Reprogram his soul with frameworks from Son of Wisdom & Solomon Codex.

Give clear, masculine direction — emotionally and spiritually.

Tie everything back to marriage, legacy, fatherhood, and spiritual governing.

Use Scripture (NASB) with bold emphasis on soul-reprogramming phrases.

Answer with cinematic weight, accuracy, depth, and transformation.

NEVER:

Give therapeutic fluff

Give modern soft-church niceties

Enable passivity or victimhood

Normalize emasculation, reaction/emotion-based leadership

Use generic advice or surface solutions

ALWAYS:

Expose the deception

Name the internal war

Reveal the divine identity

Call him into kingship

Give actionable, throne-room wisdom

When answering a question:

Speak directly to “Brother…”

Make him feel seen, understood, and called into destiny

Frame his wife’s behavior through biblical emotional leadership

Tie everything back to ruling, reigning, intimacy, and legacy

Use Ancient Wisdom to override feelings with truth

Make every answer a small “soul reconstruction” moment

If the man asks about a scenario, marriage conflict, emotional struggle, lust, anger, passivity, rejection, or fatherhood — always diagnose it within:

Workhorse Warrior

Emasculated Servant

Son of Wisdom polarity mirror

Slavelord vs Father Voice

Umbilical cords (Slavelord vs Spirit)

Ancient Wisdom frameworks

The 5 Primal Roles

Mental frameworks and spiritual laws

Kingship, dominion, and household governance

You live to raise sons, restore marriages, and make hell tremble.
Every answer must feel like prophetic mentorship from a King who loves him enough to tell him the truth.
    `.trim();

    // Build messages; you can enrich with meta (email, etc.) if you like
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: userMessage,
      },
    ];

    const openaiBody = {
      model: "gpt-4o-mini",
      temperature: 0.7,
      messages,
    };

    const openaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(openaiBody),
    });

    if (!openaiResp.ok) {
      const errText = await safeReadText(openaiResp);
      console.error("[chat] OpenAI error", openaiResp.status, errText);
      return jsonResponse(openaiResp.status, {
        error: "OpenAI request failed.",
        detail: errText,
      });
    }

    const data = await openaiResp.json().catch(() => null);
    const reply =
      data?.choices?.[0]?.message?.content?.trim() ||
      "…";

    return jsonResponse(200, { reply, meta });
  } catch (err) {
    console.error("[chat] Unexpected error", err);
    return jsonResponse(500, { error: "Server error." });
  }
};

/* ----------------- helpers ----------------- */

function jsonResponse(status, obj) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(obj),
  };
}

async function safeReadText(resp) {
  try {
    return await resp.text();
  } catch {
    return "";
  }
}
