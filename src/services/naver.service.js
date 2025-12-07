import axios from "axios";

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID || "gUrltWt5A39qWZP0UzQn";
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || "CjH7SHpY10";

// API 호출 통계 추적
let apiStats = {
  totalCalls: 0,
  successCalls: 0,
  failedCalls: 0,
  retryCalls: 0,
  rateLimitHits: 0,
  lastResetTime: Date.now(),
};

/**
 * API 통계 리셋 (1분마다)
 */
const resetStatsIfNeeded = () => {
  const now = Date.now();
  if (now - apiStats.lastResetTime > 60000) {
    // 1분마다 리셋
    console.log("\n📊 [네이버 API 통계 (최근 1분)]");
    console.log(`   총 호출: ${apiStats.totalCalls}회`);
    console.log(`   성공: ${apiStats.successCalls}회`);
    console.log(`   실패: ${apiStats.failedCalls}회`);
    console.log(`   재시도: ${apiStats.retryCalls}회`);
    console.log(`   Rate Limit: ${apiStats.rateLimitHits}회`);
    console.log("");

    apiStats = {
      totalCalls: 0,
      successCalls: 0,
      failedCalls: 0,
      retryCalls: 0,
      rateLimitHits: 0,
      lastResetTime: now,
    };
  }
};

/**
 * 딜레이 유틸리티 함수
 * @param {number} ms - 대기 시간 (밀리초)
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 타임스탬프 생성 (로그용)
 */
const getTimestamp = () => {
  return new Date().toISOString().replace("T", " ").substring(0, 23);
};

/**
 * 네이버 쇼핑 API를 사용하여 상품 검색
 * - 네트워크 오류(429, 5xx, 타임아웃)에 대해서만 1회 재시도
 * - 비즈니스 로직 재시도는 하지 않음 (호출하는 쪽에서 처리)
 * @param {string} query - 검색 쿼리
 * @param {number} display - 검색 결과 개수 (기본값: 10)
 * @param {string} sort - 정렬 방식 (sim: 정확도순, date: 날짜순, asc: 가격낮은순, dsc: 가격높은순)
 * @returns {Promise<Object>} 검색 결과
 */
