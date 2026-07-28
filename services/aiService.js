const { GoogleGenAI } = require('@google/genai');

// Use the current Flash-Lite model because this API key cannot use 2.5 models.
// It can still be overridden through GEMINI_MODEL when needed.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const GEMINI_VISION_MODEL =
  process.env.GEMINI_VISION_MODEL || process.env.GEMINI_MODEL || GEMINI_MODEL;
const GEMINI_TTS_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts';
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

function createClient() {
  return new GoogleGenAI({ apiKey: getApiKey() });
}

async function askAI(prompt) {
  const normalizedPrompt = validatePrompt(prompt);

  try {
    const ai = createClient();
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

/**
 * Multimodal request (image / audio) via Gemini Vision / audio understanding.
 * @param {{ prompt: string, mimeType: string, dataBase64: string, model?: string }} options
 */
async function askAIWithMedia(options) {
  const prompt = validatePrompt(options?.prompt);
  const mimeType = options?.mimeType ? String(options.mimeType).trim() : '';
  const dataBase64 = options?.dataBase64 ? String(options.dataBase64).trim() : '';

  if (!mimeType || !dataBase64) {
    throw new AIServiceError('Медіафайл відсутній або пошкоджений.', 'AI_INVALID_MEDIA');
  }

  const model = options.model || GEMINI_VISION_MODEL;

  try {
    const ai = createClient();
    const response = await ai.models.generateContent({
      model,
      contents: [
        { text: prompt },
        {
          inlineData: {
            mimeType,
            data: dataBase64,
          },
        },
      ],
    });

    const text = extractText(response);

    if (!text) {
      console.error('Gemini multimodal returned an empty or invalid response.');
      throw new AIServiceError(CONTROLLED_ERROR_MESSAGE, 'AI_EMPTY_RESPONSE');
    }

    return text;
  } catch (error) {
    if (error instanceof AIServiceError) {
      throw error;
    }

    console.error('Gemini multimodal API error:', error);
    throw new AIServiceError(CONTROLLED_ERROR_MESSAGE);
  }
}

/**
 * Optional TTS via Gemini. Returns audio buffer or null if unavailable.
 * Failures are soft — callers should ignore null.
 */
async function synthesizeSpeech(text, voiceName = 'Kore') {
  const normalized = typeof text === 'string' ? text.trim() : '';
  if (!normalized) {
    return null;
  }

  if (String(process.env.ENABLE_TTS || '').toLowerCase() === 'false') {
    return null;
  }

  // Keep TTS short for Telegram voice limits / API stability.
  const spoken = normalized.slice(0, 800);

  try {
    const ai = createClient();
    const response = await ai.models.generateContent({
      model: GEMINI_TTS_MODEL,
      contents: [{ parts: [{ text: spoken }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });

    const parts = response?.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part?.inlineData?.data) {
        return {
          mimeType: part.inlineData.mimeType || 'audio/wav',
          data: Buffer.from(part.inlineData.data, 'base64'),
        };
      }
    }

    return null;
  } catch (error) {
    console.error('Gemini TTS unavailable or failed:', error.message || error);
    return null;
  }
}

module.exports = {
  askAI,
  askAIWithMedia,
  synthesizeSpeech,
  AIServiceError,
  GEMINI_MODEL,
  GEMINI_VISION_MODEL,
};
