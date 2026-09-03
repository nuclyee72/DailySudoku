/**
 * generate-daily.mjs — 데일리 퍼즐(스탠다드/익스텐디드)을 생성해 daily/<date>.json 으로 저장.
 *
 *   node scripts/generate-daily.mjs                # KST 오늘 + 앞으로 3일 (버퍼)
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
import { getShape } from '../src/generator/shapes.js';
import { generatePuzzle } from '../src/generator/generatePuzzle.js';
import { solveBoard } from '../src/generator/solveBoard.js';
import { reviveStructures } from '../src/puzzles/reviveStructures.js';
import { Board } from '../src/core/Board.js';
import { Validator } from '../src/core/Validator.js';
import { dailySelections, dailySeed } from '../src/daily/dailyConfig.js';
import { dateStrKST, shiftDateStr } from '../src/daily/dateUtil.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DAILY_DIR = path.join(__dirname, '..', 'daily');

/** 생성된 퍼즐이 실제로 멀쩡한지 — givens 충돌 0, 저장 solution 이 모든 규칙 만족·완성, 백트래킹 유일해 */
function puzzleIsSound(puzzle) {
  const structs = reviveStructures(puzzle.structures);

  // 1) givens 만으로 충돌이 없어야 한다
  const gb = new Board(); gb.addStructures(structs); gb.loadGivens(puzzle.givens);
  Validator.validate(gb);
  if (gb.getVisibleCells().some((c) => c.isConflict)) return 'givens 충돌';

  // 2) 저장된 solution(턴테이블 칸 제외)을 채우면 — 충돌 0, isSolved, 모든 규칙 통과
  const sb = new Board(); sb.addStructures(reviveStructures(puzzle.structures)); sb.loadGivens(puzzle.givens);
  for (const s of puzzle.solution) { const c = sb.getCell(s.row, s.col); if (c) c.value = s.value; }
  Validator.validate(sb);
  if (sb.getVisibleCells().some((c) => c.isConflict)) return 'solution 충돌';
  if (!sb.isSolved()) return 'solution 미완성';
  for (const st of sb.structures) {
    if (st.type === 'snake') continue; // 스네이크는 렌더러 외곽선으로 따로 검사
    if ((st.validate(sb) ?? []).length) return `규칙 위반(${st.type})`;
  }
  return null;
}

/**
 * 생성 → 검증(위 puzzleIsSound + 백트래킹 솔버로 저장 solution 과 유일 일치) → 아니면 시드 바꿔 재시도.
 */
async function generateVerified(seed, selection, tries = 12) {
  for (let i = 0; i < tries; i++) {
    seedRng(i === 0 ? seed : `${seed}:r${i}`);
    const puzzle = await generatePuzzle(buildTemplateFromSelection(selection));
    const flaw = puzzleIsSound(puzzle);
    if (!flaw) {
      const sol = await solveBoard(reviveStructures(puzzle.structures), puzzle.givens);
      if (sol && puzzle.solution.every((s) => sol.get(`${s.row},${s.col}`) === s.value)) return puzzle;
    }
    console.log(`  ⚠ ${seed} (${i + 1}/${tries}): ${flaw || '유일해 아님'} — 시드 바꿔 재시도`);
  }
  throw new Error(`${seed}: 멀쩡한 퍼즐을 못 만듦`);
}

async function generateForDate(dateStr) {
  const outPath = path.join(DAILY_DIR, `${dateStr}.json`);
  if (existsSync(outPath)) {
    console.log(`· ${dateStr} 이미 있음 — 건너뜀`);
    return false;
  }

  const { meta, standard, extended } = dailySelections(dateStr);
  console.log(`▶ ${dateStr} 생성 중 (모양=${meta.shapeId}, main=${meta.main}, sub=${meta.sub})`);

  const std = await generateVerified(`${dailySeed(dateStr)}:standard`, standard);
  const ext = await generateVerified(`${dailySeed(dateStr)}:extended`, extended);

  const payload = {
    date: dateStr,
    shape: { id: meta.shapeId, boards: getShape(meta.shapeId).boards },
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
  // 인자 없으면 오늘 + 앞으로 3일치를 미리 만든다 — 크론이 하루이틀 밀리거나 스킵돼도 버틴다.
  const count = arg1 ? (Number(arg2) || 1) : 4;

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
