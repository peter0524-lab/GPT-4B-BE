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

  const PROMPT_PERSONA_EMBEDDING = `[역할]
당신은 비즈니스 관계에서 만난 사람들의 특성을 이야기 형식으로 정리하는 전문가입니다.
거래처, 동료, 상사 등 업무 관계에서 알게 된 사람의 정보를 자연스러운 서술형 문장으로 변환하여, 
나중에 그 사람에게 어울리는 선물을 찾을 때 도움이 되도록 합니다.

[입력 데이터]
- 직급/직위: ${rank || "정보없음"}
- 성별: ${gender || "정보없음"}
- 메모 (주요): ${memo || "정보없음"}
- 추가 메모: ${addMemo || "정보없음"}

[처리 규칙]
1. **이야기 형식 작성:** 입력 데이터를 바탕으로 그 사람을 소개하는 자연스러운 문장을 만듭니다.
2. **핵심 정보 포함:**
   - 직급과 성별은 자연스럽게 문장에 녹여냅니다.
   - **'메모'와 '추가 메모'를 동일하게 중요하게 다룹니다.** 둘 다 그 사람의 취미, 관심사, 선호도, 건강 상태, 특별한 사항 등을 담고 있습니다.
   - 추상적이거나 불확실한 표현("~인 것 같다", "~처럼 보인다")은 제거하고 구체적인 사실만 포함합니다.
   - 메모와 추가 메모의 모든 내용을 빠짐없이 이야기에 포함시킵니다.
3. **자연스러운 서술:**
   - 키워드를 나열하는 것이 아니라 문장으로 연결합니다.
   - 예: "골프를 즐기며, 허리 디스크가 있어 건강에 신경 쓰시는 분입니다"
4. **표준화:**
   - 정보가 없는 경우 "정보가 없습니다" 또는 자연스럽게 생략합니다.

[출력 형식]
- 2-3개의 자연스러운 한국어 문장으로 작성합니다.
- 비즈니스 관계에서의 인물 소개 형식을 유지합니다.
- 모든 내용은 **한국어**로 작성합니다.

[출력 예시 1]
입력: 직급: 부장, 성별: 남성, 메모: 골프_매니아, 허리_디스크_있음, 추가메모: 매운_음식_못먹음, 50대_초반
출력: 이 분은 부장급 남성으로 50대 초반입니다. 골프를 매우 좋아하시지만 허리 디스크가 있어 건강 관리에 신경 쓰고 계십니다. 매운 음식은 드시지 못합니다.

[출력 예시 2]
입력: 직급: 정보없음, 성별: 정보없음, 메모: 축구, 추가메모: 야구
출력: 이 분은 축구를 좋아하고 야구에도 관심이 많은 스포츠 애호가입니다.

[출력 예시 3]
입력: 직급: 과장, 성별: 여성, 메모: 와인_애호가, 추가메모: 요가_수강중
출력: 이 분은 과장급 여성으로 와인에 관심이 많은 분입니다. 건강을 위해 요가를 꾸준히 수강하고 계십니다.`;

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "당신은 비즈니스 인물 정보를 자연스러운 이야기 형식으로 작성하는 전문가입니다. 항상 2-3개의 자연스러운 한국어 문장으로 응답하세요.",
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
    // 모든 선물 후보 로그 출력
    console.log(
      `\n   📦 [리랭킹 전] 선물 후보 전체 목록 (총 ${gifts.length}개):`
    );
    gifts.forEach((gift, index) => {
      const metadata = gift.metadata || {};
      const document = gift.document || "";
      const name = metadata.name || metadata.product_name || "이름 없음";
      const category = metadata.category || "카테고리 없음";
      const price = metadata.price || "가격 정보 없음";
      const brand = metadata.brand || "브랜드 없음";
      const event = metadata.event || "";
      const vibe = metadata.vibe || "";
      const utility = metadata.utility || "";
      const source = gift.source || "unknown";
      const similarity = gift.similarity || "N/A";
      const description = document || metadata.unified_text || "";

      console.log(`\n   ${index}. [${source}] ${name}`);
      console.log(`      ID: ${gift.id || "없음"}`);
      console.log(`      카테고리: ${category}`);
      console.log(`      가격: ${price}`);
      console.log(`      브랜드: ${brand}`);
      if (event) console.log(`      이벤트: ${event}`);
      if (vibe) console.log(`      감성/분위기: ${vibe}`);
      if (utility) console.log(`      효용/기능: ${utility}`);
      if (similarity !== "N/A") console.log(`      유사도: ${similarity}`);
      if (description) {
        const descPreview =
          description.length > 150
            ? description.substring(0, 150) + "..."
            : description;
        console.log(`      설명: ${descPreview}`);
      }
      if (metadata.url || metadata.link) {
        console.log(`      URL: ${metadata.url || metadata.link}`);
      }
    });
    console.log(`\n   ========================================\n`);

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
당신은 비즈니스 상황에서 거래처, 동료, 상사 등에게 줄 선물을 추천하는 전문가입니다.
사용자의 선호도와 상황을 정확히 분석하여 비즈니스 관계에 가장 적합한 선물을 추천하세요.

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
3. **비즈니스 적절성**: 업무 관계에서 주고받기에 적합하고 예의를 갖춘 선물인지
4. **실용성**: 실제로 사용할 수 있고 가치 있는 선물인지
5. **다양성**: 너무 비슷한 선물만 추천하지 않고 다양한 옵션 제공
6. **품질**: 선물의 품질과 가격 대비 가치

