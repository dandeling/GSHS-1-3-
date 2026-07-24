// 비속어 목록 관리 파일
// 이 배열에 단어를 추가/삭제하여 필터를 관리하세요.
// 소문자로 관리하며, 검사 시 대소문자/공백/특수문자 일부를 무시합니다.
export const BADWORDS = [
  '시발', '씨발', '씨팔', '시팔', '씨바', '시바', 'ㅅㅂ', 'ㅄ', '병신', 'ㅂㅅ',
  '지랄', '개새끼', '개새', '새끼', '좆', '좇', '존나', '존내', 'ㅈㄴ',
  '엿먹어', '닥쳐', '닥치', '꺼져', '뒤져', '뒈져', '죽어',
  '미친놈', '미친년', '또라이', '등신', '멍청이', '바보같',
  'fuck', 'fucking', 'shit', 'bitch', 'asshole', 'bastard', 'dick',
];

// 검사용 정규화: 공백/일부 특수문자 제거 + 소문자화
function normalize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[\s._\-*~^]/g, '');
}

// 텍스트에 포함된 비속어 개수(중복 단어 종류 기준)를 반환
export function countBadwords(text) {
  if (!text) return 0;
  const norm = normalize(text);
  let count = 0;
  for (const w of BADWORDS) {
    const nw = normalize(w);
    if (nw && norm.includes(nw)) count += 1;
  }
  return count;
}

// 비속어 포함 여부
export function hasBadword(text) {
  return countBadwords(text) > 0;
}
