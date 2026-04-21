window.AppState = {
  mediaRecorder: null,
  activeStream: null,
  chunks: [],
  isRecording: false,
  fullTranscript: "",
  currentBatchCount: 0,
  countdownSeconds: 30,
  countdownInterval: null,
  recordingTimeout: null,
  errorMessageActive: false,
  sessionTranscript: [],
  sessionSuggestionBatches: [],
  sessionChat: [],
  REFRESH_INTERVAL: 30,
  /** First audio flush soon so transcript is not stuck behind a full 30s wait */
  FIRST_AUDIO_FLUSH_MS: 1500,
  isFirstRecordingCycle: true,
  warmupAttempts: 0,
  /** Rolling deterministic metrics (latency ms) */
  latencySamples: { transcribe: [], suggest: [], chat: [] },
  /** Last N prompt/API debug entries for settings + export */
  promptDebugLog: [],
  PROMPT_DEBUG_LOG_MAX: 25
};

window.DefaultSettings = {
  tm_sugg_prompt:
    "You are a live meeting copilot. Return strictly JSON with key 'suggestions' containing exactly 3 objects. Each object must include: type, title, preview, reason. Make suggestions actionable and different from each other (mix of ask_question, talking_point, answer, fact_check, clarify). Keep title under 14 words and preview under 45 words.",
  tm_chat_prompt:
    "You are a detailed meeting copilot. Answer using transcript evidence first, then practical next steps. If uncertain, say what is missing. Keep answers concise and useful in real-time.",
  tm_sugg_context:
    "Prioritize the last 2-4 minutes of discussion. Avoid repeating recent suggestions. Suggest what helps the user in the next 30-60 seconds.",
  tm_chat_context: "Use full session context, but prioritize recent transcript. Maintain continuity with previous chat turns.",
  tm_sugg_last_n_chars: "4000",
  tm_chat_last_n_chars: "7000",
  tm_context_summary_trigger_chars: "1500",
  tm_recency_boost_chars: "1200",
  tm_show_prompt_debug: "false"
};

window.ensureDefaultSettings = function ensureDefaultSettings() {
  Object.entries(window.DefaultSettings).forEach(([key, value]) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, value);
  });
};
