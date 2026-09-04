const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

const app = express();

// Use Render's environment PORT or default to 3000 locally
const PORT = process.env.PORT || 3000;

// Serve frontend files from the "public" folder
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: 'Query parameter "q" is required' });
  }

  try {
    const { data } = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    const $ = cheerio.load(data);
    const results = [];

    // Parse HTML search results
    $('.result').each((_, element) => {
      const title = $(element).find('.result__title a').text().trim();
      const rawLink = $(element).find('.result__title a').attr('href');
      const snippet = $(element).find('.result__snippet').text().trim();

      // Decode the underlying outbound URL
      let link = rawLink;
      if (rawLink && rawLink.includes('uddg=')) {
        try {
          const urlParams = new URLSearchParams(rawLink.split('?')[1]);
          link = decodeURIComponent(urlParams.get('uddg'));
        } catch {
          link = rawLink;
        }
      }

      if (title && link && link.startsWith('http')) {
        results.push({ title, link, snippet });
      }
    });

    res.json(results);
  } catch (error) {
    console.error('Search request failed:', error.message);
    res.status(500).json({ error: 'Failed to fetch search results from source' });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
});
