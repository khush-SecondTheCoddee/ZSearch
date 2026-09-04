app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Query parameter q is required' });

  try {
    const { data } = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(data);
    const results = [];

    $('.result').each((_, element) => {
      const title = $(element).find('.result__title a').text().trim();
      const rawLink = $(element).find('.result__title a').attr('href');
      const snippet = $(element).find('.result__snippet').text().trim();

      // DuckDuckGo redirects links via /l/?uddg=... so decode if needed
      let link = rawLink;
      if (rawLink && rawLink.includes('uddg=')) {
        const urlParams = new URLSearchParams(rawLink.split('?')[1]);
        link = decodeURIComponent(urlParams.get('uddg'));
      }

      if (title && link) {
        results.push({ title, link, snippet });
      }
    });

    res.json(results);
  } catch (error) {
    console.error('Search error:', error.message);
    res.status(500).json({ error: 'Failed to fetch search results' });
  }
});
