// state.js
export const SENTINEL_UUID = "00000000-0000-0000-0000-000000000000";

export const state = {
  // flags
  isCalling: false,
  isRecording: false,
  isPlayingAI: false,
  inChatView: false,

  // streams/recording
  globalStream: null,
  mediaRecorder: null,
  recordChunks: [],

  // barge-in
  bargeRequested: false,

  // captions
  HAS_NATIVE_ASR: ('SpeechRecognition' in window) || ('webkitSpeechRecognition' in window),
  speechRecognizer: null,

  // audio routing
  playbackAC: null,
  managedAudios: new Set(),
  preferredOutputDeviceId: null,
  micMuted: false,
  speakerMuted: false,

  // transcripts
  interimBuffer: "",
  finalSegments: [],

  // recent user turns (chat grounding)
  RECENT_USER_KEEP: 12,
  recentUserTurns: [],

  // UI dedupe
  lastFinalLine: ""
};
