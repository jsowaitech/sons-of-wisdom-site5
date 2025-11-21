// app/transcript.js
import { supabase } from "./supabase.js";

const els = {
  list: document.getElementById("turnList"),
  callIdLabel: document.getElementById("callIdLabel"),
  callIdInput: document.getElementById("callIdInput"),
  watchBtn: document.getElementById("watchBtn"),
  copyBtn: document.getElementById("copyBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  liveBadge: document.getElementById("liveBadge"),
};

let currentCallId = null;
let channel = null;
let cache = []; // for copy/download

function getParam(name) {
  const u = new URL(location.href);
  return u.searchParams.get(name);
}

function fmtTime(iso) {
  try {
    const d = new Date(iso || Date.now());
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

function setCallId(id) {
  currentCallId = id;
  els.callIdLabel.textContent = `call_id: ${id || "—"}`;
  els.callIdInput.value = id || "";
  if (id) localStorage.setItem("last_call_id", id);
}

function rowToRenderable(r) {
  const role = r.role === "assistant" ? "assistant" : "user";
  const text = role === "assistant"
    ? (r.ai_text || "")
    : (r.input_transcript || r.input_text || "");
  const audio = r.audio_url || r.ai_audio_url || r.audio_mp3_url || "";
  return {
    id: r.id || crypto.randomUUID(),
    role,
    text,
    audio,
    ts: r.created_at || r.timestamp || r.inserted_at || new Date().toISOString(),
  };
}

function appendTurn(renderable, { scroll = true } = {}) {
  cache.push(renderable);

  const row = document.createElement("div");
  row.className = `turn ${renderable.role}`;
  row.innerHTML = `
    <div class="bubble">
      <div class="meta">
        <span class="role">${renderable.role === "assistant" ? "AI" : "You"}</span>
        <span class="time">${fmtTime(renderable.ts)}</span>
      </div>
      <div class="text">${escapeHTML(renderable.text || "")}</div>
      ${renderable.audio ? `<audio controls preload="none" src="${renderable.audio}"></audio>` : ""}
    </div>
  `;
  els.list.appendChild(row);
  if (scroll) els.list.scrollTop = els.list.scrollHeight;
}

function escapeHTML(s) {
  return String(s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

async function loadInitial(callId) {
  els.list.innerHTML = "";
  cache = [];
  if (!callId) return;

  // Load existing rows
  const { data, error } = await supabase
    .from("call_sessions")
    .select("*")
    .eq("call_id", callId)
    .order("created_at", { ascending: true });

  if (error) {
    console.warn("[transcript] initial load error:", error);
    return;
  }

  (data || []).map(rowToRenderable).forEach(r => appendTurn(r, { scroll: false }));
  els.list.scrollTop = els.list.scrollHeight;
}

function subscribe(callId) {
  if (channel) {
    try { supabase.removeChannel(channel); } catch {}
    channel = null;
  }
  if (!callId) return;

  channel = supabase.channel(`call_sessions_${callId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "call_sessions", filter: `call_id=eq.${callId}` },
      (payload) => {
        if (payload.eventType === "INSERT") {
          const r = rowToRenderable(payload.new || {});
          appendTurn(r);
        } else if (payload.eventType === "UPDATE") {
          // optional: update existing bubble (not strictly necessary)
        } else if (payload.eventType === "DELETE") {
          // optional: remove bubble
        }
      }
    )
    .subscribe((status) => {
      els.liveBadge.classList.toggle("is-live", status === "SUBSCRIBED");
    });
}

function chooseStartCallId() {
  // priority: ?call_id=… > input > localStorage
  return getParam("call_id") || els.callIdInput.value.trim() || localStorage.getItem("last_call_id") || "";
}

async function watch(callId) {
  setCallId(callId);
  await loadInitial(callId);
  subscribe(callId);
}

function copyAll() {
  const text = cache.map(t => {
    const who = t.role === "assistant" ? "AI" : "You";
    return `[${fmtTime(t.ts)}] ${who}: ${t.text}`;
  }).join("\n");
  navigator.clipboard.writeText(text).catch(() => {});
}

function downloadAll() {
  const blob = new Blob([JSON.stringify(cache, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${currentCallId || "transcript"}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// UI events
els.watchBtn.addEventListener("click", () => {
  const id = els.callIdInput.value.trim();
  if (id) watch(id);
});

els.copyBtn.addEventListener("click", copyAll);
els.downloadBtn.addEventListener("click", downloadAll);

// boot
const startId = chooseStartCallId();
if (startId) watch(startId);
else setCallId("");
