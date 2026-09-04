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
    // Query DuckDuckGo Lite via POST form-data
    const response = await axios.post(
      'https://lite.duckduckgo.com/lite/',
      new URLSearchParams({ q: query }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        timeout: 8000
      }
    );

    const $ = cheerio.load(response.data);
    const results = [];

    // Lite DDG uses simple tables: 
    // Row 1: Link & Title
    // Row 2: Snippet text
    $('tr').each((i, row) => {
      const linkTag = $(row).find('a.result-link');
      if (linkTag.length > 0) {
        const title = linkTag.text().trim();
        const rawLink = linkTag.attr('href');

        // Extract description from the subsequent snippet row
        const snippet = $(row).next('tr').find('.result-snippet').text().trim();

        let link = rawLink;
        if (rawLink && rawLink.includes('uddg=')) {
          try {
            const urlParams = new URLSearchParams(rawLink.split('?')[1]);
            link = decodeURIComponent(urlParams.get('uddg'));
          } catch (e) {
            link = rawLink;
          }
        }

        if (title && link && link.startsWith('http')) {
          results.push({
            title,
            link,
            snippet: snippet || 'No description available.'
          });
        }
      }
    });

    res.json(results);
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve search results' });
  }
});

app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
