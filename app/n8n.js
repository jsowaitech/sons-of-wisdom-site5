// n8n.js
import {
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_BUCKET, RECORDINGS_FOLDER,
  N8N_WEBHOOK_URL, N8N_TRANSCRIBE_URL, ENABLE_STREAMED_PLAYBACK
} from "./config.js";
import { state } from "./state.js";
import { getOrCreateDeviceId, getUserIdForWebhook, blobToFormData, warn } from "./utils.js";
import { fetchLastPairsFromSupabase, fetchRollingSummary, buildRollingSummary, upsertRollingSummary } from "./supabase.js";
import { animateRingFromElement, registerAudioElement } from "./audio.js";
import { appendMsg, typewriter } from "./ui.js";

/* small helper clip player (ring/greeting) */
export function safePlayOnce(src,{limitMs=15000,color="#d4a373"}={}){
  return new Promise(res=>{
    const a=new Audio(src); a.preload="auto"; registerAudioElement(a); animateRingFromElement(a,color);
    const t=setTimeout(()=>res(false),limitMs);
    a.oncanplaythrough=()=>{ try{ a.play().catch(()=>res(false)); }catch{} };
    a.onended=()=>{ clearTimeout(t); res(true); };
    a.onerror=()=>res(false); a.onabort=()=>res(false);
  });
}

/* streamed webm/opus playback */
export async function playStreamedWebmOpus(response){
  try{
    if(!('MediaSource' in window)) return null;
    const ct=(response.headers.get("content-type")||"").toLowerCase();
    if(!ct.includes("audio/webm")) return null;
    if(!response.body || !response.body.getReader) return null;

    const ms=new MediaSource(); const url=URL.createObjectURL(ms);
    await new Promise(res=> ms.addEventListener("sourceopen",res,{once:true}));
    const sb=ms.addSourceBuffer('audio/webm; codecs="opus"');
    const reader=response.body.getReader();
    const a=new Audio(url); registerAudioElement(a); animateRingFromElement(a,"#d4a373");
    let started=false;

    const pump=async()=>{
      const {value,done}=await reader.read();
      if(done){ if(!sb.updating) ms.endOfStream(); else sb.addEventListener("updateend",()=>{ try{ms.endOfStream();}catch{} },{once:true}); return; }
      await new Promise(r=>{
        const go=()=>{ try{ sb.appendBuffer(value); }catch{ r(); return; } };
        if(!sb.updating){ go(); r(); } else sb.addEventListener("updateend",()=>{ go(); r(); },{once:true});
      });
      return pump();
    };
    sb.addEventListener("updateend",()=>{ if(!started){ started=true; try{ a.play(); }catch{} } });
    pump().catch(()=>{ try{ms.endOfStream();}catch{} });

    await new Promise(r=> a.onended=r);
    URL.revokeObjectURL(url);
    return true;
  }catch{ return null; }
}

/* optional live transcription of AI audio */
export async function liveTranscribeBlob(blob, aiBubbleEl){
  if(!N8N_TRANSCRIBE_URL) return;
  const resp = await fetch(N8N_TRANSCRIBE_URL,{ method:"POST", body: await blobToFormData(blob,"file","ai.mp3") });
  const data = await resp.json().catch(()=>null);
  const text = data?.text || data?.transcript || "";
  if (text && aiBubbleEl){ await typewriter(aiBubbleEl, text, 18); }
}

