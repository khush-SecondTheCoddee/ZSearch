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
    const url = 'https://en.wikipedia.org/w/api.php';
    const response = await axios.get(url, {
      params: {
        action: 'query',
        list: 'search',
        srsearch: query,
        format: 'json',
        utf8: 1
      },
      headers: {
        'User-Agent': 'MinimalSearchEngine/1.0 (contact@example.com)'
      },
      timeout: 5000
    });

    const items = response.data.query.search || [];

    // Format matches to fit your existing frontend
    const results = items.map((item) => {
      // Strip HTML span tags returned by Wikipedia snippet
      const cleanSnippet = item.snippet.replace(/<\/?[^>]+(>|$)/g, '');
      return {
        title: item.title,
        link: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(item.title.replace(/ /g, '_')),
        snippet: cleanSnippet + '...'
      };
    });

    res.json(results);
  } catch (err) {
    console.error('Search API error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve search results' });
  }
});

app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
