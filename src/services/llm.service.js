import axios from 'axios';

/**
 * Process chat message with LLM
 * @param {Array} messages - Array of message objects with role and content
 * @param {string} provider - LLM provider ('gpt', 'claude', 'gemini')
 * @returns {Promise<string>} LLM response
 */
export const processLLMChat = async (messages, provider = 'gpt') => {
  try {
    switch (provider) {
      case 'gpt':
        return await processWithOpenAI(messages);
      case 'claude':
        return await processWithClaude(messages);
      case 'gemini':
        return await processWithGemini(messages);
      default:
        throw new Error(`Unsupported LLM provider: ${provider}`);
    }
  } catch (error) {
    console.error('LLM Service Error:', error);
    throw new Error('LLM processing failed');
  }
};

/**
 * Process with OpenAI GPT
 */
const processWithOpenAI = async (messages) => {
  if (!process.env.OPENAI_API_KEY) {
    return mockLLMResponse();
  }

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4',
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content
        })),
        temperature: 0.7,
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        }
      }
    );

    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('OpenAI API Error:', error);
    return mockLLMResponse();
  }
};

/**
 * Process with Anthropic Claude
 */
const processWithClaude = async (messages) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return mockLLMResponse();
  }

  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-3-opus-20240229',
        max_tokens: 1024,
        messages: messages.map(msg => ({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: msg.content
        })),
      },
      {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        }
      }
    );

    return response.data.content[0].text;
  } catch (error) {
    console.error('Claude API Error:', error);
    return mockLLMResponse();
  }
};

/**
 * Process with Google Gemini
 */
const processWithGemini = async (messages) => {
  if (!process.env.GOOGLE_GEMINI_API_KEY) {
    return mockLLMResponse();
  }

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.GOOGLE_GEMINI_API_KEY}`,
      {
        contents: [{
          parts: messages.map(msg => ({ text: `${msg.role}: ${msg.content}` }))
        }]
      },
      {
        headers: {
          'Content-Type': 'application/json',
        }
      }
    );

    return response.data.candidates[0].content.parts[0].text;
  } catch (error) {
    console.error('Gemini API Error:', error);
    return mockLLMResponse();
  }
};

/**
 * Mock LLM response for development
 */
const mockLLMResponse = () => {
  return "안녕하세요! GPT-4b입니다. 어떻게 도와드릴까요? (This is a mock response. Please configure LLM API keys in .env file)";
};

