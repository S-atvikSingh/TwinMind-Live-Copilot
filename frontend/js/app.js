window.ensureDefaultSettings();
window.updateMetricsBar();

function requireApiKey() {
  const key = localStorage.getItem("tm_key");
  if (!key) {
    window.updateSystemStatus("Missing API key. Open settings.", "error");
    window.setErrorForAllColumns("Missing Groq API key. Add it in Settings.");
    return null;
  }
  return key;
}

function scheduleNextRecordingCycle() {
  const state = window.AppState;
  if (!state.isRecording) return;
  clearTimeout(state.recordingTimeout);
  const delayMs = state.isFirstRecordingCycle ? state.FIRST_AUDIO_FLUSH_MS : state.REFRESH_INTERVAL * 1000;
  state.recordingTimeout = setTimeout(processCycle, delayMs);
}

async function sendToTranscription(blob, timestamp) {
  const key = requireApiKey();
  if (!key) return false;
  const formData = new FormData();
  formData.append("audio", blob);
  formData.append("key", key);

  const t0 = performance.now();
  try {
    const payload = await window.apiPostForm(
      "http://localhost:8000/transcribe",
      formData,
      "Transcription failed",
      "transcript"
    );
    const transcribeMs = Math.round(performance.now() - t0);
    if (!payload) {
      window.appendPromptDebug({
        endpoint: "transcribe",
        ok: false,
        durationMs: transcribeMs,
        error: "no payload / HTTP error"
      });
      return false;
    }
    const text = payload?.data?.text || "";
    if (payload.ok && text.trim().length > 0) {
      window.AppState.sessionTranscript.push({ timestamp, text });
      window.AppState.fullTranscript += ` ${text}`;
      window.renderTranscriptEntry(text, timestamp);
      window.recordLatency("transcribe", transcribeMs);
      window.appendPromptDebug({
        endpoint: "transcribe",
        ok: true,
        durationMs: transcribeMs,
        textLength: text.length
      });
      window.afterTranscriptPaint(900, transcribeMs);
      return true;
    }
    window.appendPromptDebug({
      endpoint: "transcribe",
      ok: false,
      durationMs: transcribeMs,
      error: "empty transcript text"
    });
    return false;
  } catch (_err) {
    window.setColumnState("transcript", "error", "Backend unavailable. Is FastAPI running on localhost:8000?");
    window.appendPromptDebug({
      endpoint: "transcribe",
      ok: false,
      error: String(_err)
    });
    return false;
  }
}

async function fetchSuggestionsAttempt(extraGuidance = "", attemptLabel = "") {
  const key = requireApiKey();
  if (!key) return null;

  const transcriptWindow = window.buildTranscriptWindow("suggestions");
  const recentHistory = window.getRecentSuggestionHistory(2);
  const enrichedContext = [
    localStorage.getItem("tm_sugg_context") || "",
    `Use only recent transcript window (last ${transcriptWindow.lastN} chars) for timing-sensitive suggestions.`,
    `Recency boost segment (highest priority, latest ${transcriptWindow.recencyBoost.length} chars): ${transcriptWindow.recencyBoost}`,
    transcriptWindow.olderSummary ? `Older context summary:\n${transcriptWindow.olderSummary}` : "",
    recentHistory.length ? `Recent suggestion batches (avoid repeating these): ${JSON.stringify(recentHistory)}` : "",
    "Return exactly 3 suggestions with at least 2 different types.",
    extraGuidance,
    attemptLabel
  ]
    .filter(Boolean)
    .join("\n\n");

  const payloadPreview = {
    prompt: (localStorage.getItem("tm_sugg_prompt") || "").slice(0, 200),
    transcriptChars: transcriptWindow.recent.length,
    summarizedOlderContext: transcriptWindow.summarizedOlderContext,
    recencyBoostChars: transcriptWindow.recencyBoost.length,
    sugg_context: enrichedContext.slice(0, 4000)
  };

  const formData = new FormData();
  formData.append("transcript", transcriptWindow.recent);
  formData.append("prompt", localStorage.getItem("tm_sugg_prompt") || "");
  formData.append("sugg_context", enrichedContext);
  formData.append("key", key);

  const t0 = performance.now();
  const first = await window.apiPostForm(
    "http://localhost:8000/suggest",
    formData,
    "Suggestion request failed",
    "suggestions"
  );
  const durationMs = Math.round(performance.now() - t0);

  if (!first) {
    window.appendPromptDebug({
      endpoint: "suggest",
      ok: false,
      durationMs,
      attemptLabel,
      request: payloadPreview,
      error: "HTTP or network failure"
    });
    return null;
  }

  window.appendPromptDebug({
    endpoint: "suggest",
    ok: true,
    durationMs,
    attemptLabel,
    request: payloadPreview,
    responsePreview: JSON.stringify(first?.data?.suggestions || []).slice(0, 800)
  });

  return first;
}

