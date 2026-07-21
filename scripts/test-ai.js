require('dotenv').config();

const { askAI } = require('../services/aiService');

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.log('GEMINI_API_KEY is not set. Skipping real AI Service check.');
    return;
  }

  const result = await askAI('Відповідай одним словом: працює');
  console.log(result);
}

main().catch((error) => {
  console.error('AI Service check failed:', error.message);
  process.exitCode = 1;
});
