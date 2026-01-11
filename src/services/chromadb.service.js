import { getOrCreateCollection } from "../config/chromadb.js";
import { logger } from "../utils/logger.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * CSV 파일을 파싱하여 배열로 변환
 * @param {string} csvPath - CSV 파일 경로
 * @returns {Array} 파싱된 데이터 배열
 */
const parseCSV = (csvPath) => {
  try {
    const csvContent = fs.readFileSync(csvPath, "utf-8");
    const lines = csvContent.split("\n").filter((line) => line.trim());

    if (lines.length === 0) {
      throw new Error("CSV 파일이 비어있습니다.");
    }

    // 헤더 파싱
    const headers = lines[0]
      .split(",")
      .map((h) => h.trim().replace(/^"|"$/g, ""));

    // 데이터 파싱
    const data = [];
    for (let i = 1; i < lines.length; i++) {
      const values = [];
      let currentValue = "";
      let inQuotes = false;

      // 따옴표 처리하여 CSV 파싱
      for (let j = 0; j < lines[i].length; j++) {
        const char = lines[i][j];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === "," && !inQuotes) {
          values.push(currentValue.trim().replace(/^"|"$/g, ""));
          currentValue = "";
        } else {
          currentValue += char;
        }
      }
      values.push(currentValue.trim().replace(/^"|"$/g, ""));

      if (values.length === headers.length) {
        const row = {};
        headers.forEach((header, index) => {
          row[header] = values[index] || "";
        });
        data.push(row);
      }
    }

    return data;
  } catch (error) {
    logger.error("CSV 파싱 오류", error);
    throw error;
  }
};

/**
 * embedding_json 문자열을 배열로 파싱
 * @param {string} embeddingJson - JSON 문자열
 * @returns {Array} 임베딩 벡터 배열
 */
const parseEmbedding = (embeddingJson) => {
  try {
    if (!embeddingJson || embeddingJson.trim() === "") {
      return null;
    }
    return JSON.parse(embeddingJson);
  } catch (error) {
    console.error("❌ 임베딩 파싱 오류:", error.message);
    return null;
  }
};

/**
 * CSV 파일에서 데이터를 읽어서 ChromaDB에 저장
 * @param {string} csvPath - CSV 파일 경로
 * @returns {Object} 저장 결과
 */
const parsePriceToNumber = (price) => {
  if (!price) return null;
  const numeric = parseInt(String(price).replace(/[^0-9]/g, ""), 10);
  return Number.isNaN(numeric) ? null : numeric;
};

const loadGiftDataFromCSV = async (csvPath) => {
  try {
    // CSV 파일 파싱
    const csvData = parseCSV(csvPath);
    console.log(`📄 CSV 파일에서 ${csvData.length}개의 레코드를 읽었습니다.`);

    // 컬렉션 가져오기 또는 생성
    const collection = await getOrCreateCollection();

    // 데이터 준비 (배치 업로드 대비)
    const BATCH_SIZE = 100;
    const ids = [];
    const documents = [];
    const embeddings = [];
    const metadatas = [];
    let savedCount = 0;

    for (const row of csvData) {
      // 필수 필드 확인
      if (!row.index || !row.unified_text) {
        console.warn(`⚠️  index 또는 unified_text가 없는 레코드를 건너뜁니다.`);
        continue;
      }

      // 임베딩 파싱
      const embedding = parseEmbedding(row.embedding_json);
      if (!embedding || !Array.isArray(embedding)) {
        console.warn(
          `⚠️  유효한 임베딩이 없는 레코드 (index: ${row.index})를 건너뜁니다.`
        );
        continue;
      }

      // 데이터 추가
      ids.push(String(row.index));
      documents.push(row.unified_text);
      embeddings.push(embedding);

      // 메타데이터 준비 (임베딩 관련 필드 제외)
      const priceNumber = parsePriceToNumber(row.price);
      const metadata = {
        url: row.url || "",
        name: row.name || "",
        price: row.price || "",
        price_num: priceNumber,
        image: row.image || "",
        category: row.category || "",
        product_name: row.product_name || "",
        event: row.event || "",
        vibe: row.vibe || "",
        utility: row.utility || "",
        etc: row.etc || "",
      };

      metadatas.push(metadata);
    }

    if (ids.length === 0) {
      throw new Error("저장할 유효한 데이터가 없습니다.");
    }

    console.log(`📦 ${ids.length}개의 레코드를 ChromaDB에 배치 저장 중...`);

    // 배치 업로드로 Payload too large 방지
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = {
        ids: ids.slice(i, i + BATCH_SIZE),
        documents: documents.slice(i, i + BATCH_SIZE),
        embeddings: embeddings.slice(i, i + BATCH_SIZE),
        metadatas: metadatas.slice(i, i + BATCH_SIZE),
      };

      await collection.add(batch);
      savedCount += batch.ids.length;
      console.log(`  → ${savedCount}/${ids.length} 저장 완료`);
    }

    console.log(`✅ ${savedCount}개의 레코드가 성공적으로 저장되었습니다.`);

    return {
      success: true,
      totalRecords: csvData.length,
      savedRecords: savedCount,
      skippedRecords: csvData.length - savedCount,
    };
  } catch (error) {
    console.error("❌ ChromaDB 저장 오류:", error.message);
    throw error;
  }
};

