// 자료공유 게시판 과목 15개
export const SUBJECTS = [
  { code: 'math1',   name: '수학1' },
  { code: 'math2',   name: '수학2' },
  { code: 'math3',   name: '수학3' },
  { code: 'phys1',   name: '물리1' },
  { code: 'phys2',   name: '물리2' },
  { code: 'chem1',   name: '화학1' },
  { code: 'chem2',   name: '화학2' },
  { code: 'bio1',    name: '생명1' },
  { code: 'bio2',    name: '생명2' },
  { code: 'intsci',  name: '통합과학' },
  { code: 'info1',   name: '정보1' },
  { code: 'info2',   name: '정보2' },
  { code: 'korean',  name: '국어' },
  { code: 'english', name: '영어' },
  { code: 'etc',     name: '기타' },
];

export const SUBJECT_CODES = SUBJECTS.map((s) => s.code);

// 자료 카테고리: 수행평가 / 시험
export const CATEGORIES = [
  { code: 'perf', name: '수행평가 자료' },
  { code: 'exam', name: '시험 자료' },
];
export const CATEGORY_CODES = CATEGORIES.map((c) => c.code);

export const BOARDS = ['notice', 'free', 'resource'];

// 학교 이메일 형식: (기수)gshs-(학번)@g.gne.go.kr  예) 43gshs-1319@g.gne.go.kr
export const SCHOOL_EMAIL_REGEX = /^(\d{1,3})gshs-(\d{3,5})@g\.gne\.go\.kr$/;
