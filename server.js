const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
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
    const { data } = await axios.get(
      'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query),
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      }
    );

    const $ = cheerio.load(data);
    const results = [];

    $('.result').each((index, element) => {
      const title = $(element).find('.result__title a').text().trim();
      const rawLink = $(element).find('.result__title a').attr('href');
      const snippet = $(element).find('.result__snippet').text().trim();

      let link = rawLink;
      if (rawLink && rawLink.indexOf('uddg=') !== -1) {
        try {
          const parts = rawLink.split('?');
          if (parts[1]) {
            const urlParams = new URLSearchParams(parts[1]);
            link = decodeURIComponent(urlParams.get('uddg'));
          }
        } catch (parseErr) {
          link = rawLink;
        }
      }

      if (title && link && link.startsWith('http')) {
        results.push({ title: title, link: link, snippet: snippet });
      }
    });

    res.json(results);
  } catch (err) {
    console.error('Scrape error:', err.message);
    res.status(500).json({ error: 'Failed to fetch search results' });
  }
});

app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