/**
 * ChromaDB에서 유사한 선물 검색 (임베딩 벡터 기반 cosine similarity)
 * @param {Array} queryEmbedding - 검색할 임베딩 벡터
 * @param {number} nResults - 반환할 결과 수 (기본값: 5, 코사인 유사도로 선정)
 * @param {number} priceMin - 최소 가격 (원 단위, 선택사항)
 * @param {number} priceMax - 최대 가격 (원 단위, 선택사항)
 * @returns {Array} 검색 결과
 */
const searchSimilarGifts = async (
  queryEmbedding,
  nResults = 5, // 기본값: 코사인 유사도로 5개 선정
  priceMin = null,
  priceMax = null
) => {
  try {
    const collection = await getOrCreateCollection();

    // 가격 필터 확인
    const hasMin = Number.isFinite(priceMin) && priceMin > 0;
    const hasMax = Number.isFinite(priceMax) && priceMax > 0;
    
    // cosine similarity 계산을 위해 임베딩 벡터만 사용
    // 가격 필터링은 후처리로 수행 (where clause 사용 안 함)
    const queryOptions = {
      queryEmbeddings: [queryEmbedding],
      nResults: hasMin || hasMax ? nResults * 5 : nResults, 
      // 가격 필터링 시: 더 많은 후보를 가져와서 필터링 후 nResults개 확보
      // 가격 필터링 없을 시: 코사인 유사도로 nResults개 직접 반환
      include: ["documents", "metadatas", "distances"],
    };

    const results = await collection.query(queryOptions);

    // 가격 범위로 후처리 필터링
    if ((hasMin || hasMax) && results?.ids?.[0]) {
      const filtered = { 
        ids: [[]], 
        metadatas: [[]], 
        distances: [[]], 
        documents: [[]] 
      };
      
      results.ids[0].forEach((id, idx) => {
        const metadata = results.metadatas?.[0]?.[idx] || {};
        
        // price_num이 있으면 사용, 없으면 price 문자열에서 파싱 시도
        let priceNum = null;
        if (metadata.price_num !== undefined && metadata.price_num !== null) {
          priceNum = Number(metadata.price_num);
        } else if (metadata.price) {
          // price 문자열에서 숫자 추출 (예: "49000", "49,000", "₩49,000")
          const priceStr = String(metadata.price).replace(/[^\d]/g, '');
          priceNum = priceStr ? Number(priceStr) : null;
        }
        
        // 가격 필터링 조건 확인
        const priceOk = 
          (!hasMin || (priceNum !== null && !isNaN(priceNum) && priceNum >= priceMin)) &&
          (!hasMax || (priceNum !== null && !isNaN(priceNum) && priceNum <= priceMax));
        
        if (priceOk) {
          filtered.ids[0].push(id);
          filtered.metadatas[0].push(metadata);
          filtered.distances[0].push(results.distances?.[0]?.[idx]);
          filtered.documents[0].push(results.documents?.[0]?.[idx]);
        }
      });

      // 상위 nResults만 남김 (distance 기준으로 정렬되어 있음)
      const finalCount = Math.min(filtered.ids[0].length, nResults);
      return {
        ids: [filtered.ids[0].slice(0, finalCount)],
        metadatas: [filtered.metadatas[0].slice(0, finalCount)],
        distances: [filtered.distances[0].slice(0, finalCount)],
        documents: [filtered.documents[0].slice(0, finalCount)],
      };
    }

    // 가격 필터가 없으면 그대로 반환
    return {
      ...results,
      ids: [results.ids?.[0]?.slice(0, nResults) || []],
      metadatas: [results.metadatas?.[0]?.slice(0, nResults) || []],
      distances: [results.distances?.[0]?.slice(0, nResults) || []],
      documents: [results.documents?.[0]?.slice(0, nResults) || []],
    };
  } catch (error) {
    logger.error("ChromaDB 검색 오류", error);
    throw error;
  }
};

/**
 * ChromaDB 컬렉션의 모든 데이터 조회
 * @param {number} limit - 조회할 최대 개수
 * @returns {Object} 조회 결과
 */
const getAllGifts = async (limit = 100) => {
  try {
    const collection = await getOrCreateCollection();

    const results = await collection.get({
      limit: limit,
    });

    return results;
  } catch (error) {
    console.error("❌ ChromaDB 조회 오류:", error.message);
    throw error;
  }
};

/**
 * ChromaDB 컬렉션 초기화 (모든 데이터 삭제)
 * @returns {boolean} 성공 여부
 */
const clearCollection = async () => {
  try {
    const { chromaClient, COLLECTION_NAME } = await import(
      "../config/chromadb.js"
    );

    // 컬렉션 삭제
    await chromaClient.deleteCollection({ name: COLLECTION_NAME });
    console.log("✅ ChromaDB 컬렉션이 삭제되었습니다.");

    // 새 컬렉션 생성
    await getOrCreateCollection();
    console.log("✅ 새로운 ChromaDB 컬렉션이 생성되었습니다.");

    return true;
  } catch (error) {
    console.error("❌ ChromaDB 초기화 오류:", error.message);
    throw error;
  }
};

export {
  loadGiftDataFromCSV,
  searchSimilarGifts,
  getAllGifts,
  clearCollection,
  parseCSV,
  parseEmbedding,
};

