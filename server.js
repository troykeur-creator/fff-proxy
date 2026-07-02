const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Allow requests from your GitHub Pages domain
app.use(cors({
  origin: [
    'https://troykeur-creator.github.io',
    'https://localhost:3000',
    'http://localhost:3000',
  ],
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));

app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'Friday Fraud Facts Proxy — OK' });
});

// Proxy endpoint
app.post('/api/claude', async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key not configured on server' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Proxy request failed', detail: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`FFF Proxy running on port ${PORT}`);
});
