const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Database and crawl state
const chunkDb = [];
const visitedUrls = new Set();
const crawlQueue = [];
const domainCounts = {};

let embedder = null;

// 50+ Broad, Multi-Domain Seed URLs
const SEED_URLS = [
  'https://en.wikipedia.org/wiki/Main_Page',
  'https://simple.wikipedia.org/wiki/Main_Page',
  'https://curlie.org/',
  'https://www.britannica.com/',
  'https://www.gutenberg.org/',
  'https://en.wikipedia.org/wiki/Portal:Science',
  'https://en.wikipedia.org/wiki/Solar_System',
  'https://en.wikipedia.org/wiki/Quantum_mechanics',
  'https://www.nasa.gov/',
  'https://www.scientificamerican.com/',
  'https://phys.org/',
  'https://www.space.com/',
  'https://en.wikipedia.org/wiki/Portal:Geography',
  'https://en.wikipedia.org/wiki/Biodiversity',
  'https://en.wikipedia.org/wiki/Amazon_rainforest',
  'https://en.wikipedia.org/wiki/Himalayas',
  'https://www.nationalgeographic.com/',
  'https://www.worldwildlife.org/',
  'https://en.wikipedia.org/wiki/Portal:History',
  'https://en.wikipedia.org/wiki/Ancient_Egypt',
  'https://en.wikipedia.org/wiki/Roman_Empire',
  'https://en.wikipedia.org/wiki/Indus_Valley_Civilisation',
  'https://en.wikipedia.org/wiki/Renaissance',
  'https://en.wikipedia.org/wiki/Industrial_Revolution',
  'https://en.wikipedia.org/wiki/Cuisine',
  'https://en.wikipedia.org/wiki/Indian_cuisine',
  'https://en.wikipedia.org/wiki/Italian_cuisine',
  'https://en.wikipedia.org/wiki/Bread',
  'https://www.seriouseats.com/',
  'https://www.allrecipes.com/',
  'https://en.wikipedia.org/wiki/Portal:The_arts',
  'https://en.wikipedia.org/wiki/Music_genre',
  'https://en.wikipedia.org/wiki/Painting',
  'https://en.wikipedia.org/wiki/Architecture',
  'https://en.wikipedia.org/wiki/Poetry',
  'https://www.metmuseum.org/',
  'https://en.wikipedia.org/wiki/Human_body',
  'https://en.wikipedia.org/wiki/Nutrition',
  'https://en.wikipedia.org/wiki/Genetics',
  'https://en.wikipedia.org/wiki/Neuroscience',
  'https://www.medicalnewstoday.com/',
  'https://en.wikipedia.org/wiki/Portal:Philosophy',
  'https://en.wikipedia.org/wiki/Ethics',
  'https://en.wikipedia.org/wiki/Sociology',
  'https://plato.stanford.edu/',
  'https://en.wikipedia.org/wiki/Olympic_Games',
  'https://en.wikipedia.org/wiki/Association_football',
  'https://en.wikipedia.org/wiki/Cricket',
  'https://en.wikipedia.org/wiki/Athletics_(sport)',
  'https://en.wikipedia.org/wiki/Economics',
  'https://en.wikipedia.org/wiki/Renewable_energy',
  'https://en.wikipedia.org/wiki/Agriculture',
  'https://theconversation.com/global'
];

function getDomain(rawUrl) {
  try {
    return new URL(rawUrl).hostname;
  } catch (e) {
    return null;
  }
}

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
  }
  return dotProduct;
}

async function createEmbedding(text) {
  if (!embedder) return [];
  const output = await embedder(text, {
    pooling: 'mean',
    normalize: true
  });
  return Array.from(output.data);
}

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

async function scrapeAndIndexFullPage(url) {
  if (visitedUrls.has(url)) return;
  visitedUrls.add(url);

  const domain = getDomain(url);
  if (!domain) return;

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
    $('script, style, noscript, nav, footer, header, svg, form, iframe, aside').remove();

    const title = $('title').text().trim() || url;
    const fullBodyText = $('body')
      .text()
      .replace(/\s+/g, ' ')
      .trim();

    if (!fullBodyText || fullBodyText.length < 150) return;

    const textChunks = splitIntoChunks(fullBodyText, 400, 80);

    for (let i = 0; i < textChunks.length; i++) {
      const chunk = textChunks[i];
      const vector = await createEmbedding(title + ': ' + chunk);
      chunkDb.push({
        title: title,
        link: url,
        chunkText: chunk,
        vector: vector
      });
    }

    console.log('[INDEXED] [' + domain + '] ' + title + ' (' + textChunks.length + ' chunks)');

    $('a[href]').each(function () {
      const href = $(this).attr('href');
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
      } catch (e) {
        // Ignore invalid URLs
      }
    });
  } catch (err) {
    console.error('Failed to scrape ' + url + ':', err.message);
  }
}

async function runCrawler() {
  crawlQueue.push(...SEED_URLS);

  while (crawlQueue.length > 0 && visitedUrls.size < 100) {
    const nextUrl = crawlQueue.shift();
    await scrapeAndIndexFullPage(nextUrl);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.log('Crawl cycle finished. Total indexed chunks: ' + chunkDb.length);
}

app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Query parameter q is required' });
  if (!embedder) return res.status(503).json({ error: 'SLM vector model is initializing...' });

  try {
    const queryVector = await createEmbedding(query);

    const scoredChunks = chunkDb.map((item) => ({
      title: item.title,
      link: item.link,
      snippet: item.chunkText,
      similarity: cosineSimilarity(queryVector, item.vector)
    }));

    scoredChunks.sort((a, b) => b.similarity - a.similarity);

    const seenLinks = new Set();
    const results = [];

    for (let i = 0; i < scoredChunks.length; i++) {
      const item = scoredChunks[i];
      if (!seenLinks.has(item.link)) {
        seenLinks.add(item.link);
        results.push({
          title: item.title,
          link: item.link,
          snippet: '[Relevance: ' + (item.similarity * 100).toFixed(1) + '%] ...' + item.snippet + '...'
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

// Clean async startup function to avoid CommonJS top-level await syntax errors
async function startServer() {
  app.listen(PORT, () => {
    console.log('Search Engine running on port ' + PORT);
  });

  console.log('Loading Transformers pipeline dynamically...');
  // Dynamic import works uniformly across CommonJS & ESM in modern Node
  const transformers = await import('@xenova/transformers');
  embedder = await transformers.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  console.log('SLM model loaded. Starting multi-topic crawler...');

  runCrawler();
}

startServer().catch((err) => {
  console.error('Startup failure:', err);
});
