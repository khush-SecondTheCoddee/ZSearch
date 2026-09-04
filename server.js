const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const { pipeline } = require('@xenova/transformers');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Database and crawl state
const chunkDb = [];
const visitedUrls = new Set();
const crawlQueue = [];
const domainCounts = {}; // Limits pages per domain to force diverse discovery

let embedder = null;

// 50+ Broad, Multi-Domain Seed URLs
const SEED_URLS = [
  // --- General Knowledge & Encyclopedias ---
  'https://en.wikipedia.org/wiki/Main_Page',
  'https://simple.wikipedia.org/wiki/Main_Page',
  'https://curlie.org/',
  'https://www.britannica.com/',
  'https://www.gutenberg.org/',

  // --- Science, Space & Physics ---
  'https://en.wikipedia.org/wiki/Portal:Science',
  'https://en.wikipedia.org/wiki/Solar_System',
  'https://en.wikipedia.org/wiki/Quantum_mechanics',
  'https://www.nasa.gov/',
  'https://www.scientificamerican.com/',
  'https://phys.org/',
  'https://www.space.com/',

  // --- Nature, Animals & Geography ---
  'https://en.wikipedia.org/wiki/Portal:Geography',
  'https://en.wikipedia.org/wiki/Biodiversity',
  'https://en.wikipedia.org/wiki/Amazon_rainforest',
  'https://en.wikipedia.org/wiki/Himalayas',
  'https://www.nationalgeographic.com/',
  'https://www.worldwildlife.org/',

  // --- World History & Civilizations ---
  'https://en.wikipedia.org/wiki/Portal:History',
  'https://en.wikipedia.org/wiki/Ancient_Egypt',
  'https://en.wikipedia.org/wiki/Roman_Empire',
  'https://en.wikipedia.org/wiki/Indus_Valley_Civilisation',
  'https://en.wikipedia.org/wiki/Renaissance',
  'https://en.wikipedia.org/wiki/Industrial_Revolution',

  // --- Food, Cuisine & Cooking ---
  'https://en.wikipedia.org/wiki/Cuisine',
  'https://en.wikipedia.org/wiki/Indian_cuisine',
  'https://en.wikipedia.org/wiki/Italian_cuisine',
  'https://en.wikipedia.org/wiki/Bread',
  'https://www.seriouseats.com/',
  'https://www.allrecipes.com/',

  // --- Arts, Music & Literature ---
  'https://en.wikipedia.org/wiki/Portal:The_arts',
  'https://en.wikipedia.org/wiki/Music_genre',
  'https://en.wikipedia.org/wiki/Painting',
  'https://en.wikipedia.org/wiki/Architecture',
  'https://en.wikipedia.org/wiki/Poetry',
  'https://www.metmuseum.org/',

  // --- Health, Medicine & Biology ---
  'https://en.wikipedia.org/wiki/Human_body',
  'https://en.wikipedia.org/wiki/Nutrition',
  'https://en.wikipedia.org/wiki/Genetics',
  'https://en.wikipedia.org/wiki/Neuroscience',
  'https://www.medicalnewstoday.com/',

  // --- Philosophy & Society ---
  'https://en.wikipedia.org/wiki/Portal:Philosophy',
  'https://en.wikipedia.org/wiki/Ethics',
  'https://en.wikipedia.org/wiki/Sociology',
  'https://plato.stanford.edu/',

  // --- Sports & Athletics ---
  'https://en.wikipedia.org/wiki/Olympic_Games',
  'https://en.wikipedia.org/wiki/Association_football',
  'https://en.wikipedia.org/wiki/Cricket',
  'https://en.wikipedia.org/wiki/Athletics_(sport)',

  // --- Economy & Innovation ---
  'https://en.wikipedia.org/wiki/Economics',
  'https://en.wikipedia.org/wiki/Renewable_energy',
  'https://en.wikipedia.org/wiki/Agriculture',
  'https://theconversation.com/global'
];

function getDomain(rawUrl) {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return null;
  }
}

// Dot product for normalized vector cosine distance
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
  }
  return dotProduct;
}

// Generate normalized vector embedding
async function createEmbedding(text) {
  const output = await embedder(text, {
    pooling: 'mean',
    normalize: true
  });
  return Array.from(output.data);
}

