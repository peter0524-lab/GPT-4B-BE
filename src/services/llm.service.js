import axios from "axios";

/**
 * Process chat message with LLM
 * @param {Array} messages - Array of message objects with role and content
 * @param {string} provider - LLM provider ('gpt', 'claude', 'gemini')
 * @returns {Promise<string>} LLM response
 */
export const processLLMChat = async (messages, provider = "gpt") => {
  try {
    if (provider === "gpt") {
      return await processWithGPT(messages);
    } else if (provider === "gemini") {
      return await processWithGemini(messages);
    } else {
      throw new Error(
        `Unsupported LLM provider: ${provider}. Supported providers: 'gpt', 'gemini'.`
      );
    }
  } catch (error) {
    console.error("LLM Service Error:", error);
    throw new Error("LLM processing failed");
  }
};

/**
 * Process with OpenAI GPT
 */
const processWithGPT = async (messages) => {
  if (!process.env.OPENAI_API_KEY) {
    return mockLLMResponse();
  }

  try {
    // Format messages for OpenAI
    // OpenAI expects { role: "user" | "assistant" | "system", content: "..." }
    const formattedMessages = messages.map((msg) => {
      let role = msg.role;
      // Map "model" role to "assistant" for OpenAI
      if (role === "model") {
        role = "assistant";
      }
      return {
        role: role,
        content: msg.content,
      };
    });

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: formattedMessages,
        temperature: 0.7,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );

    if (response.data.choices && response.data.choices.length > 0) {
      return response.data.choices[0].message.content;
    }

    throw new Error("OpenAI API returned no choices");
  } catch (error) {
    console.error("OpenAI API Error:", error);

    // OpenAI API 에러 메시지 추출
    if (error.response?.data?.error?.message) {
      throw new Error(`OpenAI API Error: ${error.response.data.error.message}`);
    } else if (error.message) {
      throw new Error(`OpenAI API Error: ${error.message}`);
    } else {
      throw new Error("OpenAI API 호출에 실패했습니다. API 키를 확인해주세요.");
    }
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
 * Process persona data for embedding using GPT-4o-mini
 * @param {Object} personaData - Persona data object
 * @param {string} personaData.rank - Rank/Position
 * @param {string} personaData.gender - Gender
 * @param {string} personaData.memo - Primary memo
 * @param {string} personaData.addMemo - Additional memo
 * @returns {Promise<string>} Formatted persona string for embedding
 */
export const processPersonaEmbedding = async (personaData) => {
  const { rank = "", gender = "", memo = "", addMemo = "" } = personaData;

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const PROMPT_PERSONA_EMBEDDING = `[Role]
You are an expert 'Persona Data Structurer' for Vector Embedding.
Your goal is to convert raw profiles of people into a standardized, keyword-dense string format optimized for semantic search and embedding.

[Input Data]
- Rank/Position: ${rank || "정보없음"}
- Gender: ${gender || "정보없음"}
- Memo (Primary): ${memo || "정보없음"}
- Additional Memo: ${addMemo || "정보없음"}

[Processing Rules]
1. **Analyze Content:** Read the input data and identify key characteristics, preferences, or important facts.
2. **Summarize Memos:**
   - Compress the 'Memo' and 'Additional Memo' into concise keywords or short phrases.
   - Remove abstract or filler words (e.g., "I think he likes...", "It seems...").
   - Focus on facts: hobbies, specific constraints, relationships, or strong preferences.
3. **Standardization:**
   - If a field is empty or None, write '정보없음'.
   - Ensure 'Rank' and 'Gender' are standardized (e.g., 'Unknown' -> '정보없음').

[Output Format Rules]
1. **Single Line:** The output must be exactly ONE line of text.
2. **Structure:** Strictly follow this pattern:
   \`[상대방] 직급: {Processed Rank} | 성별: {Processed Gender} | 메모: {Key Info from Memo} | 추가메모: {Key Info from Add_Memo}\`
3. **Language:** The values must be in **KOREAN**.

[Output Example]
[상대방] 직급: 부장 | 성별: 남성 | 메모: 골프_매니아, 허리_디스크_있음 | 추가메모: 매운_음식_못먹음, 50대_초반`;

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are an expert at structuring persona data for vector embeddings. Always respond with exactly one line of text in the specified format.",
          },
          {
            role: "user",
            content: PROMPT_PERSONA_EMBEDDING,
          },
        ],
        temperature: 0.0, // Lower temperature for more consistent formatting
        max_tokens: 200,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );

    if (response.data.choices && response.data.choices.length > 0) {
      const result = response.data.choices[0].message.content.trim();
      return result;
    }

    throw new Error("OpenAI API returned no choices");
  } catch (error) {
    console.error("Persona Embedding API Error:", error);

    if (error.response?.data?.error?.message) {
      throw new Error(`OpenAI API Error: ${error.response.data.error.message}`);
    } else if (error.message) {
      throw new Error(`OpenAI API Error: ${error.message}`);
    } else {
      throw new Error(
        "Persona embedding 처리에 실패했습니다. API 키를 확인해주세요."
      );
    }
  }
};

