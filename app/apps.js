// app/app.js
/* ultra-light helpers (no framework) */

/* ---------------- Timer ---------------- */
export function startTimer(el){
  const t0 = Date.now();

  const fmt = (s) => {
    const m = Math.floor(s/60);
    const r = s % 60;
    return `${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`;
  };

  el.textContent = '00:00';

  const id = setInterval(() => {
    const sec = Math.floor((Date.now() - t0) / 1000);
    el.textContent = fmt(sec);
  }, 1000);

  // return a stopper so callers can clean up on navigation
  return () => clearInterval(id);
}

/* ------------- Transcript helper (demo) ------------- */
export function pushTranscript(listEl, text){
  if (!listEl) return;
  const b = document.createElement('div');
  b.className = 'bubble';
  b.textContent = text;
  listEl.appendChild(b);
  listEl.scrollTop = listEl.scrollHeight;
}

/* ------------- Home chips -> input ------------- */
export function wireChips(){
  const input = document.querySelector('.input');
  if (!input) return;
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      input.value = chip.textContent.trim();
      input.focus();
    });
  });
}
