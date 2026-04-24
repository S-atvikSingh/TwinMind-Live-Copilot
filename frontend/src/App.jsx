import { useEffect, useMemo, useRef, useState } from "react";
import FixedStatus from "./components/FixedStatus";
import { formatHttpDetail, mean, median, nowTime } from "./utils/appUtils";

// Keep API host configurable so local/dev/prod use the same build.
// In hosted environments (Vercel), set VITE_API_BASE at build time.
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";
const CHUNK_MS = 30000;
const VAD_RMS_THRESHOLD = 0.012;
const VAD_VOICED_FRAME_RATIO = 0.06;

const DEFAULT_SETTINGS = {
  tm_sugg_prompt:
    `Role: You are a Real-Time conversation assistant. You excel at listening to a conversation and providing suggestion which help me with the conversation. You do this in several ways like by answering questions, raising clarifying points I could ask, asking questions about the topic being discussed, giving me talking points, helping me fact check the conversation etc. You are being provided a transcript of a live conversation, analyze the provided transcript to generate exactly 3 actionable suggestions in JSON format.

    Task: Analyze the provided transcript and generate EXACTLY 3 diverse, actionable suggestions in the specified JSON format.

    1. Context Architecture:
    [MOST RECENT TRANSCRIPT]: Your primary operational area. Identify the current speaker's hurdle, question, or claim.
    [OLDER CONTEXT]: Use for continuity. If a topic was already resolved here, do not suggest it again.
    [RECENT SUGGESTIONS]: Do not repeat these themes. Provide a fresh perspective.

    2. The "Standalone Value" Mandate:
    Every preview must contain the actual insight, not a promise of one.
    Weak: "I can find the revenue growth for Q2."
    Strong (High Value): "Q2 revenue grew by 14% ($2.1M). Use this to support the argument for increasing the marketing budget."

    Preview should provide direct insight
    Weak: "Suggest asking about the deadline"
    Strong (Direct): "What is the deadline for this project"

    Preview Must provide standalone value 
    Weak: "You can confirm the pattern as being 1, 2, 4, 8"
    Strong (standalone value): "The pattern is 1, 2 ,4, 8 i.e. a geometric sequence of powers of 2"

    3. Technical Specifications:
    Types: Mix at least 2 types: fact_check, talking_point, clarify, ask_question, answer.
    Title: High impact, assertive, < 12 words.
    Preview: The core value/data/question. No conversational filler like "Maybe you could...". < 40 words.
    Reason: Internal logic. State the specific phrase from [MOST RECENT TRANSCRIPT] that triggered this.

    4. Strict Constraints:
    Output ONLY raw JSON. No markdown backticks, no preamble, no "Here is your JSON." The output must be a single-line or pretty-printed JSON object starting with { and ending with }. Do not include any text before or after this object.
    Grounding: Do not hallucinate statements the speakers did not make. Use your internal knowledge to provide accuracy for fact_check and answer types, but ensure they are relevant to the transcript.
    Timing: Suggestions must be relevant for the next 60 seconds of the conversation.
    JSON Schema:
    {"suggestions": [{"type": "", "title": "", "preview": "", "reason": ""}]}

    Examples:

    Example 1:
    Transcript: "Hello, can you guess the next five elements in this pattern 1 potato 2 potato 3 potato 4 potato 5 potato"
    [MOST RECENT TRANSCRIPT]:"can you guess the next five elements in this pattern 1 potato 2 potato 3 potato 4 potato 5 potato"
    [OLDER CONTEXT]: "Hello, can you guess the next five elements in this pattern 1 potato 2 potato 3 potato 4 potato 5 potato"
    [RECENT SUGGESTIONS]:""
    Example of good solution:
    {"suggestions": [{"type": "clarify", "title": "Clarify the question", "preview": "are the elements 1 and potato same element or two different elements ie. "1 potato" or "1", "potato", "reason": "The transcript mentions 1 potato 2 potato etc and requires next five elements, so the size of element will determine the next five elements"},{"type": "talking_point", "title":"Similar patterns" , "preview": "Similar patterns are often used as choosing rhyme for example the famous Eenie, meenie, miney, moe ", "reason": "The pattern is talked about in the recent conversation"},{"type": "answer", "title": "The next 5 elements", "preview": "The next 5 elements are 6 potato 7 potato 8 potato 9 potato 10 potato", "reason": "We were asked the question to determine the next part of the pattern"}]}

    -The above is a good solution is because it is diverse, Useful, well-timed, varied by context. The titles are diverse and high impact, the previews are direct, useful and provide standalone value and the reasons are relevant. the complete suggestions are also useful and diverse making this an excellent result. The result also follows all the constraints, is in correct format and is grounded in the transcripts.

    Example of Bad solution:
    { JSON preview:"suggestions": [{"type": "clarify", "title": "Meeting time", "preview": "When is the deadline for this task?", "reason": ""},{"type": "clarify", "title": "Meeting deadline", "preview": "Why havn't we set the task deadline?", "reason": ""}]}

    -This is a bad solution since it doesn't follow the correct format, the suggestions are not grounded in the transcript and not useful, the reasons are missing, there aren't exactly 3 solutions and the types are same across the board.

    Example 2:
    Transcript: "We should use a BFS to find the shortest path in this weighted graph."
    [MOST RECENT TRANSCRIPT]:"We should use a BFS to find the shortest path in this weighted graph."
    [OLDER CONTEXT]: "Hello, you are given a graph and you need to strategize to find the shortest path in it. Is the graph weighted? Yes it is a weighted graph. you need to strategize to find the shortest path in it. how will you do that? We should use a BFS to find the shortest path in this weighted graph."
    Example of good solution:
    {"suggestions": [{"type": "fact_check", "title": "Dijkstra vs BFS", "preview": "BFS only finds the shortest path in unweighted graphs. For weighted graphs, Dijkstra's algorithm is required to ensure accuracy.", "reason": "The speaker mentioned using BFS for a weighted graph, which is a technical inaccuracy."},{"type": "clarify", "title": "Undirected or Directed" , "preview": "It the weighted graph an undirected graph or directed graph", "reason": "undirected and directed graphs have different algorithms to find the shortest path"},{"type": "answer", "title": "Prims", "preview": "We can also use prims algorithm to find the shortest path if the graph is undirected.", "reason": "The speaker mentioned finding shortest path in a weighted graph which can be done with Prim's algorithm"}]}

    - this is a good solution since the suggestions are diverse and useful while maintaining the constraints. 
    The titles are diverse and high impact, the previews are direct, useful and provide standalone value and the reasons are relevant. 
    the complete suggestions are also useful and diverse making this an excellent result. 
    The result also follows all the constraints, is in correct format and is grounded in the transcripts.`,
  tm_chat_prompt:
    `Role: You are a Senior Meeting Historian and Executive Assistant. Your goal is to provide exhaustive, evidence-based answers derived from the meeting transcript and chat context for the given question which might be a suggestion the user selected or a question based on previous history.

    Task: Provide a detailed response to the user's inquiry or the selected suggestion. You must synthesize the full conversation history to provide a complete picture.

    1. Evidence-First Protocol:
    - Direct Quotes: When possible, paraphrase or attribute specific points to speakers (e.g., "The lead engineer mentioned..." or "Following the discussion on budget...").
    - Full Context: Do not just look at the last minute. If a question is asked about a topic discussed earlier, bridge that gap.

    2. Response Structure:
    - The Core Answer: Provide a direct, high-density response in the first paragraph.
    - Supporting Evidence: Use bullet points to list facts, figures, or arguments made during the session.
    - Practical Next Steps: Conclude with 2-3 "Action Items" based on the conversation's trajectory.

    3. Handling Uncertainty:
    - If the transcript does not contain the answer, explicitly state: "This was not explicitly covered in the meeting, but based on general best practices..." 
    - Identify "Information Gaps": Suggest what the user should ask the group next to get the missing info.

    4. Continuity & Formatting:
    - Maintain the thread of the previous chat turns. 
    - Use Markdown (bolding, lists) to make the long-form answer scannable in real-time.
    - Keep the tone professional, objective, and authoritative.

    Constraints:
    - Ground every claim in the provided [FULL TRANSCRIPT].
    - Avoid conversational filler ("I'd be happy to help"). Get straight to the data.`,
  tm_detail_prompt: `Role: You expand a single live suggestion the user tapped in the copilot.

    Task: Write a detailed, scannable answer they can use in the next minute of conversation. Lead with the core insight, then bullets tied to the transcript, then optional next steps.

    Constraints:
    - Ground claims in the transcript and the suggestion metadata in context. If the transcript is silent on a point, say so before adding general knowledge.
    - Use Markdown (bold, lists) for skimmability. Stay direct; no filler.`,
  tm_sugg_context:
    "Prioritize the last 2-4 minutes of discussion. Avoid repeating recent suggestions. Suggest what helps the user in the next 30-60 seconds.",
  tm_chat_context: "Use full session context, but prioritize recent transcript. Maintain continuity with previous chat turns.",
  tm_sugg_last_n_chars: "4000",
  tm_chat_last_n_chars: "7000",
  tm_context_summary_trigger_chars: "1500",
  tm_recency_boost_chars: "1200",
  tm_show_prompt_debug: "false"
};

