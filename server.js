const fs = require('fs');
const axios = require('axios');

async function importWikipedia() {
  console.log('1. Loading Xenova/all-MiniLM-L6-v2 SLM model...');
  const { pipeline } = await import('@xenova/transformers');
  const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

  console.log('2. Fetching pre-processed Simple Wikipedia articles from Hugging Face...');
  // Streams a clean sample of Simple Wikipedia records
  const url = 'https://datasets-server.huggingface.co/rows?dataset=Cohere%2Fwikipedia-22-12-simple-en&config=default&split=train&offset=0&limit=100';
  
  const response = await axios.get(url);
  const rows = response.data.rows;

  console.log(`Downloaded ${rows.length} articles. Generating vector index...`);

  const database = [];

  for (let i = 0; i < rows.length; i++) {
    const item = rows[i].row;
    const title = item.title;
    const url = item.url;
    // Extract first 350 characters of the summary
    const text = (item.text || '').replace(/\s+/g, ' ').trim().slice(0, 350);

    if (!text || text.length < 50) continue;

    const output = await embedder(`${title}: ${text}`, {
      pooling: 'mean',
      normalize: true
    });

    database.push({
      title,
      url,
      snippet: text,
      vector: Array.from(output.data)
    });

    if ((i + 1) % 20 === 0) {
      console.log(`Indexed ${i + 1}/${rows.length} pages...`);
    }
  }

  // Save compiled dataset
  fs.writeFileSync('index.json', JSON.stringify(database));
  console.log(`\nSuccessfully created index.json with ${database.length} pre-vectorized articles!`);
}

importWikipedia().catch(console.error);
