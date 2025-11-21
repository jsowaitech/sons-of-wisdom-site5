// ui.js — visual helpers only

const $ = (sel) => document.querySelector(sel);

export function setStatus(text) {
  const el = $("#status-line");
  if (el) el.textContent = text ?? "";
}

export function setListeningText(text) {
  const el = $("#listen-bar");
  if (el) el.textContent = text ?? "";
}

export function pulseRing(mode /* 'speaking' | 'listening' | 'idle' */) {
  const wrap = $("#avatar-wrap") || $("#avatar") || document.body;
  wrap.dataset.ring = mode || "idle";
}

export function updateMicUI(on) {
  const btn = $("#mic-btn");
  if (btn) btn.setAttribute("aria-pressed", on ? "true" : "false");
}

export function updateSpeakerUI(on) {
  const btn = $("#spk-btn");
  if (btn) btn.setAttribute("aria-pressed", on ? "true" : "false");
}

export function wireButtonClick(id, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener("click", fn);
}
