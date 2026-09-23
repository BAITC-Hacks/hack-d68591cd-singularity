import mammoth from 'mammoth';

/**
 * Достаёт плоский текст из документа комплекта: Word, PDF, Excel или текст.
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
    return (Array.isArray(text) ? text : [text]).join('\n');
  }

  if (lower.endsWith('.xlsx')) {
    // Штатное расписание / оргструктура таблицей: каждая строка → строка текста.
    const { default: readXlsxFile } = await import('read-excel-file/node');
    const sheets = await readXlsxFile(buf);
    return sheets
      .flatMap(({ sheet, data }) => [
        `${sheet}:`,
        ...data.map((row) => row.filter((c) => c !== null && c !== '').join(' | ')).filter(Boolean)
      ])
      .join('\n');
  }

  return buf.toString('utf-8');
}
