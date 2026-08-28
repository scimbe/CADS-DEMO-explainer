/**
 * Minimal OpenAI-compatible chat client for the litellm-proxy backend.
 * The LLM's only job in this pipeline: turn a topic into a storyboard/script.
 * Everything downstream (TTS, rendering, muxing) is deterministic, non-LLM code.
 */
export function createLLM(env = process.env) {
  const baseUrl = env.LITELLM_BASE_URL;
  const apiKey = env.LITELLM_API_KEY;
  const defaultModel = env.LITELLM_DEFAULT_MODEL || "local-devstral-small2";
  if (!baseUrl) throw new Error("LITELLM_BASE_URL is not set (see .env.example).");
  if (!apiKey) throw new Error("LITELLM_API_KEY is not set (see .env.example).");

  return {
    name: "litellm-proxy",
    defaultModel,
    async chat({ messages, model, temperature = 0.4, maxTokens = 4000, timeoutMs = 120000 }) {
      const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model || defaultModel,
          messages,
          temperature,
          max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`litellm-proxy chat HTTP ${res.status}: ${text.slice(0, 500)}`);
      }
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content ?? "";
      if (!text) throw new Error(`litellm-proxy returned no content: ${JSON.stringify(data).slice(0, 300)}`);
      return { text, raw: data, model: data?.model || model || defaultModel };
    },
  };
}
