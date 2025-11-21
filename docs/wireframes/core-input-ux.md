# Core Input UX — Wireframes (Call + Chat)

> Frames: 390×844 (mobile), 768×1024 (tablet), 1280×800 (desktop)
> Grid: 12 cols / 16px gutters / fluid max width 720px (desktop), 100% minus safe areas (mobile)

## A. CALL VIEW (Idle → Ringing → Listening → Thinking → Replying)

┌──────────────────────────────────────────┐
│ powered by Son of Wisdom (fixed top)     │
├──────────────────────────────────────────┤
│            ┌───────────────┐             │
│            │   VOICE RING  │             │
│            │   (Canvas)    │             │
│            └──────┬────────┘             │
│                   │                      │
│              [ AVATAR ]                  │
│                                          │
│   Status line (single row, ellipsize)    │
│   e.g. “Tap the blue call button to…”    │
│                                          │
│ ┌──────────────── transcript ──────────┐ │
│ │  [Interim live text…]               │ │
│ │  • Final line bubble                │ │
│ │  • Final line bubble                │ │
│ └─────────────────────────────────────┘ │
│                                          │
│  [Optional: Live Emotions mini panel]    │
│                                          │
│  Controls (fixed at bottom center):      │
│  [ Mic ]  [ Call / End ]  [ Speaker ]  [ Mode ] 
│  - respects safe-area insets             │
└──────────────────────────────────────────┘

States:
- Idle: status = “Tap the blue call button…”
- Ringing: play ring.mp3 twice, status = “Ringing…”
- Greeting: play blake.mp3, status = “AI is greeting you…”
- Listening: VAD on, interim text visible
- Thinking: “Thinking…”
- Replying: audio playing, ring animates to output

## B. CHAT VIEW (Always available; call can continue in background)

┌──────────────────────────────────────────┐
│ powered by Son of Wisdom (fixed top)     │
├──────────────────────────────────────────┤
│  Header row:                             │
│   - “Chat” title                         │
│   - Small status dot: Idle/On call       │
│                                          │
│ ┌──────────────── chat-log ────────────┐ │
│ │  Me bubble                            │
│ │  AI bubble (typing… 3-dot pulser)     │
│ │  AI bubble (word-by-word)             │
│ │  System chip: “(playing audio…)”      │
│ └──────────────────────────────────────┘ │
│                                          │
│  Input row:  [  Type a message…     ][ Send ] 
│  - Enter to send; Shift+Enter = newline │
│  - Disabled while inflight              │
│                                          │
│  Controls (floating bottom-right):       │
│   [ Mic ] [ Call/End ] [ Speaker ] [ Mode ] 
└──────────────────────────────────────────┘

Behavior:
- Chat works even when a call is active (parallel).
- AI bubble starts “typing” immediately, then types word-by-word if text is available (JSON or SSE); if audio-only, show “(playing audio…)” until transcript arrives.

## C. SAFE AREAS & OVERLAP RULES

- Status text NEVER overlaps transcript/chat regions.
- Minimum spacer between avatar block and transcript: 16px mobile / 20px desktop.
- Fixed controls honor `env(safe-area-inset-bottom)`.
- Transcript/chat containers have internal scroll; page body should not scroll during call.

## D. COLORS & MOTION

- Background: deep navy/charcoal (not pure black), 3–5% noise vignette recommended.
- Primary tokens: 
  - brand: #1F5FD6 (or match logo)
  - bronze-accent (ring while output): #D4A373
  - success/ready (ring while mic): #39D353
- Motion:
  - Respect `prefers-reduced-motion`
  - Ring thickness = function of RMS from analyser
  - Emotions (optional): ring hue maps to valence (red→neutral→green)

