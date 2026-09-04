const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const { pipeline } = require('@xenova/transformers');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Vector store and crawler queues
const vectorDb = [];
const visitedUrls = new Set();
const crawlQueue = [];

let embedder = null;

// Initial seeds to crawl
const SEED_URLS = [
  'https://developer.mozilla.org/en-US/docs/Web/HTML',
  'https://developer.mozilla.org/en-US/docs/Web/JavaScript',
  'https://developer.mozilla.org/en-US/docs/Web/CSS'
];

// Vector dot product / cosine similarity
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
  }
  return dotProduct; // Already normalized
}

// Generate normalized embedding vector from text
async function createEmbedding(text) {
  const output = await embedder(text, {
    pooling: 'mean',
    normalize: true
  });
  return Array.from(output.data);
}

// Scrape page, extract content, generate vector, and queue child links
async function scrapeAndIndex(url) {
  if (visitedUrls.has(url)) return;
  visitedUrls.add(url);

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      },
      timeout: 6000
    });

    const $ = cheerio.load(response.data);

    // 1. Clean and extract content
    $('script, style, nav, footer, noscript').remove();
    const title = $('title').text().trim() || url;
    const rawSnippet = $('meta[name="description"]').attr('content') ||
                       $('main p, article p, p').first().text().trim();
    const snippet = (rawSnippet || 'No summary available').slice(0, 200);

    // 2. Generate on-the-fly embedding for semantic retrieval
    const documentText = `${title}. ${snippet}`.slice(0, 512);
    const vector = await createEmbedding(documentText);

    // 3. Save to vector index
    vectorDb.push({
      title,
      link: url,
      snippet,
      vector
    });

    console.log(`[INDEXED] (${vectorDb.length}) ${title} -> ${url}`);

    // 4. Discover new URLs to crawl
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;

      try {
        const absoluteUrl = new URL(href, url).href;
        if (
          absoluteUrl.startsWith('http') &&
          !visitedUrls.has(absoluteUrl) &&
          crawlQueue.length < 50
        ) {
          crawlQueue.push(absoluteUrl);
        }
      } catch {
        // Skip malformed URLs
      }
    });
  } catch (err) {
    console.error(`Failed to scrape ${url}:`, err.message);
  }
}

// Background crawler loop
async function runCrawler() {
  crawlQueue.push(...SEED_URLS);

  while (crawlQueue.length > 0 && visitedUrls.size < 25) {
    const nextUrl = crawlQueue.shift();
    await scrapeAndIndex(nextUrl);
    // Respectful rate limit delay between requests
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log(`Crawler idle. Total pages in vector DB: ${vectorDb.length}`);
}

// Semantic Search Endpoint
app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Query parameter q is required' });
  if (!embedder) return res.status(503).json({ error: 'Embedding model is still loading' });

  try {
    const queryVector = await createEmbedding(query);

    // Rank indexed pages by vector similarity
    const scoredResults = vectorDb.map((doc) => ({
      title: doc.title,
      link: doc.link,
      snippet: doc.snippet,
      similarity: cosineSimilarity(queryVector, doc.vector)
    }));

    // Sort descending by highest semantic match
    scoredResults.sort((a, b) => b.similarity - a.similarity);

    const formatted = scoredResults.slice(0, 10).map((item) => ({
      title: item.title,
      link: item.link,
      snippet: `[Relevance: ${(item.similarity * 100).toFixed(1)}%] ${item.snippet}`
    }));

    res.json(formatted);
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: 'Vector search failed' });
  }
});

// Boot server and start crawler
app.listen(PORT, async () => {
  console.log(`Server listening at http://localhost:${PORT}`);
  console.log('Loading lightweight SLM embedding model (all-MiniLM-L6-v2)...');
  
  embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  console.log('Model loaded. Launching continuous background crawler...');

  runCrawler();
});
