const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Allow requests from GitHub Pages domain
app.use(cors({
  origin: [
    'https://troykeur-creator.github.io',
    'https://localhost:3000',
    'http://localhost:3000',
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));

app.use(express.json({ limit: '10mb' }));

// Increase timeout to 3 minutes for long AI + web search calls
app.use((req, res, next) => {
  res.setTimeout(180000);
  req.setTimeout(180000);
  next();
});

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
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Models request failed', detail: err.message });
  }
});

// Main Claude proxy — streams response back to avoid timeout
app.post('/api/claude', async (req, res) => {
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'API key not configured' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05',
      },
      body: JSON.stringify(req.body),
    });

    // Get the full response text first
    const text = await response.text();

    // Try to parse as JSON
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error('Failed to parse Anthropic response as JSON:', text.substring(0, 200));
      return res.status(500).json({ error: 'Invalid response from Anthropic', raw: text.substring(0, 500) });
    }

    if (!response.ok) {
      console.error('Anthropic API error:', response.status, JSON.stringify(data));
    }

    res.status(response.status).json(data);
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Proxy request failed', detail: err.message });
  }
});

const server = app.listen(PORT, () => {
  console.log(`FFF Proxy running on port ${PORT}`);
});

// Set server timeout to 3 minutes
server.timeout = 180000;
