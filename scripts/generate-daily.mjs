/**
 * generate-daily.mjs — 데일리 퍼즐(스탠다드/익스텐디드)을 생성해 daily/<date>.json 으로 저장.
 *
 *   node scripts/generate-daily.mjs                # KST 오늘 + 내일
 *   node scripts/generate-daily.mjs 2026-09-02     # 특정 날짜
 *   node scripts/generate-daily.mjs 2026-09-02 5   # 2026-09-02 부터 5일치
 *
 * 이미 파일이 있으면 건너뛴다(멱등). GitHub Actions 크론이 매일 호출한다.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { seedRng } from '../src/generator/random.js';
import { buildTemplateFromSelection } from '../src/generator/composeTemplate.js';
import { generatePuzzle } from '../src/generator/generatePuzzle.js';
import { dailySelections, dailySeed } from '../src/daily/dailyConfig.js';
import { dateStrKST, shiftDateStr } from '../src/daily/dateUtil.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DAILY_DIR = path.join(__dirname, '..', 'daily');

async function generateForDate(dateStr) {
  const outPath = path.join(DAILY_DIR, `${dateStr}.json`);
  if (existsSync(outPath)) {
    console.log(`· ${dateStr} 이미 있음 — 건너뜀`);
    return false;
  }

  const { meta, standard, extended } = dailySelections(dateStr);
  console.log(`▶ ${dateStr} 생성 중 (모양=${meta.shapeId}, main=${meta.main}, sub=${meta.sub})`);

  seedRng(dailySeed(dateStr) + ':standard');
  const stdTemplate = buildTemplateFromSelection(standard);
  const std = await generatePuzzle(stdTemplate);

  seedRng(dailySeed(dateStr) + ':extended');
  const extTemplate = buildTemplateFromSelection(extended);
  const ext = await generatePuzzle(extTemplate);

  const payload = {
    date: dateStr,
    shape: { id: meta.shapeId, boards: stdTemplate.boards },
    difficulty: meta.difficulty,
    standard: {
      structures: std.structures,
      givens: std.givens,
      solution: std.solution,
    },
    extended: {
      structures: ext.structures,
      givens: ext.givens,
      solution: ext.solution,
      elements: { main: meta.main, sub: meta.sub },
    },
    generatedAt: new Date().toISOString(),
  };

  await mkdir(DAILY_DIR, { recursive: true });
  await writeFile(outPath, JSON.stringify(payload) + '\n', 'utf8');
  console.log(`✓ ${dateStr} 저장 (standard givens=${std.givens.length}, extended givens=${ext.givens.length})`);
  return true;
}

async function main() {
  const [arg1, arg2] = process.argv.slice(2);
  const startDate = arg1 || dateStrKST();
  const count = arg1 ? (Number(arg2) || 1) : 2; // 인자 없으면 오늘+내일

  let wrote = 0;
  for (let i = 0; i < count; i++) {
    const dateStr = shiftDateStr(startDate, i);
    try {
      if (await generateForDate(dateStr)) wrote++;
    } catch (err) {
      console.error(`✗ ${dateStr} 실패:`, err.message);
      process.exitCode = 1;
    }
  }
  console.log(`완료 — ${wrote}개 새로 생성`);
}

main();