/**
 * Generate embedding vector using OpenAI Embedding API
 * @param {string} text - Text to embed
 * @param {string} model - Embedding model (default: text-embedding-3-small)
 * @param {number} dimensions - Embedding dimensions (default: 1536)
 * @returns {Promise<Array<number>>} Embedding vector
 */
export const generateEmbedding = async (
  text,
  model = "text-embedding-3-small",
  dimensions = 1536
) => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  if (!text || text.trim() === "") {
    throw new Error("Text cannot be empty");
  }

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/embeddings",
      {
        model: model,
        input: text,
        dimensions: dimensions,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );

    if (response.data && response.data.data && response.data.data.length > 0) {
      return response.data.data[0].embedding;
    }

    throw new Error("OpenAI Embedding API returned no embedding");
  } catch (error) {
    console.error("OpenAI Embedding API Error:", error);

    if (error.response?.data?.error?.message) {
      throw new Error(
        `OpenAI Embedding API Error: ${error.response.data.error.message}`
      );
    } else if (error.message) {
      throw new Error(`OpenAI Embedding API Error: ${error.message}`);
    } else {
      throw new Error("임베딩 생성에 실패했습니다. API 키를 확인해주세요.");
    }
  }
};

/**
 * Rerank gift recommendations using LLM
 * @param {Array} gifts - Array of gift objects with metadata
 * @param {string} personaString - Persona string for context
 * @param {Object} originalData - Original user input data (rank, gender, memo, addMemo)
 * @param {number} topN - Number of top gifts to return (default: 3)
 * @returns {Promise<Array>} Reranked top N gifts
 */
