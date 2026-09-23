import mammoth from 'mammoth';

/** Лист таблицы: строки ячеек-строк и номер строки в файле для ссылки на источник. */
export interface TableSheet {
  sheet: string;
  rows: { row: number; cells: string[] }[];
}

export const isTableFile = (filename: string) => /\.xlsx$/i.test(filename);
/** Скан страницы картинкой — распознаётся OCR. */
export const isImageFile = (filename: string) => /\.(png|jpe?g)$/i.test(filename);

/**
 * Достаёт плоский текст из документа комплекта: Word, PDF (скан — через OCR), картинка (OCR), Excel или текст.
 * Нумерация пунктов в нормативных документах обычно набрана текстом,
 * поэтому достаточно «сырого» текста — структуру восстанавливает parse-clauses.
 */
export async function extractText(buf: Buffer, filename: string): Promise<string> {
  const lower = filename.toLowerCase();

  if (lower.endsWith('.docx')) {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return value;
  }

  if (lower.endsWith('.pdf')) {
    const { extractText: pdfText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await pdfText(pdf, { mergePages: false });
    const pages = Array.isArray(text) ? text : [text];
    // Скан: текстового слоя нет или он пустой (меньше 50 знаков на страницу) — распознаём OCR.
    if (pages.join('').replace(/\s+/g, '').length < 50 * pages.length) {
      const { ocrPdf } = await import('./ocr');
      const joined = unwrapPdfLines(await ocrPdf(buf));
      if (!joined.trim()) throw new Error(`В PDF «${filename}» нет текстового слоя, и OCR не нашёл текста — нужен PDF с текстом или .docx`);
      return joined;
    }
    return unwrapPdfLines(pages);
  }

  if (isImageFile(lower)) {
    const { ocrImage } = await import('./ocr');
    const joined = unwrapPdfLines([await ocrImage(buf)]);
    if (!joined.trim()) throw new Error(`На изображении «${filename}» OCR не нашёл текста`);
    return joined;
  }

  if (isTableFile(lower)) {
    return (await extractTables(buf))
      .flatMap(({ sheet, rows }) => [`${sheet}:`, ...rows.map((r) => r.cells.filter(Boolean).join(' | '))])
      .join('\n');
  }

  return buf.toString('utf-8');
}

/** Штатное расписание / оргструктура таблицей: непустые строки каждого листа. */
export async function extractTables(buf: Buffer): Promise<TableSheet[]> {
  const { default: readXlsxFile } = await import('read-excel-file/node');
  const sheets = await readXlsxFile(buf);
  return sheets.map(({ sheet, data }) => ({
    sheet,
    rows: data
      .map((cells, i) => ({
        row: i + 1,
        cells: cells.map((c) => (c === null || c === undefined ? '' : String(c).replace(/\s+/g, ' ').trim()))
      }))
      .filter((r) => r.cells.some(Boolean))
  }));
}

/** Начало нового пункта: «3.4.», «1.», «1.1 Текст». */
const NUMBERED = /^\d{1,2}(?:\.\d{1,3})*\.\s|^\d{1,2}(?:\.\d{1,3})+\.?\s*\S/u;
/** Буквенный подпункт: «а)», «б.». */
const LETTER_ITEM = /^[а-яё][.)]\s/u;
/** Маркированный элемент: «–», «•», символ маркера Word. */
const LIST_ITEM = /^(?:[–—•-]\s|[-])/u;
/** Строка кончается ссылкой, которую продолжает номер на следующей строке: «согласно п.», «пункта», «п. 5.8.1 и». */
const REF_TAIL =
  /(?:(?<!\p{L})пп?\.|(?<!\p{L})ст\.|№|(?<!\p{L})No|пункт\p{L}*|подпункт\p{L}*|раздел\p{L}*|глав\p{L}*|стать\p{L}*|\d\.?\s*(?:и|или|,|[–-]))$/iu;
const SEPARATOR = /^(?:_{3,}|-{3,}|оглавление|содержание)$/iu;
const edgeKey = (l: string) => l.replace(/\d+/g, '#').toLowerCase();
/** Колонтитул-номер страницы: «3», «- 3 -», «Стр. 3 из 20», «3/20». */
const PAGE_NO = /^(?:[-–—]\s*)?(?:стр(?:аница)?\.?\s*)?\d{1,4}(?:\s*(?:из|\/)\s*\d{1,4})?(?:\s*[-–—])?$/iu;

/**
 * PDF отдаёт строки вёрстки, а не абзацы: пункт разорван переносами, между страницами — номера
 * и колонтитулы. Склеиваем строки обратно в абзацы, чтобы текст пунктов совпадал с Word-версией:
 * новый абзац начинается с номера пункта (если это не продолжение ссылки «п.»), с элемента перечня
 * после знака конца фразы или с заглавной буквы после конца предложения.
 */
export function unwrapPdfLines(pages: string[]): string {
  const pageLines = pages.map((p) =>
    p
      .split(/\r?\n/)
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
  );

  // Повторяющиеся верхние/нижние колонтитулы: одинаковая строка в начале или конце большинства страниц.
  const freq = new Map<string, number>();
  for (const lines of pageLines) {
    for (const l of new Set([...lines.slice(0, 2), ...lines.slice(-2)].map(edgeKey))) freq.set(l, (freq.get(l) ?? 0) + 1);
  }
  const repeated = (l: string) => pageLines.length >= 3 && (freq.get(edgeKey(l)) ?? 0) >= Math.max(3, pageLines.length * 0.6);

  const lines = pageLines.flatMap((ls) =>
    ls.filter((l, i) => {
      const edge = i < 2 || i >= ls.length - 2;
      return !(edge && (PAGE_NO.test(l) || repeated(l)));
    })
  );

  // Ширина полной строки набора: абзац, чья последняя строка заметно короче, закончился до правого поля.
  const lens = lines
    .map((l) => l.length)
    .filter((n) => n > 20)
    .toSorted((a, b) => a - b);
  const fullWidth = lens[Math.floor(lens.length * 0.8)] ?? 80;

  const paras: string[] = [];
  let lastLen = 0;
  for (const line of lines) {
    const prev = paras[paras.length - 1];
    const endsSentence = prev !== undefined && /[.;:!?]$/u.test(prev);
    const upper = /^[«"(]?[А-ЯЁA-Z]/u.test(line);
    const startsPara =
      prev === undefined ||
      (NUMBERED.test(line) && !REF_TAIL.test(prev)) ||
      LETTER_ITEM.test(line) ||
      (LIST_ITEM.test(line) && endsSentence) ||
      (endsSentence && lastLen < fullWidth * 0.85 && upper) ||
      // Одиночная короткая строка «6. Взаимоотношения» — заголовок раздела, текст под ним — новый абзац.
      (upper && /^\d{1,2}\.\s/u.test(prev) && prev.length === lastLen && lastLen < fullWidth * 0.6) ||
      // Разделители и служебные заголовки («____», «Оглавление») — отдельные абзацы, иначе не найдётся оглавление.
      SEPARATOR.test(line) ||
      SEPARATOR.test(prev);
    if (startsPara) paras.push(line);
    else if (/\p{L}-$/u.test(prev) && /^\p{Ll}/u.test(line)) paras[paras.length - 1] = prev + line;
    else paras[paras.length - 1] = `${prev} ${line}`;
    lastLen = line.length;
  }
  return paras.join('\n');
}
