const FILE_CONTEXT_TOPK = Number(process.env.FILE_CONTEXT_TOPK || 6);
const FILE_CONTEXT_MAX_CHARS = Number(process.env.FILE_CONTEXT_MAX_CHARS || 2800);

function isUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(v || "")
  );
}

async function fetchConversation(supaFetch, conversationId) {
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

async function fetchRecentMessages(supaFetch, conversationId, limit = 12) {
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
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
}

function buildHistorySnippet(recentMessages) {
  return recentMessages.length
    ? recentMessages
        .map(
          (m) => `${m.role === "user" ? "User" : "Coach"}: ${m.content || ""}`
        )
        .join("\n")
    : "—";
}

async function fetchConversationFileContext({
  supaFetch,
  openaiEmbedding,
  conversationId,
  userMessage,
}) {
  try {
    if (!conversationId || !isUuid(conversationId)) return "";

    const q = String(userMessage || "").trim();
    if (!q) return "";

    const queryEmbedding = await openaiEmbedding(q);

    const rows = await supaFetch("rpc/match_conversation_chunks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        p_conversation_id: conversationId,
        p_query_embedding: queryEmbedding,
        p_match_count: FILE_CONTEXT_TOPK,
      }),
    });

    if (!Array.isArray(rows) || !rows.length) return "";

    const snippets = rows
      .filter((r) => r && r.content)
      .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
      .map((r) => String(r.content || "").trim())
      .filter(Boolean);

    if (!snippets.length) return "";

    let out = "";
    for (const s of snippets) {
      const next = (out ? `${out}\n\n---\n\n` : "") + s;
      if (next.length > FILE_CONTEXT_MAX_CHARS) break;
      out = next;
    }

    return out.trim();
  } catch (e) {
    console.error("[context-builder] fetchConversationFileContext error:", e);
    return "";
  }
}

async function buildUnifiedContext({
  conversationId,
  userMessage,
  fetchRecentLimit = 12,
  includeFileContext = true,
  supaFetch,
  openaiEmbedding,
  getKnowledgeContext,
  buildKBQuery,
}) {
  let conversation = null;
  let recentMessages = [];

  try {
    if (conversationId) {
      conversation = await fetchConversation(supaFetch, conversationId);
      recentMessages = await fetchRecentMessages(
        supaFetch,
        conversationId,
        fetchRecentLimit
      );
    }
  } catch (e) {
    console.error("[context-builder] conversation fetch error:", e);
  }

  const historySnippet = buildHistorySnippet(recentMessages);
  const conversationSummary = (conversation && conversation.summary) || "—";

  let kbContext = "";
  try {
    const kbQuery = buildKBQuery(userMessage);
    kbContext = await getKnowledgeContext(kbQuery);
  } catch (e) {
    console.error("[context-builder] KB context error:", e);
  }

  const usedKnowledge = Boolean(kbContext && kbContext.trim());

  let fileContext = "";
  if (includeFileContext) {
    fileContext = await fetchConversationFileContext({
      supaFetch,
      openaiEmbedding,
      conversationId,
      userMessage,
    });
  }

  const usedFileContext = Boolean(fileContext && fileContext.trim());

  return {
    conversation,
    recentMessages,
    historySnippet,
    conversationSummary,
    kbContext,
    usedKnowledge,
    fileContext,
    usedFileContext,
  };
}

module.exports = {
  buildUnifiedContext,
  fetchConversation,
  fetchRecentMessages,
  fetchConversationFileContext,
  buildHistorySnippet,
};