export const searchNaverShopping = async (
  query,
  display = 10,
  sort = "sim"
) => {
  resetStatsIfNeeded();

  if (!query || query.trim() === "") {
    throw new Error("검색어를 입력해주세요.");
  }

  const requestId = `REQ-${Date.now()}-${Math.random()
    .toString(36)
    .substr(2, 5)}`;
  const startTime = Date.now();

  console.log(`\n🔍 [${getTimestamp()}] 네이버 API 호출 시작 [${requestId}]`);
  console.log(`   📝 검색어: "${query}"`);
  console.log(`   📊 파라미터: display=${display}, sort=${sort}`);

  apiStats.totalCalls++;

  const makeRequest = async (isRetry = false) => {
    const reqStartTime = Date.now();

    try {
      const response = await axios.get(
        "https://openapi.naver.com/v1/search/shop.json",
        {
          params: {
            query: query,
            display: Math.min(display, 100),
            start: 1,
            sort: sort,
          },
          headers: {
            "X-Naver-Client-Id": NAVER_CLIENT_ID,
            "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
          },
          timeout: 10000,
        }
      );

      const reqDuration = Date.now() - reqStartTime;

      if (response.data) {
        const result = {
          items: response.data.items || [],
          total: response.data.total || 0,
          start: response.data.start || 1,
          display: response.data.display || display,
          lastBuildDate: response.data.lastBuildDate || null,
        };

        console.log(
          `   ✅ API 응답 성공 (${reqDuration}ms)${isRetry ? " [재시도]" : ""}`
        );
        console.log(`      → 총 검색 결과: ${result.total.toLocaleString()}개`);
        console.log(`      → 반환 결과: ${result.items.length}개`);

        if (!isRetry) apiStats.successCalls++;
        return result;
      }

      return { items: [], total: 0, start: 1, display: 0, lastBuildDate: null };
    } catch (error) {
      const reqDuration = Date.now() - reqStartTime;
      throw { ...error, reqDuration };
    }
  };

  try {
    const result = await makeRequest(false);
    const totalDuration = Date.now() - startTime;
    console.log(`   ⏱️  총 소요 시간: ${totalDuration}ms [${requestId}]`);
    return result;
  } catch (error) {
    const status = error.response?.status;
    const reqDuration = error.reqDuration || 0;

    console.log(`   ❌ API 오류 발생 (${reqDuration}ms)`);
    console.log(`      → 상태 코드: ${status || "N/A"}`);
    console.log(`      → 에러 코드: ${error.code || "N/A"}`);
    console.log(`      → 메시지: ${error.message}`);

    const isRetryable =
      status === 429 ||
      status >= 500 ||
      error.code === "ECONNABORTED" ||
      error.code === "ECONNREFUSED" ||
      error.code === "ENOTFOUND";

    if (status === 429) {
      apiStats.rateLimitHits++;
      console.log(`   🚫 Rate Limit 감지! (총 ${apiStats.rateLimitHits}회)`);
    }

    if (isRetryable) {
      apiStats.retryCalls++;
      console.log(`   🔄 재시도 대기 중... (500ms)`);
      await sleep(500);

      try {
        const retryResult = await makeRequest(true);
        const totalDuration = Date.now() - startTime;
        console.log(
          `   ⏱️  총 소요 시간: ${totalDuration}ms (재시도 포함) [${requestId}]`
        );
        return retryResult;
      } catch (retryError) {
        apiStats.failedCalls++;
        const retryStatus = retryError.response?.status;
        console.log(`   ❌ 재시도 실패`);
        console.log(`      → 상태 코드: ${retryStatus || "N/A"}`);
        console.log(`      → 에러: ${retryError.message}`);

        if (retryStatus === 429) {
          apiStats.rateLimitHits++;
        }

        const totalDuration = Date.now() - startTime;
        console.log(
          `   ⏱️  총 소요 시간: ${totalDuration}ms (실패) [${requestId}]`
        );

        return {
          items: [],
          total: 0,
          start: 1,
          display: 0,
          lastBuildDate: null,
        };
      }
    }

    apiStats.failedCalls++;
    const totalDuration = Date.now() - startTime;
    console.log(
      `   ⏱️  총 소요 시간: ${totalDuration}ms (실패, 재시도 불가) [${requestId}]`
    );

    if (error.response?.data) {
      console.log(`      → 응답 데이터:`, error.response.data);
    }

    return { items: [], total: 0, start: 1, display: 0, lastBuildDate: null };
  }
};

/**
 * 네이버 쇼핑 검색 결과를 ChromaDB 출력 형식과 동일하게 변환
 * @param {Array} naverItems - 네이버 쇼핑 API 응답 items
 * @returns {Array} 변환된 선물 목록
 */
export const formatNaverResultsAsGifts = (naverItems) => {
  if (!naverItems || !Array.isArray(naverItems)) {
    return [];
  }

  return naverItems.map((item, index) => {
    const cleanTitle = item.title ? item.title.replace(/<[^>]*>/g, "") : "";

    const categories = {
      category1: item.category1 || "",
      category2: item.category2 || "",
      category3: item.category3 || "",
      category4: item.category4 || "",
    };

    const categoryPath = [
      categories.category1,
      categories.category2,
      categories.category3,
      categories.category4,
    ]
      .filter(Boolean)
      .join(" > ");

    return {
      id: item.productId || `naver-${index}`,
      metadata: {
        name: cleanTitle,
        product_name: cleanTitle,
        price: item.lprice || "0",
        price_num: item.lprice ? parseInt(item.lprice, 10) : 0,
        hprice: item.hprice || "0",
        hprice_num: item.hprice ? parseInt(item.hprice, 10) : 0,
        url: item.link || "",
        link: item.link || "",
        image: item.image || "",
        category: categoryPath,
        category1: categories.category1,
        category2: categories.category2,
        category3: categories.category3,
        category4: categories.category4,
        brand: item.brand || "",
        maker: item.maker || "",
        mallName: item.mallName || "네이버",
        productId: item.productId || "",
        productType: item.productType || "",
        event: "",
        vibe: "",
        utility: "",
        etc: "",
      },
      distance: null,
      document: cleanTitle,
      similarity: null,
      source: "naver",
    };
  });
};

