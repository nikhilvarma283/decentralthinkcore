/**
 * Web Search Agent — built-in specialist for internet lookups.
 *
 * Routing: Cortex sends steps here when the task contains search keywords
 * (find, search, lookup, web, internet, etc.) — see marketplace/discovery.js.
 *
 * Backends (tried in order):
 *   1. Tavily   — set TAVILY_API_KEY  (1000 free searches/month, AI-optimised)
 *                 Free key at: https://tavily.com
 *   2. SerpAPI  — set SERPAPI_KEY     (100 free searches/month)
 *   3. DuckDuckGo instant answers — no key, limited results, always available
 */

const logger = require("../lib/logger");

const TAVILY_KEY  = process.env.TAVILY_API_KEY;
const SERPAPI_KEY = process.env.SERPAPI_KEY;
const MAX_RESULTS = parseInt(process.env.WEB_SEARCH_MAX_RESULTS || "8");

/**
 * Execute a web search for the given query string.
 * Returns { results: [{title, url, snippet}], source }
 */
async function search(query) {
  if (TAVILY_KEY)   return _tavily(query);
  if (SERPAPI_KEY)  return _serpapi(query);
  return _duckduckgo(query);
}

// -- Tavily (recommended — free tier, built for AI agents) --------------------

async function _tavily(query) {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: TAVILY_KEY,
      query,
      search_depth: "basic",
      max_results: MAX_RESULTS,
      include_answer: false,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) throw new Error(`Tavily error ${res.status}`);
  const data = await res.json();

  const results = (data.results || []).map((r) => ({
    title:   r.title,
    url:     r.url,
    snippet: r.content || "",
  }));

  return { results, source: "tavily" };
}

// -- SerpAPI ------------------------------------------------------------------

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

// -- DuckDuckGo instant answers (no key, limited) ----------------------------

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
        result: `Web search for "${step}" returned no results (backend: ${source}). Try rephrasing the query.`,
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

    return {
      result: `Web search failed: ${err.message}. Set TAVILY_API_KEY in .env.prod for best results (free at https://tavily.com).`,
      usage: { input_tokens: 0, output_tokens: 0 },
      paymentReceipt: null,
    };
  }
}

module.exports = { execute, search };
