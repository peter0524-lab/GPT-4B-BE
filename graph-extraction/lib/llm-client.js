/**
 * LLM 클라이언트 모듈 (graph-extraction용)
 * fact-extraction/lib/llm-client.js 패턴을 따름
 */
import axios from "axios";
import dotenv from "dotenv";
dotenv.config({ path: "../.env" });

const LLM_TIMEOUT_MS = 120000; // 2분 타임아웃

/**
 * LLM에 텍스트 생성 요청 (OpenAI Chat API)
 * @param {string} prompt - 프롬프트
 * @param {Object} options - 옵션
 * @returns {string} 생성된 텍스트
 */
export const generateText = async (prompt, options = {}) => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured in .env file");
  }

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: options.model ?? "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: options.systemPrompt || "You are a helpful assistant.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: options.temperature ?? 0.3,
        max_tokens: options.maxTokens ?? 2000,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        timeout: options.timeout ?? LLM_TIMEOUT_MS,
      }
    );

    if (response.data.choices && response.data.choices.length > 0) {
      return response.data.choices[0].message.content;
    }

    throw new Error("OpenAI API returned no choices");
  } catch (error) {
    if (error.response?.data?.error?.message) {
      throw new Error(`OpenAI API Error: ${error.response.data.error.message}`);
    } else if (error.message) {
      throw new Error(`OpenAI API Error: ${error.message}`);
    } else {
      throw new Error("OpenAI API 호출에 실패했습니다.");
    }
  }
};

/**
 * LLM에 JSON 생성 요청 (파싱 포함)
 * @param {string} prompt - 프롬프트
 * @param {Object} options - 옵션
 * @returns {Object} 파싱된 JSON
 */
export const generateJSON = async (prompt, options = {}) => {
  const text = await generateText(prompt, options);

  // JSON 블록 추출 (```json ... ``` 형태 처리)
  let jsonStr = text;

  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  } else {
    // JSON 배열이나 객체 패턴 찾기
    const objectMatch = text.match(/(\{[\s\S]*\})/);
    const arrayMatch = text.match(/(\[[\s\S]*\])/);

    if (objectMatch) {
      jsonStr = objectMatch[1];
    } else if (arrayMatch) {
      jsonStr = arrayMatch[1];
    }
  }

  // Trailing comma 제거 (JSON에서 허용 안됨)
  jsonStr = jsonStr.replace(/,(\s*[\}\]])/g, '$1');
  
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error("JSON 파싱 실패:", e.message);
    console.error("원본 텍스트 (앞 300자):", text.substring(0, 300));
    
    // 불완전한 JSON 복구 시도
    try {
      // 마지막 완전한 객체까지 자르기
      const lastBrace = jsonStr.lastIndexOf('}');
      if (lastBrace > jsonStr.length / 2) {
        let fixedJson = jsonStr.substring(0, lastBrace + 1);
        fixedJson = fixedJson.replace(/,(\s*[\}\]])/g, '$1');
        
        const openBraces = (fixedJson.match(/\{/g) || []).length;
        const closeBraces = (fixedJson.match(/\}/g) || []).length;
        fixedJson += '}'.repeat(Math.max(0, openBraces - closeBraces));
        
        console.log("JSON 복구 시도 성공");
        return JSON.parse(fixedJson);
      }
    } catch (recoveryError) {
      console.error("JSON 복구 실패:", recoveryError.message);
    }
    
    throw new Error(`JSON 파싱 실패: ${e.message}`);
  }
};

