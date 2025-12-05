import express from "express";
import { body, query, validationResult } from "express-validator";
import Gift from "../models/Gift.model.js";
import BusinessCard from "../models/BusinessCard.model.js";
import { authenticate } from "../middleware/auth.middleware.js";
import {
  processPersonaEmbedding,
  generateEmbedding,
  rerankGifts,
  generateGiftRationale,
  extractSearchKeywords,
} from "../services/llm.service.js";
import { searchSimilarGifts } from "../services/chromadb.service.js";
import { getNaverGiftRecommendations } from "../services/naver.service.js";

const router = express.Router();

// 모든 라우트에 인증 적용
router.use(authenticate);

// ============================================================
// 📦 선물 기록 관리 API
// ============================================================

// @route   GET /api/gifts
// @desc    사용자의 선물 기록 목록 조회
// @access  Private
router.get("/", async (req, res) => {
  try {
    const { cardId, year } = req.query;
    const gifts = await Gift.findByUserId(req.user.id, { cardId, year });

    res.json({
      success: true,
      data: gifts,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// @route   POST /api/gifts
// @desc    새로운 선물 기록 생성
// @access  Private
router.post(
  "/",
  [body("cardId").notEmpty(), body("giftName").notEmpty().trim()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const gift = await Gift.create({
        ...req.body,
        userId: req.user.id,
        year: new Date().getFullYear().toString(),
      });

      res.status(201).json({
        success: true,
        data: gift,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// ============================================================
// 🔍 통합 선물 검색 API (메인 서비스)
// ============================================================

// @route   POST /api/gifts/search
// @desc    통합 선물 검색 - ChromaDB(벡터DB) + 네이버 쇼핑 결과를 통합하여 추천
// @access  Private
router.post(
  "/search",
  [
    body("query").notEmpty().withMessage("검색어(query)를 입력해주세요."),
    body("rank").optional().trim(),
    body("gender").optional().trim(),
    body("memo").optional().trim(),
    body("addMemo").optional().trim(),
    body("minPrice").optional().isFloat({ min: 0 }),
    body("maxPrice").optional().isFloat({ min: 0 }),
    body("limit").optional().isInt({ min: 1, max: 20 }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const {
        query: searchQuery,
        rank = "",
        gender = "",
        memo = "",
        addMemo = "",
        minPrice = null,
        maxPrice = null,
        limit = 5,
      } = req.body;

      const startTime = Date.now();
      console.log("==========================================");
      console.log("🔍 [선물 검색] 요청 시작");
      console.log("==========================================");
      console.log(`📝 검색어: "${searchQuery}"`);
      console.log(`👤 페르소나 데이터:`);
      console.log(`   - 직급: ${rank || "정보없음"}`);
      console.log(`   - 성별: ${gender || "정보없음"}`);
      console.log(`   - 메모: ${memo || "정보없음"}`);
      console.log(`   - 추가메모: ${addMemo || "정보없음"}`);
      console.log(
        `💰 가격 범위: ${minPrice ? `${minPrice}만원` : "없음"} ~ ${
          maxPrice ? `${maxPrice}만원` : "없음"
        }`
      );
      if (minPrice || maxPrice) {
        console.log(
          `   (원 단위: ${
            minPriceWon ? `${minPriceWon.toLocaleString()}원` : "없음"
          } ~ ${maxPriceWon ? `${maxPriceWon.toLocaleString()}원` : "없음"})`
        );
      }
      console.log(`📊 최종 추천 개수: ${limit}개`);
      console.log(`🕐 요청 시간: ${new Date().toISOString()}`);

      // 결과 저장 객체
      const searchResults = {
        chromaDB: { success: false, gifts: [], count: 0 },
        naver: { success: false, gifts: [], count: 0 },
      };

      // 가격 필터 변환 (만원 단위 → 원 단위)
      const minPriceWon = minPrice ? parseFloat(minPrice) * 10000 : null;
      const maxPriceWon = maxPrice ? parseFloat(maxPrice) * 10000 : null;

      // ========================================
      // Step 1: 페르소나 문자열 생성
      // ========================================
      const step1StartTime = Date.now();
      console.log("\n[Step 1] 페르소나 문자열 생성 시작...");
      let personaString;
      const personaData = {
        rank: rank || searchQuery,
        gender,
        memo: memo || searchQuery,
        addMemo,
      };
      console.log(`   입력 데이터:`, JSON.stringify(personaData, null, 2));

      try {
        personaString = await processPersonaEmbedding(personaData);
        const step1Time = Date.now() - step1StartTime;
        console.log("✅ [Step 1] 페르소나 문자열 생성 완료");
        console.log(`   소요 시간: ${step1Time}ms`);
        console.log(`   생성된 페르소나 (전체):`);
        console.log(`   "${personaString}"`);
        console.log(`   길이: ${personaString.length}자`);
      } catch (error) {
        // API 키가 없거나 실패 시 기본 문자열 사용
        personaString = `[상대방] 직급: ${personaData.rank} | 성별: ${
          personaData.gender || "정보없음"
        } | 메모: ${personaData.memo} | 추가메모: ${
          personaData.addMemo || "정보없음"
        }`;
        const step1Time = Date.now() - step1StartTime;
        console.log("⚠️  [Step 1] LLM 페르소나 생성 실패, 기본 문자열 사용");
        console.log(`   소요 시간: ${step1Time}ms`);
        console.log(`   에러: ${error.message}`);
        console.log(`   기본 페르소나: ${personaString}`);
      }

      // ========================================
      // Step 2: ChromaDB 벡터 검색
      // ========================================
      const step2StartTime = Date.now();
      console.log("\n[Step 2] ChromaDB 벡터 검색 시작...");
      try {
        console.log("   → 임베딩 벡터 생성 중...");
        console.log(`   모델: text-embedding-3-small, 차원: 1536`);
        const embeddingStartTime = Date.now();
        const embeddingVector = await generateEmbedding(
          personaString,
          "text-embedding-3-small",
          1536
        );
        const embeddingTime = Date.now() - embeddingStartTime;
        console.log(
          `   ✅ 임베딩 벡터 생성 완료 (차원: ${embeddingVector.length}, 소요: ${embeddingTime}ms)`
        );
        console.log(
          `   벡터 샘플 (처음 5개 값): [${embeddingVector
            .slice(0, 5)
            .map((v) => v.toFixed(4))
            .join(", ")}, ...]`
        );

        console.log("   → ChromaDB에서 유사 선물 검색 중...");
        console.log(
          `   검색 파라미터: limit=${limit}, minPrice=${
            minPriceWon || "없음"
          }, maxPrice=${maxPriceWon || "없음"}`
        );
        const chromaSearchStartTime = Date.now();
        const chromaResults = await searchSimilarGifts(
          embeddingVector,
          parseInt(limit, 10),
          minPriceWon,
          maxPriceWon
        );
        const chromaSearchTime = Date.now() - chromaSearchStartTime;
        console.log(`   검색 소요 시간: ${chromaSearchTime}ms`);

        if (chromaResults.ids && chromaResults.ids[0]?.length > 0) {
          const ids = chromaResults.ids[0];
          const metadatas = chromaResults.metadatas[0] || [];
          const distances = chromaResults.distances[0] || [];
          const documents = chromaResults.documents[0] || [];

          const chromaGifts = ids.map((id, i) => ({
            id,
            metadata: metadatas[i] || {},
            distance: distances[i] || null,
            document: documents[i] || "",
            similarity:
              distances[i] !== null ? (1 - distances[i]).toFixed(4) : null,
            source: "chromadb",
          }));

          searchResults.chromaDB = {
            success: true,
            gifts: chromaGifts,
            count: chromaGifts.length,
          };
          const step2Time = Date.now() - step2StartTime;
          console.log(
            `✅ [Step 2] ChromaDB 검색 완료: ${chromaGifts.length}개 결과 (총 소요: ${step2Time}ms)`
          );
          console.log(`\n   📋 ChromaDB 검색 결과 상세:`);
          chromaGifts.forEach((gift, idx) => {
            console.log(`   ${idx + 1}. [ID: ${gift.id}]`);
            console.log(
              `      이름: ${
                gift.metadata?.name ||
                gift.metadata?.product_name ||
                "이름 없음"
              }`
            );
            console.log(
              `      가격: ${gift.metadata?.price || "가격 정보 없음"}`
            );
            console.log(
              `      카테고리: ${gift.metadata?.category || "카테고리 없음"}`
            );
            console.log(
              `      브랜드: ${gift.metadata?.brand || "브랜드 없음"}`
            );
            console.log(
              `      유사도: ${gift.similarity || "N/A"} (거리: ${
                gift.distance?.toFixed(4) || "N/A"
              })`
            );
            console.log(`      URL: ${gift.metadata?.url || "URL 없음"}`);
            if (gift.document) {
              console.log(`      문서: ${gift.document.substring(0, 100)}...`);
            }
            console.log("");
          });
        } else {
          searchResults.chromaDB = {
            success: true,
            gifts: [],
            count: 0,
            message: "ChromaDB에서 일치하는 결과가 없습니다.",
          };
          const step2Time = Date.now() - step2StartTime;
          console.log(
            `⚠️  [Step 2] ChromaDB에서 일치하는 결과 없음 (소요: ${step2Time}ms)`
          );
        }
      } catch (error) {
        const step2Time = Date.now() - step2StartTime;
        searchResults.chromaDB = {
          success: false,
          gifts: [],
          count: 0,
          error: error.message,
        };
        console.error(
          `❌ [Step 2] ChromaDB 검색 실패 (소요: ${step2Time}ms):`,
          error.message
        );
        console.error(`   스택:`, error.stack);
      }

      // ========================================
      // Step 3: 네이버 쇼핑 검색 (LLM 키워드 추출 사용)
      // ========================================
      const step3StartTime = Date.now();
      console.log("\n[Step 3] 네이버 쇼핑 검색 시작...");
      try {
        // LLM을 사용하여 최적의 검색 키워드 추출
        console.log("   → LLM 키워드 추출 중...");
        console.log(`   입력: 페르소나 데이터 + 검색어 "${searchQuery}"`);
        const keywordExtractStartTime = Date.now();
        const extractedKeywords = await extractSearchKeywords(
          personaData,
          searchQuery
        );
        const keywordExtractTime = Date.now() - keywordExtractStartTime;
        console.log(`   ✅ 키워드 추출 완료 (소요: ${keywordExtractTime}ms)`);
        console.log(`   추출된 키워드 (${extractedKeywords.length}개):`);
        extractedKeywords.forEach((kw, idx) => {
          console.log(`      ${idx + 1}. "${kw}"`);
        });

        // 여러 키워드로 검색하여 결과 통합
        const naverGifts = [];
        const searchedKeywords = [];
        const keywordResults = [];

        for (const keyword of extractedKeywords.slice(0, 3)) {
          // 최대 3개 키워드
          try {
            const keywordSearchStartTime = Date.now();
            console.log(`\n   → 네이버 검색 중: "${keyword}"`);
            console.log(
              `      파라미터: display=1, sort=sim, minPrice=${
                minPriceWon || "없음"
              }, maxPrice=${maxPriceWon || "없음"}`
            );
            const result = await getNaverGiftRecommendations(keyword, {
              display: 1, // 키워드당 1개씩 → 총 3개
              sort: "sim",
              minPrice: minPriceWon,
              maxPrice: maxPriceWon,
            });
            const keywordSearchTime = Date.now() - keywordSearchStartTime;

            if (result.recommendedGifts && result.recommendedGifts.length > 0) {
              naverGifts.push(...result.recommendedGifts);
              searchedKeywords.push(keyword);
              keywordResults.push({
                keyword,
                count: result.recommendedGifts.length,
                time: keywordSearchTime,
                gifts: result.recommendedGifts,
              });
              console.log(
                `      ✅ "${keyword}": ${result.recommendedGifts.length}개 결과 (소요: ${keywordSearchTime}ms)`
              );
              result.recommendedGifts.forEach((gift, idx) => {
                console.log(
                  `         ${idx + 1}. ${
                    gift.name || gift.metadata?.name || "이름 없음"
                  }`
                );
                console.log(
                  `            가격: ${
                    gift.price || gift.metadata?.price || "가격 정보 없음"
                  }`
                );
                console.log(
                  `            브랜드: ${
                    gift.brand || gift.metadata?.brand || "브랜드 없음"
                  }`
                );
              });
            } else {
              console.log(
                `      ⚠️  "${keyword}": 결과 없음 (소요: ${keywordSearchTime}ms)`
              );
            }
          } catch (keywordError) {
            console.error(
              `      ❌ "${keyword}" 검색 실패:`,
              keywordError.message
            );
            console.error(`         스택:`, keywordError.stack);
          }
        }

        console.log(`\n   → 중복 제거 중...`);
        console.log(`      중복 제거 전: ${naverGifts.length}개`);
        // 중복 제거 (상품 ID 기준)
        const uniqueGifts = [];
        const seenIds = new Set();
        const duplicateIds = [];
        for (const gift of naverGifts) {
          const giftId = gift.id || gift.metadata?.productId;
          if (!seenIds.has(giftId)) {
            seenIds.add(giftId);
            uniqueGifts.push(gift);
          } else {
            duplicateIds.push(giftId);
          }
        }
        console.log(`      중복 제거 후: ${uniqueGifts.length}개`);
        if (duplicateIds.length > 0) {
          console.log(`      제거된 중복 ID: ${duplicateIds.join(", ")}`);
        }

        searchResults.naver = {
          success: true,
          gifts: uniqueGifts.slice(0, 3), // 최대 3개
          count: uniqueGifts.length,
          extractedKeywords,
          searchedKeywords,
        };
        const step3Time = Date.now() - step3StartTime;
        console.log(
          `\n✅ [Step 3] 네이버 검색 완료: ${uniqueGifts.length}개 결과 (중복 제거 후, 총 소요: ${step3Time}ms)`
        );
        console.log(`   사용된 키워드: ${searchedKeywords.join(", ")}`);
        console.log(`\n   📋 네이버 검색 결과 상세:`);
        uniqueGifts.slice(0, 3).forEach((gift, idx) => {
          console.log(
            `   ${idx + 1}. [ID: ${
              gift.id || gift.metadata?.productId || "ID 없음"
            }]`
          );
          console.log(
            `      이름: ${
              gift.name ||
              gift.metadata?.name ||
              gift.metadata?.product_name ||
              "이름 없음"
            }`
          );
          console.log(
            `      가격: ${
              gift.price || gift.metadata?.price || "가격 정보 없음"
            }`
          );
          console.log(
            `      카테고리: ${
              gift.category || gift.metadata?.category || "카테고리 없음"
            }`
          );
          console.log(
            `      브랜드: ${
              gift.brand || gift.metadata?.brand || "브랜드 없음"
            }`
          );
          console.log(`      제조사: ${gift.metadata?.maker || "제조사 없음"}`);
          console.log(
            `      URL: ${
              gift.url ||
              gift.metadata?.url ||
              gift.metadata?.link ||
              "URL 없음"
            }`
          );
          console.log(
            `      이미지: ${
              gift.image || gift.metadata?.image || "이미지 없음"
            }`
          );
          console.log("");
        });
      } catch (error) {
        const step3Time = Date.now() - step3StartTime;
        searchResults.naver = {
          success: false,
          gifts: [],
          count: 0,
          error: error.message,
        };
        console.error(
          `❌ [Step 3] 네이버 검색 실패 (소요: ${step3Time}ms):`,
          error.message
        );
        console.error(`   스택:`, error.stack);
      }

      // ========================================
      // Step 4: 결과 통합 및 리랭킹
      // ========================================
      const step4StartTime = Date.now();
      console.log("\n[Step 4] 결과 통합 및 리랭킹 시작...");
      const allGifts = [
        ...searchResults.chromaDB.gifts,
        ...searchResults.naver.gifts,
      ];
      console.log(
        `   → 통합 결과: ChromaDB ${searchResults.chromaDB.count}개 + 네이버 ${searchResults.naver.count}개 = 총 ${allGifts.length}개`
      );
      console.log(`\n   📋 통합 전 전체 선물 목록:`);
      allGifts.forEach((gift, idx) => {
        console.log(
          `   ${idx + 1}. [${gift.source || "unknown"}] ${
            gift.metadata?.name || gift.name || gift.id
          }`
        );
        console.log(
          `      가격: ${
            gift.metadata?.price || gift.price || "가격 정보 없음"
          }`
        );
        if (gift.similarity) {
          console.log(`      유사도: ${gift.similarity}`);
        }
      });

      let recommendedGifts = allGifts;
      let rationaleCards = [];

      // 결과가 3개 초과일 경우 LLM 리랭킹 수행
      if (allGifts.length > 3) {
        try {
          console.log(
            `\n   → LLM 리랭킹 수행 중... (${allGifts.length}개 → 3개)`
          );
          console.log(`      입력: ${allGifts.length}개 선물, 페르소나 데이터`);
          const rerankStartTime = Date.now();
          const beforeRerank = allGifts.map((g) => ({
            id: g.id,
            name: g.metadata?.name || g.name,
            source: g.source,
          }));
          recommendedGifts = await rerankGifts(
            allGifts,
            personaString,
            personaData,
            3
          );
          const rerankTime = Date.now() - rerankStartTime;
          console.log(
            `      ✅ 리랭킹 완료: 상위 3개 선정 (소요: ${rerankTime}ms)`
          );
          console.log(`\n   📋 리랭킹 결과:`);
          recommendedGifts.forEach((gift, idx) => {
            console.log(
              `   ${idx + 1}. [${gift.source || "unknown"}] ${
                gift.metadata?.name || gift.name || gift.id
              }`
            );
            console.log(
              `      가격: ${
                gift.metadata?.price || gift.price || "가격 정보 없음"
              }`
            );
            if (gift.similarity) {
              console.log(`      유사도: ${gift.similarity}`);
            }
          });

          // 추천 이유 생성
          console.log(`\n   → 추천 이유 생성 중...`);
          const rationaleStartTime = Date.now();
          rationaleCards = await Promise.all(
            recommendedGifts.map(async (gift, idx) => {
              try {
                const rationale = await generateGiftRationale(
                  gift,
                  personaString,
                  personaData
                );
                return {
                  id: idx + 1,
                  title: rationale.title,
                  description: rationale.description,
                };
              } catch (error) {
                const meta = gift.metadata || {};
                return {
                  id: idx + 1,
                  title: meta.category?.split(" > ")[0] || "추천 선물",
                  description: `"${searchQuery}" 검색 결과로 추천드립니다.`,
                };
              }
            })
          );
          const rationaleTime = Date.now() - rationaleStartTime;
          console.log(
            `      ✅ 추천 이유 생성 완료: ${rationaleCards.length}개 (소요: ${rationaleTime}ms)`
          );
          rationaleCards.forEach((card, idx) => {
            console.log(`      ${idx + 1}. ${card.title}`);
            console.log(`         ${card.description.substring(0, 100)}...`);
          });
        } catch (error) {
          // 리랭킹 실패 시 상위 3개 사용
          console.error(
            `      ⚠️  리랭킹 실패, 상위 3개 사용 (에러: ${error.message})`
          );
          recommendedGifts = allGifts.slice(0, 3);
          rationaleCards = recommendedGifts.map((gift, idx) => ({
            id: idx + 1,
            title: gift.metadata?.category?.split(" > ")[0] || "추천 선물",
            description: `"${searchQuery}" 검색 결과로 추천드립니다.`,
          }));
        }
      } else {
        // 결과가 3개 이하면 그대로 사용
        console.log(`   → 결과가 ${allGifts.length}개 (3개 이하), 리랭킹 생략`);
        rationaleCards = recommendedGifts.map((gift, idx) => ({
          id: idx + 1,
          title: gift.metadata?.category?.split(" > ")[0] || "추천 선물",
          description: `"${searchQuery}" 검색 결과로 추천드립니다.`,
        }));
      }
      const step4Time = Date.now() - step4StartTime;
      console.log(`\n   Step 4 총 소요 시간: ${step4Time}ms`);

      // ========================================
      // 최종 응답
      // ========================================
      const totalTime = Date.now() - startTime;
      console.log("\n==========================================");
      console.log("✅ [선물 검색] 완료");
      console.log("==========================================");
      console.log(`   최종 추천 개수: ${recommendedGifts.length}개`);
      console.log(
        `   총 소요 시간: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}초)`
      );
      console.log(`\n   📊 최종 추천 선물 상세:`);
      recommendedGifts.forEach((gift, idx) => {
        console.log(
          `\n   ${idx + 1}. [${gift.source || "unknown"}] ${
            gift.metadata?.name || gift.name || gift.id
          }`
        );
        console.log(`      ID: ${gift.id}`);
        console.log(
          `      가격: ${
            gift.metadata?.price || gift.price || "가격 정보 없음"
          }`
        );
        console.log(
          `      카테고리: ${
            gift.metadata?.category || gift.category || "카테고리 없음"
          }`
        );
        console.log(
          `      브랜드: ${gift.metadata?.brand || gift.brand || "브랜드 없음"}`
        );
        console.log(
          `      URL: ${
            gift.metadata?.url || gift.metadata?.link || gift.url || "URL 없음"
          }`
        );
        console.log(
          `      이미지: ${gift.metadata?.image || gift.image || "이미지 없음"}`
        );
        if (gift.similarity) {
          console.log(`      유사도: ${gift.similarity}`);
        }
        if (rationaleCards[idx]) {
          console.log(`      추천 이유:`);
          console.log(`         제목: ${rationaleCards[idx].title}`);
          console.log(`         설명: ${rationaleCards[idx].description}`);
        }
      });
      console.log("\n==========================================\n");
      res.json({
        success: true,
        data: {
          query: searchQuery,
          personaString,
          recommendedGifts: recommendedGifts.map((gift) => ({
            id: gift.id,
            name: gift.metadata?.name || gift.metadata?.product_name || "",
            price: gift.metadata?.price || "",
            image: gift.metadata?.image || "",
            url: gift.metadata?.url || gift.metadata?.link || "",
            category: gift.metadata?.category || "",
            brand: gift.metadata?.brand || "",
            source: gift.source || "unknown",
          })),
          rationaleCards,
        },
      });
    } catch (error) {
      console.error("\n==========================================");
      console.error("❌ [선물 검색] 오류 발생");
      console.error("==========================================");
      console.error("에러 메시지:", error.message);
      console.error("스택 트레이스:", error.stack);
      console.error("==========================================\n");
      res.status(500).json({
        success: false,
        message: error.message || "선물 검색에 실패했습니다.",
      });
    }
  }
);

// ============================================================
// 🎁 명함 카드 기반 선물 추천 API
// ============================================================

// @route   POST /api/gifts/recommend
// @desc    명함 카드 정보를 기반으로 선물 추천 (ChromaDB + 네이버 쇼핑 통합)
// @access  Private
router.post(
  "/recommend",
  [
    body("cardId").notEmpty().withMessage("명함 ID(cardId)를 입력해주세요."),
    body("additionalInfo").optional().trim(),
    body("gender").optional().trim(),
    body("memos").optional().isArray(),
    body("minPrice").optional().isFloat({ min: 0 }),
    body("maxPrice").optional().isFloat({ min: 0 }),
    body("includeNaver").optional().isBoolean(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const {
        cardId,
        additionalInfo = "",
        gender = "",
        memos = [],
        minPrice = null,
        maxPrice = null,
        includeNaver = true,
      } = req.body;

      const recommendStartTime = Date.now();
      console.log("==========================================");
      console.log("🎁 [명함 기반 선물 추천] 요청 시작");
      console.log("==========================================");
      console.log(`📇 명함 ID: ${cardId}`);
      console.log(`👤 사용자 ID: ${req.user.id}`);
      console.log(
        `💰 가격 범위: ${minPrice ? `${minPrice}만원` : "없음"} ~ ${
          maxPrice ? `${maxPrice}만원` : "없음"
        }`
      );
      if (minPrice || maxPrice) {
        const minPriceWon = minPrice ? parseFloat(minPrice) * 10000 : null;
        const maxPriceWon = maxPrice ? parseFloat(maxPrice) * 10000 : null;
        console.log(
          `   (원 단위: ${
            minPriceWon ? `${minPriceWon.toLocaleString()}원` : "없음"
          } ~ ${maxPriceWon ? `${maxPriceWon.toLocaleString()}원` : "없음"})`
        );
      }
      console.log(`🛒 네이버 검색 포함: ${includeNaver ? "예" : "아니오"}`);
      console.log(`📝 추가 정보: ${additionalInfo || "없음"}`);
      console.log(`📝 메모: ${memos.length > 0 ? memos.join(", ") : "없음"}`);
      console.log(`🕐 요청 시간: ${new Date().toISOString()}`);

      // 명함 정보 조회
      console.log("\n[명함 조회] 명함 정보 조회 중...");
      const card = await BusinessCard.findById(cardId, req.user.id);
      if (!card) {
        console.error("❌ 명함을 찾을 수 없습니다.");
        return res.status(404).json({
          success: false,
          message: "명함을 찾을 수 없습니다.",
        });
      }
      console.log(
        `✅ 명함 조회 완료: ${card.name} (${card.position} @ ${card.company})`
      );

      // 페르소나 데이터 준비
      const finalGender = card.gender || gender || "";
      const rank = card.position || "";
      const primaryMemo = memos.length > 0 ? memos[0] : card.memo || "";
      const addMemo = additionalInfo || "";

      const personaData = {
        rank,
        gender: finalGender,
        memo: primaryMemo,
        addMemo,
      };
      console.log(`👤 페르소나 데이터:`, personaData);

      // 결과 저장
      const searchResults = {
        chromaDB: { success: false, gifts: [], count: 0 },
        naver: { success: false, gifts: [], count: 0 },
      };

      // 가격 필터 변환
      const minPriceWon = minPrice ? parseFloat(minPrice) * 10000 : null;
      const maxPriceWon = maxPrice ? parseFloat(maxPrice) * 10000 : null;

      // Step 1: 페르소나 문자열 생성
      console.log("\n[Step 1] 페르소나 문자열 생성 시작...");
      let personaString;
      try {
        personaString = await processPersonaEmbedding(personaData);
        console.log("✅ [Step 1] 페르소나 문자열 생성 완료");
        console.log(
          `   생성된 페르소나: ${personaString.substring(0, 100)}...`
        );
      } catch (error) {
        personaString = `[상대방] 직급: ${rank} | 성별: ${
          finalGender || "정보없음"
        } | 메모: ${primaryMemo} | 추가메모: ${addMemo || "정보없음"}`;
        console.log("⚠️  [Step 1] LLM 페르소나 생성 실패, 기본 문자열 사용");
        console.log(`   기본 페르소나: ${personaString}`);
      }

      // Step 2: ChromaDB 검색
      console.log("\n[Step 2] ChromaDB 벡터 검색 시작...");
      try {
        console.log("   → 임베딩 벡터 생성 중...");
        const embeddingVector = await generateEmbedding(
          personaString,
          "text-embedding-3-small",
          1536
        );
        console.log(
          `   ✅ 임베딩 벡터 생성 완료 (차원: ${embeddingVector.length})`
        );

        console.log("   → ChromaDB에서 유사 선물 검색 중...");
        const chromaResults = await searchSimilarGifts(
          embeddingVector,
          5,
          minPriceWon,
          maxPriceWon
        );

        if (chromaResults.ids && chromaResults.ids[0]?.length > 0) {
          const ids = chromaResults.ids[0];
          const metadatas = chromaResults.metadatas[0] || [];
          const distances = chromaResults.distances[0] || [];
          const documents = chromaResults.documents[0] || [];

          const chromaGifts = ids.map((id, i) => ({
            id,
            metadata: metadatas[i] || {},
            distance: distances[i] || null,
            document: documents[i] || "",
            similarity:
              distances[i] !== null ? (1 - distances[i]).toFixed(4) : null,
            source: "chromadb",
          }));

          searchResults.chromaDB = {
            success: true,
            gifts: chromaGifts,
            count: chromaGifts.length,
          };
          console.log(
            `✅ [Step 2] ChromaDB 검색 완료: ${chromaGifts.length}개 결과`
          );
          if (chromaGifts.length > 0) {
            console.log(`   최고 유사도: ${chromaGifts[0].similarity}`);
            console.log(
              `   첫 번째 결과: ${
                chromaGifts[0].metadata?.name || chromaGifts[0].id
              }`
            );
          }
        } else {
          console.log("⚠️  [Step 2] ChromaDB에서 일치하는 결과 없음");
        }
      } catch (error) {
        searchResults.chromaDB = {
          success: false,
          error: error.message,
        };
        console.error("❌ [Step 2] ChromaDB 검색 실패:", error.message);
      }

      // Step 3: 네이버 쇼핑 검색 (LLM 키워드 추출 사용)
      if (includeNaver) {
        console.log("\n[Step 3] 네이버 쇼핑 검색 시작...");
        try {
          // LLM을 사용하여 최적의 검색 키워드 추출
          console.log("   → LLM 키워드 추출 중...");
          const extractedKeywords = await extractSearchKeywords(
            personaData,
            primaryMemo
          );
          console.log(
            `   ✅ 키워드 추출 완료: ${extractedKeywords.join(", ")}`
          );

          // 여러 키워드로 검색하여 결과 통합
          const naverGifts = [];
          const searchedKeywords = [];

          for (const keyword of extractedKeywords.slice(0, 3)) {
            try {
              console.log(`   → 네이버 검색 중: "${keyword}"`);
              const result = await getNaverGiftRecommendations(keyword, {
                display: 3,
                sort: "sim",
                minPrice: minPriceWon,
                maxPrice: maxPriceWon,
              });

              if (
                result.recommendedGifts &&
                result.recommendedGifts.length > 0
              ) {
                naverGifts.push(...result.recommendedGifts);
                searchedKeywords.push(keyword);
                console.log(
                  `   ✅ "${keyword}": ${result.recommendedGifts.length}개 결과`
                );
              } else {
                console.log(`   ⚠️  "${keyword}": 결과 없음`);
              }
            } catch (keywordError) {
              console.error(
                `   ❌ "${keyword}" 검색 실패:`,
                keywordError.message
              );
            }
          }

          // 중복 제거
          const uniqueGifts = [];
          const seenIds = new Set();
          for (const gift of naverGifts) {
            const giftId = gift.id || gift.metadata?.productId;
            if (!seenIds.has(giftId)) {
              seenIds.add(giftId);
              uniqueGifts.push(gift);
            }
          }

          searchResults.naver = {
            success: true,
            gifts: uniqueGifts.slice(0, 3), // 최대 3개
            count: uniqueGifts.length,
            extractedKeywords,
            searchedKeywords,
          };
          console.log(
            `✅ [Step 3] 네이버 검색 완료: ${uniqueGifts.length}개 결과 (중복 제거 후)`
          );
          console.log(`   사용된 키워드: ${searchedKeywords.join(", ")}`);
        } catch (error) {
          searchResults.naver = {
            success: false,
            error: error.message,
          };
          console.error("❌ [Step 3] 네이버 검색 실패:", error.message);
        }
      } else {
        console.log("\n[Step 3] 네이버 검색 건너뜀 (includeNaver=false)");
      }

      // Step 4: 결과 통합 및 리랭킹
      console.log("\n[Step 4] 결과 통합 및 리랭킹 시작...");
      const allGifts = [
        ...(searchResults.chromaDB.gifts || []),
        ...(searchResults.naver.gifts || []),
      ];
      console.log(
        `   → 통합 결과: ChromaDB ${searchResults.chromaDB.count}개 + 네이버 ${searchResults.naver.count}개 = 총 ${allGifts.length}개`
      );

      let recommendedGifts = allGifts.slice(0, 3);
      let rationaleCards = [];

      if (allGifts.length > 3) {
        try {
          console.log("   → LLM 리랭킹 수행 중...");
          recommendedGifts = await rerankGifts(
            allGifts,
            personaString,
            personaData,
            3
          );
          console.log(`   ✅ 리랭킹 완료: 상위 3개 선정`);
        } catch (error) {
          console.error("   ⚠️  리랭킹 실패, 상위 3개 사용:", error.message);
          recommendedGifts = allGifts.slice(0, 3);
        }
      } else {
        console.log("   → 결과가 3개 이하, 리랭킹 생략");
      }

      // 추천 이유 생성
      console.log("   → 추천 이유 생성 중...");
      rationaleCards = await Promise.all(
        recommendedGifts.map(async (gift, idx) => {
          try {
            const rationale = await generateGiftRationale(
              gift,
              personaString,
              personaData
            );
            return {
              id: idx + 1,
              title: rationale.title,
              description: rationale.description,
            };
          } catch {
            const meta = gift.metadata || {};
            return {
              id: idx + 1,
              title: meta.category?.split(" > ")[0] || "추천 선물",
              description: `${card.name || "상대방"}님에게 적합한 선물입니다.`,
            };
          }
        })
      );
      console.log(`   ✅ 추천 이유 생성 완료: ${rationaleCards.length}개`);

      console.log("\n==========================================");
      console.log("✅ [명함 기반 선물 추천] 완료");
      console.log(`   최종 추천 개수: ${recommendedGifts.length}개`);
      console.log("==========================================\n");

      res.json({
        success: true,
        data: {
          personaString,
          card: {
            id: card.id,
            name: card.name,
            position: card.position,
            company: card.company,
            gender: card.gender,
          },
          recommendedGifts: recommendedGifts.map((gift) => ({
            id: gift.id,
            name: gift.metadata?.name || gift.metadata?.product_name || "",
            price: gift.metadata?.price || "",
            image: gift.metadata?.image || "",
            url: gift.metadata?.url || gift.metadata?.link || "",
            category: gift.metadata?.category || "",
            brand: gift.metadata?.brand || "",
            source: gift.source || "unknown",
          })),
          rationaleCards,
        },
      });
    } catch (error) {
      console.error("\n==========================================");
      console.error("❌ [명함 기반 선물 추천] 오류 발생");
      console.error("==========================================");
      console.error("에러 메시지:", error.message);
      console.error("스택 트레이스:", error.stack);
      console.error("==========================================\n");
      res.status(500).json({
        success: false,
        message: error.message || "선물 추천에 실패했습니다.",
      });
    }
  }
);

// ============================================================
// 🛒 네이버 쇼핑 단독 검색 API
// ============================================================

// @route   GET /api/gifts/naver
// @desc    네이버 쇼핑에서 상품 검색
// @access  Private
router.get(
  "/naver",
  [
    query("q").notEmpty().withMessage("검색어(q)를 입력해주세요."),
    query("display").optional().isInt({ min: 1, max: 20 }),
    query("sort").optional().isIn(["sim", "date", "asc", "dsc"]),
    query("minPrice").optional().isFloat({ min: 0 }),
    query("maxPrice").optional().isFloat({ min: 0 }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const {
        q: searchQuery,
        display = 3,
        sort = "sim",
        minPrice = null,
        maxPrice = null,
      } = req.query;

      console.log("==========================================");
      console.log("🛒 [네이버 쇼핑 검색] 요청 시작 (GET)");
      console.log("==========================================");
      console.log(`📝 검색어: "${searchQuery}"`);
      console.log(`📊 결과 개수: ${display}개`);
      console.log(`🔀 정렬: ${sort}`);
      console.log(
        `💰 가격 범위: ${minPrice ? `${minPrice}원` : "없음"} ~ ${
          maxPrice ? `${maxPrice}원` : "없음"
        }`
      );

      console.log("\n→ 네이버 쇼핑 API 호출 중...");
      const result = await getNaverGiftRecommendations(searchQuery, {
        display: parseInt(display, 10),
        sort,
        minPrice: minPrice ? parseFloat(minPrice) : null,
        maxPrice: maxPrice ? parseFloat(maxPrice) : null,
      });
      console.log(
        `✅ 검색 완료: ${result.recommendedGifts?.length || 0}개 결과`
      );

      console.log("\n==========================================");
      console.log("✅ [네이버 쇼핑 검색] 완료");
      console.log("==========================================\n");

      res.json({
        success: true,
        data: {
          query: searchQuery,
          recommendedGifts: result.recommendedGifts.map((gift) => ({
            id: gift.id,
            name: gift.metadata?.name || gift.metadata?.product_name || "",
            price: gift.metadata?.price || "",
            image: gift.metadata?.image || "",
            url: gift.metadata?.url || gift.metadata?.link || "",
            category: gift.metadata?.category || "",
            brand: gift.metadata?.brand || "",
            source: "naver",
          })),
          rationaleCards: result.rationaleCards,
        },
      });
    } catch (error) {
      console.error("\n==========================================");
      console.error("❌ [네이버 쇼핑 검색] 오류 발생 (GET)");
      console.error("==========================================");
      console.error("에러 메시지:", error.message);
      console.error("스택 트레이스:", error.stack);
      console.error("==========================================\n");
      res.status(500).json({
        success: false,
        message: error.message || "네이버 쇼핑 검색에 실패했습니다.",
      });
    }
  }
);

// @route   POST /api/gifts/naver
// @desc    네이버 쇼핑에서 상품 검색 (POST)
// @access  Private
router.post(
  "/naver",
  [
    body("query").notEmpty().withMessage("검색어(query)를 입력해주세요."),
    body("display").optional().isInt({ min: 1, max: 20 }),
    body("sort").optional().isIn(["sim", "date", "asc", "dsc"]),
    body("minPrice").optional().isFloat({ min: 0 }),
    body("maxPrice").optional().isFloat({ min: 0 }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const {
        query: searchQuery,
        display = 3,
        sort = "sim",
        minPrice = null,
        maxPrice = null,
      } = req.body;

      console.log("==========================================");
      console.log("🛒 [네이버 쇼핑 검색] 요청 시작 (POST)");
      console.log("==========================================");
      console.log(`📝 검색어: "${searchQuery}"`);
      console.log(`📊 결과 개수: ${display}개`);
      console.log(`🔀 정렬: ${sort}`);
      console.log(
        `💰 가격 범위: ${minPrice ? `${minPrice}원` : "없음"} ~ ${
          maxPrice ? `${maxPrice}원` : "없음"
        }`
      );

      console.log("\n→ 네이버 쇼핑 API 호출 중...");
      const result = await getNaverGiftRecommendations(searchQuery, {
        display: parseInt(display, 10),
        sort,
        minPrice: minPrice ? parseFloat(minPrice) : null,
        maxPrice: maxPrice ? parseFloat(maxPrice) : null,
      });
      console.log(
        `✅ 검색 완료: ${result.recommendedGifts?.length || 0}개 결과`
      );

      console.log("\n==========================================");
      console.log("✅ [네이버 쇼핑 검색] 완료");
      console.log("==========================================\n");

      res.json({
        success: true,
        data: {
          query: searchQuery,
          recommendedGifts: result.recommendedGifts.map((gift) => ({
            id: gift.id,
            name: gift.metadata?.name || gift.metadata?.product_name || "",
            price: gift.metadata?.price || "",
            image: gift.metadata?.image || "",
            url: gift.metadata?.url || gift.metadata?.link || "",
            category: gift.metadata?.category || "",
            brand: gift.metadata?.brand || "",
            source: "naver",
          })),
          rationaleCards: result.rationaleCards,
        },
      });
    } catch (error) {
      console.error("\n==========================================");
      console.error("❌ [네이버 쇼핑 검색] 오류 발생 (POST)");
      console.error("==========================================");
      console.error("에러 메시지:", error.message);
      console.error("스택 트레이스:", error.stack);
      console.error("==========================================\n");
      res.status(500).json({
        success: false,
        message: error.message || "네이버 쇼핑 검색에 실패했습니다.",
      });
    }
  }
);

export default router;
