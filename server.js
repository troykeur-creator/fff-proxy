const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Allow all origins (GitHub Pages, local file testing, etc.)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));

app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'Friday Fraud Facts Proxy — OK' });
});

// Models endpoint
app.get('/api/models', async (req, res) => {
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'API key not configured' });
  try {
    const response = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Models request failed', detail: err.message });
  }
});

// ── Web search helper (DuckDuckGo — no API key required) ─────────────────────
async function runWebSearch(query) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&t=FridayFraudFacts`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const d = await res.json();

    const parts = [];
    if (d.Abstract) parts.push(d.Abstract);
    if (d.AbstractSource) parts.push(`Source: ${d.AbstractSource}`);
    const topics = (d.RelatedTopics || [])
      .slice(0, 6)
      .map(t => (t.Text || '').trim())
      .filter(Boolean);
    if (topics.length) parts.push(topics.join('\n'));

    return parts.join('\n\n') || `No live results for: ${query}. Use your training-data knowledge.`;
  } catch (e) {
    return `Search unavailable (${e.message}). Use your training-data knowledge for: ${query}`;
  }
}

// ── Main Claude proxy with full tool loop ─────────────────────────────────────
app.post('/api/claude', async (req, res) => {
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'API key not configured' });

  res.setTimeout(300000); // 5 min — searches + generation can take a while

  const messages = JSON.parse(JSON.stringify(req.body.messages)); // deep copy
  const MAX_ROUNDS = 10; // up to 10 search rounds

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      console.log(`[FFF] Round ${round + 1} — calling Anthropic…`);

      const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'web-search-2025-03-05',
        },
        body: JSON.stringify({ ...req.body, messages }),
        signal: AbortSignal.timeout(120000), // 2 min per Anthropic call
      });

      let data;
      const raw = await apiRes.text();
      try {
        data = JSON.parse(raw);
      } catch (e) {
        console.error('[FFF] Bad JSON from Anthropic:', raw.substring(0, 300));
        return res.status(500).json({ error: 'Invalid response from Anthropic', raw: raw.substring(0, 500) });
      }

      if (!apiRes.ok) {
        console.error('[FFF] Anthropic error:', apiRes.status, JSON.stringify(data));
        return res.status(apiRes.status).json(data);
      }

      // ── Done — return to client ───────────────────────────────────────────
      if (data.stop_reason !== 'tool_use') {
        console.log(`[FFF] Finished in ${round + 1} round(s). stop_reason=${data.stop_reason}`);
        return res.status(200).json(data);
      }

      // ── Tool use — run searches, feed results back ────────────────────────
      const toolUseBlocks = (data.content || []).filter(b => b.type === 'tool_use');
      console.log(`[FFF] tool_use — ${toolUseBlocks.length} call(s):`, toolUseBlocks.map(b => b.input?.query || b.name));

      // Add the assistant turn to history
      messages.push({ role: 'assistant', content: data.content });

      // Execute all searches in parallel
      const toolResults = await Promise.all(
        toolUseBlocks.map(async (b) => {
          let content = 'No results.';
          if (b.name === 'web_search' && b.input?.query) {
            content = await runWebSearch(b.input.query);
          }
          return { type: 'tool_result', tool_use_id: b.id, content };
        })
      );

      // Add tool results as next user turn
      messages.push({ role: 'user', content: toolResults });
    }

    // Exhausted rounds — ask model to wrap up with what it has
    console.warn('[FFF] Max rounds reached — requesting wrap-up');
    messages.push({
      role: 'user',
      content: 'You have completed your research. Now write the final JSON newsletter immediately. RESPOND WITH JSON ONLY STARTING WITH {',
    });

    const finalRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05',
      },
      body: JSON.stringify({ ...req.body, messages }),
      signal: AbortSignal.timeout(120000),
    });
    const finalData = await finalRes.json();
    return res.status(finalRes.status).json(finalData);

  } catch (err) {
    console.error('[FFF] Proxy error:', err);
    res.status(500).json({ error: 'Proxy request failed', detail: err.message });
  }
});

const server = app.listen(PORT, () => {
  console.log(`FFF Proxy running on port ${PORT}`);
});
server.timeout = 300000; // 5 min server timeout