export const rerankGifts = async (
  gifts,
  personaString,
  originalData = {},
  topN = 3
) => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  if (!gifts || gifts.length === 0) {
    return [];
  }

  // If we have 3 or fewer gifts, return them as is
  if (gifts.length <= topN) {
    return gifts;
  }

  try {
    // Format gifts for LLM with detailed information
    const giftsList = gifts
      .map((gift, index) => {
        const metadata = gift.metadata || {};
        const document = gift.document || "";
        const name = metadata.name || metadata.product_name || "이름 없음";
        const category = metadata.category || "카테고리 없음";
        const price = metadata.price || "가격 정보 없음";
        const event = metadata.event || "";
        const vibe = metadata.vibe || "";
        const utility = metadata.utility || "";

        // document나 unified_text에서 상세 정보 추출
        const description = document || metadata.unified_text || "";

        return `[선물 ${index}]
- 이름: ${name}
- 카테고리: ${category}
- 가격: ${price}
- 이벤트: ${event || "없음"}
- 감성/분위기: ${vibe || "없음"}
- 효용/기능: ${utility || "없음"}
- 상세 설명: ${description.substring(0, 200)}${
          description.length > 200 ? "..." : ""
        }`;
      })
      .join("\n\n");

    // 원본 사용자 입력 정보 포맷팅
    const userInputInfo = `
- 직급/직책: ${originalData.rank || "정보없음"}
- 성별: ${originalData.gender || "정보없음"}
- 메모: ${originalData.memo || "정보없음"}
- 추가 정보: ${originalData.addMemo || "정보없음"}`;

    const prompt = `[Role]
당신은 사용자의 선호도와 상황을 정확히 분석하여 가장 적합한 선물을 추천하는 전문가입니다.

[사용자 정보]
${userInputInfo}

[Persona 요약]
${personaString}

[후보 선물 목록]
${giftsList}

[분석 기준]
다음 기준을 종합적으로 고려하여 선물을 재정렬하세요:
1. **관련성**: 사용자의 직급, 성별, 메모, 추가 정보와의 직접적인 관련성
2. **적합성**: 사용자의 관심사, 취향, 상황에 맞는지 여부
3. **실용성**: 실제로 사용할 수 있고 가치 있는 선물인지
4. **다양성**: 너무 비슷한 선물만 추천하지 않고 다양한 옵션 제공
5. **품질**: 선물의 품질과 가격 대비 가치

[주의사항]
- 사용자의 메모나 추가 정보에 명시된 취향, 관심사를 우선적으로 반영하세요
- 직급이나 성별에 부적절한 선물은 낮은 순위로 배치하세요
- 모든 선물이 비슷한 카테고리인 경우, 가장 관련성이 높은 것만 선택하세요
- 사용자 입력 정보가 없거나 "정보없음"인 경우, 일반적으로 적합한 선물을 선택하세요

[출력 형식]
가장 적합한 순서대로 선물 인덱스(0부터 시작)를 JSON 배열로 반환하세요.
형식: [2, 0, 4]
정확히 ${topN}개의 인덱스를 반환하세요.
- 인덱스는 0부터 ${gifts.length - 1} 사이의 정수여야 합니다.
- 중복된 인덱스는 사용하지 마세요.
- 반드시 유효한 JSON 배열 형식으로만 반환하세요.

[예시]
사용자 정보: 직급: 부장, 성별: 남성, 메모: 골프_매니아, 추가정보: 허리_디스크_있음
선물: [0: "골프 클럽", 1: "와인 세트", 2: "골프백", 3: "허리 보호대", 4: "캔들"]
출력: [0, 2, 3] (골프 클럽, 골프백, 허리 보호대 - 골프 취미와 건강 고려)

중요: JSON 배열만 반환하세요. 다른 설명이나 텍스트 없이 순수한 JSON 배열만 반환하세요.
예: [0, 2, 3]`;

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a gift recommendation expert. You must respond with ONLY a valid JSON array of integers (indices), nothing else. Example: [0, 2, 3]. Do not include any explanation, markdown, or other text.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.2, // 낮춰서 더 일관된 결과
        max_tokens: 100, // 짧게 제한하여 배열만 반환하도록
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );

    if (response.data.choices && response.data.choices.length > 0) {
      const result = response.data.choices[0].message.content.trim();

      // Parse JSON array from response
      let rankedIndices;
      try {
        // Remove markdown code blocks if present
        let cleanedResult = result
          .replace(/```json\n?/g, "")
          .replace(/```\n?/g, "")
          .replace(/^\[/, "[")
          .replace(/\]$/, "]")
          .trim();

        // Try to extract array from text if it's not pure JSON
        const arrayMatch = cleanedResult.match(/\[[\d\s,]*\]/);
        if (arrayMatch) {
          cleanedResult = arrayMatch[0];
        }

        rankedIndices = JSON.parse(cleanedResult);
      } catch (parseError) {
        console.error("Failed to parse rerank result:", result);
        console.error("Parse error:", parseError.message);
        // Fallback: return top N by similarity
        return gifts.slice(0, topN);
      }

      // Validate indices
      if (!Array.isArray(rankedIndices)) {
        console.warn("Invalid rerank result (not an array):", rankedIndices);
        return gifts.slice(0, topN);
      }

      if (rankedIndices.length === 0) {
        console.warn(
          "Invalid rerank result (empty array), using similarity order"
        );
        return gifts.slice(0, topN);
      }

      // Convert to integers and filter valid indices
      const validIndices = rankedIndices
        .map((idx) => {
          const numIdx = typeof idx === "string" ? parseInt(idx, 10) : idx;
          return Number.isInteger(numIdx) &&
            numIdx >= 0 &&
            numIdx < gifts.length
            ? numIdx
            : null;
        })
        .filter((idx) => idx !== null)
        .slice(0, topN);

      if (validIndices.length === 0) {
        console.warn("No valid indices from rerank, using similarity order");
        return gifts.slice(0, topN);
      }

      // Remove duplicates while preserving order
      const uniqueIndices = [];
      const seen = new Set();
      for (const idx of validIndices) {
        if (!seen.has(idx)) {
          seen.add(idx);
          uniqueIndices.push(idx);
        }
      }

      if (uniqueIndices.length === 0) {
        console.warn(
          "No unique valid indices from rerank, using similarity order"
        );
        return gifts.slice(0, topN);
      }

      // Return reranked gifts
      return uniqueIndices.map((idx) => gifts[idx]);
    }

    throw new Error("OpenAI API returned no choices");
  } catch (error) {
    console.error("Rerank API Error:", error);

    // Fallback: return top N by similarity if rerank fails
    console.warn("Rerank failed, using similarity order");
    return gifts.slice(0, topN);
  }
};

/**
 * Generate rationale for gift recommendation using RAG reasoning
 * @param {Object} gift - Gift object with metadata and document
 * @param {string} personaString - Persona string
 * @param {Object} originalData - Original user input data
 * @returns {Promise<Object>} Rationale with title and description
 */
