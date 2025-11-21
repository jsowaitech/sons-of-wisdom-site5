// speech.js
import { state } from "./state.js";
import { transcriptUI } from "./ui.js";

export function openNativeRecognizer(){
  const ASR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!ASR){ transcriptUI.setInterim("Listening…"); return; }
  const r=new ASR(); r.lang="en-US"; r.continuous=true; r.interimResults=true; r.maxAlternatives=1;
  r.onresult=(e)=>{
    let interim="";
    for(let i=e.resultIndex;i<e.results.length;i++){
      const res=e.results[i]; const txt=(res[0]?.transcript||"").trim(); if(!txt) continue;
      if(res.isFinal){ transcriptUI.addFinalLine(txt); state.finalSegments.push(txt); state.interimBuffer=""; }
      else interim += (interim?" ":"")+txt;
    }
    transcriptUI.setInterim(interim);
    state.interimBuffer = interim;
  };
  r.onend=()=>{ if(state.isCalling && state.isRecording) { try{ r.start(); }catch{} } };
  try{ r.start(); }catch{}
  state.speechRecognizer=r;
}
export function closeNativeRecognizer(){
  try{ if(state.speechRecognizer){ const r=state.speechRecognizer; state.speechRecognizer=null; r.onend=null; r.stop(); } }catch{}
}
