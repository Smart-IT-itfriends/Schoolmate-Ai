const { GoogleGenAI } = require('@google/genai');

// Use the current Flash-Lite model because this API key cannot use 2.5 models.
// It can still be overridden through GEMINI_MODEL when needed.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const CONTROLLED_ERROR_MESSAGE = 'AI Service тимчасово недоступний. Спробуйте ще раз пізніше.';

class AIServiceError extends Error {
  constructor(message, code = 'AI_SERVICE_ERROR') {
    super(message);
    this.name = 'AIServiceError';
    this.code = code;
  }
}

function validatePrompt(prompt) {
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new AIServiceError('Prompt має бути непорожнім рядком.', 'AI_INVALID_PROMPT');
  }

  return prompt.trim();
}

function getApiKey() {
  const apiKey = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : '';

  if (!apiKey) {
    throw new AIServiceError(
      'GEMINI_API_KEY не налаштовано. Додайте ключ у змінні середовища.',
      'AI_MISSING_API_KEY'
    );
  }

  return apiKey;
}

function extractText(response) {
  if (response && typeof response.text === 'string' && response.text.trim().length > 0) {
    return response.text.trim();
  }

  return null;
}

async function askAI(prompt) {
  const normalizedPrompt = validatePrompt(prompt);
  const apiKey = getApiKey();

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: normalizedPrompt,
    });

    const text = extractText(response);

    if (!text) {
      console.error('Gemini returned an empty or invalid response.');
      throw new AIServiceError(CONTROLLED_ERROR_MESSAGE, 'AI_EMPTY_RESPONSE');
    }

    return text;
  } catch (error) {
    if (error instanceof AIServiceError) {
      throw error;
    }

    console.error('Gemini API error:', error);
    throw new AIServiceError(CONTROLLED_ERROR_MESSAGE);
  }
}

module.exports = {
  askAI,
  AIServiceError,
};
