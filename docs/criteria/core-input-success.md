# Core Input – Definition of Done (DoD)

## Functional
- [ ] **Unlimited user recording**; capture continues until ~3s of silence (VAD), with no hard time cap.
- [ ] **Live user captions** show interim + final lines in the Call view; no duplicate final lines.
- [ ] **AI reply plays fully** (no duration cap); works for both JSON and binary responses. 
- [ ] **Barge-in**: if user speaks during AI playback, AI audio pauses/stops and app returns to Listening state.
- [ ] **Chat works in parallel** with calls; user can send text while on a live call.
- [ ] **AI text typing**: if response text is available (JSON or SSE), the AI bubble types word-by-word; otherwise show “(playing audio…)”.
- [ ] **Mode toggle**: Call ↔ Chat is instant; state persists (active call keeps running).

## Layout/Visual
- [ ] Status text never overlaps transcript/chat.
- [ ] Transcript/chat areas are scrollable with auto-scroll-to-bottom on append.
- [ ] Controls are fixed at bottom, centered (Call view) or bottom-right cluster (Chat view), respecting safe-area.
- [ ] Voice ring animates by input RMS; output animation hue/bronze while AI is speaking.

## Accessibility
- [ ] All control buttons have `aria-label` and `aria-pressed` where applicable.
- [ ] Keyboard: Enter to send; Escape to blur input; C toggles modes; Space/Enter activates buttons.
- [ ] Focus rings visible and high contrast.

## Performance
- [ ] First keystroke to “user bubble visible” < 100ms (optimistic UI).
- [ ] Mic start (user gesture) to live ring animation < 250ms on mid-tier mobile.
- [ ] Streamed audio begins within 1–2s when server supports progressive WebM.

## Resilience
- [ ] If upload fails, UI shows a small error chip and allows retry without page reload.
- [ ] If TTS returns binary with no headers, audio still plays.
- [ ] If SSE transcript webhook is down, audio still plays; AI bubble shows “(playing audio…)”.

## Data & History
- [ ] Per turn: store audio URL, user transcript, optional AI transcript, timestamps, session id.
- [ ] **Rolling summary**: includes BOTH user and AI salient lines (not just user), <= 380 chars.

## QA Scenarios
- [ ] Mobile Safari (iOS 16+) and Chrome Android: mic permission, barge-in, long reply playback.
- [ ] Desktop Chrome/Edge: output device routing (`setSinkId`) works when available.
- [ ] Network drop mid-reply: playback stops gracefully; next turn still possible.
