// app/home-ui.js
// Son of Wisdom — Home UI helpers
// DOM rendering, context strip, artifact rail, bubbles, and UI state helpers

export function createHomeUI(refs, contextState, getVoiceRepliesEnabled) {
  const $ = (s, r = document) => r.querySelector(s);

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatBytes(bytes) {
    const n = Number(bytes || 0);
    if (!Number.isFinite(n) || n <= 0) return "";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  function humanFileType(mime, filename = "") {
    const m = String(mime || "").toLowerCase();
    const f = String(filename || "").toLowerCase();

    if (m.includes("pdf") || f.endsWith(".pdf")) return "PDF";
    if (m.startsWith("text/") || f.endsWith(".txt")) return "Text";
    if (m.includes("word") || f.endsWith(".doc") || f.endsWith(".docx")) return "Doc";
    if (m.includes("sheet") || f.endsWith(".xls") || f.endsWith(".xlsx")) return "Sheet";
    if (m.includes("presentation") || f.endsWith(".ppt") || f.endsWith(".pptx")) return "Slides";
    if (m.includes("json") || f.endsWith(".json")) return "JSON";
    if (m.includes("csv") || f.endsWith(".csv")) return "CSV";
    return "File";
  }

  function artifactIcon(type) {
    switch (type) {
      case "PDF":
        return "PDF";
      case "Text":
        return "TXT";
      case "Doc":
        return "DOC";
      case "Sheet":
        return "XLS";
      case "Slides":
        return "PPT";
      case "JSON":
        return "JSN";
      case "CSV":
        return "CSV";
      default:
        return "FILE";
    }
  }

  function addContextStripStyles() {
    if ($("#context-strip-inline-styles")) return;

    const style = document.createElement("style");
    style.id = "context-strip-inline-styles";
    style.textContent = `
      #context-strip .ctx-pill{
        display:inline-flex;
        align-items:center;
        gap:.35rem;
        padding:.36rem .72rem;
        border-radius:999px;
        font-size:.78rem;
        line-height:1;
        color:#e5edf8;
        border:1px solid rgba(148,163,184,.24);
        background:rgba(15,23,42,.72);
        white-space:nowrap;
      }
      #context-strip .ctx-pill[data-state="active"]{
        border-color:rgba(246,201,121,.58);
        background:rgba(246,201,121,.12);
        color:#f6d99a;
      }
      #context-strip .ctx-pill[data-state="good"]{
        border-color:rgba(74,222,128,.5);
        background:rgba(74,222,128,.12);
        color:#baf5c8;
      }
      #context-strip .ctx-pill[data-state="warn"]{
        border-color:rgba(248,113,113,.55);
        background:rgba(248,113,113,.12);
        color:#fecaca;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureContextStrip() {
    if ($("#context-strip")) return $("#context-strip");

    const strip = document.createElement("section");
    strip.id = "context-strip";
    strip.setAttribute("aria-label", "Conversation context");
    strip.style.cssText = [
      "display:flex",
      "flex-wrap:wrap",
      "align-items:center",
      "gap:0.55rem",
      "margin:0 0 0.75rem",
      "padding:0.7rem 0.85rem",
      "border-radius:16px",
      "background:rgba(10,18,34,0.88)",
      "border:1px solid rgba(148,163,184,0.22)",
      "box-shadow:0 12px 32px rgba(0,0,0,0.35)",
    ].join(";");

    strip.innerHTML = `
      <div id="ctx-conversation" class="ctx-pill">Conversation: New conversation</div>
      <div id="ctx-memory" class="ctx-pill">Memory: on</div>
      <div id="ctx-kb" class="ctx-pill">KB: idle</div>
      <div id="ctx-files" class="ctx-pill">Artifacts: 0</div>
      <div id="ctx-voice" class="ctx-pill">Voice replies: off</div>
      <div id="ctx-mode" class="ctx-pill">Mode: chat</div>
    `;

    if (refs.chatPanel?.parentElement) {
      refs.chatPanel.parentElement.insertBefore(strip, refs.chatPanel);
    } else if (refs.content) {
      refs.content.appendChild(strip);
    } else {
      document.body.appendChild(strip);
    }

    addContextStripStyles();
    return strip;
  }

  function ensureArtifactRail() {
    if ($("#artifact-rail")) return $("#artifact-rail");

    const rail = document.createElement("section");
    rail.id = "artifact-rail";
    rail.className = "artifact-rail";
    rail.setAttribute("aria-label", "Conversation artifacts");

    if (refs.chatPanel?.parentElement) {
      const contextStrip = $("#context-strip");
      if (contextStrip?.nextSibling) {
        refs.chatPanel.parentElement.insertBefore(rail, contextStrip.nextSibling);
      } else {
        refs.chatPanel.parentElement.insertBefore(rail, refs.chatPanel);
      }
    } else if (refs.content) {
      refs.content.appendChild(rail);
    } else {
      document.body.appendChild(rail);
    }

    return rail;
  }

  function updateContextStrip() {
    ensureContextStrip();

    const convEl = $("#ctx-conversation");
    const memEl = $("#ctx-memory");
    const kbEl = $("#ctx-kb");
    const filesEl = $("#ctx-files");
    const voiceEl = $("#ctx-voice");
    const modeEl = $("#ctx-mode");

    if (convEl) {
      convEl.textContent = `Conversation: ${
        contextState.conversationTitle || "New conversation"
      }`;
    }

    if (memEl) {
      memEl.textContent = "Memory: on";
      memEl.dataset.state = "good";
    }

    if (kbEl) {
      kbEl.textContent = `KB: ${
        contextState.lastUsedKnowledge ? "used" : "idle"
      }`;
      kbEl.dataset.state = contextState.lastUsedKnowledge ? "active" : "";
    }

    if (filesEl) {
      const count = contextState.attachedArtifacts.length || 0;
      const suffix = contextState.fileIndexingInFlight ? " (indexing…)" : "";
      filesEl.textContent = `Artifacts: ${count}${suffix}`;
      filesEl.dataset.state =
        count > 0 ? (contextState.lastUsedFileContext ? "active" : "good") : "";
    }

    if (voiceEl) {
      const enabled = !!getVoiceRepliesEnabled();
      voiceEl.textContent = `Voice replies: ${enabled ? "on" : "off"}`;
      voiceEl.dataset.state = enabled ? "active" : "";
    }

    if (modeEl) {
      modeEl.textContent = `Mode: ${contextState.lastMode || "chat"}`;
      modeEl.dataset.state =
        contextState.lastMode === "files" || contextState.lastMode === "voice"
          ? "active"
          : "";
    }
  }

  function renderArtifactRail() {
    const rail = ensureArtifactRail();
    const artifacts = Array.isArray(contextState.attachedArtifacts)
      ? contextState.attachedArtifacts
      : [];

    if (!artifacts.length) {
      rail.innerHTML = `
        <div class="artifact-empty">
          <div class="artifact-empty-title">No artifacts attached</div>
          <div class="artifact-empty-copy">Upload a PDF or text file and it will appear here for this conversation.</div>
        </div>
      `;
      return;
    }

    rail.innerHTML = artifacts
      .map((artifact, idx) => {
        const type = humanFileType(artifact.content_type, artifact.filename);
        const size = formatBytes(artifact.bytes);
        const used = !!contextState.lastUsedFileContext;
        const newest = idx === artifacts.length - 1;
        const flags = [
          newest ? "artifact-card--latest" : "",
          used ? "artifact-card--used" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return `
          <article class="artifact-card ${flags}">
            <div class="artifact-card-icon">${artifactIcon(type)}</div>
            <div class="artifact-card-body">
              <div class="artifact-card-name" title="${escapeHtml(
                artifact.filename || "file"
              )}">${escapeHtml(artifact.filename || "file")}</div>
              <div class="artifact-card-meta">
                <span>${type}</span>
                ${size ? `<span>•</span><span>${size}</span>` : ""}
                ${artifact.created_at ? `<span>•</span><span>attached</span>` : ""}
              </div>
            </div>
            <div class="artifact-card-badges">
              ${
                newest
                  ? `<span class="artifact-badge artifact-badge--soft">latest</span>`
                  : ""
              }
              ${
                used
                  ? `<span class="artifact-badge artifact-badge--gold">used in context</span>`
                  : ""
              }
            </div>
          </article>
        `;
      })
      .join("");
  }

  function refreshContextUI() {
    updateContextStrip();
    renderArtifactRail();
  }

  function setStatus(text, isError = false) {
    if (!refs.status) return;
    refs.status.textContent = text || "";
    refs.status.dataset.kind = isError ? "error" : "normal";
  }

  function setSendingState(flag) {
    const sending = !!flag;
    if (refs.sendBtn) refs.sendBtn.disabled = sending;
    if (refs.filesBtn) refs.filesBtn.disabled = sending;
    if (refs.speakBtn) refs.speakBtn.disabled = sending;
    if (refs.input) refs.input.disabled = sending;
  }

  function scrollChatToBottom() {
    if (!refs.chatBox) return;
    const scroller = refs.chatBox.parentElement || refs.chatBox;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
  }

  function updateBubbleText(bubbleRef, text) {
    if (!bubbleRef?.bubble) return;
    bubbleRef.bubble.textContent = text || "";
    scrollChatToBottom();
  }

  function appendBubble(role, text, { audio } = {}) {
    if (!refs.chatBox) return null;

    const wrap = document.createElement("div");
    wrap.className = `bubble-wrap ${role}`;

    const bubble = document.createElement("div");
    bubble.className = `bubble ${role}`;
    bubble.textContent = text || "";

    wrap.appendChild(bubble);

    if (audio?.url) {
      const row = document.createElement("div");
      row.className = "bubble-audio-row";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bubble-audio-btn";
      btn.textContent = "Play voice";
      btn.addEventListener("click", async () => {
        const player = new Audio(audio.url);
        player.play().catch(() => {});
      });

      row.appendChild(btn);
      wrap.appendChild(row);
    }

    refs.chatBox.appendChild(wrap);
    scrollChatToBottom();

    return { wrap, bubble };
  }

  function addAssistantSourceMarkers(
    bubbleRef,
    { usedKnowledge = false, usedFileContext = false } = {}
  ) {
    if (!bubbleRef?.wrap) return;

    const old = bubbleRef.wrap.querySelector(".bubble-context-meta");
    if (old) old.remove();

    const tags = [];
    if (usedKnowledge) tags.push("KB context");
    if (usedFileContext) tags.push("Artifact context");

    if (!tags.length) return;

    const meta = document.createElement("div");
    meta.className = "bubble-context-meta";

    tags.forEach((tag) => {
      const pill = document.createElement("span");
      pill.className = "bubble-context-pill";
      if (tag === "Artifact context") {
        pill.classList.add("bubble-context-pill--gold");
      }
      pill.textContent = tag;
      meta.appendChild(pill);
    });

    bubbleRef.wrap.appendChild(meta);
  }

  return {
    ensureContextStrip,
    ensureArtifactRail,
    refreshContextUI,
    setStatus,
    setSendingState,
    scrollChatToBottom,
    updateBubbleText,
    appendBubble,
    addAssistantSourceMarkers,
  };
}