async function getSuggestions() {
  const startedAt = performance.now();
  window.setButtonLoading(window.UI.refreshBtn, "Refreshing...", true);
  window.setColumnState("suggestions", "loading", "Generating 3 fresh suggestions...");
  const MAX_ATTEMPTS = 5;
  let lastBatch = [];

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const extra =
        attempt === 1
          ? ""
          : `Attempt ${attempt}/${MAX_ATTEMPTS}: previous output failed quality checks. Produce 3 highly specific, non-generic cards grounded in the transcript. Vary types.`;
      const first = await fetchSuggestionsAttempt(extra, `attempt-${attempt}`);
      let batch = window.normalizeSuggestions(first?.data?.suggestions || []);
      lastBatch = batch;
      if (window.passesSuggestionQuality(batch)) {
        window.renderSuggestionBatch(batch);
        const elapsed = Math.round(performance.now() - startedAt);
        window.recordLatency("suggest", elapsed);
        window.setColumnState("suggestions", "success", `Suggestions updated in ${elapsed} ms. 3 cards ready.`);
        window.updateLastRefreshInfo(elapsed);
        setTimeout(() => window.clearColumnState("suggestions"), 1500);
        return;
      }
      window.setColumnState("suggestions", "loading", `Retrying suggestions (${attempt}/${MAX_ATTEMPTS})…`);
      await new Promise((r) => setTimeout(r, 350));
    }

    if (lastBatch.length === 3) {
      window.renderSuggestionBatch(lastBatch);
      const elapsed = Math.round(performance.now() - startedAt);
      window.recordLatency("suggest", elapsed);
      window.setColumnState(
        "suggestions",
        "success",
        `Showing best-effort suggestions in ${elapsed} ms (quality checks relaxed).`
      );
      window.updateLastRefreshInfo(elapsed);
      setTimeout(() => window.clearColumnState("suggestions"), 2200);
      return;
    }

    window.setColumnState("suggestions", "error", "Could not load suggestions after multiple retries.");
  } catch (_err) {
    window.setColumnState("suggestions", "error", "Suggestions failed. Check backend and API key.");
  } finally {
    window.setButtonLoading(window.UI.refreshBtn, "Refreshing...", false);
  }
}

async function processChatRequest(queryText, displayTitle = null, sourceSuggestion = null) {
  const key = requireApiKey();
  if (!key) return;

  const startedAt = performance.now();
  window.setButtonLoading(window.UI.sendBtn, "Sending...", true);
  window.setColumnState("chat", "loading", "Generating detailed answer...");
  const transcriptWindow = window.buildTranscriptWindow("chat");
  const suggestionMeta = sourceSuggestion
    ? `Clicked suggestion metadata:\nType: ${sourceSuggestion.type}\nTitle: ${sourceSuggestion.title}\nPreview: ${sourceSuggestion.preview}\nReason: ${sourceSuggestion.reason || ""}`
    : "";
  const chatContext = [
    localStorage.getItem("tm_chat_context") || "",
    `Use recent transcript window (last ${transcriptWindow.lastN} chars) as primary evidence.`,
    `Recency boost segment (highest priority, latest ${transcriptWindow.recencyBoost.length} chars): ${transcriptWindow.recencyBoost}`,
    transcriptWindow.olderSummary ? `Older context summary:\n${transcriptWindow.olderSummary}` : "",
    suggestionMeta
  ]
    .filter(Boolean)
    .join("\n\n");

  const formData = new FormData();
  formData.append("question", queryText);
  formData.append("transcript", transcriptWindow.recent);
  formData.append("chat_context", chatContext);
  formData.append("prompt", localStorage.getItem("tm_chat_prompt") || "");
  formData.append("key", key);

  const reqPreview = {
    question: queryText.slice(0, 500),
    transcriptChars: transcriptWindow.recent.length,
    chat_context: chatContext.slice(0, 4000)
  };

  try {
    const t0 = performance.now();
    const payload = await window.apiPostForm(
      "http://localhost:8000/chat",
      formData,
      "Chat request failed",
      "chat"
    );
    const chatMs = Math.round(performance.now() - t0);
    if (!payload) {
      window.appendPromptDebug({
        endpoint: "chat",
        ok: false,
        durationMs: chatMs,
        request: reqPreview,
        error: "no payload / HTTP error"
      });
      window.clearColumnState("chat");
      return;
    }
    const answer = payload?.data?.answer || "";
    window.appendPromptDebug({
      endpoint: "chat",
      ok: true,
      durationMs: chatMs,
      request: reqPreview,
      responsePreview: (answer || "").slice(0, 1200)
    });
    window.recordLatency("chat", chatMs);
    window.renderChatTurn(queryText, displayTitle, answer);
    window.AppState.sessionChat.push({
      timestamp: new Date().toISOString(),
      user: queryText,
      displayTitle: displayTitle || null,
      assistant: answer,
      clickedSuggestion: sourceSuggestion || null
    });
    const elapsed = Math.round(performance.now() - startedAt);
    window.setColumnState(
      "chat",
      "success",
      `Answer ready in ${elapsed} ms. Context ${transcriptWindow.recent.length} chars, summary ${
        transcriptWindow.summarizedOlderContext ? "yes" : "no"
      }.`
    );
    setTimeout(() => window.clearColumnState("chat"), 1500);
  } catch (_err) {
    window.setColumnState("chat", "error", "Chat failed. Check backend and API key.");
    window.appendPromptDebug({
      endpoint: "chat",
      ok: false,
      error: String(_err),
      request: reqPreview
    });
    window.clearColumnState("chat");
  } finally {
    window.setButtonLoading(window.UI.sendBtn, "Sending...", false);
  }
}

