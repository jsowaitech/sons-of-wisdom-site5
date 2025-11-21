// app/history.js
import { requireSession, listCalls, listTurns } from "./supabase.js";

await requireSession();

const listEl = document.getElementById("history-list");
const metaEl = document.getElementById("history-meta");

function formatDuration(sec) {
  const s = Math.max(0, sec | 0);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function rowHTML(call) {
  const t = call.title || "Untitled";
  const dt = new Date(call.created_at);
  const when = dt.toLocaleString();
  const dur = call.duration_sec ? formatDuration(call.duration_sec) : "—";
  return `
    <button class="history-row" data-id="${call.id}">
      <div class="title">${t}</div>
      <div class="sub">Started: ${when} • Duration: ${dur}</div>
    </button>`;
}

async function render() {
  listEl.innerHTML = "Loading…";
  try {
    const calls = await listCalls();
    metaEl.textContent = `${calls.length} conversations`;
    listEl.innerHTML = calls.map(rowHTML).join("") || "<div class='muted'>No conversations yet.</div>";
  } catch (e) {
    listEl.innerHTML = `<div class="error">Failed to load history: ${e.message}</div>`;
  }
}
listEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".history-row");
  if (!btn) return;
  const id = btn.getAttribute("data-id");
  if (id) location.href = `./call.html?resume=${encodeURIComponent(id)}`;
});

render();