const initialColumnStatus = {
  transcript: { type: "idle", message: "Waiting to start" },
  suggestions: { type: "idle", message: "Waiting for transcript" },
  chat: { type: "idle", message: "Ask anything or click a suggestion" }
};

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState({});
  const [isRecording, setIsRecording] = useState(false);
  const [transcriptChunks, setTranscriptChunks] = useState([]);
  const [fullTranscript, setFullTranscript] = useState("");
  const [suggestionBatches, setSuggestionBatches] = useState([]);
  const [chatHistory, setChatHistory] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [columnStatus, setColumnStatus] = useState(initialColumnStatus);
  const [recordingCycleProgress, setRecordingCycleProgress] = useState(0);
  const [transcribingProgress, setTranscribingProgress] = useState(0);
  const [lastRefreshInfo, setLastRefreshInfo] = useState("last refresh: not yet");
  const [promptDebugLog, setPromptDebugLog] = useState([]);
  const [metrics, setMetrics] = useState({ transcribe: [], suggest: [], chat: [] });
  const [loading, setLoading] = useState({ refresh: false, chat: false });

  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const isRecordingRef = useRef(false);
  const cycleTimeoutRef = useRef(null);
  const cycleStartedAtRef = useRef(0);
  const cycleTickerRef = useRef(null);
  const transcribeTickerRef = useRef(null);
  const transcriptAreaRef = useRef(null);
  const chatAreaRef = useRef(null);
  const fullTranscriptRef = useRef("");
  const audioContextRef = useRef(null);

  useEffect(() => {
    const loaded = {};
    Object.entries(DEFAULT_SETTINGS).forEach(([key, value]) => {
      const v = localStorage.getItem(key);
      loaded[key] = v ?? value;
      if (!v) localStorage.setItem(key, value);
    });
    const key = localStorage.getItem("tm_key");
    loaded.tm_key = key || "";
    setSettings(loaded);
  }, []);

  useEffect(() => {
    if (!transcriptAreaRef.current) return;
    transcriptAreaRef.current.scrollTop = transcriptAreaRef.current.scrollHeight;
  }, [transcriptChunks.length]);

  useEffect(() => {
    if (!chatAreaRef.current) return;
    // Auto-scroll only when user is already near the bottom.
    const el = chatAreaRef.current;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom <= 120) {
      el.scrollTop = el.scrollHeight;
    }
  }, [chatHistory]);

  useEffect(
    () => () => {
      stopRecordingInternal();
    },
    []
  );

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setSettingsOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settingsOpen]);

  useEffect(() => {
    const onBeforeUnload = (event) => {
      const hasSessionData =
        transcriptChunks.length > 0 || suggestionBatches.length > 0 || chatHistory.length > 0 || fullTranscript.trim().length > 0;
      if (!hasSessionData) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [transcriptChunks.length, suggestionBatches.length, chatHistory.length, fullTranscript]);

  function updateStatus(column, type, message) {
    setColumnStatus((s) => ({ ...s, [column]: { type, message } }));
  }

  function pushLatency(kind, ms) {
    setMetrics((m) => {
      const next = [...m[kind], ms].slice(-10);
      return { ...m, [kind]: next };
    });
  }

  function appendPromptLog(entry) {
    setPromptDebugLog((prev) => [...prev, { time: new Date().toISOString(), ...entry }].slice(-25));
  }

  function parseNum(key, fallback) {
    const v = parseInt(settings[key] || "", 10);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  }

  function buildOlderSummary(text) {
  // Heuristic compression keeps prompt size bounded in long meetings.
  // We sample a few sentences instead of sending full older transcript.
    const lines = text
      .split(/[.!?]\s+/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (!lines.length) return "";
    const step = Math.max(1, Math.floor(lines.length / 3));
    const picks = [];
    for (let i = 0; i < lines.length && picks.length < 3; i += step) {
      picks.push(lines[i].slice(0, 120));
    }
    return picks.map((s, i) => `${i + 1}. ${s}`).join("\n");
  }

  function buildTranscriptWindow(kind) {
  // Suggest and chat intentionally use different context sizes:
  // suggestions need speed; chat benefits from a wider historical window.
    const n = parseNum(kind === "suggestions" ? "tm_sugg_last_n_chars" : "tm_chat_last_n_chars", kind === "suggestions" ? 4000 : 7000);
    const trigger = parseNum("tm_context_summary_trigger_chars", 1500);
    const boost = parseNum("tm_recency_boost_chars", 1200);
    const full = fullTranscriptRef.current.trim();
    const recent = full.slice(-n);
    const older = full.slice(0, Math.max(0, full.length - n));
    const olderSummary = older.length > trigger ? buildOlderSummary(older) : "";
    return {
      recent,
      olderSummary,
      recencyBoost: recent.slice(-Math.min(recent.length, boost)),
      summarizedOlderContext: older.length > trigger,
      lastN: n
    };
  }

  function normalizeSuggestions(items) {
  // Defensive normalization: model output can contain duplicates/missing fields.
  // UI assumes cards are usable without extra null checks.
    const seen = new Set();
    const out = [];
    for (const item of items || []) {
      const title = (item.title || "").trim();
      const preview = (item.preview || "").trim();
      if (!title || !preview) continue;
      const sig = `${title.toLowerCase()}::${preview.toLowerCase()}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push({
        type: (item.type || "talking_point").toString(),
        title,
        preview,
        reason: (item.reason || "").toString()
      });
    }
    return out.slice(0, 3);
  }

  function suggestionsPassQuality(batch) {
  // Quality gate is intentionally strict so live cards feel diverse and useful.
    if (!Array.isArray(batch) || batch.length !== 3) return false;
    const types = new Set(batch.map((b) => b.type.toLowerCase()));
    const titles = new Set(batch.map((b) => b.title.toLowerCase()));
    return types.size >= 2 && titles.size === 3;
  }

  function setCycleTicker() {
  // Render smooth progress while MediaRecorder chunk timer is running.
    clearInterval(cycleTickerRef.current);
    cycleTickerRef.current = setInterval(() => {
      if (!isRecordingRef.current) {
        setRecordingCycleProgress(0);
        return;
      }
      const elapsed = Date.now() - cycleStartedAtRef.current;
      setRecordingCycleProgress(Math.min(100, (elapsed / CHUNK_MS) * 100));
    }, 250);
  }

  function setTranscribeTicker(startedMs = Date.now()) {
  // Fake-progress avoids a "frozen" UI while waiting for network/model latency.
    clearInterval(transcribeTickerRef.current);
    setTranscribingProgress(5);
    transcribeTickerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedMs;
      setTranscribingProgress(Math.min(95, 5 + (elapsed / 4000) * 90));
    }, 120);
  }

  function clearTimers() {
    clearTimeout(cycleTimeoutRef.current);
    clearInterval(cycleTickerRef.current);
    clearInterval(transcribeTickerRef.current);
  }

  async function isChunkLikelySilent(blob) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      if (!audioContextRef.current) audioContextRef.current = new Ctx();
      const ctx = audioContextRef.current;
      const arrBuf = await blob.arrayBuffer();
      const audioBuf = await ctx.decodeAudioData(arrBuf.slice(0));
      const data = audioBuf.getChannelData(0);
      const frameSize = 2048;
      let voicedFrames = 0;
      let totalFrames = 0;
      for (let i = 0; i < data.length; i += frameSize) {
        const end = Math.min(i + frameSize, data.length);
        let sum = 0;
        for (let j = i; j < end; j += 1) sum += data[j] * data[j];
        const rms = Math.sqrt(sum / (end - i || 1));
        if (rms >= VAD_RMS_THRESHOLD) voicedFrames += 1;
        totalFrames += 1;
      }
      if (!totalFrames) return true;
      return voicedFrames / totalFrames < VAD_VOICED_FRAME_RATIO;
    } catch {
      // If decoding fails, fall back to server transcription behavior.
      return false;
    }
  }

  function appendSilentChunkAndHints() {
    const ts = nowTime();
    const text = "[No audio detected]";
    const merged = `${fullTranscriptRef.current} ${text}`.trim();
    fullTranscriptRef.current = merged;
    setFullTranscript(merged);
    setTranscriptChunks((prev) => [...prev, { timestamp: ts, text }]);
    const hints = [
      {
        type: "clarify",
        title: "No speech captured",
        preview: "No audio was detected this cycle, so suggestions are paused until speech resumes.",
        reason: "Chunk marked silent by client-side VAD."
      },
      {
        type: "talking_point",
        title: "Mic check tips",
        preview: "Move closer to the mic, reduce background noise, and verify browser microphone permissions.",
        reason: "Helps recover from repeated silent chunks."
      },
      {
        type: "ask_question",
        title: "Resume when ready",
        preview: "Start speaking naturally; the next 30s chunk will be transcribed and suggestions will refresh automatically.",
        reason: "Keeps the user informed without disrupting chunk timing."
      }
    ];
    setSuggestionBatches((prev) => [
      { batchNumber: prev.length + 1, timestamp: new Date().toISOString(), suggestions: hints },
      ...prev
    ]);
    updateStatus("transcript", "idle", "No audio detected.");
    updateStatus("suggestions", "idle", "Suggestions paused until speech is detected.");
    appendPromptLog({ endpoint: "transcribe", ok: true, note: "silent chunk skipped by Voice Actity Detection logic" });
  }

  function renderAssistantText(text) {
    const escaped = String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return escaped
      .replace(/^### (.*)$/gm, "<h4>$1</h4>")
      .replace(/^## (.*)$/gm, "<h3>$1</h3>")
      .replace(/^# (.*)$/gm, "<h2>$1</h2>")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/^- (.*)$/gm, "<li>$1</li>")
      .replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>")
      .replace(/\n/g, "<br />");
  }

  async function postForm(url, formData) {
  // Normalize backend validation/auth errors into a single readable message path.
    const res = await fetch(url, { method: "POST", body: formData });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(formatHttpDetail(body.detail) || `HTTP ${res.status}`);
    return body;
  }

  async function startRecording() {
    if (!settings.tm_key) {
      updateStatus("transcript", "error", "Missing API key. Open settings.");
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    chunksRef.current = [];
    setIsRecording(true);
    updateStatus("transcript", "loading", "Recording started. First transcript chunk in ~30s.");
    cycleStartedAtRef.current = Date.now();
    setCycleTicker();

    // audio/webm aligns with backend transcribe endpoint expectations.
    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.start();
    mediaRecorderRef.current = recorder;
    scheduleNextCycle();
  }

  function stopRecordingInternal() {
    clearTimers();
    setIsRecording(false);
    setRecordingCycleProgress(0);
    setTranscribingProgress(0);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  }

  function stopRecording() {
    stopRecordingInternal();
    updateStatus("transcript", "idle", "Recording stopped.");
  }

  function scheduleNextCycle() {
    clearTimeout(cycleTimeoutRef.current);
    cycleTimeoutRef.current = setTimeout(() => {
      processCycle();
    }, CHUNK_MS);
  }

  async function processCycle() {
    if (!isRecordingRef.current || !mediaRecorderRef.current) return;
    updateStatus("transcript", "loading", "Transcribing current 30s chunk...");
    cycleStartedAtRef.current = Date.now();
    setRecordingCycleProgress(0);
    setCycleTicker();

    const recorder = mediaRecorderRef.current;
    // Stop/start recorder each cycle to flush exactly one chunk for upload.
    const chunkReady = new Promise((resolve) => {
      const onStop = () => {
        recorder.removeEventListener("stop", onStop);
        resolve();
      };
      recorder.addEventListener("stop", onStop);
    });

    recorder.stop();
    await chunkReady;

    const chunkBlob = new Blob(chunksRef.current, { type: "audio/webm" });
    chunksRef.current = [];
    recorder.start();
    scheduleNextCycle();

    if (!chunkBlob.size) {
      appendSilentChunkAndHints();
      return;
    }

    const isSilent = await isChunkLikelySilent(chunkBlob);
    if (isSilent) {
      appendSilentChunkAndHints();
      return;
    }

    await sendToTranscribeAndSuggest(chunkBlob);
  }

  async function manualRefresh() {
    if (!isRecording) return;
    if (loading.refresh) return;
    setLoading((l) => ({ ...l, refresh: true }));
    clearTimeout(cycleTimeoutRef.current);
    await processCycle();
    setLoading((l) => ({ ...l, refresh: false }));
  }

  async function sendToTranscribeAndSuggest(blob) {
    const formData = new FormData();
    formData.append("audio", blob);
    formData.append("key", settings.tm_key || "");
    const t0 = performance.now();
    setTranscribeTicker(Date.now());
    try {
      const payload = await postForm(`${API_BASE}/transcribe`, formData);
      const ms = Math.round(performance.now() - t0);
      pushLatency("transcribe", ms);
      setTranscribingProgress(100);
      const text = payload?.data?.text || "";
      if (text.trim()) {
        const ts = nowTime();
        // Ref is updated first so follow-up suggest call always sees fresh text
        // (avoids waiting for async React state batching).
        const merged = `${fullTranscriptRef.current} ${text}`.trim();
        fullTranscriptRef.current = merged;
        setFullTranscript(merged);
        setTranscriptChunks((prev) => [...prev, { timestamp: ts, text }]);
        updateStatus("transcript", "success", `Transcript ready in ${ms} ms`);
        appendPromptLog({ endpoint: "transcribe", ok: true, latencyMs: ms, textLength: text.length, transcriptCharsAfterMerge: merged.length });
        await getSuggestions();
      } else {
        updateStatus("transcript", "idle", "No transcribable text in this chunk.");
        appendPromptLog({ endpoint: "transcribe", ok: true, latencyMs: ms, textLength: 0, note: "skipped suggestions — empty transcript" });
      }
    } catch (err) {
      updateStatus("transcript", "error", `Transcription failed: ${String(err.message || err)}`);
      appendPromptLog({ endpoint: "transcribe", ok: false, error: String(err.message || err) });
    } finally {
      setTimeout(() => setTranscribingProgress(0), 400);
      clearInterval(transcribeTickerRef.current);
    }
  }

  async function getSuggestions() {
    const started = performance.now();
    updateStatus("suggestions", "loading", "Generating 3 live suggestions...");
    const win = buildTranscriptWindow("suggestions");
    const recentTranscript = win.recent.toLowerCase();
    const looksLikePatternOrPuzzle =
      recentTranscript.includes("pattern") ||
      recentTranscript.includes("sequence") ||
      recentTranscript.includes("guess the next") ||
      recentTranscript.includes("next numbers") ||
      recentTranscript.includes("puzzle") ||
      recentTranscript.includes("riddle");
    // Feed recent cards back so the model avoids repeating themes.
    const recentHistory = suggestionBatches.slice(-2).map((b) => ({
      batchNumber: b.batchNumber,
      suggestions: b.suggestions.map((s) => ({ type: s.type, title: s.title, preview: s.preview }))
    }));
    const contextParts = [
      settings.tm_sugg_context,
      `[MOST RECENT TRANSCRIPT]:\n${win.recencyBoost}`,
      win.olderSummary ? `[OLDER CONTEXT]:\n${win.olderSummary}` : null,
      recentHistory.length ? `Avoid repeating these [RECENT SUGGESTIONS]: ${JSON.stringify(recentHistory)}` : null,
      `Use the recent transcript window (last ${win.lastN} characters).`,
      "Ground every suggestion in the provided transcript only.",
      "Do not invent business context (deadlines, budget, milestones, stakeholders) unless explicitly present in transcript.",
      looksLikePatternOrPuzzle
        ? "Transcript appears to be a puzzle or sequence task. Include at least one suggestion that directly computes or proposes the next sequence items."
        : null
    ];
    const context = contextParts.filter(Boolean).join("\n\n");

    // LLM JSON quality can vary; retry a few times before surfacing failure.
    const MAX_RETRY = 4;
    let best = [];
    for (let i = 1; i <= MAX_RETRY; i += 1) {
      const fd = new FormData();
      fd.append("transcript", win.recent);
      fd.append("prompt", settings.tm_sugg_prompt || "");
      fd.append("sugg_context", `${context}\n\nAttempt ${i}/${MAX_RETRY}: keep high quality and non-generic.`);
      fd.append("key", settings.tm_key || "");
      try {
        const payload = await postForm(`${API_BASE}/suggest`, fd);
        const normalized = normalizeSuggestions(payload?.data?.suggestions || []);
        best = normalized;
        appendPromptLog({
          endpoint: "suggest",
          ok: true,
          attempt: i,
          systemPrompt: settings.tm_sugg_prompt || "",
          userContextPreview: context.slice(0, 1000),
          responsePreview: JSON.stringify(payload?.data?.suggestions || []).slice(0, 1000)
        });
        // Stop early once we hit UX constraints (3 cards, diverse/unique).
        if (suggestionsPassQuality(normalized)) break;
      } catch (err) {
        appendPromptLog({
          endpoint: "suggest",
          ok: false,
          attempt: i,
          systemPrompt: settings.tm_sugg_prompt || "",
          userContextPreview: context.slice(0, 1000),
          error: String(err.message || err)
        });
      }
    }

    const ms = Math.round(performance.now() - started);
    pushLatency("suggest", ms);
    setLastRefreshInfo(`last refresh: ${nowTime()} • ${ms} ms`);

    if (best.length === 3) {
      setSuggestionBatches((prev) => [
        { batchNumber: prev.length + 1, timestamp: new Date().toISOString(), suggestions: best },
        ...prev
      ]);
      updateStatus("suggestions", "success", `Suggestions ready in ${ms} ms`);
    } else {
      updateStatus("suggestions", "error", "Could not generate high-quality suggestions after retries.");
    }
  }

  async function askChat(question, displayTitle = null, sourceSuggestion = null) {
    if (!question.trim() || loading.chat) return;
    setLoading((l) => ({ ...l, chat: true }));
    updateStatus("chat", "loading", "Generating detailed answer...");
    const t0 = performance.now();
    const win = buildTranscriptWindow("chat");
    const detail = String(settings.tm_detail_prompt || "").trim();
    const systemPrompt = sourceSuggestion && detail ? settings.tm_detail_prompt : settings.tm_chat_prompt || "";
    const meta = sourceSuggestion
      ? `Clicked suggestion metadata:\nType: ${sourceSuggestion.type}\nTitle: ${sourceSuggestion.title}\nPreview: ${sourceSuggestion.preview}\nReason: ${sourceSuggestion.reason || ""}`
      : "";
    const chatContext = [
      settings.tm_chat_context || "",
      `Use recent transcript (last ${win.lastN} chars).`,
      `Recency boost (highest priority): ${win.recencyBoost}`,
      win.olderSummary ? `Older context summary:\n${win.olderSummary}` : "",
      "Formatting rules: avoid markdown tables and pipes. Use short headings and bullet points.",
      meta
    ]
      .filter(Boolean)
      .join("\n\n");

    const userTurn = {
      timestamp: new Date().toISOString(),
      user: question,
      displayTitle: displayTitle || null,
      assistant: "..."
    };
    setChatHistory((prev) => [...prev, userTurn]);

    try {
      const fd = new FormData();
      fd.append("question", question);
      fd.append("transcript", win.recent);
      fd.append("chat_context", chatContext);
      fd.append("prompt", systemPrompt);
      fd.append("key", settings.tm_key || "");
      const payload = await postForm(`${API_BASE}/chat`, fd);
      const answer = payload?.data?.answer || "";
      const ms = Math.round(performance.now() - t0);
      pushLatency("chat", ms);
      updateStatus("chat", "success", `Answer ready in ${ms} ms`);
      appendPromptLog({
        endpoint: "chat",
        ok: true,
        systemPrompt,
        userContextPreview: chatContext.slice(0, 1000),
        responsePreview: answer.slice(0, 1000),
        latencyMs: ms
      });
      setChatHistory((prev) => {
        const next = [...prev];
        next[next.length - 1] = { ...next[next.length - 1], assistant: answer, clickedSuggestion: sourceSuggestion || null };
        return next;
      });
    } catch (err) {
      updateStatus("chat", "error", `Chat failed: ${String(err.message || err)}`);
      appendPromptLog({
        endpoint: "chat",
        ok: false,
        systemPrompt,
        userContextPreview: chatContext.slice(0, 1000),
        error: String(err.message || err)
      });
      setChatHistory((prev) => {
        const next = [...prev];
        next[next.length - 1] = { ...next[next.length - 1], assistant: `Error: ${String(err.message || err)}` };
        return next;
      });
    } finally {
      setLoading((l) => ({ ...l, chat: false }));
    }
  }

  function exportSession() {
    // Export is intentionally complete for offline review/debug of a session.
    const payload = {
      transcriptText: fullTranscript,
      transcriptChunks,
      suggestionBatches,
      chatHistory,
      promptDebugLog,
      latencyMetrics: metrics,
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `twinmind-session-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportPromptLog() {
    const blob = new Blob([JSON.stringify(promptDebugLog, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `twinmind-prompt-log-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function saveSettings() {
    Object.entries(settings).forEach(([k, v]) => {
      localStorage.setItem(k, String(v ?? ""));
    });
    setSettingsOpen(false);
  }

  const metricsBar = useMemo(() => {
    const kinds = ["transcribe", "suggest", "chat"];
    const chunks = kinds
      .map((k) => {
        const last = metrics[k][metrics[k].length - 1] ?? null;
        const med = median(metrics[k]);
        const avg = mean(metrics[k]);
        if (last == null && med == null && avg == null) return null;
        return `${k}: last ${last ?? "-"}ms | median ${med ?? "-"}ms | mean ${avg ?? "-"}ms`;
      })
      .filter(Boolean);
    return chunks.length ? chunks.join("  ·  ") : "latency: —";
  }, [metrics]);

  const promptDebugText = useMemo(() => {
    // Reverse so newest entries are visible first in the debug panel.
    if (settings.tm_show_prompt_debug !== "true") return "";
    return promptDebugLog
      .slice()
      .reverse()
      .map((x) => JSON.stringify(x, null, 2))
      .join("\n\n---\n\n");
  }, [promptDebugLog, settings.tm_show_prompt_debug]);

  return (
    <div className="app">
      <header className="header">
        <h1>TwinMind</h1>
        <div className="metrics">{metricsBar}</div>
        <button onClick={() => setSettingsOpen(true)} className="icon-btn">
          ⚙
        </button>
      </header>

      <main className="layout">
        <section className="col">
          <div className="col-head">
            <h2>1. Mic & Transcript</h2>
            <span>{isRecording ? "Recording" : "Idle"}</span>
          </div>
          <div className="mic-row">
            <button className={`mic-btn ${isRecording ? "stop" : "start"}`} onClick={isRecording ? stopRecording : startRecording}>
              <span className="dot" />
            </button>
            <div>
              <p>{isRecording ? "Stop recording" : "Click mic to start."}</p>
              <p className="hint">Uniform 30s chunk timing with progress bar.</p>
            </div>
          </div>
          <div className="scroll" ref={transcriptAreaRef}>
            {transcriptChunks.length === 0 ? (
              <p className="placeholder">No transcript yet — start the mic.</p>
            ) : (
              transcriptChunks.map((t, idx) => (
                <div key={`${t.timestamp}-${idx}`} className="line">
                  <span>{t.timestamp}</span>
                  <p>{t.text}</p>
                </div>
              ))
            )}
          </div>
          <div className="col-footer">
            <button className="text-btn" onClick={exportSession}>
              Export Session
            </button>
            <FixedStatus status={columnStatus.transcript} progress={Math.max(recordingCycleProgress, transcribingProgress)} />
          </div>
        </section>

        <section className="col">
          <div className="col-head">
            <h2>2. Live Suggestions</h2>
            <span>{isRecording ? `next chunk in ${Math.max(0, Math.ceil((100 - recordingCycleProgress) * 0.3))}s` : "not recording"}</span>
          </div>
          <div className="mini">{lastRefreshInfo}</div>
          <button className="primary" disabled={!isRecording || loading.refresh} onClick={manualRefresh}>
            {loading.refresh ? "Refreshing..." : "↻ Reload suggestions"}
          </button>
          <div className="scroll">
            {suggestionBatches.map((b) => (
              <div key={b.batchNumber} className="batch">
                <div className="batch-title">
                  Batch {b.batchNumber} • {new Date(b.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </div>
                {b.suggestions.map((s, idx) => (
                  <button key={`${s.title}-${idx}`} className="card" onClick={() => askChat(`Explain: ${s.title}. Context: ${s.preview}`, s.title, s)}>
                    <div className="tag">{s.type}</div>
                    <div className="card-title">{s.title}</div>
                    <div className="card-preview">{s.preview}</div>
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="col-footer">
            <FixedStatus status={columnStatus.suggestions} progress={loading.refresh ? 35 : 0} />
          </div>
        </section>

        <section className="col">
          <div className="col-head">
            <h2>3. Chat (Detailed Answers)</h2>
            <span>session-only</span>
          </div>
          <div className="scroll" ref={chatAreaRef}>
            {chatHistory.map((m, i) => (
              <div key={`${m.timestamp}-${i}`} className="chat-pair">
                <div className="you">{m.displayTitle || m.user}</div>
                  <div className="bot" dangerouslySetInnerHTML={{ __html: renderAssistantText(m.assistant) }} />
              </div>
            ))}
          </div>
          <div className="chat-row">
            <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Ask anything..." />
            <button
              onClick={() => {
                const text = chatInput.trim();
                if (!text) return;
                askChat(text);
                setChatInput("");
              }}
              disabled={loading.chat}
            >
              {loading.chat ? "Sending..." : "Send"}
            </button>
          </div>
          <div className="col-footer">
            <FixedStatus status={columnStatus.chat} progress={loading.chat ? 40 : 0} />
          </div>
        </section>
      </main>

      {settingsOpen && (
        <div className="modal">
          <div className="modal-card">
            <div className="modal-head">
              <h3>Settings</h3>
              <button className="modal-close" onClick={() => setSettingsOpen(false)} aria-label="Close settings">
                ×
              </button>
            </div>
            <label>Groq API Key</label>
            <input type="password" value={settings.tm_key || ""} onChange={(e) => setSettings((s) => ({ ...s, tm_key: e.target.value }))} />

            <label>Suggestions Prompt</label>
            <textarea value={settings.tm_sugg_prompt || ""} onChange={(e) => setSettings((s) => ({ ...s, tm_sugg_prompt: e.target.value }))} />

            <label>Chat Prompt (typed messages)</label>
            <textarea value={settings.tm_chat_prompt || ""} onChange={(e) => setSettings((s) => ({ ...s, tm_chat_prompt: e.target.value }))} />

            <label>Detailed answer prompt (suggestion click)</label>
            <textarea value={settings.tm_detail_prompt || ""} onChange={(e) => setSettings((s) => ({ ...s, tm_detail_prompt: e.target.value }))} />

            <label>Suggestions Context</label>
            <textarea value={settings.tm_sugg_context || ""} onChange={(e) => setSettings((s) => ({ ...s, tm_sugg_context: e.target.value }))} />

            <label>Chat Context</label>
            <textarea value={settings.tm_chat_context || ""} onChange={(e) => setSettings((s) => ({ ...s, tm_chat_context: e.target.value }))} />

            <div className="grid2">
              <div>
                <label>Suggestion Last N Chars</label>
                <input value={settings.tm_sugg_last_n_chars || ""} onChange={(e) => setSettings((s) => ({ ...s, tm_sugg_last_n_chars: e.target.value }))} />
              </div>
              <div>
                <label>Chat Last N Chars</label>
                <input value={settings.tm_chat_last_n_chars || ""} onChange={(e) => setSettings((s) => ({ ...s, tm_chat_last_n_chars: e.target.value }))} />
              </div>
            </div>

            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.tm_show_prompt_debug === "true"}
                onChange={(e) => setSettings((s) => ({ ...s, tm_show_prompt_debug: e.target.checked ? "true" : "false" }))}
              />
              Prompt clarity debug (show payload)
            </label>

            {settings.tm_show_prompt_debug === "true" && (
              <>
                <div className="row-between">
                  <span className="small-head">Prompt / API log (recent)</span>
                  <button className="text-btn" onClick={exportPromptLog}>
                    Export log JSON
                  </button>
                </div>
                <textarea readOnly value={promptDebugText} className="debug" />
              </>
            )}

            <div className="modal-actions">
              <button onClick={() => setSettingsOpen(false)}>Cancel</button>
              <button onClick={saveSettings}>Save Settings</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
