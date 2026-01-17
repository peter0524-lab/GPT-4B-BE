/**
 * 전체 파이프라인 실행 스크립트
 * 
 * 1. 마이그레이션 (테이블 생성)
 * 2. 시나리오 데이터 생성
 * 3. source_event 채우기
 * 4. fact 추출
 * 5. 분포 분석
 * 
 * 사용법:
 *   node scripts/run-all.js [--skip-migration] [--skip-generate]
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 스크립트 실행
 */
function runScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`실행: node ${path.basename(scriptPath)} ${args.join(" ")}`);
    console.log("=".repeat(60) + "\n");

    const child = spawn("node", [scriptPath, ...args], {
      cwd: path.join(__dirname, ".."),
      stdio: "inherit",
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`스크립트 실패: ${scriptPath} (exit code: ${code})`));
      }
    });

    child.on("error", reject);
  });
}

/**
 * 사용자 확인
 */
async function confirm(message) {
  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y");
    });
  });
}

/**
 * 메인 실행
 */
async function main() {
  const args = process.argv.slice(2);
  const skipMigration = args.includes("--skip-migration");
  const skipGenerate = args.includes("--skip-generate");

  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║        Fact Extraction 파이프라인 전체 실행                ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log(`\n시간: ${new Date().toISOString()}`);
  console.log(`옵션: skipMigration=${skipMigration}, skipGenerate=${skipGenerate}\n`);

  try {
    // 1. 마이그레이션
    if (!skipMigration) {
      await runScript(path.join(__dirname, "run-migration.js"));
    } else {
      console.log("\n⏭ 마이그레이션 건너뜀");
    }

    // 2. 시나리오 데이터 생성
    if (!skipGenerate) {
      console.log("\n시나리오 기반 더미 데이터를 생성합니다.");
      console.log("기본 시나리오를 사용합니다. (커스텀 시나리오는 별도 실행)");
      
      await runScript(path.join(__dirname, "generate-scenario-data.js"));
    } else {
      console.log("\n⏭ 데이터 생성 건너뜀");
    }

    // 3. source_event 채우기
    await runScript(path.join(__dirname, "populate-source-events.js"));

    // 4. fact 추출
    console.log("\nLLM을 사용하여 fact를 추출합니다. 시간이 걸릴 수 있습니다...");
    await runScript(path.join(__dirname, "extract-facts.js"));

    // 5. 분포 분석
    await runScript(path.join(__dirname, "analyze-distribution.js"));

    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log("║                    파이프라인 완료!                        ║");
    console.log("╚════════════════════════════════════════════════════════════╝\n");

  } catch (error) {
    console.error("\n❌ 오류 발생:", error.message);
    process.exit(1);
  }
}

main();

