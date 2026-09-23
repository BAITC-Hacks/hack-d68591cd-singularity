/**
 * Контракт между пайплайном (A) и интерфейсом (B).
 * Правки — только по договорённости: от этого файла зависят оба.
 */

/** Сторона сравнения: комплект документов «до» или «после» реорганизации. */
export type DocSide = 'before' | 'after';

/** Загруженный документ комплекта. */
export interface SourceDoc {
  side: DocSide;
  /** Имя исходного файла — показывается пользователю вместе с пунктом */
  name: string;
  clauseCount: number;
  /** «Положение о внутреннем аудите АО «Компания», ред. 9 от 23 декабря 2022 года» — если удалось извлечь из шапки */
  title?: string;
  /** «ред. 9» */
  short?: string;
}

/**
 * Пункт документа — атомарная единица прослеживаемости.
 * Must have 4 ТЗ: каждый вывод ссылается на документ и пункт,
 * поэтому всё в пайплайне оперирует id пункта, а не свободным текстом.
 */
export interface Clause {
  /** Номер пункта как в документе: "3.4", "2.3.1", "3.4.а" */
  id: string;
  side: DocSide;
  docName: string;
  /** Номер раздела верхнего уровня: "3" */
  section: string;
  /** Заголовок раздела: "Структура и организация работы внутреннего аудита" */
  sectionTitle: string;
  text: string;
}

/** Ссылка на источник. Без неё вывод не показывается — ограничение 9 ТЗ. */
export interface Evidence {
  side: DocSide;
  docName: string;
  clauseId: string;
  /** Дословная цитата из пункта */
  quote: string;
  /** Цитата найдена в тексте пункта автоматической проверкой */
  verified: boolean;
}

/**
 * Что произошло с подразделением (must have 1).
 * reorganized — подразделение сохранилось, но изменились состав, подчинённость или функции.
 */
export type UnitStatus = 'created' | 'retained' | 'reorganized' | 'removed';

export interface UnitChange {
  /** Стабильный ключ узла на схеме: "u-dnm" */
  id: string;
  name: string;
  abbr?: string;
  /** unit — подразделение, position — самостоятельная должность вне подразделений */
  kind: 'unit' | 'position';
  status: UnitStatus;
  /** Одна строка: что изменилось */
  summary: string;
  /** Должности в подчинении — для узла схемы */
  positions: { before: string[]; after: string[] };
  evidence: Evidence[];
  /** UnitChange.id руководителя по каждой стороне (подчинённость для схемы); нет — верхний уровень */
  parentId?: { before?: string; after?: string };
}

/** Ребро схемы «до → после»: куда ушли функции подразделения. */
export interface UnitFlow {
  /** UnitChange.id на стороне «до» */
  from: string;
  /** UnitChange.id на стороне «после» */
  to: string;
  /** retained — то же подразделение, transferred — функции переданы другому */
  kind: 'retained' | 'transferred';
  functionCount: number;
  evidence: Evidence[];
  /** FunctionMatch.id всех функций, давших это ребро (functionCount === matchIds.length) */
  matchIds?: string[];
}

/** Атомарная функция подразделения (must have 2 и 3). */
export interface UnitFunction {
  id: string;
  side: DocSide;
  /** UnitChange.id носителей; пусто — функция закреплена за блоком в целом */
  unitIds: string[];
  /** Нормализованная формулировка: «действие + объект» */
  text: string;
  clauseId: string;
  /** Дословная цитата из пункта */
  quote: string;
}

export type MatchStatus =
  /** У того же подразделения, смысл тот же */
  | 'kept'
  /** Перешла к другому подразделению */
  | 'moved'
  /** Сохранилась, но объём сужен */
  | 'narrowed'
  /** Сохранилась, объём расширен */
  | 'expanded'
  /** Не нашлась ни у кого в «после» */
  | 'lost'
  /** Новая в «после» */
  | 'added';

/** Строка таблицы сопоставления функций «до/после». */
export interface FunctionMatch {
  id: string;
  status: MatchStatus;
  /** UnitFunction.id; нет у added */
  beforeId?: string;
  /** UnitFunction.id пунктов «после», которые покрывают функцию; у lost — пункты лишь частичного покрытия (обычно пусто) */
  afterIds: string[];
  /** Почему так решено — одно-два предложения */
  explanation: string;
  confidence: number;
}