[주의사항]
- **메모와 추가 정보를 동등하게 중요하게 취급하세요.** 둘 다 사용자의 관심사와 취향을 나타냅니다.
- **중요: 메모와 추가 정보가 둘 다 있고 "정보없음"이 아닌 경우, 각각 최소 1개씩은 반드시 포함해야 합니다.**
  - 예: 메모에 "축구", 추가 정보에 "야구"가 있으면 → 최소 축구 관련 선물 1개, 야구 관련 선물 1개 포함 필수
  - 예: 메모에 "골프", 추가 정보에 "허리보호대"가 있으면 → 최소 골프 관련 선물 1개, 허리보호대 관련 선물 1개 포함 필수
- 사용자의 메모와 추가 정보에 명시된 모든 취향, 관심사를 우선적으로 반영하세요
- 직급이나 성별에 부적절한 선물은 낮은 순위로 배치하세요
- 모든 선물이 비슷한 카테고리인 경우, 메모와 추가 정보 모두에 관련성이 높은 선물을 우선 선택하세요
- 사용자 입력 정보가 없거나 "정보없음"인 경우, 일반적으로 적합한 선물을 선택하세요

[출력 형식]
가장 적합한 순서대로 선물 인덱스(0부터 시작)를 JSON 배열로 반환하세요.
형식: [2, 0, 4]
정확히 ${topN}개의 인덱스를 반환하세요.
- 인덱스는 0부터 ${gifts.length - 1} 사이의 정수여야 합니다.
- 중복된 인덱스는 사용하지 마세요.
- 같은 상품(이름이 같거나 유사한 상품)은 중복 선택하지 마세요.
- 반드시 유효한 JSON 배열 형식으로만 반환하세요.

[예시 1]
사용자 정보: 직급: 부장, 성별: 남성, 메모: 골프_매니아, 추가정보: 허리_디스크_있음
선물: [0: "골프 클럽", 1: "와인 세트", 2: "골프백", 3: "허리 보호대", 4: "캔들"]
출력: [0, 2, 3] (골프 클럽, 골프백, 허리 보호대 - 골프 취미와 건강 고려)

