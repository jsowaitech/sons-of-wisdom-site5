// app/home-api.js
// Son of Wisdom — Home API/data helpers
// Owns backend calls, Supabase data fetches, and dev direct OpenAI fallback

export function createHomeApi(config = {}) {
  const {
    supabase,
    chatUrl,
    devDirectOpenAI = false,
    devOpenAIModel = "gpt-4o-mini",
    devOpenAIKey = "",
    devSystemPrompt = "",
  } = config;

  async function createConversation(userId) {
    if (!userId) throw new Error("Missing user id");

    const { data, error } = await supabase
      .from("conversations")
      .insert([
        {
          user_id: userId,
          title: "New Conversation",
          summary: null,
        },
      ])
      .select("id, title")
      .single();

    if (error) throw error;
    return data || null;
  }

  async function fetchConversation(conversationId) {
    if (!conversationId) return null;

    const { data, error } = await supabase
      .from("conversations")
      .select("id, title, updated_at, created_at")
      .eq("id", conversationId)
      .single();

    if (error) throw error;
    return data || null;
  }

  async function fetchConversationMessages(conversationId) {
    if (!conversationId) return [];

    const { data, error } = await supabase
      .from("conversation_messages")
      .select("role, content, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  async function fetchConversationDocuments(conversationId) {
    if (!conversationId) return [];

    const { data, error } = await supabase
      .from("conversation_documents")
      .select("filename, content_type, bytes, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  async function coachRequest({
    text,
    source = "chat",
    wantAudio = false,
    extra = {},
    conversationId = null,
    userId = "",
    deviceId = "",
  }) {
    if (devDirectOpenAI) {
      const reply = await chatDirectOpenAI(text, extra);
      return {
        assistant_text: reply,
        audio_base64: null,
        mime: null,
        usedKnowledge: false,
        usedFileContext: false,
        conversationId: conversationId || null,
      };
    }

    const payload = {
      source,
      conversationId: conversationId || null,
      transcript: text,
      utterance: text,
      user_turn: text,
      user_id: userId || "",
      device_id: deviceId || "",
      want_audio: !!wantAudio,
      ...extra,
    };

    const res = await fetch(chatUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Coach ${res.status}: ${t || res.statusText}`);
    }

    const data = await res.json().catch(() => ({}));

    return {
      assistant_text: data.assistant_text ?? data.text ?? data.reply ?? "",
      audio_base64: data.audio_base64 ?? null,
      mime: data.mime ?? data.audio_mime ?? "audio/mpeg",
      usedKnowledge: !!data.usedKnowledge,
      usedFileContext: !!data.usedFileContext,
      conversationId: data.conversationId ?? conversationId ?? null,
      audio_missing: !!data.audio_missing,
      audio_error: data.audio_error ?? null,
    };
  }

  async function chatDirectOpenAI(text, meta = {}) {
    const key = String(devOpenAIKey || "").trim();
    if (!key) {
      throw new Error(
        "Missing OpenAI key. For dev-only browser calls, set window.OPENAI_DEV_KEY in app/dev-local.js."
      );
    }

    const systemPrompt = meta.system || devSystemPrompt || "";

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: devOpenAIModel,
        temperature: 0.7,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: String(text || "").trim() },
        ],
      }),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`OpenAI ${res.status}: ${t || res.statusText}`);
    }

    const data = await res.json().catch(() => ({}));
    return data?.choices?.[0]?.message?.content?.trim() || "";
  }

  return {
    createConversation,
    fetchConversation,
    fetchConversationMessages,
    fetchConversationDocuments,
    coachRequest,
    chatDirectOpenAI,
  };
}