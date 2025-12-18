// app/history.js
// Conversation history page controller
// UPDATED: adds per-conversation 3-dot menu + delete flow + inline rename

import { supabase, ensureAuthedOrRedirect } from "./supabase.js";

const $ = (s, r = document) => r.querySelector(s);

// Main list container (support either #list or #conversation-list)
const listEl =
  $("#list") ||
  $("#conversation-list") ||
  (() => {
    const div = document.createElement("div");
    div.id = "list";
    document.body.appendChild(div);
    return div;
  })();

// Template (added in updated history.html)
const itemTpl = $("#conv-item-template");

// Query params
const params = new URLSearchParams(window.location.search);
const returnTo = params.get("returnTo") || "home.html";

// --- helpers -----------------------------------------------------------

function initialFromEmail(email = "") {
  const c = (email || "?").trim()[0] || "?";
  return c.toUpperCase();
}

function convUrl(id) {
  const q = new URLSearchParams({ c: id }).toString();
  return `./home.html?${q}`;
}

function formatDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
  });
}

function normalizeTitle(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function isUntitled(title) {
  const t = normalizeTitle(title).toLowerCase();
  return !t || t === "untitled" || t === "new conversation";
}

async function getConvosFromSupabase(userId) {
  if (!userId) return [];

  const { data, error } = await supabase
    .from("conversations")
    .select("id, title, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("[HISTORY] Error loading conversations:", error);
    return [];
  }

  return (data || []).map((r) => ({
    id: r.id,
    title: r.title || "Untitled",
    updated_at: r.updated_at || r.created_at || new Date().toISOString(),
  }));
}

function closeAllMenus(exceptEl = null) {
  document.querySelectorAll(".conv-actions.open").forEach((el) => {
    if (exceptEl && el === exceptEl) return;
    el.classList.remove("open");
    const menu = el.querySelector(".conv-menu");
    if (menu) menu.setAttribute("aria-hidden", "true");
  });
}

function toggleMenu(actionsEl) {
  const isOpen = actionsEl.classList.contains("open");
  if (isOpen) {
    actionsEl.classList.remove("open");
    const menu = actionsEl.querySelector(".conv-menu");
    if (menu) menu.setAttribute("aria-hidden", "true");
  } else {
    closeAllMenus(actionsEl);
    actionsEl.classList.add("open");
    const menu = actionsEl.querySelector(".conv-menu");
    if (menu) menu.setAttribute("aria-hidden", "false");
  }
}

async function deleteConversation(convId) {
  // Safe path if FK does not cascade:
  // delete messages first to avoid FK errors.
  const { error: msgErr } = await supabase
    .from("conversation_messages")
    .delete()
    .eq("conversation_id", convId);

  if (msgErr) {
    // If cascade exists, this may still be fine, but log it.
    console.warn("[HISTORY] message delete warning:", msgErr);
  }

  const { error: convErr } = await supabase
    .from("conversations")
    .delete()
    .eq("id", convId);

  if (convErr) throw convErr;
}

async function renameConversation(convId, newTitle) {
  const title = normalizeTitle(newTitle);
  const finalTitle = title || "Untitled";

  const { error } = await supabase
    .from("conversations")
    .update({
      title: finalTitle,
      updated_at: new Date().toISOString(),
    })
    .eq("id", convId);

  if (error) throw error;
  return finalTitle;
}

function showEmptyStateIfNeeded() {
  const remaining =
    listEl?.querySelectorAll(".conv-item:not(.empty)")?.length || 0;
  if (remaining === 0) {
    const empty = document.createElement("div");
    empty.className = "conv-item empty";
    empty.textContent = "No conversations yet. Tap “New Conversation” to start.";
    listEl?.appendChild(empty);
  }
}

function beginInlineRename(rowEl, conv) {
  if (!rowEl) return;

  // Close menus while renaming
  closeAllMenus();

  const titleTextEl = rowEl.querySelector(".title-text");
  const titleEditEl = rowEl.querySelector(".title-edit");

  // Fallback if template wasn't updated yet
  if (!titleTextEl || !titleEditEl) {
    alert(
      "Rename UI missing. Please update history.html template to support inline rename."
    );
    return;
  }

  // Prevent row navigation while editing
  rowEl.classList.add("renaming");

  const current = normalizeTitle(conv.title);
  titleEditEl.value = isUntitled(current) ? "" : current;

  // Select all for quick overwrite
  titleEditEl.focus();
  titleEditEl.select();

  let committed = false;

  const cleanup = () => {
    rowEl.classList.remove("renaming");
    titleEditEl.removeEventListener("keydown", onKeyDown);
    titleEditEl.removeEventListener("blur", onBlur);
    titleEditEl.disabled = false;
  };

  const commit = async () => {
    if (committed) return;
    committed = true;

    const nextTitle = normalizeTitle(titleEditEl.value);
    const originalTitle = conv.title || "Untitled";

    // If unchanged, just exit
    if (normalizeTitle(nextTitle) === normalizeTitle(originalTitle)) {
      cleanup();
      return;
    }

    // Optimistic UI
    titleTextEl.textContent = nextTitle || "Untitled";
    conv.title = nextTitle || "Untitled";

    // Disable input while saving
    titleEditEl.disabled = true;

    try {
      const saved = await renameConversation(conv.id, nextTitle);
      conv.title = saved;
      titleTextEl.textContent = saved;
      cleanup();
    } catch (err) {
      console.error("[HISTORY] rename failed:", err);
      alert("Could not rename conversation. Please try again.");

      // Revert
      conv.title = originalTitle;
      titleTextEl.textContent = originalTitle || "Untitled";

      committed = false;
      titleEditEl.disabled = false;
      titleEditEl.focus();
      titleEditEl.select();
    }
  };

  const cancel = () => {
    if (committed) return;
    committed = true;
    cleanup();
  };

  const onKeyDown = async (e) => {
    // Prevent row click / navigation
    e.stopPropagation();

    if (e.key === "Enter") {
      e.preventDefault();
      await commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  const onBlur = async () => {
    await commit();
  };

  titleEditEl.addEventListener("keydown", onKeyDown);
  titleEditEl.addEventListener("blur", onBlur);
}

function makeConvRow(c) {
  let el;

  // Prefer template if present
  if (itemTpl?.content?.firstElementChild) {
    el = itemTpl.content.firstElementChild.cloneNode(true);
  } else {
    // Fallback if template is missing
    el = document.createElement("button");
    el.type = "button";
    el.className = "conv-item";
    el.innerHTML = `
      <div class="conv-main">
        <div class="title">
          <span class="title-text"></span>
          <input class="title-edit" type="text" aria-label="Rename conversation" />
        </div>
        <div class="date tiny muted"></div>
      </div>

      <div class="conv-actions">
        <button class="conv-kebab" type="button" aria-label="Conversation options">
          <span></span><span></span><span></span>
        </button>

        <div class="conv-menu" role="menu" aria-hidden="true">
          <button class="conv-menu-item" type="button" data-action="rename" role="menuitem">
            Rename
          </button>
          <button class="conv-menu-item danger" type="button" data-action="delete" role="menuitem">
            Delete
          </button>
        </div>
      </div>
    `;
  }

  el.dataset.convId = c.id;

  // Title + date
  const titleTextEl = el.querySelector(".title-text") || el.querySelector(".title");
  const dateEl = el.querySelector(".date");
  if (titleTextEl) titleTextEl.textContent = c.title || "Untitled";
  if (dateEl) dateEl.textContent = formatDate(c.updated_at);

  // Clicking the row opens the conversation (unless renaming)
  el.addEventListener("click", () => {
    if (el.classList.contains("renaming")) return;
    window.location.href = convUrl(c.id);
  });

  const actions = el.querySelector(".conv-actions");
  const kebab = el.querySelector(".conv-kebab");
  const menu = el.querySelector(".conv-menu");

  // Kebab should NOT open the conversation
  kebab?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (actions) toggleMenu(actions);
  });

  // Menu should NOT open the conversation
  menu?.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const btn = e.target.closest("[data-action]");
    if (!btn) return;

    const action = btn.getAttribute("data-action");

    // close menu
    actions?.classList.remove("open");
    menu?.setAttribute("aria-hidden", "true");

    if (action === "rename") {
      beginInlineRename(el, c);
      return;
    }

    if (action === "delete") {
      const ok = confirm("Delete this conversation? This cannot be undone.");
      if (!ok) return;

      // optimistic UI
      el.disabled = true;
      el.style.opacity = "0.7";

      try {
        await deleteConversation(c.id);
        el.remove();
        showEmptyStateIfNeeded();
      } catch (err) {
        console.error("[HISTORY] delete failed:", err);
        alert("Could not delete conversation. Please try again.");
        el.disabled = false;
        el.style.opacity = "";
      }
    }
  });

  // Prevent input clicks from bubbling to row
  el.querySelector(".title-edit")?.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  return el;
}