[예시 2]
사용자 정보: 메모: 축구, 추가정보: 야구
선물: [0: "축구공", 1: "야구장갑", 2: "축구화", 3: "야구배트", 4: "캔들"]
출력: [0, 1, 2] 또는 [1, 0, 3] (메모와 추가정보 모두 반영하여 축구 관련 선물 최소 1개, 야구 관련 선물 최소 1개 포함 필수)
  - ✅ 올바른 예: [0, 1, 4] (축구공=메모 관련, 야구장갑=추가정보 관련 포함)
  - ❌ 잘못된 예: [0, 2, 4] (축구 관련만 있고 야구 관련 없음)

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
        temperature: 0.0, // 낮춰서 더 일관된 결과
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

      // 메모와 추가 메모 키워드가 각각 최소 1개씩 포함되도록 강제 보장
      const memo = (originalData.memo || "").trim();
      const addMemo = (originalData.addMemo || "").trim();

      // 메모와 추가 메모가 둘 다 있고 "정보없음"이 아닐 때만 검증
      if (memo && addMemo && memo !== "정보없음" && addMemo !== "정보없음") {
        console.log(
          `   🔍 메모("${memo}")와 추가 메모("${addMemo}") 각각 최소 1개씩 포함 검증 중...`
        );

        // 키워드 추출
        const memoKeywords = memo
          .split(/[,，\s]+/)
          .map((k) => k.trim())
          .filter((k) => k && k.length > 0);
        const addMemoKeywords = addMemo
          .split(/[,，\s]+/)
          .map((k) => k.trim())
          .filter((k) => k && k.length > 0);

        // 모든 선물을 분석하여 메모/추가메모 관련 여부 분류
        const memoRelatedGifts = []; // 메모 키워드와 관련된 선물 인덱스
        const addMemoRelatedGifts = []; // 추가 메모 키워드와 관련된 선물 인덱스
        const otherGifts = []; // 둘 다 아닌 선물 인덱스

        for (let i = 0; i < gifts.length; i++) {
          const gift = gifts[i];
          const metadata = gift.metadata || {};
          const name = metadata.name || metadata.product_name || "";
          const category = metadata.category || "";
          const document = gift.document || metadata.unified_text || "";
          const searchText = `${name} ${category} ${document}`.toLowerCase();

          // 메모 키워드 확인
          const isMemoRelated = memoKeywords.some(
            (keyword) =>
              keyword.length > 0 && searchText.includes(keyword.toLowerCase())
          );

          // 추가 메모 키워드 확인
          const isAddMemoRelated = addMemoKeywords.some(
            (keyword) =>
              keyword.length > 0 && searchText.includes(keyword.toLowerCase())
          );

          if (isMemoRelated && isAddMemoRelated) {
            // 둘 다 관련 있으면 메모 쪽으로 분류 (추가 메모는 별도로 보장)
            memoRelatedGifts.push(i);
            addMemoRelatedGifts.push(i);
          } else if (isMemoRelated) {
            memoRelatedGifts.push(i);
          } else if (isAddMemoRelated) {
            addMemoRelatedGifts.push(i);
          } else {
            otherGifts.push(i);
          }
        }

        console.log(
          `   📊 분석 결과: 메모 관련 ${memoRelatedGifts.length}개, 추가 메모 관련 ${addMemoRelatedGifts.length}개, 기타 ${otherGifts.length}개`
        );

        // 현재 리랭킹된 선물들을 분류
        const currentMemoCount = uniqueIndices.filter((idx) =>
          memoRelatedGifts.includes(idx)
        ).length;
        const currentAddMemoCount = uniqueIndices.filter((idx) =>
          addMemoRelatedGifts.includes(idx)
        ).length;

        console.log(
          `   📋 현재 리랭킹 결과: 메모 관련 ${currentMemoCount}개, 추가 메모 관련 ${currentAddMemoCount}개`
        );

        // 재구성: 각각 최소 1개씩 포함되도록 강제
        const finalIndices = [];

        // 1. 메모 관련 선물이 없으면 추가
        if (currentMemoCount === 0 && memoRelatedGifts.length > 0) {
          // 현재 리랭킹 결과에 없는 메모 관련 선물 중 가장 좋은 것을 추가
          const availableMemoGifts = memoRelatedGifts.filter(
            (idx) => !uniqueIndices.includes(idx)
          );
          if (availableMemoGifts.length > 0) {
            finalIndices.push(availableMemoGifts[0]);
            console.log(
              `   ✅ 메모 관련 선물 추가: 인덱스 ${availableMemoGifts[0]}`
            );
          } else {
            // 이미 포함된 것 중 메모 관련 선물 사용
            finalIndices.push(memoRelatedGifts[0]);
            console.log(
              `   ✅ 메모 관련 선물 사용: 인덱스 ${memoRelatedGifts[0]}`
            );
          }
        }

        // 2. 추가 메모 관련 선물이 없으면 추가
        if (currentAddMemoCount === 0 && addMemoRelatedGifts.length > 0) {
          // 현재 리랭킹 결과에 없는 추가 메모 관련 선물 중 가장 좋은 것을 추가
          const availableAddMemoGifts = addMemoRelatedGifts.filter(
            (idx) => !finalIndices.includes(idx) && !uniqueIndices.includes(idx)
          );
          if (availableAddMemoGifts.length > 0) {
            finalIndices.push(availableAddMemoGifts[0]);
            console.log(
              `   ✅ 추가 메모 관련 선물 추가: 인덱스 ${availableAddMemoGifts[0]}`
            );
          } else {
            // 이미 포함된 것 중 추가 메모 관련 선물 사용
            const existingAddMemoGifts = addMemoRelatedGifts.filter((idx) =>
              uniqueIndices.includes(idx)
            );
            if (existingAddMemoGifts.length > 0) {
              finalIndices.push(existingAddMemoGifts[0]);
              console.log(
                `   ✅ 추가 메모 관련 선물 사용: 인덱스 ${existingAddMemoGifts[0]}`
              );
            }
          }
        }

        // 3. 나머지는 기존 리랭킹 결과에서 가져오되, 각각 최소 1개씩 포함되도록 조정
        // 먼저 현재 리랭킹 결과에서 메모/추가메모 각각 최소 1개씩 포함된 것들만 선별
        const remainingIndices = [];

        // 메모 관련 선물 중 현재 리랭킹 결과에 포함된 것
        const rankedMemoGifts = uniqueIndices.filter(
          (idx) => memoRelatedGifts.includes(idx) && !finalIndices.includes(idx)
        );
        // 추가 메모 관련 선물 중 현재 리랭킹 결과에 포함된 것 (메모와 중복 제외)
        const rankedAddMemoGifts = uniqueIndices.filter(
          (idx) =>
            addMemoRelatedGifts.includes(idx) &&
            !memoRelatedGifts.includes(idx) &&
            !finalIndices.includes(idx)
        );
        // 둘 다 아닌 선물
        const rankedOtherGifts = uniqueIndices.filter(
          (idx) =>
            !memoRelatedGifts.includes(idx) &&
            !addMemoRelatedGifts.includes(idx) &&
            !finalIndices.includes(idx)
        );

        // 최소 1개씩 포함되도록 추가
        if (
          finalIndices.filter((idx) => memoRelatedGifts.includes(idx))
            .length === 0 &&
          rankedMemoGifts.length > 0
        ) {
          finalIndices.push(rankedMemoGifts[0]);
        }
        if (
          finalIndices.filter((idx) => addMemoRelatedGifts.includes(idx))
            .length === 0 &&
          rankedAddMemoGifts.length > 0
        ) {
          finalIndices.push(rankedAddMemoGifts[0]);
        }

        // 나머지 슬롯 채우기 (기존 리랭킹 결과 우선)
        const remainingSlots = topN - finalIndices.length;
        const candidates = [
          ...rankedMemoGifts.slice(1), // 이미 1개 포함했으므로 나머지
          ...rankedAddMemoGifts.slice(1), // 이미 1개 포함했으므로 나머지
          ...rankedOtherGifts,
        ].filter((idx) => !finalIndices.includes(idx));

        finalIndices.push(...candidates.slice(0, remainingSlots));

        console.log(
          `   ✅ 최종 재구성: ${finalIndices.length}개 (메모 관련: ${
            finalIndices.filter((idx) => memoRelatedGifts.includes(idx)).length
          }개, 추가 메모 관련: ${
            finalIndices.filter((idx) => addMemoRelatedGifts.includes(idx))
              .length
          }개)`
        );

        // 상품 ID 및 이름 기준 중복 제거 (같은 상품이 2개 이상 선택되지 않도록)
        const finalGifts = [];
        const seenProductIds = new Set();
        const seenProductNames = new Set();
        const duplicateProductIds = [];
        const duplicateProductNames = [];

        for (const idx of finalIndices.slice(0, topN)) {
          const gift = gifts[idx];
          const productId =
            gift.id || gift.metadata?.productId || gift.metadata?.id;
          const productName = (
            gift.metadata?.name ||
            gift.metadata?.product_name ||
            gift.name ||
            ""
          )
            .trim()
            .toLowerCase();

          let isDuplicate = false;

          // 상품 ID로 중복 체크
          if (productId) {
            if (seenProductIds.has(productId)) {
              duplicateProductIds.push({
                idx,
                productId,
                name: gift.metadata?.name || gift.name || "이름 없음",
              });
              isDuplicate = true;
            } else {
              seenProductIds.add(productId);
            }
          }

          // 상품 이름으로 중복 체크 (ID가 없거나 ID로 체크되지 않은 경우)
          if (!isDuplicate && productName) {
            if (seenProductNames.has(productName)) {
              duplicateProductNames.push({
                idx,
                name: gift.metadata?.name || gift.name || "이름 없음",
              });
              isDuplicate = true;
            } else {
              seenProductNames.add(productName);
            }
          }

          if (!isDuplicate) {
            finalGifts.push(gift);
          }
        }

        if (
          duplicateProductIds.length > 0 ||
          duplicateProductNames.length > 0
        ) {
          console.log(`   ⚠️  중복된 상품 제거:`);
          duplicateProductIds.forEach((dup) => {
            console.log(
              `      - 인덱스 ${dup.idx}: ${dup.name} (ID 중복: ${dup.productId})`
            );
          });
          duplicateProductNames.forEach((dup) => {
            console.log(`      - 인덱스 ${dup.idx}: ${dup.name} (이름 중복)`);
          });
        }

        return finalGifts;
      }

      // 상품 ID 및 이름 기준 중복 제거 (같은 상품이 2개 이상 선택되지 않도록)
      const finalGifts = [];
      const seenProductIds = new Set();
      const seenProductNames = new Set();
      const duplicateProductIds = [];
      const duplicateProductNames = [];

      for (const idx of uniqueIndices) {
        const gift = gifts[idx];
        const productId =
          gift.id || gift.metadata?.productId || gift.metadata?.id;
        const productName = (
          gift.metadata?.name ||
          gift.metadata?.product_name ||
          gift.name ||
          ""
        )
          .trim()
          .toLowerCase();

        let isDuplicate = false;

        // 상품 ID로 중복 체크
        if (productId) {
          if (seenProductIds.has(productId)) {
            duplicateProductIds.push({
              idx,
              productId,
              name: gift.metadata?.name || gift.name || "이름 없음",
            });
            isDuplicate = true;
          } else {
            seenProductIds.add(productId);
          }
        }

        // 상품 이름으로 중복 체크 (ID가 없거나 ID로 체크되지 않은 경우)
        if (!isDuplicate && productName) {
          if (seenProductNames.has(productName)) {
            duplicateProductNames.push({
              idx,
              name: gift.metadata?.name || gift.name || "이름 없음",
            });
            isDuplicate = true;
          } else {
            seenProductNames.add(productName);
          }
        }

        if (!isDuplicate) {
          finalGifts.push(gift);
        }
      }

      if (duplicateProductIds.length > 0 || duplicateProductNames.length > 0) {
        console.log(`   ⚠️  중복된 상품 제거:`);
        duplicateProductIds.forEach((dup) => {
          console.log(
            `      - 인덱스 ${dup.idx}: ${dup.name} (ID 중복: ${dup.productId})`
          );
        });
        duplicateProductNames.forEach((dup) => {
          console.log(`      - 인덱스 ${dup.idx}: ${dup.name} (이름 중복)`);
        });
      }

      return finalGifts;
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
   - **중요**: "~~에게", "~~님에게", "~~을/를 좋아하는 ~~에게" 같은 사용자 지칭 표현을 사용하지 마세요.
   - 선물의 특징, 장점, 적합한 이유만 직접적으로 설명하세요.

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
  "description": "최신 기술이 적용된 골프 클럽으로 실력을 향상시킬 수 있습니다."
}
❌ 잘못된 예: "골프를 좋아하는 분에게 최신 기술이 적용된 골프 클럽으로 실력을 향상시킬 수 있습니다."

