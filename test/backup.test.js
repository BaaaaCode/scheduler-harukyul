"use strict";
/* 백업 솎아내기 규칙 검증. 파일을 만들지 않고 이름 목록만 가지고 돌린다.
   실행:  node test/backup.test.js  */
const { planBackupKeep, isoWeekKey, monthKey } = require("../backup");

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log("  FAIL " + msg); } }
function name(d) {
  return "harukyul-" + d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0") + ".json";
}
function addDays(d, n) { const t = new Date(d); t.setDate(t.getDate() + n); return t; }

/* ── 1. 하루하루 굴려본다 ──────────────────────────────────
   매일 백업을 하나 만들고, 그날 기준으로 솎아낸다. 이걸 200일 반복한다.
   예전 구현은 여기서 14일 넘은 파일이 전부 사라졌다. */
(function rollForward() {
  const start = new Date(2026, 0, 1);
  let files = [];
  for (let i = 0; i < 200; i++) {
    const today = addDays(start, i);
    files.push(name(today));                       // 그날 백업 생성
    const keep = planBackupKeep(files, today);     // 그날의 솎아내기
    files = files.filter((n) => keep.has(n));      // 살아남은 것만
  }
  const last = addDays(start, 199);

  console.log("200일 후 남은 백업: " + files.length + "개");
  files.sort();                                  // 이름이 날짜라 사전순 = 시간순
  console.log("  가장 오래된 것: " + files[0]);

  ok(files.length >= 20, "파일이 20개 이상 남아야 한다 (실제 " + files.length + ")");

  const oldest = files[0].match(/(\d{4})-(\d{2})-(\d{2})/);
  const oldestDate = new Date(+oldest[1], +oldest[2] - 1, +oldest[3]);
  const ageDays = Math.round((last - oldestDate) / 86400000);
  console.log("  가장 오래된 것의 나이: " + ageDays + "일");
  ok(ageDays > 150, "150일 넘은 복구 지점이 남아야 한다 (실제 " + ageDays + "일)");

  // 최근 14일은 하루도 빠짐없이
  for (let i = 0; i <= 14; i++) {
    ok(files.indexOf(name(addDays(last, -i))) >= 0, "최근 " + i + "일 전 백업이 있어야 한다");
  }

  // 월별로 최소 하나씩은 남아 있어야 한다
  const months = new Set(files.map((n) => n.slice(9, 16)));
  console.log("  남은 달: " + Array.from(months).sort().join(", "));
  ok(months.size >= 5, "여러 달의 복구 지점이 남아야 한다 (실제 " + months.size + "달)");
})();

/* ── 2. 400일이 넘으면 지운다 ── */
(function tooOld() {
  const today = new Date(2026, 5, 1);
  const old = addDays(today, -500);
  const keep = planBackupKeep([name(old), name(today)], today);
  ok(!keep.has(name(old)), "500일 지난 백업은 지워야 한다");
  ok(keep.has(name(today)), "오늘 백업은 남겨야 한다");
})();

/* ── 3. 시계가 미래로 틀어져도 안 지운다 ── */
(function future() {
  const today = new Date(2026, 5, 1);
  const future = addDays(today, 30);
  const keep = planBackupKeep([name(future)], today);
  ok(keep.has(name(future)), "미래 날짜 백업은 지우지 않는다");
})();

/* ── 4. 버킷 키가 날짜에만 의존하는지 ── */
(function stableKeys() {
  const d = new Date(2026, 8, 3);
  ok(isoWeekKey(d) === isoWeekKey(new Date(2026, 8, 3)), "같은 날짜면 같은 주 키");
  ok(monthKey(d) === "2026-09", "월 키 형식 (실제 " + monthKey(d) + ")");
  ok(isoWeekKey(new Date(2026, 0, 1)).indexOf("-W") > 0, "주 키 형식");
})();

/* ── 5. 백업 아닌 파일은 건드리지 않는다 ── */
(function ignoresOthers() {
  const today = new Date(2026, 5, 1);
  const keep = planBackupKeep(["메모.txt", "harukyul-data.json", name(today)], today);
  ok(!keep.has("메모.txt"), "무관한 파일은 keep 목록에 없다 (pruneBackups 가 따로 거른다)");
  ok(keep.has(name(today)), "백업 파일은 남는다");
})();

console.log("\n" + pass + " 통과 / " + fail + " 실패");
process.exit(fail ? 1 : 0);
