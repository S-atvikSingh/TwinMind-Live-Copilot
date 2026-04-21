/**
 * @param {'all'|'transcript'|'suggestions'|'chat'} scope - which column(s) show the error
 */
window.handleHttpError = function handleHttpError(status, fallbackMessage, scope = "all") {
  let message = `${fallbackMessage}. Request failed.`;
  if (status === 400 || status === 401) {
    message = "Invalid or missing API key. Update it in Settings.";
  } else if (status === 429) {
    message = "Groq rate limit reached. Please wait and retry.";
  } else if (status >= 500) {
    message = `${fallbackMessage}. Backend may be unreachable.`;
  }
  if (scope === "all") {
    window.setErrorForAllColumns(message);
  } else {
    window.setColumnState(scope, "error", message);
  }
};

/**
 * @param {'all'|'transcript'|'suggestions'|'chat'} [errorScope='all']
 */
window.apiPostForm = async function apiPostForm(url, formData, fallbackMessage, errorScope = "all") {
  const response = await fetch(url, { method: "POST", body: formData });
  if (!response.ok) {
    let detail = "";
    try {
      const errBody = await response.json();
      const d = errBody.detail ?? errBody.message;
      if (Array.isArray(d)) {
        detail = d
          .map((x) => (typeof x === "string" ? x : x.msg || JSON.stringify(x)))
          .join("; ");
      } else if (d != null) {
        detail = String(d);
      }
    } catch (_e) {
      /* ignore */
    }
    const msg = detail ? `${fallbackMessage}: ${detail}` : fallbackMessage;
    window.handleHttpError(response.status, msg, errorScope);
    return null;
  }
  return response.json();
};