export const generateGiftRationale = async (
  gift,
  personaString,
  originalData = {}
) => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  try {
    const metadata = gift.metadata || {};
    const document = gift.document || metadata.unified_text || "";
    const giftName = metadata.name || metadata.product_name || "선물";
    const category = metadata.category || "";
    const vibe = metadata.vibe || "";
    const utility = metadata.utility || "";
    const event = metadata.event || "";

    const userContext = `
- 직급/직책: ${originalData.rank || "정보없음"}
- 성별: ${originalData.gender || "정보없음"}
- 메모: ${originalData.memo || "정보없음"}
- 추가 정보: ${originalData.addMemo || "정보없음"}`;

    const prompt = `[Role]
당신은 선물 추천 시스템의 분석가입니다. 사용자의 특성과 검색된 문서를 기반으로 왜 이 선물이 추천되었는지에 대한 자연스러운 설명을 생성합니다.

[사용자 정보]
${userContext}

[Persona 요약]
${personaString}

[추천 선물 정보]
- 상품명: ${giftName}
- 카테고리: ${category}
- 감성/분위기: ${vibe || "없음"}
- 효용/기능: ${utility || "없음"}
- 이벤트: ${event || "없음"}

[검색된 문서 근거]
${document.substring(0, 500)}${document.length > 500 ? "..." : ""}

[Task]
위 정보를 종합하여 다음을 생성하세요:
1. **제목 (title)**: 사용자의 특성, 관심사, 상황을 나타내는 짧은 키워드 (예: "와인 애호가", "스포츠 매니아", "비즈니스 선물", "특별한 날" 등)
2. **설명 (description)**: 왜 이 선물이 추천되었는지에 대한 자연스러운 설명 (1-2문장)

[출력 형식]
JSON 형식으로 반환하세요:
{
  "title": "제목",
  "description": "설명"
}

[예시 1]
입력: 직급 부장, 성별 남성, 메모 골프_매니아, 선물 골프 클럽
출력: {
  "title": "골프 애호가",
  "description": "평소 골프에 관심이 많으시며, 최신 기술이 적용된 골프 클럽으로 실력을 향상시킬 수 있습니다."
}

[예시 2]
입력: 추가정보 생일, 선물 프리미엄 와인 세트
출력: {
  "title": "특별한 날",
  "description": "생일을 맞이하여 프리미엄 와인 세트가 적합합니다."
}

[예시 3]
입력: 직급 부장, 선물 고급 명함지갑
출력: {
  "title": "비즈니스 선물",
  "description": "거래처 관계자로 고급스러운 선물이 필요합니다."
}

JSON만 반환하세요, 다른 텍스트 없이:`;

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a gift recommendation analyst. Always respond with valid JSON only.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.1,
        max_tokens: 200,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );

    if (response.data.choices && response.data.choices.length > 0) {
      const result = response.data.choices[0].message.content.trim();

      try {
        // Remove markdown code blocks if present
        const cleanedResult = result
          .replace(/```json\n?/g, "")
          .replace(/```\n?/g, "")
          .trim();
        const rationale = JSON.parse(cleanedResult);

        // Validate structure
        if (rationale.title && rationale.description) {
          return {
            title: rationale.title,
            description: rationale.description,
          };
        }
      } catch (parseError) {
        console.error("Failed to parse rationale:", result);
      }
    }

    // Fallback: Generate simple rationale
    const fallbackTitle =
      originalData.addMemo && originalData.addMemo !== "정보없음"
        ? originalData.addMemo.split("_")[0]
        : category || "추천 선물";

    const fallbackDesc = `${personaString}에 맞춰 ${giftName}을(를) 추천드립니다.`;

    return {
      title: fallbackTitle,
      description: fallbackDesc,
    };
  } catch (error) {
    console.error("Rationale generation error:", error);

    // Fallback
    const metadata = gift.metadata || {};
    return {
      title: metadata.category || "추천 선물",
      description: `${personaString}에 맞춰 추천드립니다.`,
    };
  }
};

/**
 * Extract search keywords from persona data for Naver Shopping search
 * @param {Object} personaData - Persona data object
 * @param {string} personaData.rank - Rank/Position
 * @param {string} personaData.gender - Gender
 * @param {string} personaData.memo - Primary memo (interests, hobbies)
 * @param {string} personaData.addMemo - Additional memo (occasion, constraints)
 * @param {string} userQuery - Optional user query for context
 * @returns {Promise<Array<string>>} Array of search keywords for Naver Shopping
 */
