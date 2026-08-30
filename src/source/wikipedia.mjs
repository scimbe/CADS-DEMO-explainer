/**
 * Wikipedia topic -> a grounded fact source for the storyboard.
 *
 * Fetches the REST summary of a German-Wikipedia article and returns its
 * verbatim `extract` (the lead paragraph) as the single source of truth the
 * downstream script generator must not contradict. This is the ONLY place the
 * pipeline pulls in external facts; everything else stays local/deterministic.
 *
 *   GET https://de.wikipedia.org/api/rest_v1/page/summary/<Titel>
 *   accept: application/json
 *   user-agent: CADS-Demo-Explainer/1.0
 *
 * The endpoint resolves redirects itself (e.g. "Fog_Computing" -> "Edge Computing"),
 * so a caller's loose title still lands on the canonical article. Disambiguation
 * pages and empty/missing articles are rejected with a clear reason rather than
 * fed downstream, so we never build a video on top of "X steht für: …" or nothing.
 */

const DEFAULT_LANG = "de";
const USER_AGENT = "CADS-Demo-Explainer/1.0";

export class WikipediaSourceError extends Error {
  constructor(message, { kind } = {}) {
    super(message);
    this.name = "WikipediaSourceError";
    this.kind = kind; // "not-found" | "disambiguation" | "empty" | "http" | "input"
  }
}

/** Build the REST summary URL for a title. Encodes spaces as underscores like the wiki does. */
export function summaryUrl(title, lang = DEFAULT_LANG) {
  const t = String(title ?? "").trim().replace(/\s+/g, "_");
  return `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t)}`;
}

/**
 * Fetch and validate a Wikipedia article summary for use as a fact source.
 *
 * @param {string} title  Article title (loose is fine; the API resolves redirects).
 * @param {{lang?:string, fetchImpl?:typeof fetch, timeoutMs?:number}} [opts]
 * @returns {Promise<{title:string, extract:string, description:string, url:string,
 *                    lang:string, revision:string, pageid:number}>}
 * @throws {WikipediaSourceError} on empty input, 404, disambiguation, or empty extract.
 */
export async function fetchWikipediaSummary(title, opts = {}) {
  const lang = opts.lang || DEFAULT_LANG;
  const fetchImpl = opts.fetchImpl || fetch;
  const timeoutMs = opts.timeoutMs ?? 20000;

  const cleanTitle = String(title ?? "").trim();
  if (!cleanTitle) {
    throw new WikipediaSourceError("Wikipedia topic is empty.", { kind: "input" });
  }

  const url = summaryUrl(cleanTitle, lang);
  const res = await fetchImpl(url, {
    headers: { accept: "application/json", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (res.status === 404) {
    throw new WikipediaSourceError(
      `No ${lang}.wikipedia.org article found for "${cleanTitle}". Check the exact title.`,
      { kind: "not-found" },
    );
  }
  if (!res.ok) {
    throw new WikipediaSourceError(
      `Wikipedia summary request failed: HTTP ${res.status} for "${cleanTitle}".`,
      { kind: "http" },
    );
  }

  const data = await res.json();

  if (data?.type === "disambiguation") {
    throw new WikipediaSourceError(
      `"${data.title || cleanTitle}" is a disambiguation page, not a single topic. ` +
        `Pass a more specific title (e.g. one of the entries it lists).`,
      { kind: "disambiguation" },
    );
  }

  const extract = normalizeExtract(data?.extract);
  if (!extract) {
    throw new WikipediaSourceError(
      `Wikipedia article "${data?.title || cleanTitle}" has no usable summary text.`,
      { kind: "empty" },
    );
  }

  return {
    title: data.title || cleanTitle,
    extract,
    description: (data.description || "").trim(),
    url: data?.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(cleanTitle)}`,
    lang,
    revision: String(data.revision ?? ""),
    pageid: data.pageid ?? null,
  };
}

/** Collapse whitespace in the lead-paragraph extract; keep the wording itself verbatim. */
export function normalizeExtract(raw) {
  return String(raw ?? "").replace(/\s+/g, " ").trim();
}
