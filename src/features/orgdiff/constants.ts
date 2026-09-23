import type { DocSide } from './types';

/** NEXT_PUBLIC_USE_MOCK=1 — демо без LLM: результат из mock.json */
export const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === '1';

/** Как часто опрашивать GET /api/analyze/{jobId} */
export const JOB_POLL_MS = 1500;

/** Мок проигрывает trace из mock.json с такой скоростью на шаг */
export const MOCK_STEP_MS = 450;

/** Сколько шагов обычно в trace пайплайна — для полосы прогресса до прихода результата */
export const EXPECTED_TRACE_STEPS = 11;

export const ANALYZE_ENDPOINT = '/api/analyze';

export const ACCEPTED_FILES = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx']
};

export const ACCEPTED_EXTENSIONS_LABEL = '.docx, .pdf, .xlsx';

export const MAX_FILE_SIZE = 20 * 1024 * 1024;

export const MAX_FILES_PER_SIDE = 20;

export const SIDE_LABELS: Record<DocSide, { title: string; description: string }> = {
  before: {
    title: 'Комплект ДО',
    description: 'Документы до реорганизации: положения, оргструктура, приказы'
  },
  after: {
    title: 'Комплект ПОСЛЕ',
    description: 'Документы после реорганизации в той же комплектности'
  }
};

/** Тестовый комплект для жюри: копии data/*.docx в public/samples */
export const SAMPLE_SET: Record<DocSide, { url: string; name: string }[]> = {
  before: [{ url: '/samples/before_polozhenie_red8.docx', name: 'before_polozhenie_red8.docx' }],
  after: [{ url: '/samples/after_polozhenie_red9.docx', name: 'after_polozhenie_red9.docx' }]
};

export const SAMPLE_SET_LABEL = 'Положение о внутреннем аудите, ред. 8 → ред. 9';
