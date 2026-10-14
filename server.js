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

// ── Main Claude proxy ─────────────────────────────────────────────────────────
app.post('/api/claude', async (req, res) => {
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'API key not configured' });

  res.setTimeout(300000); // 5 min

  try {
    // Strip the web_search tool from the request.
    // The web_search_20250305 beta causes stop_reason:"tool_use" which breaks
    // the app's single-turn JSON extraction. Without it, the model generates
    // the full newsletter from training data and always returns end_turn JSON.
    const { tools, ...bodyWithoutTools } = req.body;
    const forwardBody = { ...bodyWithoutTools, messages: req.body.messages };

    console.log(`[FFF] Calling Anthropic (tools stripped)…`);

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(forwardBody),
      signal: AbortSignal.timeout(120000),
    });

    const raw = await apiRes.text();
    let data;
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

    console.log(`[FFF] Done. stop_reason=${data.stop_reason}`);
    return res.status(200).json(data);

  } catch (err) {
    console.error('[FFF] Proxy error:', err);
    res.status(500).json({ error: 'Proxy request failed', detail: err.message });
  }
});

const server = app.listen(PORT, () => {
  console.log(`FFF Proxy running on port ${PORT}`);
});
server.timeout = 300000; // 5 min server timeout
