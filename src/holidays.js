// 대한민국 공휴일 (자체 내장 데이터 — 외부 API 불필요)
// 양력 고정 공휴일은 매년 자동, 음력 기반(설날·추석·부처님오신날)과 대체공휴일은
// 연도별 실제 날짜 표를 사용합니다. 새 연도가 필요하면 VARIABLE에 추가하세요.

// 매년 반복되는 양력 공휴일 (MM-DD)
const FIXED = {
  '01-01': '신정',
  '03-01': '삼일절',
  '05-05': '어린이날',
  '06-06': '현충일',
  '08-15': '광복절',
  '10-03': '개천절',
  '10-09': '한글날',
  '12-25': '크리스마스',
};

// 음력 기반·대체공휴일 (YYYY-MM-DD → 이름)
const VARIABLE = {
  // 2025
  '2025-01-28': '설날 연휴', '2025-01-29': '설날', '2025-01-30': '설날 연휴',
  '2025-03-03': '대체공휴일',
  '2025-05-05': '부처님오신날',
  '2025-05-06': '대체공휴일',
  '2025-10-05': '추석 연휴', '2025-10-06': '추석', '2025-10-07': '추석 연휴', '2025-10-08': '대체공휴일',
  // 2026
  '2026-02-16': '설날 연휴', '2026-02-17': '설날', '2026-02-18': '설날 연휴',
  '2026-03-02': '대체공휴일',
  '2026-05-24': '부처님오신날', '2026-05-25': '대체공휴일',
  '2026-09-24': '추석 연휴', '2026-09-25': '추석', '2026-09-26': '추석 연휴',
  '2026-10-05': '대체공휴일',
  // 2027
  '2027-02-06': '설날 연휴', '2027-02-07': '설날', '2027-02-08': '설날 연휴',
  '2027-05-13': '부처님오신날',
  '2027-09-14': '추석 연휴', '2027-09-15': '추석', '2027-09-16': '추석 연휴',
};

// 특정 날짜(YYYY-MM-DD)의 공휴일명 (없으면 null)
export function holidayName(dateStr) {
  if (!dateStr) return null;
  const mmdd = dateStr.slice(5, 10);
  return VARIABLE[dateStr] || FIXED[mmdd] || null;
}

// 해당 월의 공휴일 목록 [{date, name}]
export function holidaysInMonth(year, month) {
  const mm = String(month).padStart(2, '0');
  const out = [];
  for (const [md, name] of Object.entries(FIXED)) {
    if (md.startsWith(mm + '-')) out.push({ date: `${year}-${md}`, name });
  }
  for (const [date, name] of Object.entries(VARIABLE)) {
    if (date.startsWith(`${year}-${mm}-`)) out.push({ date, name });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}
