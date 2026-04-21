window.UI = {
  micBtn: document.getElementById("micBtn"),
  micStatus: document.getElementById("micStatus"),
  micActionText: document.getElementById("micActionText"),
  transcriptArea: document.getElementById("transcriptArea"),
  suggestionsArea: document.getElementById("suggestionsArea"),
  chatArea: document.getElementById("chatArea"),
  chatInput: document.getElementById("chatInput"),
  sendBtn: document.getElementById("sendBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  transcriptBanner: document.getElementById("transcriptBanner"),
  suggestionsBanner: document.getElementById("suggestionsBanner"),
  chatBanner: document.getElementById("chatBanner"),
  sModal: document.getElementById("settingsModal"),
  lastRefreshInfo: document.getElementById("lastRefreshInfo"),
  promptDebugPanel: document.getElementById("promptDebugPanel"),
  promptDebugText: document.getElementById("promptDebugText"),
  metricsBar: document.getElementById("metricsBar")
};

window.setColumnState = function setColumnState(column, type, message) {
  const { transcriptBanner, suggestionsBanner, chatBanner } = window.UI;
  const banner = column === "transcript" ? transcriptBanner : column === "suggestions" ? suggestionsBanner : chatBanner;
  if (!banner) return;
  const styles = {
    loading: "border-blue-700 bg-blue-950/40 text-blue-300",
    error: "border-red-700 bg-red-950/40 text-red-300",
    success: "border-emerald-700 bg-emerald-950/40 text-emerald-300"
  };
  banner.className = `mb-3 text-[11px] rounded-lg border px-3 py-2 ${styles[type] || styles.loading}`;
  banner.textContent = message;
};

window.clearColumnState = function clearColumnState(column) {
  const { transcriptBanner, suggestionsBanner, chatBanner } = window.UI;
  const banner = column === "transcript" ? transcriptBanner : column === "suggestions" ? suggestionsBanner : chatBanner;
  if (!banner) return;
  banner.className = "hidden mb-3 text-[11px] rounded-lg border px-3 py-2";
  banner.textContent = "";
};

window.setErrorForAllColumns = function setErrorForAllColumns(message) {
  window.setColumnState("transcript", "error", message);
  window.setColumnState("suggestions", "error", message);
  window.setColumnState("chat", "error", message);
};

window.updateSystemStatus = function updateSystemStatus(msg, type = "info") {
  const state = window.AppState;
  if (state.errorMessageActive && type === "info") return;

  const colors = {
    info: "text-slate-400",
    error: "text-red-500 font-bold animate-pulse",
    success: "text-green-500"
  };

  window.UI.micStatus.textContent = msg;
  window.UI.micStatus.className = colors[type];
  if (type === "error") state.errorMessageActive = true;
  if (type === "success") state.errorMessageActive = false;
};

window.renderTranscriptEntry = function renderTranscriptEntry(text, timestamp) {
  const entry = document.createElement("div");
  entry.className = "flex gap-3 mb-4 animate-in fade-in slide-in-from-left-2 duration-500";
  entry.innerHTML = `
      <span class="text-[10px] font-mono text-slate-600 mt-1 min-w-[60px]">${timestamp}</span>
      <p class="text-sm leading-relaxed text-slate-300">${text}</p>
  `;
  window.UI.transcriptArea.appendChild(entry);
  window.UI.transcriptArea.scrollTo({ top: window.UI.transcriptArea.scrollHeight, behavior: "smooth" });
};

window.renderSuggestionBatch = function renderSuggestionBatch(batch) {
  const state = window.AppState;
  state.currentBatchCount += 1;
  state.sessionSuggestionBatches.push({
    batchNumber: state.currentBatchCount,
    timestamp: new Date().toISOString(),
    suggestions: batch
  });

  const container = document.createElement("div");
  container.className = "mb-8 animate-in fade-in slide-in-from-top-4 duration-700";
  container.innerHTML = `
      <div class="batch-separator">
          <span class="batch-label uppercase">Batch ${state.currentBatchCount} • ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
  `;

  batch.forEach((s) => {
    const card = document.createElement("div");
    card.className = "bg-slate-800/50 border border-slate-700 p-4 rounded-xl cursor-pointer hover:border-blue-500 hover:bg-slate-800 transition mb-3 group";
    card.innerHTML = `
        <div class="flex justify-between items-start mb-2">
            <span class="text-[9px] font-bold px-2 py-0.5 rounded bg-slate-700 text-blue-400 uppercase tracking-wider">${s.type}</span>
        </div>
        <div class="text-sm font-bold text-white mb-1 group-hover:text-blue-400 transition">${s.title}</div>
        <div class="text-xs text-slate-400 leading-relaxed">${s.preview}</div>
    `;
    card.onclick = () => window.expandToChat(s);
    container.appendChild(card);
  });

  window.UI.suggestionsArea.prepend(container);
};

window.renderChatTurn = function renderChatTurn(queryText, displayTitle, answer) {
  const userMsg = document.createElement("div");
  userMsg.className = "bg-blue-900/20 p-3 rounded-xl border border-blue-800/50 text-xs self-end ml-8 mb-4";
  userMsg.innerHTML = `<span class="text-blue-400 font-bold block mb-1 uppercase">YOU</span>${displayTitle || queryText}`;
  window.UI.chatArea.appendChild(userMsg);

  const botMsg = document.createElement("div");
  botMsg.className = "bg-slate-800/80 p-4 rounded-xl text-xs leading-relaxed border border-slate-700 mr-8 mb-4";
  botMsg.innerHTML = `<span class="text-indigo-400 font-bold uppercase block mb-1">TwinMind Assistant</span>${answer
    .replace(/\*\*(.*?)\*\*/g, '<strong class="text-white">$1</strong>')
    .replace(/\n/g, "<br>")}`;
  window.UI.chatArea.appendChild(botMsg);
  window.UI.chatArea.scrollTo({ top: window.UI.chatArea.scrollHeight, behavior: "smooth" });
};

window.setButtonLoading = function setButtonLoading(button, loadingText, isLoading) {
  if (!button) return;
  if (isLoading) {
    if (!button.dataset.defaultText) button.dataset.defaultText = button.textContent;
    button.textContent = loadingText;
    button.disabled = true;
    button.classList.add("opacity-60", "cursor-not-allowed");
  } else {
    button.textContent = button.dataset.defaultText || button.textContent;
    button.disabled = false;
    button.classList.remove("opacity-60", "cursor-not-allowed");
  }
};

window.updateLastRefreshInfo = function updateLastRefreshInfo(ms) {
  if (!window.UI.lastRefreshInfo) return;
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  window.UI.lastRefreshInfo.textContent = `last refresh: ${time} • ${ms} ms`;
};

function medianOf(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

window.recordLatency = function recordLatency(kind, ms) {
  const state = window.AppState;
  if (!state.latencySamples[kind]) state.latencySamples[kind] = [];
  state.latencySamples[kind].push(ms);
  if (state.latencySamples[kind].length > 10) state.latencySamples[kind].shift();
  window.updateMetricsBar();
};

window.updateMetricsBar = function updateMetricsBar() {
  const el = window.UI.metricsBar;
  if (!el) return;
  const { transcribe, suggest, chat } = window.AppState.latencySamples;
  const parts = [];
  const t = medianOf(transcribe || []);
  const s = medianOf(suggest || []);
  const c = medianOf(chat || []);
  if (t != null) parts.push(`transcribe ~${t}ms`);
  if (s != null) parts.push(`suggest ~${s}ms`);
  if (c != null) parts.push(`chat ~${c}ms`);
  el.textContent = parts.length ? parts.join(" · ") : "latency: —";
};

/** After transcript DOM update, show success then hide banner */
window.afterTranscriptPaint = function afterTranscriptPaint(successMs, transcribeMs) {
  const show = () => {
    window.updateSystemStatus("Displaying transcription", "success");
    window.setColumnState("transcript", "success", `Transcript ready in ${transcribeMs} ms`);
    setTimeout(() => window.clearColumnState("transcript"), Math.max(700, successMs));
  };
  requestAnimationFrame(() => requestAnimationFrame(show));
};

window.appendPromptDebug = function appendPromptDebug(entry) {
  const state = window.AppState;
  state.promptDebugLog.push({
    time: new Date().toISOString(),
    ...entry
  });
  while (state.promptDebugLog.length > state.PROMPT_DEBUG_LOG_MAX) {
    state.promptDebugLog.shift();
  }
  window.refreshPromptDebugPanel();
};

window.refreshPromptDebugPanel = function refreshPromptDebugPanel() {
  const enabled = localStorage.getItem("tm_show_prompt_debug") === "true";
  if (!window.UI.promptDebugPanel || !window.UI.promptDebugText) return;
  if (!enabled) {
    window.UI.promptDebugPanel.classList.add("hidden");
    return;
  }
  window.UI.promptDebugPanel.classList.remove("hidden");
  const lines = window.AppState.promptDebugLog
    .slice()
    .reverse()
    .map((e) => JSON.stringify(e, null, 0));
  window.UI.promptDebugText.value = lines.join("\n\n---\n\n");
};

/** @deprecated use appendPromptDebug + refreshPromptDebugPanel */
window.renderPromptDebug = function renderPromptDebug(title, payloadObject) {
  window.appendPromptDebug({
    kind: "inline",
    title,
    payload: payloadObject
  });
};
