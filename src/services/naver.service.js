import axios from "axios";

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID || "gUrltWt5A39qWZP0UzQn";
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || "CjH7SHpY10";

/**
 * 네이버 쇼핑 API를 사용하여 상품 검색
 * @param {string} query - 검색 쿼리
 * @param {number} display - 검색 결과 개수 (기본값: 5)
 * @param {string} sort - 정렬 방식 (sim: 정확도순, date: 날짜순, asc: 가격낮은순, dsc: 가격높은순)
 * @returns {Promise<Array>} 검색 결과
 */
export const searchNaverShopping = async (query, display = 5, sort = "sim") => {
  if (!query || query.trim() === "") {
    throw new Error("검색어를 입력해주세요.");
  }

  try {
    const response = await axios.get(
      "https://openapi.naver.com/v1/search/shop.json",
      {
        params: {
          query: query,
          display: display,
          start: 1,
          sort: sort,
        },
        headers: {
          "X-Naver-Client-Id": NAVER_CLIENT_ID,
          "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
        },
      }
    );

    if (response.data) {
      return {
        items: response.data.items || [],
        total: response.data.total || 0, // 총 검색 결과 개수
        start: response.data.start || 1, // 검색 시작 위치
        display: response.data.display || display, // 한 번에 표시할 검색 결과 개수
        lastBuildDate: response.data.lastBuildDate || null, // 검색 결과 생성 시간
      };
    }

    return { items: [], total: 0, start: 1, display: 0, lastBuildDate: null };
  } catch (error) {
    console.error("네이버 쇼핑 API 오류:", error.message);
    if (error.response) {
      console.error("응답 상태:", error.response.status);
      console.error("응답 데이터:", error.response.data);
    }
    throw new Error("네이버 쇼핑 검색에 실패했습니다.");
  }
};

/**
 * 네이버 쇼핑 검색 결과를 ChromaDB 출력 형식과 동일하게 변환
 * @param {Array} naverItems - 네이버 쇼핑 API 응답 items
 * @returns {Array} 변환된 선물 목록
 */
export const formatNaverResultsAsGifts = (naverItems) => {
  return naverItems.map((item, index) => {
    // HTML 태그 제거 (네이버 API는 <b> 태그로 검색어를 감싸서 반환)
    const cleanTitle = item.title.replace(/<[^>]*>/g, "");

    // 카테고리 정보 구조화
    const categories = {
      category1: item.category1 || "", // 대분류
      category2: item.category2 || "", // 중분류
      category3: item.category3 || "", // 소분류
      category4: item.category4 || "", // 세분류
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
        // === 기본 상품 정보 ===
        name: cleanTitle,
        product_name: cleanTitle,

        // === 가격 정보 ===
        price: item.lprice || "0", // 최저가 (문자열)
        price_num: item.lprice ? parseInt(item.lprice, 10) : 0, // 최저가 (숫자)
        hprice: item.hprice || "0", // 최고가
        hprice_num: item.hprice ? parseInt(item.hprice, 10) : 0, // 최고가 (숫자)

        // === URL 및 이미지 ===
        url: item.link || "", // 상품 정보 URL
        link: item.link || "", // 상품 정보 URL (별칭)
        image: item.image || "", // 섬네일 이미지 URL

        // === 카테고리 정보 ===
        category: categoryPath, // 전체 카테고리 경로 (대분류 > 중분류 > 소분류 > 세분류)
        category1: categories.category1, // 대분류
        category2: categories.category2, // 중분류
        category3: categories.category3, // 소분류
        category4: categories.category4, // 세분류

        // === 제조사/브랜드 정보 ===
        brand: item.brand || "", // 브랜드
        maker: item.maker || "", // 제조사

        // === 판매처 정보 ===
        mallName: item.mallName || "네이버", // 쇼핑몰명

        // === 상품 식별 정보 ===
        productId: item.productId || "", // 네이버 쇼핑 상품 ID
        productType: item.productType || "", // 상품 타입 (1: 일반상품 등)

        // === ChromaDB 호환 필드 (빈 값) ===
        event: "",
        vibe: "",
        utility: "",
        etc: "",
      },
      // === 검색 관련 정보 ===
      distance: null,
      document: cleanTitle,
      similarity: null,
      source: "naver", // 출처 표시
    };
  });
};

/**
 * 쿼리를 받아서 네이버 쇼핑에서 선물 추천 (ChromaDB 형식과 동일하게 반환)
 * @param {string} query - 검색 쿼리
 * @param {Object} options - 옵션
 * @param {number} options.display - 검색 결과 개수 (기본값: 5)
 * @param {string} options.sort - 정렬 방식 (기본값: sim)
 * @param {number} options.minPrice - 최소 가격 (선택)
 * @param {number} options.maxPrice - 최대 가격 (선택)
 * @returns {Promise<Object>} 선물 추천 결과
 */
export const getNaverGiftRecommendations = async (query, options = {}) => {
  const {
    display = 5,
    sort = "sim",
    minPrice = null,
    maxPrice = null,
  } = options;

  // 네이버 쇼핑 검색
  const searchResult = await searchNaverShopping(query, display * 2, sort); // 필터링 대비 여유있게 가져옴
  const { items: naverItems, total, lastBuildDate } = searchResult;

  // 형식 변환
  let gifts = formatNaverResultsAsGifts(naverItems);

  // 가격 필터링
  if (minPrice !== null || maxPrice !== null) {
    gifts = gifts.filter((gift) => {
      const price = gift.metadata.price_num;
      if (price === null) return false;
      if (minPrice !== null && price < minPrice) return false;
      if (maxPrice !== null && price > maxPrice) return false;
      return true;
    });
  }

  // 결과 개수 제한
  gifts = gifts.slice(0, display);

  // Rationale cards 생성 (상세 버전)
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
      // 추가 상세 정보
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

  return {
    personaString: `[검색어] ${query}`,
    recommendedGifts: gifts,
    rationaleCards,
    originalData: {
      query,
      source: "naver_shopping",
    },
    // 검색 메타 정보
    searchMeta: {
      total, // 총 검색 결과 개수
      returned: gifts.length, // 반환된 결과 개수
      lastBuildDate, // 검색 결과 생성 시간
    },
  };
};