/**
 * 쿼리를 받아서 네이버 쇼핑에서 선물 추천 (단순 API 호출 + 가격 필터링만)
 * @param {string} query - 검색 쿼리
 * @param {Object} options - 옵션
 * @param {number} options.display - 검색 결과 개수 (기본값: 10)
 * @param {string} options.sort - 정렬 방식 (기본값: sim)
 * @param {number} options.minPrice - 최소 가격 (선택)
 * @param {number} options.maxPrice - 최대 가격 (선택)
 * @returns {Promise<Object>} 선물 추천 결과
 */
export const getNaverGiftRecommendations = async (query, options = {}) => {
  const {
    display = 10,
    sort = "sim",
    minPrice = null,
    maxPrice = null,
  } = options;

  const funcStartTime = Date.now();

  console.log(`\n📦 [getNaverGiftRecommendations] 시작`);
  console.log(`   검색어: "${query}"`);
  console.log(`   옵션: display=${display}, sort=${sort}`);
  console.log(
    `   가격 범위: ${minPrice ? minPrice.toLocaleString() : "없음"}원 ~ ${
      maxPrice ? maxPrice.toLocaleString() : "없음"
    }원`
  );

  // 네이버 쇼핑 검색
  const searchResult = await searchNaverShopping(query, display, sort);
  const { items: naverItems, total, lastBuildDate } = searchResult;

  // 형식 변환
  let gifts = formatNaverResultsAsGifts(naverItems);
  const beforeFilterCount = gifts.length;

  console.log(`   📋 형식 변환 완료: ${beforeFilterCount}개`);

  // 가격 필터링
  if (minPrice !== null || maxPrice !== null) {
    gifts = gifts.filter((gift) => {
      const price = gift.metadata.price_num;
      if (price === null || price === 0) return false;
      if (minPrice !== null && price < minPrice) return false;
      if (maxPrice !== null && price > maxPrice) return false;
      return true;
    });

    const filteredOut = beforeFilterCount - gifts.length;
    console.log(
      `   💰 가격 필터링: ${beforeFilterCount}개 → ${gifts.length}개 (${filteredOut}개 제외)`
    );

    if (gifts.length > 0) {
      const prices = gifts.map((g) => g.metadata.price_num);
      const minActual = Math.min(...prices);
      const maxActual = Math.max(...prices);
      console.log(
        `      실제 가격 범위: ${minActual.toLocaleString()}원 ~ ${maxActual.toLocaleString()}원`
      );
    }
  }

  // Rationale cards 생성
  const rationaleCards = gifts.map((gift, idx) => {
    const meta = gift.metadata;
    const categoryMain = meta.category1 || "추천 선물";
    const brandInfo = meta.brand ? `${meta.brand} ` : "";
    const makerInfo =
      meta.maker && meta.maker !== meta.brand ? `(${meta.maker})` : "";
    const priceInfo = meta.price_num
      ? `${meta.price_num.toLocaleString()}원`
      : "";

    return {
      id: idx + 1,
      title: categoryMain,
      description: `${brandInfo}${meta.name}${makerInfo}${
        priceInfo ? ` - ${priceInfo}` : ""
      }`,
      details: {
        mallName: meta.mallName,
        brand: meta.brand,
        maker: meta.maker,
        price: priceInfo,
        category: meta.category,
        link: meta.url,
        image: meta.image,
      },
    };
  });

  const funcDuration = Date.now() - funcStartTime;
  console.log(`   ✅ [getNaverGiftRecommendations] 완료 (${funcDuration}ms)`);
  console.log(`      → 최종 결과: ${gifts.length}개`);

  // 상위 3개 미리보기
  if (gifts.length > 0) {
    console.log(`      → 상위 결과 미리보기:`);
    gifts.slice(0, 3).forEach((gift, idx) => {
      console.log(
        `         ${idx + 1}. ${gift.metadata.name.substring(0, 40)}${
          gift.metadata.name.length > 40 ? "..." : ""
        } (${gift.metadata.price_num.toLocaleString()}원)`
      );
    });
  }

  return {
    personaString: `[검색어] ${query}`,
    recommendedGifts: gifts,
    rationaleCards,
    originalData: {
      query,
      source: "naver_shopping",
    },
    searchMeta: {
      total,
      returned: gifts.length,
      lastBuildDate,
    },
  };
};

/**
 * 현재 API 통계 조회 (디버깅용)
 */
export const getApiStats = () => {
  return { ...apiStats };
};
