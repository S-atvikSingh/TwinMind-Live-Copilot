window.getNumericSetting = function getNumericSetting(key, fallback) {
  const raw = parseInt(localStorage.getItem(key) || "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};

window.buildOlderTranscriptSummary = function buildOlderTranscriptSummary(text) {
  const chunks = text
    .split(/[.!?]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (chunks.length === 0) return "";
  const picks = [];
  const step = Math.max(1, Math.floor(chunks.length / 3));
  for (let i = 0; i < chunks.length && picks.length < 3; i += step) {
    picks.push(chunks[i].slice(0, 120));
  }
  return picks.map((s, idx) => `${idx + 1}. ${s}`).join("\n");
};

window.buildTranscriptWindow = function buildTranscriptWindow(kind) {
  const settingKey = kind === "suggestions" ? "tm_sugg_last_n_chars" : "tm_chat_last_n_chars";
  const lastN = window.getNumericSetting(settingKey, kind === "suggestions" ? 4000 : 7000);
  const trigger = window.getNumericSetting("tm_context_summary_trigger_chars", 1500);
  const recencyBoostChars = window.getNumericSetting("tm_recency_boost_chars", 1200);
  const transcript = window.AppState.fullTranscript.trim();
  const recent = transcript.slice(-lastN);
  const older = transcript.slice(0, Math.max(0, transcript.length - lastN));
  const olderSummary = older.length > trigger ? window.buildOlderTranscriptSummary(older) : "";
  const recencyBoost = recent.slice(-Math.min(recencyBoostChars, recent.length));
  return { recent, olderSummary, lastN, recencyBoost, summarizedOlderContext: older.length > trigger };
};

window.getRecentSuggestionHistory = function getRecentSuggestionHistory(limit = 2) {
  return window.AppState.sessionSuggestionBatches.slice(-limit).map((batch) => ({
    batchNumber: batch.batchNumber,
    suggestions: batch.suggestions.map((s) => ({ type: s.type, title: s.title, preview: s.preview }))
  }));
};

window.normalizeSuggestions = function normalizeSuggestions(items) {
  const seen = new Set();
  const normalized = [];
  for (const item of items || []) {
    const title = (item.title || "").trim();
    const preview = (item.preview || "").trim();
    if (!title || !preview) continue;
    const dedupeKey = `${title.toLowerCase()}::${preview.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    normalized.push({
      type: (item.type || "talking_point").toString().slice(0, 40),
      title: title.slice(0, 140),
      preview: preview.slice(0, 400),
      reason: (item.reason || "").toString().slice(0, 240)
    });
  }
  return normalized.slice(0, 3);
};

window.isGenericSuggestion = function isGenericSuggestion(item) {
  const text = `${item.title} ${item.preview}`.toLowerCase();
  const genericPhrases = [
    "ask for clarification",
    "summarize the discussion",
    "good point",
    "consider discussing",
    "you may want to",
    "it depends"
  ];
  return genericPhrases.some((p) => text.includes(p));
};

window.passesSuggestionQuality = function passesSuggestionQuality(batch) {
  if (!Array.isArray(batch) || batch.length !== 3) return false;
  const typeSet = new Set(batch.map((s) => (s.type || "").toLowerCase()));
  if (typeSet.size < 2) return false;
  if (batch.some((s) => window.isGenericSuggestion(s))) return false;
  const uniqueTitles = new Set(batch.map((s) => s.title.toLowerCase()));
  return uniqueTitles.size === 3;
};