[예시 2]
입력: 추가정보 생일, 선물 프리미엄 와인 세트
출력: {
  "title": "특별한 날",
  "description": "생일을 맞이하여 프리미엄 와인 세트가 적합합니다."
}
❌ 잘못된 예: "생일을 맞이하는 분에게 프리미엄 와인 세트가 적합합니다."

[예시 3]
입력: 직급 부장, 선물 고급 명함지갑
출력: {
  "title": "비즈니스 선물",
  "description": "고급스러운 비즈니스 선물로 업무에 유용합니다."
}
❌ 잘못된 예: "데이터 엔지니어에게 고급스러운 비즈니스 선물로 업무에 유용합니다."

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
1. **메모와 추가 정보를 동등하게 중요하게 취급하세요.** 둘 다 관심사, 취미, 선호도를 포함할 수 있습니다.
2. 메모와 추가 정보에서 **모든 구체적인 관심사, 취미, 상황**을 추출하세요.
   - 예: 메모에 "축구"가 있고 추가 정보에 "야구"가 있다면 → ["축구 선물", "야구 선물"] 같이 둘 다 포함
3. 추상적인 표현은 구체적인 상품 키워드로 변환하세요.
   - "골프를 좋아함" → "골프용품", "골프공", "골프장갑"
   - "와인을 즐김" → "와인세트", "와인잔", "와인오프너"
   - "건강이 안 좋음" → "건강식품", "영양제"
