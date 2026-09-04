const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: 'Query parameter "q" is required' });
  }

  try {
    // SearXNG aggregates Google, Bing, DDG, and open web without blocking cloud IPs
    const response = await axios.get('https://searx.be/search', {
      params: {
        q: query,
        format: 'json',
        language: 'en'
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      },
      timeout: 7000
    });

    const items = response.data.results || [];

    // Map into title, link, snippet for your existing frontend
    const results = items.slice(0, 15).map(item => ({
      title: item.title,
      link: item.url,
      snippet: item.content || 'No description available.'
    }));

    res.json(results);
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve web search results' });
  }
});

app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
