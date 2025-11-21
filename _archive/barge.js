// barge.js — very light RMS VAD to interrupt TTS when the user starts speaking

import { getMicAnalyser, isSpeaking, interruptTTS } from "./audio.js";

let rafId = 0;
let armed = false;
let cb = null;

export function startBargeIn(onSpeechStart) {
  cb = onSpeechStart;
  armed = true;
  loop();
}

export function stopBargeIn() {
  armed = false;
  if (rafId) cancelAnimationFrame(rafId);
}

function loop() {
  if (!armed) return;
  const an = getMicAnalyser();
  if (an) {
    const buf = new Uint8Array(an.fftSize);
    an.getByteTimeDomainData(buf);
    // RMS
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);
    // If AI is speaking and user voice is strong enough → barge-in
    if (isSpeaking() && rms > 0.06) {
      interruptTTS();
      cb?.();
    }
  }
  rafId = requestAnimationFrame(loop);
}