// Break body text into overlapping semantic windows
function splitIntoChunks(text, chunkSize = 400, overlap = 80) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const chunk = text.slice(start, start + chunkSize).trim();
    if (chunk.length > 80) {
      chunks.push(chunk);
    }
    start += chunkSize - overlap;
  }
  return chunks;
}

// Scrape, chunk, and embed
async function scrapeAndIndexFullPage(url) {
  if (visitedUrls.has(url)) return;
  visitedUrls.add(url);

  const domain = getDomain(url);
  if (!domain) return;

  // Max 3 pages per host domain to prevent crawler lock-in
  domainCounts[domain] = (domainCounts[domain] || 0) + 1;
  if (domainCounts[domain] > 3) return;

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      },
      timeout: 7000
    });

    const $ = cheerio.load(response.data);

    // Remove boilerplate markup
    $('script, style, noscript, nav, footer, header, svg, form, iframe, aside').remove();

    const title = $('title').text().trim() || url;

    // Extract clean body text
    const fullBodyText = $('body')
      .text()
      .replace(/\s+/g, ' ')
      .trim();

    if (!fullBodyText || fullBodyText.length < 150) return;

    // Slice page into semantic chunks
    const textChunks = splitIntoChunks(fullBodyText, 400, 80);

    // Generate embeddings for each chunk
    for (const chunk of textChunks) {
      const vector = await createEmbedding(`${title}: ${chunk}`);
      chunkDb.push({
        title,
        link: url,
        chunkText: chunk,
        vector
      });
    }

    console.log(`[INDEXED] [${domain}] ${title} (${textChunks.length} chunks) | Total Chunks: ${chunkDb.length}`);

    // Queue outbound links for deep discovery
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;

      try {
        const absoluteUrl = new URL(href, url).href;
        if (
          absoluteUrl.startsWith('http') &&
          !visitedUrls.has(absoluteUrl) &&
          crawlQueue.length < 250
        ) {
          crawlQueue.push(absoluteUrl);
        }
      } catch {
        // Skip invalid URL formats
      }
    });
  } catch (err) {
    console.error(`Failed to scrape ${url}:`, err.message);
  }
}

// Continuous background crawler loop
async function runCrawler() {
  crawlQueue.push(...SEED_URLS);

  // Set crawl capacity (e.g. up to 100 diverse domains/pages)
  while (crawlQueue.length > 0 && visitedUrls.size < 100) {
    const nextUrl = crawlQueue.shift();
    await scrapeAndIndexFullPage(nextUrl);
    // 1-second delay between requests
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.log(`Crawl cycle completed. Total indexed searchable chunks: ${chunkDb.length}`);
}

// Vector Search API
app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Query parameter q is required' });
  if (!embedder) return res.status(503).json({ error: 'SLM vector model is initializing...' });

  try {
    const queryVector = await createEmbedding(query);

    // Compute similarity across all chunks
    const scoredChunks = chunkDb.map((item) => ({
      title: item.title,
      link: item.link,
      snippet: item.chunkText,
      similarity: cosineSimilarity(queryVector, item.vector)
    }));

    // Sort by descending semantic relevance
    scoredChunks.sort((a, b) => b.similarity - a.similarity);

    // Deduplicate so only the best matching snippet per URL is shown
    const seenLinks = new Set();
    const results = [];

    for (const item of scoredChunks) {
      if (!seenLinks.has(item.link)) {
        seenLinks.add(item.link);
        results.push({
          title: item.title,
          link: item.link,
          snippet: `[Relevance: ${(item.similarity * 100).toFixed(1)}%] ...${item.snippet}...`
        });
      }
      if (results.length >= 10) break;
    }

    res.json(results);
  } catch (err) {
    console.error('Search API error:', err.message);
    res.status(500).json({ error: 'Failed vector search' });
  }
});

// Boot and initialize SLM
app.listen(PORT, async () => {
  console.log(`Search Engine running on port ${PORT}`);
  console.log('Loading Xenova/all-MiniLM-L6-v2 SLM model...');
  embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  console.log('Model ready. Launching multi-topic crawl across 50+ seeds...');
  runCrawler();
});
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