/* voice path: upload → n8n → play AI */
export async function uploadRecordingAndNotify(){
  if(!state.isCalling) return false;

  const finalText=state.finalSegments.join(" ").trim();
  const interimText=(state.interimBuffer||"").trim();
  const combinedTranscript = finalText || interimText || "";
  if(combinedTranscript){
    state.recentUserTurns.push(combinedTranscript);
    if(state.recentUserTurns.length>state.RECENT_USER_KEEP)
      state.recentUserTurns.splice(0, state.recentUserTurns.length-state.RECENT_USER_KEEP);
  }

  const user_id=getUserIdForWebhook();
  const device=getOrCreateDeviceId();
  const mimeType=state.mediaRecorder?.mimeType || "audio/webm";
  const blob=new Blob(state.recordChunks, { type:mimeType });
  if(!blob.size || !state.isCalling){ document.getElementById("status-text").textContent="No audio captured."; return false; }

  document.getElementById("status-text").textContent="Thinking…";

  let historyPairsText="", historyPairs=[];
  try{ const hist=await fetchLastPairsFromSupabase(user_id,{pairs:8}); historyPairsText=hist.text||""; historyPairs=hist.pairs||[]; }catch{}
  const prevSummary=await fetchRollingSummary(user_id,device);
  const rollingSummary=buildRollingSummary(prevSummary,historyPairs,combinedTranscript);
  const transcriptForModel = historyPairsText
    ? `Previous conversation (last ${Math.min(historyPairs.length,8)} pairs), oldest→newest:\n${historyPairsText}\n\nUser now says:\n${combinedTranscript}`
    : combinedTranscript;

  const ext = mimeType.includes("mp4") ? "m4a" : "webm";
  const filePath = `${RECORDINGS_FOLDER}/${device}/${Date.now()}.${ext}`;
  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET)}/${filePath}`;
  const upRes = await fetch(uploadUrl,{
    method:"POST",
    headers:{
      Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": blob.type || "application/octet-stream",
      "x-upsert":"false"
    },
    body: blob
  });
  if(!upRes.ok || !state.isCalling){ document.getElementById("status-text").textContent=`Upload failed (${upRes.status}).`; return false; }

  let aiPlayableUrl=null, revokeLater=null, aiBlob=null, aiTextFromJSON="";
  try{
    const body={
      bucket: SUPABASE_BUCKET,
      filePath,
      publicUrl: `${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(SUPABASE_BUCKET)}/${filePath}`,
      user_id,
      transcript: transcriptForModel,
      has_transcript: !!transcriptForModel,
      history_user_last3: state.recentUserTurns.slice(-3),
      rolling_summary: rollingSummary || undefined,
      executionMode:"production",
      source:"voice"
    };

    const resp=await fetch(N8N_WEBHOOK_URL,{ method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(body) });
    const ct=(resp.headers.get("content-type")||"").toLowerCase();

    if(ENABLE_STREAMED_PLAYBACK && ct.includes("audio/webm") && resp.body?.getReader){
      const ok=await playStreamedWebmOpus(resp.clone());
      if(ok){ upsertRollingSummary(user_id,device,rollingSummary).catch(()=>{}); return true; }
    }

    if (ct.startsWith("audio/") || ct==="application/octet-stream") {
      aiBlob = await resp.blob();
      aiPlayableUrl=URL.createObjectURL(aiBlob); revokeLater=aiPlayableUrl;
    } else if (ct.includes("application/json")) {
      const data=await resp.json();
      aiTextFromJSON = data?.text ?? data?.transcript ?? data?.message ?? "";
      const b64 = data?.audio_base64;
      const url = data?.result_audio_url || data?.audioUrl || data?.url || data?.fileUrl;
      if(b64 && !url){
        const raw=b64.includes(",")?b64.split(",").pop():b64;
        const bytes=Uint8Array.from(atob(raw),c=>c.charCodeAt(0));
        aiBlob=new Blob([bytes],{type:(data && data.mime) ? data.mime : "audio/mpeg"});
        aiPlayableUrl=URL.createObjectURL(aiBlob); revokeLater=aiPlayableUrl;
      }else if(url){ aiPlayableUrl=url; }
    }else{
      aiBlob = await resp.blob();
      if(aiBlob.size){ aiPlayableUrl=URL.createObjectURL(aiBlob); revokeLater=aiPlayableUrl; }
    }
  }catch(e){ warn("webhook failed",e); document.getElementById("status-text").textContent="AI processing failed."; return false; }

  if(!state.isCalling) return false;
  if(!aiPlayableUrl){ document.getElementById("status-text").textContent="AI processing failed (no audio)."; return false; }

  let aiBubble=null;
  if (state.inChatView){
    aiBubble = appendMsg("ai","", { typing:true });
    if (aiTextFromJSON){ await typewriter(aiBubble, aiTextFromJSON, 18); }
  }
  if (!aiTextFromJSON && aiBlob && N8N_TRANSCRIBE_URL){
    try{ await liveTranscribeBlob(aiBlob, aiBubble); }catch{}
  }

  document.getElementById("status-text").textContent="AI replying…";
  state.isPlayingAI=true;
  const a=new Audio(aiPlayableUrl); registerAudioElement(a); animateRingFromElement(a,"#d4a373");
  try{ await a.play(); }catch{}
  await new Promise(r=> a.onended=r);
  state.isPlayingAI=false;
  if(revokeLater) try{ URL.revokeObjectURL(revokeLater); }catch{}

  upsertRollingSummary(user_id, device, rollingSummary).catch(()=>{});
  return true;
}

/* chat path: send text → n8n → (optional audio) + bubble typing */
export async function sendChatToN8N(userText){
  const user_id=getUserIdForWebhook();
  const device=getOrCreateDeviceId();

  state.recentUserTurns.push(userText);
  if(state.recentUserTurns.length>state.RECENT_USER_KEEP)
    state.recentUserTurns.splice(0, state.recentUserTurns.length-state.RECENT_USER_KEEP);

  let historyPairsText="", historyPairs=[];
  try{ const hist=await fetchLastPairsFromSupabase(user_id,{pairs:8}); historyPairsText=hist.text||""; historyPairs=hist.pairs||[]; }catch{}
  const prevSummary=await fetchRollingSummary(user_id,device);
  const rollingSummary=buildRollingSummary(prevSummary, historyPairs, userText);
  const transcriptForModel = historyPairsText
    ? `Previous conversation (last ${Math.min(historyPairs.length,8)} pairs), oldest→newest:\n${historyPairsText}\n\nUser now says:\n${userText}`
    : userText;

  try{
    const resp=await fetch(N8N_WEBHOOK_URL, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({
        user_id, transcript: transcriptForModel, has_transcript: !!transcriptForModel,
        history_user_last3: state.recentUserTurns.slice(-3),
        rolling_summary: rollingSummary || undefined,
        executionMode:"production", source:"chat"
      })
    });

    const ct=(resp.headers.get("content-type")||"").toLowerCase();
    let aiText="", playableUrl=null, revoke=null, b=null;

    if(ct.includes("application/json")){
      const data=await resp.json();
      aiText = data?.text ?? data?.transcript ?? data?.message ?? "";
      const url = data?.result_audio_url || data?.audioUrl || data?.url || data?.fileUrl;
      const b64 = data?.audio_base64;
      if(b64 && !url){
        const raw=b64.includes(",")?b64.split(",").pop():b64;
        const bytes=Uint8Array.from(atob(raw),c=>c.charCodeAt(0));
        b=new Blob([bytes],{type:(data && data.mime) ? data.mime : "audio/mpeg"});
        playableUrl=URL.createObjectURL(b); revoke=playableUrl;
      } else if(url){ playableUrl=url; }
    } else if(ct.startsWith("audio/") || ct==="application/octet-stream"){
      b=await resp.blob(); if(b.size){ playableUrl=URL.createObjectURL(b); revoke=playableUrl; }
    } else {
      b=await resp.blob(); if(b.size){ playableUrl=URL.createObjectURL(b); revoke=playableUrl; }
    }

    const aiBubble = appendMsg("ai","", { typing:true });
    if(aiText){ await typewriter(aiBubble, aiText, 18); }
    else if (b && N8N_TRANSCRIBE_URL){ await liveTranscribeBlob(b, aiBubble); }

    if(playableUrl){
      const a=new Audio(playableUrl); registerAudioElement(a); animateRingFromElement(a,"#d4a373");
      try{ await a.play(); }catch{} await new Promise(r=>a.onended=r);
      if(revoke) try{ URL.revokeObjectURL(revoke); }catch{}
    }
    upsertRollingSummary(user_id, device, rollingSummary).catch(()=>{});
  }catch(e){ warn("chat error",e); appendMsg("ai","Sorry, I couldn’t send that just now."); }
}
