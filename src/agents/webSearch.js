/**
 * Web Search Agent — built-in specialist for internet lookups.
 *
 * Routing: Cortex sends steps here when the task contains search keywords
 * (find, search, lookup, web, internet, etc.) — see marketplace/discovery.js.
 *
 * Backends (tried in order):
 *   1. Brave Search API   — set BRAVE_SEARCH_API_KEY  (best results, free tier: 2k/month)
 *   2. SerpAPI            — set SERPAPI_KEY            (100 free searches/month)
 *   3. DuckDuckGo Lite    — no key needed, limited to instant answers + related topics
 *
 * The raw search results are returned to Cortex's executor, which then passes
 * them as context to the next Hermes step for summarisation/formatting.
 */

const logger = require("../lib/logger");

const BRAVE_KEY  = process.env.BRAVE_SEARCH_API_KEY;
const SERPAPI_KEY = process.env.SERPAPI_KEY;
const MAX_RESULTS = parseInt(process.env.WEB_SEARCH_MAX_RESULTS || "8");

/**
 * Execute a web search for the given query string.
 * Returns { results: [{title, url, snippet}], source }
 */
async function search(query) {
  if (BRAVE_KEY)   return _brave(query);
  if (SERPAPI_KEY) return _serpapi(query);
  return _duckduckgo(query);
}

// ── Brave Search API ──────────────────────────────────────────────────────────

async function _brave(query) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${MAX_RESULTS}`;
  const res = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": BRAVE_KEY,
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`Brave Search error ${res.status}`);
  const data = await res.json();

  const results = (data.web?.results || []).map((r) => ({
    title:   r.title,
    url:     r.url,
    snippet: r.description || "",
  }));

  return { results, source: "brave" };
}

// ── SerpAPI ───────────────────────────────────────────────────────────────────

async function _serpapi(query) {
  const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&num=${MAX_RESULTS}&api_key=${SERPAPI_KEY}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });

  if (!res.ok) throw new Error(`SerpAPI error ${res.status}`);
  const data = await res.json();

  const results = (data.organic_results || []).map((r) => ({
    title:   r.title,
    url:     r.link,
    snippet: r.snippet || "",
  }));

  return { results, source: "serpapi" };
}

// ── DuckDuckGo instant answers (no key, limited) ──────────────────────────────

async function _duckduckgo(query) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });

  if (!res.ok) throw new Error(`DuckDuckGo error ${res.status}`);
  const data = await res.json();

  const results = [];

  if (data.AbstractText) {
    results.push({
      title:   data.Heading || query,
      url:     data.AbstractURL || "",
      snippet: data.AbstractText,
    });
  }

  (data.RelatedTopics || []).slice(0, MAX_RESULTS - 1).forEach((t) => {
    if (t.Text && t.FirstURL) {
      results.push({ title: t.Text.split(" - ")[0], url: t.FirstURL, snippet: t.Text });
    }
  });

  return { results, source: "duckduckgo" };
}

/**
 * Run a search step. Called by executor for web-search routed steps.
 * Returns the same { result, usage, paymentReceipt } shape as other agents.
 */
async function execute(step) {
  logger.info("WebSearch: executing step", { stepPreview: step.slice(0, 80) });

  try {
    const { results, source } = await search(step);

    if (results.length === 0) {
      return {
        result: `Web search for "${step}" returned no results. The search backend used was: ${source}. Try rephrasing the query.`,
        usage: { input_tokens: 0, output_tokens: 0 },
        paymentReceipt: null,
      };
    }

    // Format results as structured text for Hermes to reason over in the next step
    const formatted = results
      .map((r, i) => `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.snippet}`)
      .join("\n\n");

    const result = `Web search results for: "${step}" (via ${source})\n\n${formatted}`;

    logger.info("WebSearch: returned results", { count: results.length, source });

    return {
      result,
      usage: { input_tokens: 0, output_tokens: 0 },
      paymentReceipt: null,
    };
  } catch (err) {
    logger.error("WebSearch: search failed", { error: err.message });

    // Return a soft failure — Cortex will continue with next steps
    return {
      result: `Web search failed: ${err.message}. No search API key may be configured (set BRAVE_SEARCH_API_KEY for best results).`,
      usage: { input_tokens: 0, output_tokens: 0 },
      paymentReceipt: null,
    };
  }
}

module.exports = { execute, search };
