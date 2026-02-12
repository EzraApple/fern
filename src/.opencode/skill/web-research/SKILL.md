---
name: web-research
description: How to do multi-step web research, site crawling, and targeted content extraction using Tavily tools and web_fetch. Load when planning a research workflow, crawling a site, or unsure which web tool to use for a task.
---

# Web Research

You have two systems for accessing web content: **Tavily** (AI-optimized search and extraction, costs credits) and **web_fetch** (free general-purpose URL fetching).

## Choosing the Right Tool

| Situation | Tool | Why |
|-----------|------|-----|
| Hit an API endpoint or raw URL | `web_fetch` | Free, works on any URL including non-web endpoints |
| Read a known web page you already have the URL for | `web_fetch` | Free, no credits needed |
| Search the web for information on a topic | `tv_tavily-search` | AI-optimized search with relevance scoring |
| Extract content from URLs with query targeting | `tv_tavily-extract` | Smart extraction, reranks by relevance |
| Read JS-heavy or dynamic pages | `tv_tavily-extract` | Handles JS rendering (`extract_depth: "advanced"`) |
| Discover all URLs on a site | `tv_tavily-map` | Fast URL discovery without content extraction |
| Download docs or content from an entire site | `tv_tavily-crawl` | Full site crawling with semantic focus |

**Rule of thumb:** If you have the URL and just need the content, use `web_fetch` (free). If you need to *find* something, *target* specific content, or handle complex pages, use Tavily.

## Search (`tv_tavily-search`)

### Query Optimization
- Keep queries under 400 characters — think focused web search, not LLM prompt
- Break complex research into multiple focused sub-queries rather than one broad query
- Be specific: include names, dates, domain context when known

### Search Depth
| Depth | Cost | Best For |
|-------|------|----------|
| `basic` | 1 credit | General searches — good default for most queries |
| `advanced` | 2 credits | Precision queries where basic results aren't relevant enough |

Start with `basic`. Only use `advanced` when you need higher relevance.

### Filtering
- `include_domains` — restrict to trusted sources (e.g., `["github.com", "docs.python.org"]`)
- `exclude_domains` — filter out noise
- `time_range` — filter by recency: `day`, `week`, `month`, `year`
- `topic: "news"` — for current events (adds published dates to results)
- `max_results` — keep reasonable (5-10). Higher may reduce quality.

### Result Handling
- Each result has a `score` (0-1). Filter by score > 0.5 for high relevance.
- Results include `title`, `content` (snippet), `url`, and optionally `raw_content`.

## Two-Step Research Pattern

The most powerful workflow for deep research:

1. **Search** to discover relevant URLs with relevance scores
2. **Filter** results by score (> 0.5 threshold)
3. **Extract** deep content from the best URLs with a targeted `query`

This gives breadth (search discovers) and depth (extract gets full content). Better than using `include_raw_content` on search, which returns everything unfiltered.

## Extract (`tv_tavily-extract`)

- Pass a `query` to rerank extracted chunks by relevance — don't just dump raw pages
- Use `chunks_per_source` (1-5) to limit output and prevent context overflow
- `extract_depth: "advanced"` for JS-rendered pages, tables, structured docs
- `extract_depth: "basic"` for simple static pages (faster, cheaper)
- Max 20 URLs per call — batch larger sets
- Check `failed_results` for URLs that couldn't be processed

## Map (`tv_tavily-map`)

- Use for quick URL discovery — much faster than crawl since it only collects links
- Good for understanding site structure before deciding what to extract or crawl
- Combine with extract: map discovers URLs → extract gets content from the important ones
- Use `instructions` to focus on relevant pages (e.g., "Find all API documentation pages")

## Crawl (`tv_tavily-crawl`)

### For Agentic Use (feeding results into context)
Always use `instructions` + `chunks_per_source`:
- `instructions` — semantic focus (e.g., "Find API documentation and authentication guides")
- `chunks_per_source` — limits output per page (1-5), prevents context explosion
- Without these, you get full page content that will overwhelm your context window

### For Data Collection (saving full pages)
Omit `chunks_per_source` to get full page content.

### Depth vs Performance
| Depth | Typical Pages | Time |
|-------|---------------|------|
| 1 | 10-50 | Seconds |
| 2 | 50-500 | Minutes |
| 3+ | 500-5000 | Many minutes |

- Start conservative: `max_depth=1`, `limit=20`
- Always set a `limit` to prevent runaway crawls
- Use `select_paths`/`exclude_paths` regex to focus on relevant sections
- Use `tv_tavily-map` first to understand site structure before committing to a deep crawl

## Cost Awareness

Tavily free tier: **1,000 credits/month**.

| Action | Cost |
|--------|------|
| Basic search | 1 credit |
| Advanced search | 2 credits |
| Extract | ~1 credit per 5 URLs (basic) |
| Crawl/Map | Varies by scope |
| `web_fetch` | **Free** (unlimited) |

Default to `web_fetch` for known URLs to conserve Tavily credits.

## Anti-Patterns

- Don't use Tavily search when you already have the URL — use `web_fetch` (free)
- Don't use Tavily extract for API endpoints or raw files — use `web_fetch`
- Don't set `max_depth > 2` on crawls without a `limit` — costs add up exponentially
- Don't use `advanced` search depth for every query — `basic` is usually sufficient
- Don't send raw user messages as search queries — extract the key question first
- Don't crawl when you only need one page — use extract or `web_fetch`
- Don't omit `instructions` when crawling for agentic use — causes context explosion
- Don't skip the two-step pattern for research — search then extract gives better results than search with `include_raw_content`