4. 직급과 성별을 고려하여 적절한 선물 카테고리를 추가하세요.
   - 임원급 + 남성 → "고급 선물", "비즈니스 선물"
   - 여성 → "뷰티", "향수" 등 고려
5. 상황(생일, 승진, 감사 등)에 맞는 키워드도 추가하세요.
6. 키워드는 네이버 쇼핑에서 실제로 검색했을 때 좋은 결과가 나오는 형태로 작성하세요.

[출력 형식]
JSON 배열로 **최대 3개의 핵심 검색 키워드만** 반환하세요.
- 메모와 추가 정보에서 가장 중요한 키워드 1-2개만 추출
- 각 관심사마다 하나의 핵워드만 생성 (예: "축구", "야구" 등)
- 최대 3개를 넘지 마세요

예시:
- 메모 "축구", 추가정보 "야구" → ["축구 선물", "야구 선물"]
- 메모 "골프", 추가정보 "허리보호대" → ["골프 선물", "허리보호대"]
- 메모 "와인", 추가정보 "생일" → ["와인 선물", "생일 선물"]

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

  // 추가 정보에서 키워드 추출 (메모와 동일하게 처리)
  if (addMemo && addMemo.trim()) {
    // 먼저 특정 상황 키워드 확인
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
 * Extract preferences from memo content using LLM
 * Only extracts explicit expressions, no inference
 */
export const extractPreferencesFromMemo = async (memoContent) => {
  if (!process.env.OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY not configured, returning empty preferences");
    return { likes: [], dislikes: [], uncertain: [] };
  }

  try {
    const prompt = `다음 메모 텍스트에서 명시적으로 표현된 선호도만 추출하세요.

규칙:
1. 다음 키워드가 명시적으로 언급된 경우만 추출: 좋아한다, 좋아함, 선호, 자주 마심, 즐겨, 싫어, 별로, 못 먹, 피함, 부담스러워, 거부함
2. 건강, 정치, 종교, 성적 취향, 인종 등 민감한 속성은 추론하지 말 것
3. 애매하거나 추론이 필요한 경우는 uncertain에 분류
4. 모든 preference는 메모 텍스트에서 직접 복사한 증거(evidence)를 포함해야 함
5. 추측이나 환각 금지 - 메모에 명시되지 않은 것은 추출하지 말 것

메모 텍스트:
${memoContent}

응답 형식 (JSON only):
{
  "likes": [{"item": "항목명", "evidence": ["증거 문장1", "증거 문장2"], "weight": 0.8}],
  "dislikes": [{"item": "항목명", "evidence": ["증거 문장"], "weight": 0.9}],
  "uncertain": [{"item": "항목명", "evidence": ["증거 문장"], "weight": 0.5}]
}

JSON만 반환하고 다른 설명은 포함하지 마세요.`;

    const messages = [
      {
        role: "system",
        content: "You are a preference extraction system that only extracts explicit preferences from text. Never infer or guess. Return only valid JSON."
      },
      {
        role: "user",
        content: prompt
      }
    ];

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: messages,
        temperature: 0.1,
        response_format: { type: "json_object" }
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );

    if (response.data.choices && response.data.choices.length > 0) {
      const content = response.data.choices[0].message.content.trim();
      
      // Try to parse JSON (might be wrapped in code blocks or plain JSON)
      let parsed;
      try {
        // Remove markdown code blocks if present
        const cleanedContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        parsed = JSON.parse(cleanedContent);
      } catch (parseError) {
        console.error('Failed to parse LLM response as JSON:', content);
        return { likes: [], dislikes: [], uncertain: [] };
      }
      
      // Validate and normalize structure
      const normalizeItem = (item) => {
        if (typeof item === 'string') {
          return { item, evidence: [item], weight: 0.7 };
        }
        if (typeof item === 'object' && item.item) {
          return {
            item: String(item.item),
            evidence: Array.isArray(item.evidence) ? item.evidence.map(String) : [String(item.evidence || '')],
            weight: typeof item.weight === 'number' ? item.weight : 0.7
          };
        }
        return null;
      };

      const normalizeArray = (arr) => {
        if (!Array.isArray(arr)) return [];
        return arr.map(normalizeItem).filter(item => item && item.item.trim());
      };
      
      return {
        likes: normalizeArray(parsed.likes || []),
        dislikes: normalizeArray(parsed.dislikes || []),
        uncertain: normalizeArray(parsed.uncertain || [])
      };
    }

    throw new Error("OpenAI API returned no choices");
  } catch (error) {
    console.error("Preference extraction error:", error);
    // Return empty preferences on error
    return { likes: [], dislikes: [], uncertain: [] };
  }
};

/**
 * Mock LLM response for development
 */
const mockLLMResponse = () => {
  return "안녕하세요! GPT-4b입니다. 어떻게 도와드릴까요? (This is a mock response. Please configure LLM API keys in .env file)";
};