export const extractSearchKeywords = async (personaData, userQuery = "") => {
  const { rank = "", gender = "", memo = "", addMemo = "" } = personaData;

  if (!process.env.OPENAI_API_KEY) {
    // API 키가 없으면 기본 키워드 추출 로직 사용
    return extractKeywordsFallback(personaData, userQuery);
  }

  const prompt = `[Role]
당신은 선물 추천을 위한 검색 키워드 전문가입니다.
주어진 정보를 분석하여 네이버 쇼핑에서 검색할 최적의 키워드를 추출합니다.

[입력 정보]
- 사용자 검색어: ${userQuery || "없음"}
- 직급/직책: ${rank || "정보없음"}
- 성별: ${gender || "정보없음"}
- 메모 (관심사/취미): ${memo || "정보없음"}
- 추가 정보 (상황/제약조건): ${addMemo || "정보없음"}

[키워드 추출 규칙]
1. 메모와 추가 정보에서 **구체적인 관심사, 취미, 상황**을 추출하세요.
2. 추상적인 표현은 구체적인 상품 키워드로 변환하세요.
   - "골프를 좋아함" → "골프용품", "골프공", "골프장갑"
   - "와인을 즐김" → "와인세트", "와인잔", "와인오프너"
   - "건강이 안 좋음" → "건강식품", "영양제"
3. 직급과 성별을 고려하여 적절한 선물 카테고리를 추가하세요.
   - 임원급 + 남성 → "고급 선물", "비즈니스 선물"
   - 여성 → "뷰티", "향수" 등 고려
4. 상황(생일, 승진, 감사 등)에 맞는 키워드도 추가하세요.
5. 키워드는 네이버 쇼핑에서 실제로 검색했을 때 좋은 결과가 나오는 형태로 작성하세요.

[출력 형식]
JSON 배열로 3-5개의 검색 키워드를 반환하세요.
예시: ["골프용품 선물", "프리미엄 와인세트", "건강식품"]

중요: JSON 배열만 반환하세요. 다른 설명 없이 순수한 JSON 배열만 반환하세요.`;

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a search keyword extraction expert. Always respond with ONLY a valid JSON array of Korean search keywords. No explanation, no markdown.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 150,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );

    if (response.data.choices && response.data.choices.length > 0) {
      const result = response.data.choices[0].message.content.trim();

      try {
        // JSON 파싱 시도
        let cleanedResult = result
          .replace(/```json\n?/g, "")
          .replace(/```\n?/g, "")
          .trim();

        const arrayMatch = cleanedResult.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          cleanedResult = arrayMatch[0];
        }

        const keywords = JSON.parse(cleanedResult);

        if (Array.isArray(keywords) && keywords.length > 0) {
          return keywords.filter(
            (k) => typeof k === "string" && k.trim() !== ""
          );
        }
      } catch (parseError) {
        console.error("Keyword extraction parse error:", parseError.message);
      }
    }

    // 파싱 실패 시 폴백
    return extractKeywordsFallback(personaData, userQuery);
  } catch (error) {
    console.error("Keyword extraction API error:", error.message);
    return extractKeywordsFallback(personaData, userQuery);
  }
};

/**
 * Fallback keyword extraction without LLM
 * @param {Object} personaData - Persona data
 * @param {string} userQuery - User query
 * @returns {Array<string>} Keywords array
 */
const extractKeywordsFallback = (personaData, userQuery = "") => {
  const { memo = "", addMemo = "" } = personaData;
  const keywords = [];

  // 사용자 쿼리가 있으면 추가
  if (userQuery && userQuery.trim()) {
    keywords.push(userQuery.trim());
  }

  // 메모에서 키워드 추출
  if (memo && memo.trim()) {
    // "~를 좋아함", "~를 즐김" 등의 패턴에서 키워드 추출
    const cleaned = memo
      .replace(/를?\s*(좋아함|좋아해|즐김|즐겨|좋아하|관심)/g, "")
      .replace(/이?\s*(있음|있어|없음|없어)/g, "")
      .trim();

    if (cleaned) {
      keywords.push(`${cleaned} 선물`);
    }
  }

  // 추가 정보에서 상황 키워드 추출
  if (addMemo && addMemo.trim()) {
    const occasions = ["생일", "승진", "감사", "결혼", "출산", "졸업", "취업"];
    for (const occasion of occasions) {
      if (addMemo.includes(occasion)) {
        keywords.push(`${occasion} 선물`);
        break;
      }
    }
  }

  // 키워드가 없으면 기본값
  if (keywords.length === 0) {
    keywords.push("선물 추천");
  }

  return keywords;
};

/**
 * Mock LLM response for development
 */
const mockLLMResponse = () => {
  return "안녕하세요! GPT-4b입니다. 어떻게 도와드릴까요? (This is a mock response. Please configure LLM API keys in .env file)";
};