window.expandToChat = function expandToChat(suggestion) {
  const detailedQuery = `Explain: ${suggestion.title}. Context: ${suggestion.preview}`;
  processChatRequest(detailedQuery, suggestion.title, suggestion);
};

function startNewRecorder() {
  if (!window.AppState.activeStream) return;
  window.AppState.mediaRecorder = new MediaRecorder(window.AppState.activeStream, { mimeType: "audio/webm" });
  window.AppState.mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) window.AppState.chunks.push(e.data);
  };
  window.AppState.mediaRecorder.start();
}

async function processCycle() {
  const state = window.AppState;
  if (!state.isRecording) return;
  window.updateSystemStatus("Processing audio...", "info");

  const currentChunks = [...state.chunks];
  state.chunks = [];
  if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") state.mediaRecorder.stop();
  startNewRecorder();

  if (currentChunks.length > 0) {
    window.setColumnState("transcript", "loading", "Transcribing…");
    const blob = new Blob(currentChunks, { type: "audio/webm" });
    const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const transcribed = await sendToTranscription(blob, timestamp);
    if (transcribed) await getSuggestions();
    state.isFirstRecordingCycle = false;
    state.warmupAttempts = 0;
  } else {
    window.setColumnState("transcript", "loading", "Waiting for audio…");
    setTimeout(() => {
      if (window.AppState.isRecording) window.clearColumnState("transcript");
    }, 700);
    if (state.isFirstRecordingCycle) {
      state.warmupAttempts += 1;
      if (state.warmupAttempts <= 4) {
        window.updateSystemStatus("Recording", "info");
        clearTimeout(state.recordingTimeout);
        state.recordingTimeout = setTimeout(processCycle, 1600);
        return;
      }
    }
    state.isFirstRecordingCycle = false;
    state.warmupAttempts = 0;
  }

  window.updateSystemStatus("Recording", "info");
  scheduleNextRecordingCycle();
}

function startRecordingLoop() {
  window.AppState.isFirstRecordingCycle = true;
  startNewRecorder();
  scheduleNextRecordingCycle();
}

function startCountdownUI() {
  const counterLabel = document.getElementById("refreshTimer");
  if (!counterLabel) return;
  const state = window.AppState;
  state.countdownSeconds = state.REFRESH_INTERVAL;
  counterLabel.textContent = `auto-refresh in ${state.countdownSeconds}s`;
  if (state.countdownInterval) clearInterval(state.countdownInterval);

  state.countdownInterval = setInterval(() => {
    if (!state.isRecording) {
      clearInterval(state.countdownInterval);
      return;
    }
    state.countdownSeconds -= 1;
    if (state.countdownSeconds < 0) state.countdownSeconds = state.REFRESH_INTERVAL;
    counterLabel.textContent = `auto-refresh in ${state.countdownSeconds}s`;
  }, 1000);
}

function stopRecording() {
  const state = window.AppState;
  state.isRecording = false;
  if (state.mediaRecorder) state.mediaRecorder.stop();
  clearTimeout(state.recordingTimeout);
  window.UI.micStatus.textContent = "Idle";
  window.UI.micActionText.textContent = "Click mic to start.";
  window.UI.micBtn.classList.replace("bg-red-600", "bg-blue-600");
  if (state.activeStream) state.activeStream.getTracks().forEach((track) => track.stop());
}

