import { supabase, sbInsert, sbPatch } from "./supabase.js";
import { ensureDeviceId, getUserId, nowIso } from "./utils.js";

// active call (in-memory)
export const ActiveCall = {
  id: null,
  started_at: null,
  ended_at: null,
  turn_count: 0,
};

export async function createCallRow(title) {
  const device_id = ensureDeviceId();
  const user_id   = getUserId();

  const started_at = nowIso();
  const [{ id }] = await sbInsert("calls", [{
    user_id, device_id, started_at, duration_sec: null, turn_count: 0, title: title || null
  }]);

  ActiveCall.id = id;
  ActiveCall.started_at = started_at;
  ActiveCall.turn_count = 0;
  return id;
}

export async function endCallRow() {
  if (!ActiveCall.id) return;
  ActiveCall.ended_at = nowIso();
  const dur = Math.max(0, Math.round((+new Date(ActiveCall.ended_at) - +new Date(ActiveCall.started_at))/1000));

  await sbPatch("calls", { id: ActiveCall.id }, {
    ended_at: ActiveCall.ended_at,
    duration_sec: dur,
    turn_count: ActiveCall.turn_count
  });
}

export async function logTurn(role, { text, audio_url }) {
  if (!ActiveCall.id) return;
  ActiveCall.turn_count++;

  const user_id = getUserId();
  await sbInsert("call_sessions", [{
    call_id: ActiveCall.id,
    user_id_uuid: user_id,
    timestamp: nowIso(),
    role,
    input_transcript: role === "user" ? (text || null) : null,
    ai_text: role === "assistant" ? (text || null) : null,
    ai_audio_url: role === "assistant" ? (audio_url || null) : null
  }]);
}
