import axios from "axios";

/**
 * Process chat message with LLM
 * @param {Array} messages - Array of message objects with role and content
 * @param {string} provider - LLM provider ('gpt', 'claude', 'gemini')
 * @returns {Promise<string>} LLM response
 */
export const processLLMChat = async (messages, provider = "gemini") => {
  try {
    if (provider === "gemini") {
      return await processWithGemini(messages);
    } else {
      throw new Error(
        `Unsupported LLM provider: ${provider}. Only 'gemini' is supported.`
      );
    }
  } catch (error) {
    console.error("LLM Service Error:", error);
    throw new Error("LLM processing failed");
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
    // Format messages for Gemini
    // Gemini expects { role: "user" | "model", parts: [{ text: "..." }] }
    const formattedContents = messages.map((msg) => {
      let role = "user";
      if (msg.role === "assistant" || msg.role === "system") {
        role = "model";
      }

      return {
        role: role,
        parts: [{ text: msg.content }],
      };
    });

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.GOOGLE_GEMINI_API_KEY}`,
      {
        contents: formattedContents,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (response.data.candidates && response.data.candidates.length > 0) {
      return response.data.candidates[0].content.parts[0].text;
    }

    return mockLLMResponse();
  } catch (error) {
    console.error("Gemini API Error:", error);
    return mockLLMResponse();
  }
};

/**
 * Mock LLM response for development
 */
const mockLLMResponse = () => {
  return "안녕하세요! GPT-4b입니다. 어떻게 도와드릴까요? (This is a mock response. Please configure LLM API keys in .env file)";
};
