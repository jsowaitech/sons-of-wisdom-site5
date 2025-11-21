# Flows

## A. Call flow
Idle → Ringing(2×) → Greeting → Listening(VAD) → Thinking(upload→n8n) → Replying(play) → Listening… (loop)
- If user speaks during Replying → interrupt → Listening

## B. Chat flow
Type → optimistic user bubble → AI typing bubble
- If JSON text: typewriter → done; optionally play audio too
- If Binary only: show “(playing audio…)”; if SSE present, replace with live words

## C. Error flow (voice)
Capture → upload fail → error chip + retry
n8n fail → “AI processing failed” + listen again

## D. Mode transitions
Call→Chat or Chat→Call at any time
- Do not re-render transcript/chat containers (preserve scroll & content)
