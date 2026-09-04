const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

let embedder = null;
let database = [];

// Load pre-compiled vector dataset
const indexPath = path.join(__dirname, 'index.json');
if (fs.existsSync(indexPath)) {
  try {
    database = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    console.log(`Loaded ${database.length} pre-vectorized articles from index.json`);
  } catch (err) {
    console.error('Error parsing index.json:', err.message);
  }
} else {
  console.warn('Warning: index.json not found. Run your indexing script to populate data.');
}

// Normalized vector dot product for fast cosine similarity
function dotProduct(vecA, vecB) {
  let sum = 0;
  for (let i = 0; i < vecA.length; i++) {
    sum += vecA[i] * vecB[i];
  }
  return sum;
}

// Search API Endpoint
app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Query parameter "q" is required' });
  if (!embedder) return res.status(503).json({ error: 'Embedding model is still loading...' });
  if (database.length === 0) return res.status(500).json({ error: 'Database is empty. Check index.json.' });

  try {
    // Generate query vector
    const queryTensor = await embedder(query, {
      pooling: 'mean',
      normalize: true
    });
    const queryVector = Array.from(queryTensor.data);

    // Score query against all stored vectors
    const scored = database.map((item) => ({
      title: item.title,
      link: item.url,
      snippet: item.snippet,
      score: dotProduct(queryVector, item.vector)
    }));

    // Sort descending by highest semantic similarity
    scored.sort((a, b) => b.score - a.score);

    // Return top 10 matches
    const results = scored.slice(0, 10).map((item) => ({
      title: item.title,
      link: item.link,
      snippet: `[Score: ${(item.score * 100).toFixed(1)}%] ${item.snippet}`
    }));

    res.json(results);
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Server Initialization
async function startServer() {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  console.log('Loading Xenova/all-MiniLM-L6-v2 model into memory...');
  const transformers = await import('@xenova/transformers');
  embedder = await transformers.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  console.log('Search engine ready to query!');
}

startServer().catch((err) => {
  console.error('Failed to initialize server:', err);
});
