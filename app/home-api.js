// app/home-api.js
// Son of Wisdom — Home API/data helpers

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
    hiddenPrompt = null,
    source = "chat",
    wantAudio = false,
    extra = {},
    conversationId = null,
    userId = "",
    deviceId = "",
  }) {
    const visibleText = String(text || "").trim();
    const modelText = String(hiddenPrompt || text || "").trim();

    if (!visibleText) throw new Error("Missing visible text");
    if (!modelText) throw new Error("Missing model text");

    if (devDirectOpenAI) {
      const reply = await chatDirectOpenAI(modelText, extra);
      return {
        assistant_text: reply,
        audio_base64: null,
        mime: null,
        usedKnowledge: false,
        usedFileContext: false,
        title: null,
        debug: { mode: "dev-direct-openai" },
      };
    }

    const payload = {
      transcript: modelText,
      utterance: modelText,
      user_turn: modelText,

      display_text: visibleText,
      user_visible_text: visibleText,

      source,
      conversation_id: conversationId,
      user_id: userId,
      device_id: deviceId,
      want_audio: !!wantAudio,

      ...extra,
    };

    const res = await fetch(chatUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Coach request failed (${res.status}): ${text || res.statusText}`);
    }

    return await res.json();
  }

  async function chatDirectOpenAI(text, extra = {}) {
    if (!devOpenAIKey) throw new Error("Missing DEV_OPENAI_KEY");

    const systemPrompt = String(devSystemPrompt || "").trim();
    const messages = [];

    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }

    if (extra?.context) {
      messages.push({
        role: "system",
        content: `Additional context:\n${String(extra.context).trim()}`,
      });
    }

    messages.push({
      role: "user",
      content: String(text || "").trim(),
    });

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${devOpenAIKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: devOpenAIModel,
        temperature: 0.7,
        messages,
      }),
    });

    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      throw new Error(`OpenAI ${res.status}: ${raw || res.statusText}`);
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
  };
}