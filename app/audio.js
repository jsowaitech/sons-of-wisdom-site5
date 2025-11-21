// audio.js — mic I/O, playback (streaming + fallback), and interrupt

let ctx;
let micStream;
let micSource;
let analyser;
let ttsAudio;           // <audio> sink for TTS
let mediaSource;        // MediaSource for webm/opus streaming
let sourceBuffer;       // SourceBuffer for streaming
let streamReader;       // ReadableStreamDefaultReader
let abortStream = null; // abort fn for current streaming request
let speaking = false;
let speakerEnabled = true;
let micEnabled = true;

async function ensureCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") await ctx.resume();
  if (!ttsAudio) {
    ttsAudio = document.getElementById("tts-audio");
    if (!ttsAudio) {
      ttsAudio = document.createElement("audio");
      ttsAudio.id = "tts-audio";
      ttsAudio.style.display = "none";
      document.body.appendChild(ttsAudio);
    }
  }
}

export async function initAudio() {
  await ensureCtx();
}

export async function setMicEnabled(on) {
  micEnabled = !!on;
  if (on) {
    if (!micStream) {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      micSource = ctx.createMediaStreamSource(micStream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      micSource.connect(analyser);
    } else {
      micStream.getAudioTracks().forEach(t => t.enabled = true);
    }
  } else if (micStream) {
    micStream.getAudioTracks().forEach(t => t.enabled = false);
  }
  return micStream || null;
}

export function getMicAnalyser() { return analyser || null; }
export function isMicEnabled()   { return micEnabled; }
export function isSpeakerEnabled(){ return speakerEnabled; }
export function isSpeaking()     { return speaking; }

export function setSpeakerEnabled(on) {
  speakerEnabled = !!on;
  if (ttsAudio) ttsAudio.muted = !speakerEnabled;
}

/** Stop current TTS playback/stream if any */
export function interruptTTS() {
  // stop speechSynthesis fallback if used
  if (window.speechSynthesis && window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
  }
  // stop streaming
  if (abortStream) abortStream();
  if (ttsAudio) {
    ttsAudio.pause();
    if (ttsAudio.src && ttsAudio.src.startsWith("blob:")) {
      URL.revokeObjectURL(ttsAudio.src);
    }
  }
  speaking = false;
}

/** Play TTS from a fetch Response that streams webm/opus. Fallback to blob/mp3. */
export async function playStreamResponse(resp, { onStart, onEnd, onError } = {}) {
  await ensureCtx();
  interruptTTS();
  try {
    const ctype = (resp.headers.get("content-type") || "").toLowerCase();
    if (ctype.includes("audio/webm") || ctype.includes("codecs=opus")) {
      // Stream via MediaSource
      mediaSource = new MediaSource();
      const url = URL.createObjectURL(mediaSource);
      ttsAudio.src = url;
      ttsAudio.muted = !speakerEnabled;
      speaking = true;
      onStart?.();
      await new Promise((resolve, reject) => {
        mediaSource.addEventListener("sourceopen", async () => {
          try {
            sourceBuffer = mediaSource.addSourceBuffer('audio/webm; codecs="opus"');
            sourceBuffer.mode = "sequence";
            const reader = resp.body.getReader();
            streamReader = reader;
            let ended = false;

            const pump = async () => {
              const { value, done } = await reader.read();
              if (done) { ended = true; try { mediaSource.endOfStream(); } catch {} return; }
              await new Promise((r) => {
                sourceBuffer.addEventListener("updateend", r, { once: true });
                try { sourceBuffer.appendBuffer(value); } catch { r(); }
              });
              if (!ended) pump();
            };
            abortStream = () => { try { reader.cancel(); } catch {} };
            pump().catch(reject);
            ttsAudio.play().catch(()=>{});
            ttsAudio.onended = () => { speaking = false; onEnd?.(); };
          } catch (e) {
            reject(e);
          }
        }, { once: true });
      });
    } else {
      // Fallback: read as blob and play once
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      ttsAudio.src = url;
      ttsAudio.muted = !speakerEnabled;
      speaking = true;
      onStart?.();
      await ttsAudio.play().catch(()=>{});
      ttsAudio.onended = () => { speaking = false; onEnd?.(); };
    }
  } catch (err) {
    speaking = false;
    onError?.(err);
  }
}

/** Fallback: browser speech synthesis (useful while wiring backend) */
export async function speakTextFallback(text, { onStart, onEnd } = {}) {
  await ensureCtx();
  if (!("speechSynthesis" in window)) return;
  interruptTTS();
  const utt = new SpeechSynthesisUtterance(text);
  utt.onstart = () => { speaking = true; onStart?.(); };
  utt.onend   = () => { speaking = false; onEnd?.();  };
  window.speechSynthesis.speak(utt);
}
