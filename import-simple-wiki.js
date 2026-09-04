const fs = require('fs');
const axios = require('axios');

// Curated list of high-value topics spanning science, history, nature, culture & food
const TOPICS = [
  'Earth', 'Sun', 'Moon', 'Solar_System', 'Mars', 'Milky_Way', 'Black_hole',
  'Albert_Einstein', 'Isaac_Newton', 'Charles_Darwin', 'Galileo_Galilei',
  'Ancient_Egypt', 'Roman_Empire', 'Renaissance', 'Industrial_Revolution', 'World_War_II',
  'Human_body', 'Brain', 'Heart', 'DNA', 'Immune_system', 'Virus',
  'Water', 'Atmosphere_of_Earth', 'Climate_change', 'Photosynthesis', 'Ocean',
  'Mammal', 'Bird', 'Dinosaur', 'Blue_whale', 'Lion', 'Honey_bee',
  'Agriculture', 'Bread', 'Rice', 'Tea', 'Chocolate', 'Apple',
  'Music', 'Painting', 'Cinema', 'Theatre', 'Poetry', 'Sculpture',
  'Internet', 'Computer', 'Telephone', 'Electricity', 'Automobile', 'Aeroplane',
  'Philosophy', 'Democracy', 'Economics', 'Olympic_Games', 'Football', 'Chess'
];

async function buildWikipediaIndex() {
  console.log('1. Loading Xenova/all-MiniLM-L6-v2 SLM model...');
  const { pipeline } = await import('@xenova/transformers');
  const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

  console.log(`2. Fetching ${TOPICS.length} articles from Wikimedia REST API...`);
  const database = [];

  for (let i = 0; i < TOPICS.length; i++) {
    const topic = TOPICS[i];
    try {
      // Official, open Wikimedia REST summary endpoint (no key required)
      const res = await axios.get(`https://simple.wikipedia.org/api/rest_v1/page/summary/${topic}`, {
        headers: {
          'User-Agent': 'MiniSearchEngine/1.0 (educational-project)'
        },
        timeout: 5000
      });

      const title = res.data.title;
      const url = res.data.content_urls.desktop.page;
      const snippet = res.data.extract;

      if (!snippet) continue;

      // Generate 384-d semantic embedding
      const output = await embedder(`${title}: ${snippet}`, {
        pooling: 'mean',
        normalize: true
      });

      database.push({
        title,
        url,
        snippet,
        vector: Array.from(output.data)
      });

      console.log(`[${i + 1}/${TOPICS.length}] Indexed: ${title}`);
    } catch (err) {
      console.error(`Skipped ${topic}:`, err.message);
    }
  }

  // Save the pre-computed embeddings
  fs.writeFileSync('index.json', JSON.stringify(database, null, 2));
  console.log(`\nSuccess! Created index.json with ${database.length} vectorized articles.`);
}

buildWikipediaIndex().catch(console.error);