export type FindingKind =
  | 'unit_created'
  | 'unit_removed'
  | 'unit_reorganized'
  /** Функция была в «до» и не нашлась ни у кого в «после» */
  | 'function_lost'
  /** Объём функции сужен */
  | 'function_narrowed'
  /** Одна функция закреплена за двумя и более подразделениями */
  | 'function_duplicated'
  /** Пересечение зон ответственности */
  | 'responsibility_overlap'
  /** Потенциальный конфликт интересов / нарушение независимости */
  | 'conflict_of_interest'
  /** Дефект документа: ссылка на несуществующий пункт или устаревшая после перенумерации */
  | 'doc_defect';

export const FINDING_KIND_LABELS: Record<FindingKind, string> = {
  unit_created: 'Создано подразделение',
  unit_removed: 'Упразднено подразделение',
  unit_reorganized: 'Реорганизация подразделения',
  function_lost: 'Потеря функции',
  function_narrowed: 'Сужение функции',
  function_duplicated: 'Дублирование функций',
  responsibility_overlap: 'Пересечение зон ответственности',
  conflict_of_interest: 'Конфликт интересов',
  doc_defect: 'Дефект документа'
};

export type Severity = 'high' | 'medium' | 'low';

export interface Finding {
  id: string;
  kind: FindingKind;
  severity: Severity;
  /** Формулировка-гипотеза: «признаки дублирования», не «функция продублирована» */
  title: string;
  detail: string;
  /** UnitChange.id затронутых подразделений — для подсветки на схеме */
  unitIds: string[];
  /** Пусто быть не может — вывод без источника отбрасывается */
  evidence: Evidence[];
  /** Уверенность 0..1 */
  confidence: number;
  recommendation?: string;
  /** Источники парами «до ↔ после» для панели сравнения; evidence остаётся полным плоским списком */
  pairs?: EvidencePair[];
  /** FunctionMatch.id строк таблицы сопоставления, на которых основан вывод */
  matchIds?: string[];
  /** Оговорка: что требует проверки сотрудником */
  caveat?: string;
}

export interface EvidencePair {
  /** нет — пункт появился только в «после» */
  before?: Evidence;
  /** нет — пункт исчез (потеря) */
  after?: Evidence;
  /** «убрано: «ежеквартально»», носитель и т.п. */
  note?: string;
}

/** Итоговое заключение (must have 5). */
export interface Conclusion {
  /** 3–5 предложений для руководителя */
  summary: string;
  sections: { title: string; text: string; findingIds: string[] }[];
  recommendations: { text: string; findingIds: string[] }[];
  disclaimer: string;
}

/** Шаг агента — для ленты прогресса и прозрачности решения. */
export interface TraceStep {
  id: string;
  label: string;
  /** pending — шаг ещё не начат: весь план шагов виден сразу после запуска */
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped';
  detail?: string;
  /** 0 — шаг ещё не начат (pending) */
  startedAt: number;
  finishedAt?: number;
}

/** Полный результат анализа — то, что рендерит интерфейс. */
export interface AnalysisResult {
  documents: SourceDoc[];
  clauses: Clause[];
  units: UnitChange[];
  flows: UnitFlow[];
  functions: UnitFunction[];
  matches: FunctionMatch[];
  findings: Finding[];
  conclusion: Conclusion;
  trace: TraceStep[];
  stats: {
    clausesBefore: number;
    clausesAfter: number;
    unitsCreated: number;
    unitsRemoved: number;
    unitsReorganized: number;
    unitsRetained: number;
    functionsLost: number;
    findings: number;
  };
  meta: {
    model: string;
    generatedAt: string;
    durationMs: number;
    fromCache: boolean;
    /** Хеш содержимого входных документов: одинаков для повторного анализа тех же файлов */
    resultId?: string;
  };
}

/**
 * API:
 *   POST /api/analyze            multipart: before[]=файлы, after[]=файлы → { jobId }
 *   POST /api/analyze?demo=1     без файлов, берёт тестовый комплект из data/ → { jobId }
 *   GET  /api/analyze/{jobId}    → AnalysisJob (опрашивать раз в 1–2 с, пока status = running)
 */
/** Решение сотрудника по выводу (экран «Находки»). */
export type FindingReview = 'confirmed' | 'rejected';

/**
 *   POST /api/report?format=docx|md   { result: AnalysisResult, reviews?: Record<Finding.id, FindingReview> } → файл
 */
export interface ReportRequest {
  result: AnalysisResult;
  reviews?: Record<string, FindingReview>;
}

export interface AnalysisJob {
  id: string;
  status: 'running' | 'done' | 'error';
  trace: TraceStep[];
  result?: AnalysisResult;
  error?: string;
}
