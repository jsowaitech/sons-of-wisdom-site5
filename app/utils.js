// utils.js — tiny helpers (no framework)

/** mm:ss timer */
export function startTimer(el) {
  if (!el) return () => {};
  const t0 = Date.now();
  el.textContent = "00:00";
  const id = setInterval(() => {
    const sec = Math.floor((Date.now() - t0) / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    el.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, 1000);
  return () => clearInterval(id);
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
