// main.js
import { state } from "./state.js";
import {
  ensureChatUI, showCallView, showChatView,
  updateMicUI, updateSpeakerUI, updateModeBtnUI, appendMsg
} from "./ui.js";
import { callBtn, micBtn, speakerBtn, modeBtn, statusText } from "./ui.js";
import { pickSpeakerOutputDevice, updateMicTracks } from "./audio.js";
import { startCall, endCall } from "./call.js";
import { sendChatToN8N } from "./n8n.js";

ensureChatUI();
updateMicUI(); updateSpeakerUI(); updateModeBtnUI();
showCallView();

/* wiring */
callBtn?.addEventListener("click", ()=>{ !state.isCalling ? startCall() : endCall(); });
micBtn?.addEventListener("click", ()=>{
  state.micMuted=!state.micMuted; updateMicTracks(); updateMicUI();
  statusText.textContent = state.micMuted?"Mic muted.":"Mic unmuted.";
});
speakerBtn?.addEventListener("click", async()=>{
  const wasMuted=state.speakerMuted; state.speakerMuted=!state.speakerMuted;
  for(const el of state.managedAudios){ el.muted=state.speakerMuted; el.volume=state.speakerMuted?0:1; }
  updateSpeakerUI();
  if(wasMuted && !state.speakerMuted && "setSinkId" in HTMLMediaElement.prototype){
    if(!state.preferredOutputDeviceId) state.preferredOutputDeviceId=await pickSpeakerOutputDevice();
    if(state.preferredOutputDeviceId){
      for(const el of state.managedAudios) el.setSinkId?.(state.preferredOutputDeviceId);
      statusText.textContent="Speaker output active.";
    }
  }
});
modeBtn?.addEventListener("click", ()=>{ state.inChatView ? showCallView() : showChatView(); });

/* chat */
const form = document.getElementById("chat-form");
const input = document.getElementById("chat-input");

if (form && !form._wired){
  // Enter to send (Shift+Enter = newline), IME-safe
  let composing = false;
  input?.addEventListener("compositionstart", ()=> composing=true);
  input?.addEventListener("compositionend",  ()=> composing=false);
  input?.addEventListener("keydown", (e)=>{
    if (!composing && e.key === "Enter" && !e.shiftKey){
      e.preventDefault();
      form.requestSubmit?.();
    }
  });

  // autosize
  const autosize=()=>{
    if(!input) return;
    input.style.height="auto";
    const max=6*20; // ~6 lines
    input.style.height=Math.min(input.scrollHeight, max)+"px";
  };
  input?.addEventListener("input", autosize); queueMicrotask(autosize);

  form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    const txt=(input?.value||"").trim();
    if(!txt) return;
    input.value=""; input.style.height="auto";
    showChatView();
    appendMsg("me", txt);
    await sendChatToN8N(txt);
  });
  form._wired=true;
}
