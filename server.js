// server.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import fetch from 'node-fetch'; // v3 – already ESM

const app = express();
app.use(express.json()); // <-- REQUIRED so req.body is populated

// ----- static files (serve /app) -----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, 'app')));

// ----- health check (optional) -----
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ----- chat endpoint -----
app.post('/api/chat', async (req, res) => {
  try {
    const { message, meta } = req.body || {};
    if (!message) return res.status(400).json({ error: 'message is required' });
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is missing' });
    }

    // Call OpenAI – lightweight, coach-y reply
    const openaiResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.7,
        messages: [
          {
            role: 'system',
            content:
              "You are the Son of Wisdom AI Coach. Be warm, concise, and practical. Offer 1–3 actionable suggestions.",
          },
          { role: 'user', content: message },
        ],
      }),
    });

    if (!openaiResp.ok) {
      const errText = await openaiResp.text();
      return res.status(openaiResp.status).json({ error: errText });
    }

    const data = await openaiResp.json();
    const reply = data?.choices?.[0]?.message?.content?.trim() || '…';

    // You can also enqueue meta to n8n here if you’d like.
    return res.json({ reply, meta: meta || null });
  } catch (err) {
    console.error('[api/chat] error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// (optional) serve SPA fallback for clean refreshes:
app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, 'app', 'home.html'))
);

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`🟢 Server running at http://localhost:${PORT}`);
});