function renderConvos(convos) {
  if (!listEl) return;
  listEl.innerHTML = "";

  if (!convos || convos.length === 0) {
    const empty = document.createElement("div");
    empty.className = "conv-item empty";
    empty.textContent = "No conversations yet. Tap “New Conversation” to start.";
    listEl.appendChild(empty);
    return;
  }

  for (const c of convos) {
    listEl.appendChild(makeConvRow(c));
  }
}

async function createConversation(userId) {
  if (!userId) return null;

  const title = "New Conversation";
  try {
    const { data, error } = await supabase
      .from("conversations")
      .insert([{ user_id: userId, title }])
      .select("id")
      .single();

    if (error) throw error;
    return data.id;
  } catch (e) {
    console.error("[HISTORY] Failed to create conversation:", e);
    return null;
  }
}

// --- global menu dismissal ---------------------------------------------

document.addEventListener(
  "click",
  () => {
    closeAllMenus();
  },
  { capture: true }
);

document.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Escape") closeAllMenus();
  },
  { capture: true }
);

// --- event bindings ----------------------------------------------------

$("#btn-close")?.addEventListener("click", () => {
  const dest = decodeURIComponent(returnTo);
  window.location.href = dest.match(/\.html/) ? dest : "home.html";
});

$("#btn-settings")?.addEventListener("click", () => {
  alert("Settings coming soon.");
});

$("#btn-new")?.addEventListener("click", async () => {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const id = await createConversation(user?.id);
  if (id) {
    window.location.href = convUrl(id);
  }
});

// --- boot --------------------------------------------------------------

(async function boot() {
  await ensureAuthedOrRedirect();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Render bottom user row if present
  const nameEl = $("#user-name");
  const avatarEl = $("#avatar");

  if (nameEl) {
    nameEl.textContent =
      user?.user_metadata?.full_name || user?.email || "You";
  }
  if (avatarEl) {
    avatarEl.textContent = initialFromEmail(user?.email);
  }

  const convos = await getConvosFromSupabase(user?.id);
  renderConvos(convos);
})();
