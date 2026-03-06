/* =========================
   Hume Realtime (Expression Measurement API)
   - Browser WebSocket client using JSON messages (models + base64 data)
   - Streams PCM16 @16kHz mic chunks (~500ms) in real-time
   - Shows top-3 emotions live
   - Uses short-lived access token from backend (/api/hume-token)
   - Minimal global API: window.HumeRealtime { init, startTurn, handleRecorderChunk, stopTurn }
   ========================= */

(() => {
  const DEFAULTS = {
    enable: true,
    tokenEndpoint: "/api/hume-token",
    wssBase: "wss://api.hume.ai/v0/stream/models",
    batchMs: 500,
    targetHz: 16000,
    uiThrottleMs: 180,
  };

  const S = {
    cfg: { ...DEFAULTS },
    socket: null,
    socketPromise: null,
    workletReady: false,
    pcmNode: null,
    srcNode: null,
    audioCtx: null,
    flushTimer: null,

    accessToken: null,
    accessTokenExpiresAt: 0,

    pcmQueue: [],
    lastFlush: 0,

    ui: { root: null, list: null, lastRender: 0 },
  };

  /* ---------- Emotion UI ---------- */
  function ensureUI() {
    if (S.ui.root) return;

    const root = document.createElement("div");
    root.id = "hume-panel";
    root.style.cssText =
      "position:relative;width:min(860px,92vw);margin:10px auto 0;padding:8px 10px;border-radius:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:#dfe8ff;font-size:13px;";

    const title = document.createElement("div");
    title.textContent = "Live Emotions";
    title.style.cssText = "opacity:.8;margin-bottom:6px;font-weight:600;";

    const list = document.createElement("div");
    list.style.cssText =
      "display:flex;gap:10px;flex-wrap:wrap;align-items:center;";

    root.appendChild(title);
    root.appendChild(list);

    const anchor =
      document.getElementById("transcript") ||
      document.getElementById("avatar-container") ||
      document.body;

    anchor.insertAdjacentElement("afterend", root);
    S.ui.root = root;
    S.ui.list = list;
  }

  function uiBar(label, pct) {
    const wrap = document.createElement("div");
    wrap.style.cssText =
      "display:flex;align-items:center;gap:6px;min-width:160px;";

    const name = document.createElement("div");
    name.textContent = label;
    name.style.cssText = "min-width:82px;opacity:.9;";

    const track = document.createElement("div");
    track.style.cssText =
      "flex:1;height:8px;background:rgba(255,255,255,.12);border-radius:6px;overflow:hidden;";

    const fill = document.createElement("div");
    fill.style.cssText = `height:100%;width:${Math.round(
      pct * 100
    )}%;background:#3ad67b;`;

    track.appendChild(fill);

    const val = document.createElement("div");
    val.textContent = `${Math.round(pct * 100)}%`;
    val.style.cssText = "min-width:40px;text-align:right;opacity:.85;";

    wrap.appendChild(name);
    wrap.appendChild(track);
    wrap.appendChild(val);
    return wrap;
  }

  function uiUpdateTop(pairs) {
    ensureUI();
    const now = performance.now();
    if (now - S.ui.lastRender < S.cfg.uiThrottleMs) return;
    S.ui.lastRender = now;

    S.ui.list.innerHTML = "";
    pairs.slice(0, 3).forEach((e) => {
      S.ui.list.appendChild(uiBar(e.name, e.score));
    });
  }

  function uiClear() {
    if (S.ui.list) S.ui.list.innerHTML = "";
  }

  /* ---------- Emotion extraction ---------- */
  function extractEmotions(json) {
    const out = [];

    (function walk(node) {
      if (!node || typeof node !== "object") return;

      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }

      if (node.emotions && Array.isArray(node.emotions)) {
        node.emotions.forEach((e) => {
          const name = e?.name || e?.label || e?.emotion || "";
          const score =
            typeof e?.score === "number"
              ? e.score
              : typeof e?.confidence === "number"
              ? e.confidence
              : typeof e?.value === "number"
              ? e.value
              : null;

          if (name && score != null) out.push({ name, score });
        });
      }

      if (
        node.scores &&
        typeof node.scores === "object" &&
        !Array.isArray(node.scores)
      ) {
        for (const [k, v] of Object.entries(node.scores)) {
          if (typeof v === "number") out.push({ name: k, score: v });
        }
      }

      for (const v of Object.values(node)) walk(v);
    })(json);

    out.sort((a, b) => b.score - a.score);
    return out;
  }

  /* ---------- AudioWorklet: downsample to 16k PCM16 ---------- */
  async function ensureWorklet(audioCtx) {
    if (S.workletReady) return true;
    if (!audioCtx?.audioWorklet) return false;

    const code = `
      class PCM16Downsampler extends AudioWorkletProcessor {
        constructor(opts){
          super();
          this.target = (opts?.processorOptions?.targetSampleRate) || 16000;
          this.inRate = sampleRate;
          this._acc = 0;
        }
        process(inputs){
          const ch0 = inputs[0]?.[0];
          if (!ch0) return true;

          const ratio = this.inRate / this.target;
          let outLen = Math.ceil(ch0.length / ratio) + 8;
          const out = new Int16Array(outLen);
          let o = 0;

          for (let acc = this._acc; acc < ch0.length; acc += ratio) {
            const i = acc | 0;
            const s = Math.max(-1, Math.min(1, ch0[i] || 0));
            out[o++] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }

          this._acc = (this._acc + ch0.length) % ratio;

          if (o > 0) {
            const buf = out.buffer.slice(0, o * 2);
            this.port.postMessage({ type: "pcm16", buffer: buf }, [buf]);
          }

          return true;
        }
      }
      registerProcessor("pcm16-downsampler", PCM16Downsampler);
    `;

    const blob = new Blob([code], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);

    try {
      await audioCtx.audioWorklet.addModule(url);
      S.workletReady = true;
    } finally {
      URL.revokeObjectURL(url);
    }

    return true;
  }

  /* ---------- Access token ---------- */
  async function getAccessToken() {
    const now = Date.now();

    if (S.accessToken && now < S.accessTokenExpiresAt - 60_000) {
      return S.accessToken;
    }

    const resp = await fetch(S.cfg.tokenEndpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      throw new Error(
        data?.error || data?.detail || "Failed to get Hume access token"
      );
    }

    if (!data?.access_token) {
      throw new Error("Hume token response missing access_token");
    }

    S.accessToken = data.access_token;

    const expiresInSec =
      typeof data?.expires_in === "number" ? data.expires_in : 1800;

    S.accessTokenExpiresAt = now + expiresInSec * 1000;

    return S.accessToken;
  }

  function wsUrl(accessToken) {
    const u = new URL(S.cfg.wssBase);
    u.searchParams.set("access_token", accessToken);
    return u.toString();
  }

  /* ---------- Socket ---------- */
  async function openSocket() {
    if (!S.cfg.enable) return null;
    if (S.socket?.readyState === WebSocket.OPEN) return S.socket;
    if (S.socketPromise) return S.socketPromise;

    S.socketPromise = (async () => {
      const token = await getAccessToken();

      await new Promise((resolve, reject) => {
        let settled = false;
        let ws;

        try {
          ws = new WebSocket(wsUrl(token));
        } catch (err) {
          S.socket = null;
          reject(err);
          return;
        }

        S.socket = ws;
        S.socket.binaryType = "arraybuffer";

        const cleanup = () => {
          ws.onopen = null;
          ws.onerror = null;
        };

        ws.onopen = () => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve();
        };

        ws.onerror = (evt) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(evt instanceof Error ? evt : new Error("Hume socket error"));
        };

        ws.onmessage = (evt) => {
          try {
            const data = JSON.parse(evt.data);
            const top = extractEmotions(data);
            if (top.length) uiUpdateTop(top);
          } catch {
            // ignore non-JSON frames
          }
        };

        ws.onclose = () => {
          S.socket = null;
        };
      });

      return S.socket;
    })();

    try {
      return await S.socketPromise;
    } finally {
      S.socketPromise = null;
    }
  }

  function closeSocket() {
    try {
      S.socket?.close();
    } catch {}
    S.socket = null;
    S.socketPromise = null;
  }

  /* ---------- Batching & send ---------- */
  function flushIfDue(force = false) {
    if (!S.socket || S.socket.readyState !== WebSocket.OPEN) return;

    const now = performance.now();
    if (!force && now - S.lastFlush < S.cfg.batchMs) return;
    S.lastFlush = now;

    if (!S.pcmQueue.length) return;

    let totalSamples = 0;
    S.pcmQueue.forEach((a) => {
      totalSamples += a.length;
    });

    const merged = new Int16Array(totalSamples);
    let off = 0;

    for (const a of S.pcmQueue) {
      merged.set(a, off);
      off += a.length;
    }

    S.pcmQueue.length = 0;

    const u8 = new Uint8Array(merged.buffer);
    let bin = "";
    for (let i = 0; i < u8.length; i++) {
      bin += String.fromCharCode(u8[i]);
    }
    const b64 = btoa(bin);

    const msg = {
      models: { prosody: {} },
      data: b64,
      encoding: "pcm16",
      sample_rate: S.cfg.targetHz,
      channels: 1,
    };

    try {
      S.socket.send(JSON.stringify(msg));
    } catch {
      // swallow send errors
    }
  }

  /* ---------- Public API ---------- */
  async function init(opts = {}) {
    S.cfg = { ...S.cfg, ...opts };
    if (S.cfg.enable) ensureUI();
  }

  async function startTurn(stream, audioCtx) {
    if (!S.cfg.enable) return;

    await openSocket();

    S.audioCtx =
      audioCtx || new (window.AudioContext || window.webkitAudioContext)();

    if (S.audioCtx.state === "suspended") {
      await S.audioCtx.resume().catch(() => {});
    }

    const ok = await ensureWorklet(S.audioCtx);
    if (!ok) return;

    if (S.srcNode || S.pcmNode) {
      stopTurn();
      await openSocket();
    }

    S.srcNode = S.audioCtx.createMediaStreamSource(stream);
    S.pcmNode = new AudioWorkletNode(S.audioCtx, "pcm16-downsampler", {
      processorOptions: { targetSampleRate: S.cfg.targetHz },
    });

    S.srcNode.connect(S.pcmNode);

    S.pcmNode.port.onmessage = (e) => {
      if (e.data?.type !== "pcm16") return;
      const view = new Int16Array(e.data.buffer);
      S.pcmQueue.push(view);
      flushIfDue(false);
    };

    S.lastFlush = performance.now();
    S.flushTimer = setInterval(() => flushIfDue(true), S.cfg.batchMs);
  }

  async function handleRecorderChunk(_blob) {
    // no-op, kept for compatibility
  }

  function stopTurn() {
    try {
      clearInterval(S.flushTimer);
    } catch {}
    S.flushTimer = null;

    flushIfDue(true);

    if (S.pcmNode) {
      try {
        S.pcmNode.disconnect();
      } catch {}
      S.pcmNode = null;
    }

    if (S.srcNode) {
      try {
        S.srcNode.disconnect();
      } catch {}
      S.srcNode = null;
    }

    closeSocket();
    uiClear();
  }

  window.HumeRealtime = { init, startTurn, handleRecorderChunk, stopTurn };
})();