window.UI.micBtn.onclick = async () => {
  const state = window.AppState;
  if (!state.isRecording) {
    try {
      state.activeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.isRecording = true;
      state.isFirstRecordingCycle = true;
      state.warmupAttempts = 0;
      window.UI.micStatus.textContent = "Recording";
      window.UI.micActionText.textContent = "Stop recording";
      window.UI.micBtn.classList.replace("bg-blue-600", "bg-red-600");
      startCountdownUI();
      if (window.UI.transcriptArea.querySelector("p.italic")) window.UI.transcriptArea.innerHTML = "";
      startRecordingLoop();
    } catch (_err) {
      alert("Mic access denied.");
    }
  } else {
    stopRecording();
  }
};

window.UI.refreshBtn.onclick = async () => {
  const state = window.AppState;
  if (!state.isRecording) return;
  state.countdownSeconds = state.REFRESH_INTERVAL;
  document.getElementById("refreshTimer").textContent = `auto-refresh in ${state.REFRESH_INTERVAL}s`;
  clearTimeout(state.recordingTimeout);
  await processCycle();
};

window.UI.sendBtn.onclick = () => {
  const text = window.UI.chatInput.value.trim();
  if (!text) return;
  processChatRequest(text);
  window.UI.chatInput.value = "";
};

window.UI.chatInput.onkeydown = (e) => {
  if (e.key === "Enter") window.UI.sendBtn.click();
};

document.getElementById("exportBtn").onclick = () => {
  const state = window.AppState;
  const sessionData = {
    transcriptText: state.fullTranscript.trim(),
    transcriptChunks: state.sessionTranscript,
    suggestionBatches: state.sessionSuggestionBatches,
    chatHistory: state.sessionChat,
    promptDebugLog: state.promptDebugLog,
    latencySamples: state.latencySamples,
    exportedAt: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(sessionData, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `twinmind-session-${Date.now()}.json`;
  a.click();
};

document.getElementById("exportPromptLogBtn").onclick = () => {
  const state = window.AppState;
  const blob = new Blob([JSON.stringify(state.promptDebugLog, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `twinmind-prompt-log-${Date.now()}.json`;
  a.click();
};

document.getElementById("settingsBtn").onclick = () => {
  document.getElementById("apiKey").value = localStorage.getItem("tm_key") || "";
  document.getElementById("suggPrompt").value = localStorage.getItem("tm_sugg_prompt") || "";
  document.getElementById("chatPrompt").value = localStorage.getItem("tm_chat_prompt") || "";
  document.getElementById("suggPromptContext").value = localStorage.getItem("tm_sugg_context") || "";
  document.getElementById("chatPromptContext").value = localStorage.getItem("tm_chat_context") || "";
  document.getElementById("suggLastNChars").value = localStorage.getItem("tm_sugg_last_n_chars") || "4000";
  document.getElementById("chatLastNChars").value = localStorage.getItem("tm_chat_last_n_chars") || "7000";
  document.getElementById("showPromptDebug").checked = localStorage.getItem("tm_show_prompt_debug") === "true";
  window.refreshPromptDebugPanel();
  if (localStorage.getItem("tm_show_prompt_debug") === "true") {
    window.UI.promptDebugPanel.classList.remove("hidden");
  } else {
    window.UI.promptDebugPanel.classList.add("hidden");
  }
  window.UI.sModal.classList.remove("hidden");
};

document.getElementById("saveSettings").onclick = () => {
  localStorage.setItem("tm_key", document.getElementById("apiKey").value.trim());
  localStorage.setItem("tm_sugg_prompt", document.getElementById("suggPrompt").value);
  localStorage.setItem("tm_chat_prompt", document.getElementById("chatPrompt").value);
  localStorage.setItem("tm_sugg_context", document.getElementById("suggPromptContext").value);
  localStorage.setItem("tm_chat_context", document.getElementById("chatPromptContext").value);
  localStorage.setItem("tm_sugg_last_n_chars", document.getElementById("suggLastNChars").value || "4000");
  localStorage.setItem("tm_chat_last_n_chars", document.getElementById("chatLastNChars").value || "7000");
  localStorage.setItem("tm_show_prompt_debug", document.getElementById("showPromptDebug").checked ? "true" : "false");
  window.refreshPromptDebugPanel();
  window.UI.sModal.classList.add("hidden");
};

document.getElementById("closeSettings").onclick = () => window.UI.sModal.classList.add("hidden");

document.getElementById("showPromptDebug").onchange = (e) => {
  localStorage.setItem("tm_show_prompt_debug", e.target.checked ? "true" : "false");
  window.refreshPromptDebugPanel();
};
