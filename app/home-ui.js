// app/home-ui.js
// Son of Wisdom — UI helpers for Home

export function createHomeUI(refs, contextState, isVoiceRepliesEnabled) {
  function scrollChatToBottom() {
    try {
      refs.chatBox?.scrollTo({
        top: refs.chatBox.scrollHeight,
        behavior: "smooth",
      });
    } catch {
      if (refs.chatBox) refs.chatBox.scrollTop = refs.chatBox.scrollHeight;
    }
  }

  function setStatus(text, isError = false) {
    if (!refs.status) return;
    refs.status.textContent = text || "";
    refs.status.classList.toggle("error", !!isError);
  }

  function setSendingState(flag) {
    if (refs.sendBtn) refs.sendBtn.disabled = !!flag;
    if (refs.filesBtn) refs.filesBtn.disabled = !!flag;
    if (refs.speakBtn) refs.speakBtn.disabled = !!flag;
    if (refs.input) refs.input.disabled = !!flag;
  }

  function bubbleClass(role) {
    if (role === "user") return "bubble user";
    return "bubble ai";
  }

  function appendBubble(role, text = "") {
    if (!refs.chatBox) return null;
    const div = document.createElement("div");
    div.className = bubbleClass(role);
    div.textContent = text || "";
    refs.chatBox.appendChild(div);
    scrollChatToBottom();
    return div;
  }

  function updateBubbleText(el, text = "") {
    if (!el) return;
    el.textContent = text || "";
    scrollChatToBottom();
  }

  function formatBytes(bytes) {
    const n = Number(bytes || 0);
    if (!Number.isFinite(n) || n <= 0) return "";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function fileTypeLabel(item = {}) {
    const ct = String(item.content_type || "").toLowerCase();
    const name = String(item.filename || "").toLowerCase();

    if (ct.startsWith("image/") || /\.(jpg|jpeg|png|webp)$/i.test(name)) return "Image";
    if (ct === "application/pdf" || /\.pdf$/i.test(name)) return "PDF";
    if (ct.startsWith("text/") || /\.txt$/i.test(name)) return "Text";
    return "File";
  }

  function renderArtifactRail() {
    const root = document.getElementById("artifact-rail");
    if (!root) return;

    const files = Array.isArray(contextState.attachedArtifacts)
      ? contextState.attachedArtifacts
      : [];

    if (!files.length) {
      root.innerHTML = `
        <div class="artifact-empty-copy">Upload a screenshot, image, PDF, or text file and it will appear here for this conversation.</div>
      `;
      return;
    }

    root.innerHTML = files
      .map((item) => {
        const type = fileTypeLabel(item);
        const size = formatBytes(item.bytes);
        const meta = [type, size].filter(Boolean).join(" • ");
        return `
          <div class="artifact-pill" title="${String(item.filename || "")}">
            <span class="artifact-pill-name">${String(item.filename || "file")}</span>
            <span class="artifact-pill-meta">${meta}</span>
          </div>
        `;
      })
      .join("");
  }

  function refreshContextUI() {
    const titleEl = document.getElementById("conversation-title");
    if (titleEl) {
      titleEl.textContent =
        contextState.conversationTitle || "New conversation";
    }

    const metaEl = document.getElementById("conversation-meta");
    if (metaEl) {
      const bits = [];

      if (contextState.lastMode) {
        bits.push(
          contextState.lastMode === "voice"
            ? "Voice"
            : contextState.lastMode === "files"
            ? "Files"
            : "Chat"
        );
      }

      if (contextState.lastUsedKnowledge) bits.push("Knowledge");
      if (contextState.lastUsedFileContext) bits.push("File context");
      if (isVoiceRepliesEnabled?.()) bits.push("Voice replies on");
      if (contextState.fileIndexingInFlight) bits.push("Indexing file…");

      metaEl.textContent = bits.join(" • ");
    }

    renderArtifactRail();
  }

  return {
    setStatus,
    setSendingState,
    appendBubble,
    updateBubbleText,
    refreshContextUI,
    renderArtifactRail,
  };
}