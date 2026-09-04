const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.static('public'));

app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Query parameter q is required' });

  try {
    const { data } = await axios.get(`https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(data);
    const results = [];

    // Parse Google's main search result containers
    $('div.g').each((_, element) => {
      const title = $(element).find('h3').first().text();
      const link = $(element).find('a').first().attr('href');
      // Google wraps snippet descriptions inside standard text blocks
      const snippet = $(element).find('div[data-sncf], div[style*="-webkit-line-clamp"]').text();

      if (title && link && link.startsWith('http')) {
        results.push({ title, link, snippet });
      }
    });

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch search results' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
