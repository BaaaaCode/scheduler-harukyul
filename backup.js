"use strict";
/* 백업 솎아내기 규칙만 담은 모듈.
   Electron에 의존하지 않아 `node` 로 바로 테스트할 수 있다. */

const BACKUP_DAILY_DAYS = 14;    // 최근 14일: 매일 보관
const BACKUP_WEEKLY_DAYS = 70;   // 그 이후 ~8주: 주 1개
const BACKUP_MONTHLY_DAYS = 400; // 그 이후 ~1년: 월 1개 (넘으면 삭제)

const NAME_RE = /^harukyul-(\d{4})-(\d{2})-(\d{2})\.json$/;

/* 파일 날짜로 주·월 버킷 키를 만든다.

   예전에는 "오늘 기준 며칠 전"으로 버킷을 잡았다. 그 값은 매일 1씩 늘어나므로
   어제 주(週) 대표였던 파일이 오늘은 대표 자리를 잃고 삭제되는 일이 매일 반복됐다.
   결과적으로 14일이 지난 백업은 하나도 살아남지 못했다.

   버킷 키가 "그 파일의 날짜"에만 의존하면 시간이 지나도 대표가 바뀌지 않는다. */
function isoWeekKey(d) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7) + 3);     // 그 주의 목요일
  const firstThu = new Date(t.getFullYear(), 0, 4);
  firstThu.setDate(firstThu.getDate() - ((firstThu.getDay() + 6) % 7) + 3);
  const week = 1 + Math.round((t - firstThu) / (7 * 86400000));
  return t.getFullYear() + "-W" + String(week).padStart(2, "0");
}

function monthKey(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

function parseName(n) {
  const m = n.match(NAME_RE);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}

/* 남길 파일 이름 집합. 파일 시스템을 건드리지 않는다. */
function planBackupKeep(names, today) {
  const DAY = 86400000;
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const items = names
    .map((n) => {
      const d = parseName(n);
      if (!d) return null;
      return { name: n, date: d, ageDays: Math.round((t0 - d) / DAY) };
    })
    .filter(Boolean)
    .sort((a, b) => b.date - a.date);   // 최신 먼저 → 각 버킷 대표는 그 버킷의 최신본

  const keep = new Set();
  const seenWeek = new Set();
  const seenMonth = new Set();
  items.forEach((it) => {
    if (it.ageDays < 0 || it.ageDays <= BACKUP_DAILY_DAYS) {
      keep.add(it.name);                // 미래 날짜(시계 변경) 또는 최근 14일
    } else if (it.ageDays <= BACKUP_WEEKLY_DAYS) {
      const wk = isoWeekKey(it.date);
      if (!seenWeek.has(wk)) { seenWeek.add(wk); keep.add(it.name); }
    } else if (it.ageDays <= BACKUP_MONTHLY_DAYS) {
      const mo = monthKey(it.date);
      if (!seenMonth.has(mo)) { seenMonth.add(mo); keep.add(it.name); }
    }
    // BACKUP_MONTHLY_DAYS 초과 → keep 안 함 → 삭제
  });
  return keep;
}

module.exports = {
  BACKUP_DAILY_DAYS, BACKUP_WEEKLY_DAYS, BACKUP_MONTHLY_DAYS,
  NAME_RE, isoWeekKey, monthKey, parseName, planBackupKeep
};
