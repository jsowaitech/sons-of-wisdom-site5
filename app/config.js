// app/config.js
// Fill in any placeholders. Safe to commit for client-side apps.

export const CONFIG = {
  // ===== Supabase (yours) =====
  SUPABASE_URL: "https://plrobtlpedniyvkpwdmp.supabase.co",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBscm9idGxwZWRuaXl2a3B3ZG1wIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NjYyOTg1MCwiZXhwIjoyMDYyMjA1ODUwfQ.IhY398suDk3RKXAAgyO5FM6Wr8SbkDyd8bE8pql6nSE",

  // ===== (Optional) Hume realtime (kept for future) =====
  HUME_WS_URL: "wss://api.hume.ai/v0/stream/models",
  HUME_API_KEY: "vyy4rmKvPN8b7RiI4fZL7vDs2bUN05vDdZWmmrxCb1FOG01U",

  // ===== Identity / theming =====
  AVATAR_URL: "./Sonofwisdom.png",
  TITLE_FALLBACK: "Conversation",

  // ===== Audio assets =====
  RING_URL: "./ring.mp3",      // played twice at the start
  GREETING_URL: "./blake.mp3", // AI greeting before listening

  // ===== n8n webhook =====
  // Your webhook that accepts a POST with FormData("audio": <webm blob>)
  // and returns either:
  //   A) binary audio (Content-Type: audio/*)
  //   B) JSON { tts_url: "https://...", transcript?, assistant_transcript? }
  N8N_WEBHOOK_URL: "https://jsonofwisdom.app.n8n.cloud/webhook/4877ebea-544b-42b4-96d6-df41c58d48b0",
  N8N_METHOD: "POST",
  N8N_TIMEOUT_MS: 60000,

  // Response handling:
  //  - 'auto'   : decide by Content-Type header (audio/* => binary, else JSON)
  //  - 'binary' : always treat as binary audio
  //  - 'json'   : always parse JSON
  N8N_RESPONSE_TYPE: "auto",
  JSON_AUDIO_FIELD: "tts_url",          // JSON field name to read when using JSON
  JSON_USER_TEXT_FIELDS: ["transcript","user_transcript","user_text"],
  JSON_ASSIST_TEXT_FIELDS: ["assistant_transcript","assistant","text"],

  // ===== VAD / UX tuning =====
  VAD: {
    startThreshold: 0.02,   // energy to start detecting speech
    stopThreshold: 0.012,   // energy below which we consider silence
    minSpeechMs: 300,       // must talk at least this long
    minSilenceMs: 350,      // trailing silence to end utterance
    bargeInGraceMs: 120,    // how fast we interrupt TTS after speech detected
    analyseFps: 24          // energy sampling rate for ring/VAD
  },

  // ===== Feature toggles =====
  ENABLE_BARGE_IN: true,
  LOG_TO_SUPABASE: true,   // insert rows into calls/call_sessions if available
  START_SPEAKER_MUTED: false
};
