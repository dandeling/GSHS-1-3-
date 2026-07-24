// NEIS(교육청) 급식 자동 연동
// 환경변수:
//   NEIS_KEY          : NEIS 오픈API 인증키(선택, 없어도 소량 조회 가능)
//   NEIS_ATPT         : 시도교육청코드 (경상남도교육청 기본값 S10)
//   NEIS_SCHOOL_NAME  : 학교명 (기본 '경남과학고등학교')
//   NEIS_SCHOOL_CODE  : 표준학교코드 (지정 시 이름 조회 생략)
const ATPT = process.env.NEIS_ATPT || 'S10';
const SCHOOL_NAME = process.env.NEIS_SCHOOL_NAME || '경남과학고등학교';
const KEY = process.env.NEIS_KEY || '';

let cachedSchoolCode = process.env.NEIS_SCHOOL_CODE || null;

function keyParam() { return KEY ? `KEY=${encodeURIComponent(KEY)}&` : ''; }

// 학교명 → 표준학교코드 조회 (최초 1회, 메모리 캐시)
async function resolveSchoolCode() {
  if (cachedSchoolCode) return cachedSchoolCode;
  const url = `https://open.neis.go.kr/hub/schoolInfo?${keyParam()}Type=json&pIndex=1&pSize=5`
    + `&ATPT_OFCDC_SC_CODE=${ATPT}&SCHUL_NM=${encodeURIComponent(SCHOOL_NAME)}`;
  const res = await fetch(url);
  const data = await res.json();
  const rows = data?.schoolInfo?.[1]?.row;
  if (rows && rows.length) {
    cachedSchoolCode = rows[0].SD_SCHUL_CODE;
    return cachedSchoolCode;
  }
  throw new Error('학교 정보를 찾을 수 없습니다.');
}

// 특정 날짜(YYYY-MM-DD)의 급식을 NEIS에서 가져와 텍스트로 반환. 없으면 null.
export async function fetchMeal(dateStr) {
  const ymd = dateStr.replace(/-/g, '');
  const code = await resolveSchoolCode();
  const url = `https://open.neis.go.kr/hub/mealServiceDietInfo?${keyParam()}Type=json&pIndex=1&pSize=10`
    + `&ATPT_OFCDC_SC_CODE=${ATPT}&SD_SCHUL_CODE=${code}&MLSV_YMD=${ymd}`;
  const res = await fetch(url);
  const data = await res.json();
  const rows = data?.mealServiceDietInfo?.[1]?.row;
  if (!rows || !rows.length) return null;
  // 여러 끼(조/중/석) 합치기
  return rows.map((r) => {
    const meal = (r.MMEAL_SC_NM || '').trim();
    const dish = (r.DDISH_NM || '').replace(/<br\/?>/g, '\n').replace(/\([0-9.]+\)/g, '').trim();
    return `[${meal}]\n${dish}`;
  }).join('\n\n');
}
