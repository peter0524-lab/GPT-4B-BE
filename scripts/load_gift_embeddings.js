import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { loadGiftDataFromCSV } from "../src/services/chromadb.service.js";
import { testConnection } from "../src/config/chromadb.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Prefer backend .env if present
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const csvArg = process.argv[2];
const csvPath = csvArg
  ? path.resolve(csvArg)
  : path.resolve(__dirname, "..", "df_gift__embeddings.csv");

console.log(`🔎 CSV 경로: ${csvPath}`);

const main = async () => {
  try {
    // ChromaDB 연결 테스트
    console.log("🔌 ChromaDB 연결 확인 중...");
    const chromaDbPath = process.env.CHROMADB_PATH || "http://localhost:8000";
    console.log(`📍 ChromaDB 경로: ${chromaDbPath}`);

    const isConnected = await testConnection();
    if (!isConnected) {
      console.error("\n❌ ChromaDB 서버에 연결할 수 없습니다.");
      console.error("\n📋 ChromaDB 서버를 시작하는 방법:");
      console.error("\n1. Docker를 사용하는 경우:");
      console.error("   docker run -d -p 8000:8000 chromadb/chroma");
      console.error("\n2. Python을 사용하는 경우:");
      console.error("   pip install chromadb");
      console.error("   chroma run --path ./chroma_data --port 8000");
      console.error("\n3. 환경 변수 설정:");
      console.error("   .env 파일에 CHROMADB_PATH=http://localhost:8000 추가");
      console.error("\n서버가 실행 중인지 확인한 후 다시 시도해주세요.");
      process.exit(1);
    }

    console.log("✅ ChromaDB 연결 성공!\n");

    // CSV 업로드
    const result = await loadGiftDataFromCSV(csvPath);
    console.log(
      `✅ 업로드 완료: 총 ${result.totalRecords}개 중 ${result.savedRecords}개 저장 (건너뜀 ${result.skippedRecords}개)`
    );
    process.exit(0);
  } catch (error) {
    console.error("❌ 업로드 실패:", error.message);
    if (
      error.message.includes("connect") ||
      error.message.includes("ECONNREFUSED")
    ) {
      console.error("\n💡 ChromaDB 서버가 실행 중인지 확인해주세요.");
    }
    process.exit(1);
  }
};

main();
