import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { InferenceSession } from 'onnxruntime-node';

/**
 * OCR сканов и картинок: PaddleOCR PP-OCRv5 через ONNX Runtime, полностью офлайн.
 * Детектор строк PP-OCRv5_mobile_det (DB) → вырезка строки с учётом наклона →
 * распознаватель eslav_PP-OCRv5_mobile_rec (русский/украинский/белорусский + латиница) → CTC.
 * Модели лежат в models/ocr/ (Apache-2.0, см. models/ocr/README.md), PDF растрируется mupdf (WASM).
 */

/** Растровая картинка RGB, 3 байта на пиксель. */
interface Rgb {
  data: Uint8Array;
  width: number;
  height: number;
}

/** Повёрнутый прямоугольник строки в координатах исходной картинки; u — ось вдоль строки. */
interface TextBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
  ux: number;
  uy: number;
}

interface TextLine extends TextBox {
  text: string;
}

const MODEL_DIR = path.join(process.cwd(), 'models', 'ocr');
/** Разрешение растеризации PDF: 200 DPI хватает для кегля 10–14, быстрее 300. */
const PDF_DPI = 200;
/** Длинная сторона страницы на входе детектора (кратно 32). */
const DET_LIMIT = 1600;
const DET_THRESH = 0.3;
const DET_BOX_THRESH = 0.6;
const DET_UNCLIP = 1.5;
const REC_H = 48;
const REC_MAX_W = 3200;
/** Строка сжимается по ширине: шагов CTC с запасом, CER тот же (0,34% против 0,37% на стр. 5), распознавание на ~20% быстрее. */
const REC_SQUEEZE = 0.8;
const REC_BATCH = 16;
const REC_MIN_SCORE = 0.3;
/** Страниц PDF в работе одновременно: растр и пост-обработка идут в JS, сети — в пуле ONNX Runtime. */
const PAGE_CONCURRENCY = 2;

interface Models {
  ort: typeof import('onnxruntime-node');
  det: InferenceSession;
  rec: InferenceSession;
  dict: string[];
}

let modelsPromise: Promise<Models> | undefined;

function loadModels(): Promise<Models> {
  modelsPromise ??= (async () => {
    const files = ['det.onnx', 'rec.onnx', 'rec_dict.txt'].map((f) => path.join(MODEL_DIR, f));
    const missing = files.filter((f) => !existsSync(f));
    if (missing.length) {
      throw new Error(
        `OCR: нет файлов моделей ${missing.map((f) => path.relative(process.cwd(), f)).join(', ')} — они лежат в репозитории в models/ocr/`
      );
    }
    const ort = await import('onnxruntime-node');
    const opts: InferenceSession.SessionOptions = {
      logSeverityLevel: 3,
      graphOptimizationLevel: 'all'
    };
    const create = (file: string) => ort.InferenceSession.create(file, opts);
    const [det, rec] = await Promise.all([create(files[0]), create(files[1])]);
    // Классы CTC: 0 — blank, затем словарь, последним — пробел (use_space_char).
    const dict = [
      '',
      ...readFileSync(files[2], 'utf-8')
        .split('\n')
        .filter((c) => c.length > 0),
      ' '
    ];
    return { ort, det, rec, dict };
  })();
  modelsPromise.catch(() => (modelsPromise = undefined));
  return modelsPromise;
}

/** Картинка (.png/.jpg) → текст сверху вниз, слева направо. */
export async function ocrImage(buf: Buffer): Promise<string> {
  const { default: sharp } = await import('sharp');
  const { data, info } = await sharp(buf)
    .rotate()
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return ocrRgb({
    data: new Uint8Array(data.buffer, data.byteOffset, data.length),
    width: info.width,
    height: info.height
  });
}

/** PDF-скан → текст по страницам. */
export async function ocrPdf(buf: Buffer): Promise<string[]> {
  const mupdf = await import('mupdf');
  const doc = mupdf.Document.openDocument(new Uint8Array(buf), 'application/pdf');
  try {
    const n = doc.countPages();
    const out: string[] = Array.from({ length: n }, () => '');
    let next = 0;
    const worker = async () => {
      while (next < n) {
        const i = next++;
        out[i] = await ocrRgb(renderPage(mupdf, doc, i));
      }
    };
    await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, n) }, worker));
    return out;
  } finally {
    doc.destroy();
  }
}

function renderPage(mupdf: typeof import('mupdf'), doc: import('mupdf').Document, i: number): Rgb {
  const page = doc.loadPage(i);
  const s = PDF_DPI / 72;
  const pix = page.toPixmap(mupdf.Matrix.scale(s, s), mupdf.ColorSpace.DeviceRGB, false, true);
  try {
    const width = pix.getWidth();
    const height = pix.getHeight();
    const stride = pix.getStride();
    const src = pix.getPixels();
    const data = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y++)
      data.set(src.subarray(y * stride, y * stride + width * 3), y * width * 3);
    return { data, width, height };
  } finally {
    pix.destroy();
    page.destroy();
  }
}

async function ocrRgb(img: Rgb): Promise<string> {
  const models = await loadModels();
  const boxes = await detect(models, img);
  const lines = await recognize(models, img, boxes);
  return joinLines(lines);
}

// ───────────────────────── Детекция (DB) ─────────────────────────

async function detect({ ort, det }: Models, img: Rgb): Promise<TextBox[]> {
  const scale = Math.min(1, DET_LIMIT / Math.max(img.width, img.height));
  const W = Math.max(32, Math.round((img.width * scale) / 32) * 32);
  const H = Math.max(32, Math.round((img.height * scale) / 32) * 32);
  const { default: sharp } = await import('sharp');
  const small = await sharp(img.data, {
    raw: { width: img.width, height: img.height, channels: 3 }
  })
    .resize(W, H, { fit: 'fill' })
    .raw()
    .toBuffer();

  // BGR, ImageNet mean/std, CHW — как в PaddleOCR.
  const plane = W * H;
  const x = new Float32Array(3 * plane);
  const mean = [0.406, 0.456, 0.485];
  const std = [0.225, 0.224, 0.229];
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++)
      x[(2 - c) * plane + i] = (small[i * 3 + c] / 255 - mean[c]) / std[c];
  }
  const res = await det.run({ [det.inputNames[0]]: new ort.Tensor('float32', x, [1, 3, H, W]) });
  const prob = res[det.outputNames[0]].data as Float32Array;
  const sx = img.width / W;
  const sy = img.height / H;
  return dbBoxes(prob, W, H).map((b) => ({
    ...b,
    cx: b.cx * sx,
    cy: b.cy * sy,
    w: b.w * Math.hypot(b.ux * sx, b.uy * sy),
    h: b.h * Math.hypot(-b.uy * sx, b.ux * sy)
  }));
}

/** Карта вероятностей → связные области → минимальные повёрнутые прямоугольники с расширением (unclip). */
function dbBoxes(prob: Float32Array, W: number, H: number): TextBox[] {
  const label = new Int32Array(W * H);
  const boxes: TextBox[] = [];
  const stack: number[] = [];
  let id = 0;
  for (let start = 0; start < W * H; start++) {
    if (label[start] || prob[start] <= DET_THRESH) continue;
    id++;
    label[start] = id;
    stack.push(start);
    // Для оболочки хватает крайних пикселей каждой строки области.
    const rowMin = new Map<number, number>();
    const rowMax = new Map<number, number>();
    let sum = 0;
    let count = 0;
    while (stack.length) {
      const p = stack.pop()!;
      const px = p % W;
      const py = (p - px) / W;
      sum += prob[p];
      count++;
      if (!(rowMin.get(py)! <= px)) rowMin.set(py, px);
      if (!(rowMax.get(py)! >= px)) rowMax.set(py, px);
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          if (nx < 0 || nx >= W) continue;
          const q = ny * W + nx;
          if (!label[q] && prob[q] > DET_THRESH) {
            label[q] = id;
            stack.push(q);
          }
        }
      }
    }
    if (count < 6 || sum / count < DET_BOX_THRESH) continue;
    const pts: [number, number][] = [];
    for (const [y, x0] of rowMin) {
      const x1 = rowMax.get(y)!;
      pts.push([x0, y], [x0 + 1, y], [x0, y + 1], [x1 + 1, y], [x1 + 1, y + 1], [x1, y + 1]);
    }
    const r = minAreaRect(convexHull(pts));
    if (Math.min(r.w, r.h) < 3) continue;
    const d = (r.w * r.h * DET_UNCLIP) / (2 * (r.w + r.h));
    const box = { ...r, w: r.w + 2 * d, h: r.h + 2 * d };
    if (Math.min(box.w, box.h) < 5) continue;
    boxes.push(box);
  }
  return boxes;
}

const cross = (o: number[], a: number[], b: number[]) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

function convexHull(points: [number, number][]): [number, number][] {
  const p = points.toSorted((a, b) => a[0] - b[0] || a[1] - b[1]);
  const lower: [number, number][] = [];
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0)
      lower.pop();
    lower.push(pt);
  }
  const upper: [number, number][] = [];
  for (const pt of p.toReversed()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0)
      upper.pop();
    upper.push(pt);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Минимальный по площади прямоугольник вокруг выпуклой оболочки (перебор направлений рёбер). */
function minAreaRect(hull: [number, number][]): TextBox {
  let best: TextBox | undefined;
  let bestArea = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const [x0, y0] = hull[i];
    const [x1, y1] = hull[(i + 1) % hull.length];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (!len) continue;
    let ux = (x1 - x0) / len;
    let uy = (y1 - y0) / len;
    // Ось строки — ближайшая к горизонтали, направлена вправо.
    if (Math.abs(uy) > Math.abs(ux)) [ux, uy] = [-uy, ux];
    if (ux < 0) [ux, uy] = [-ux, -uy];
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const [x, y] of hull) {
      const u = x * ux + y * uy;
      const v = -x * uy + y * ux;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < bestArea) {
      bestArea = area;
      const cu = (minU + maxU) / 2;
      const cv = (minV + maxV) / 2;
      best = {
        cx: cu * ux - cv * uy,
        cy: cu * uy + cv * ux,
        w: maxU - minU,
        h: maxV - minV,
        ux,
        uy
      };
    }
  }
  return best ?? { cx: hull[0]?.[0] ?? 0, cy: hull[0]?.[1] ?? 0, w: 1, h: 1, ux: 1, uy: 0 };
}

// ───────────────────────── Распознавание (CTC) ─────────────────────────

async function recognize(
  { ort, rec, dict }: Models,
  img: Rgb,
  boxes: TextBox[]
): Promise<TextLine[]> {
  const items = boxes
    .map((b) => ({
      b,
      cw: Math.max(1, Math.min(REC_MAX_W, Math.ceil((REC_H * REC_SQUEEZE * b.w) / b.h)))
    }))
    .toSorted((a, b) => a.cw - b.cw);
  const out: TextLine[] = [];
  for (let i = 0; i < items.length; i += REC_BATCH) {
    const batch = items.slice(i, i + REC_BATCH);
    // Ширина батча — кратно 160: меньше разных форм входа, CoreML не перекомпилирует граф на каждую.
    const W = Math.ceil(Math.max(320, ...batch.map((it) => it.cw)) / 160) * 160;
    const plane = REC_H * W;
    const x = new Float32Array(batch.length * 3 * plane);
    batch.forEach((it, k) => cropInto(img, it.b, it.cw, W, x, k * 3 * plane));
    const res = await rec.run({
      [rec.inputNames[0]]: new ort.Tensor('float32', x, [batch.length, 3, REC_H, W])
    });
    const t = res[rec.outputNames[0]];
    const [, T, C] = t.dims as number[];
    const probs = t.data as Float32Array;
    batch.forEach((it, k) => {
      let text = '';
      let prev = 0;
      let score = 0;
      let n = 0;
      for (let s = 0; s < T; s++) {
        const off = (k * T + s) * C;
        let arg = 0;
        let max = -Infinity;
        for (let c = 0; c < C; c++) {
          if (probs[off + c] > max) {
            max = probs[off + c];
            arg = c;
          }
        }
        if (arg !== 0 && arg !== prev) {
          text += dict[arg] ?? '';
          score += max;
          n++;
        }
        prev = arg;
      }
      text = text.trim();
      if (text && score / n >= REC_MIN_SCORE) out.push({ ...it.b, text });
    });
  }
  return out;
}

/** Вырезает повёрнутую строку билинейной интерполяцией сразу в тензор распознавателя (BGR, [-1, 1], CHW). */
function cropInto(img: Rgb, b: TextBox, cw: number, W: number, dst: Float32Array, off: number) {
  const plane = REC_H * W;
  const { ux, uy } = b;
  const vx = -uy;
  const vy = ux;
  const { data, width, height } = img;
  for (let oy = 0; oy < REC_H; oy++) {
    const dv = ((oy + 0.5) / REC_H - 0.5) * b.h;
    for (let ox = 0; ox < cw; ox++) {
      const du = ((ox + 0.5) / cw - 0.5) * b.w;
      const fx = Math.min(width - 1.001, Math.max(0, b.cx + du * ux + dv * vx - 0.5));
      const fy = Math.min(height - 1.001, Math.max(0, b.cy + du * uy + dv * vy - 0.5));
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const ax = fx - x0;
      const ay = fy - y0;
      const i00 = (y0 * width + x0) * 3;
      const i10 = i00 + 3;
      const i01 = i00 + width * 3;
      const i11 = i01 + 3;
      const o = oy * W + ox;
      for (let c = 0; c < 3; c++) {
        const v =
          (data[i00 + c] * (1 - ax) + data[i10 + c] * ax) * (1 - ay) +
          (data[i01 + c] * (1 - ax) + data[i11 + c] * ax) * ay;
        dst[off + (2 - c) * plane + o] = v / 127.5 - 1;
      }
    }
  }
}

/** Латинские двойники кириллических букв. */
const LAT2CYR: Record<string, string> = {
  a: 'а',
  c: 'с',
  e: 'е',
  o: 'о',
  p: 'р',
  x: 'х',
  y: 'у',
  A: 'А',
  B: 'В',
  C: 'С',
  E: 'Е',
  H: 'Н',
  K: 'К',
  M: 'М',
  O: 'О',
  P: 'Р',
  T: 'Т',
  X: 'Х'
};
const VOWELS = /[аеёиоуыэюяАЕЁИОУЫЭЮЯ]/u;
/** Сокращения без гласных, которые пишутся строчными: «пп.», «млн». */
const LOWER_ABBR = new Set(['пп', 'гг', 'вв', 'тт', 'млн', 'млрд', 'шт', 'мм', 'см', 'км', 'кг']);

/**
 * Типовые ошибки распознавателя в русском тексте: латиница внутри кириллического слова
 * («Cовет» → «Совет») и регистр аббревиатур, у которых строчные и заглавные буквы похожи
 * («ДитААД» → «ДИТААД», «(днм)» → «(ДНМ)»): иначе подразделения не совпадут между пунктами.
 */
function fixWord(w: string, next: string): string {
  if (!/\p{Script=Cyrillic}/u.test(w)) return w;
  let out = /[a-zA-Z]/.test(w) ? w.replace(/[a-zA-Z]/g, (ch) => LAT2CYR[ch] ?? ch) : w;
  const upper = [...out].filter((ch) => ch !== ch.toLowerCase()).length;
  const mixedAbbr =
    out.length >= 3 && upper >= 2 && upper * 2 >= out.length && out[0] !== out[0].toLowerCase();
  const noVowelAbbr =
    out.length >= 2 &&
    !VOWELS.test(out) &&
    !LOWER_ABBR.has(out.toLowerCase()) &&
    // «пп.», «стр.» — строчные сокращения; «Дккм.» с заглавной — аббревиатура.
    (next !== '.' || out[0] !== out[0].toLowerCase());
  if (mixedAbbr || noVowelAbbr) out = out.toUpperCase();
  return out;
}

const ITEM_SEQ = 'абвгдежзиклмнопрстуфхцчшщэюя';
/** Чем распознаватель подменяет букву подпункта: «a.» латиницей, «6.» вместо «б.», «3.» вместо «з.». */
const ITEM_LOOKALIKE: Record<string, string> = {
  ...LAT2CYR,
  '6': 'б',
  '3': 'з',
  r: 'г',
  u: 'и',
  n: 'п',
  k: 'к',
  m: 'м',
  h: 'н',
  t: 'т'
};

/**
 * Страница после порядка чтения: слова чинятся по одному, буквенные подпункты «a.», «6.» восстанавливаются
 * по контексту перечня (после «а.» ждём «б.»), иначе parse-clauses не узнает подпункты 3.4.а–г.
 */
function fixPage(text: string): string {
  let prev = '';
  return text
    .split('\n')
    .map((raw) => {
      let line = raw
        .replace(/\p{L}+/gu, (w, i: number) => fixWord(w, raw[i + w.length] ?? ''))
        // Пропущенный пробел после номера: «4.Внутренний», «а.Директор».
        .replace(/^(\d{1,2}(?:\.\d{1,3})*\.|\S[.)])(?=\p{Lu})/u, '$1 ');
      const m = /^(\S)([.)])\s/u.exec(line);
      if (!m) {
        if (/^\d{1,2}(?:\.\d{1,3})+\.?\s/u.test(line)) prev = '';
        return line;
      }
      const ch = m[1];
      const expected = ITEM_SEQ[prev ? ITEM_SEQ.indexOf(prev) + 1 : 0];
      if (ITEM_SEQ.includes(ch)) {
        prev = ch;
        return line;
      }
      const cand = ITEM_LOOKALIKE[ch]?.toLowerCase();
      const latin = /[a-zA-Z]/.test(ch) && /\p{Script=Cyrillic}/u.test(line);
      if (cand && ITEM_SEQ.includes(cand) && (cand === expected || latin)) {
        prev = cand;
        line = cand + line.slice(1);
      }
      return line;
    })
    .join('\n');
}

// ───────────────────────── Порядок чтения ─────────────────────────

/**
 * Строки сверху вниз, слева направо. Координаты переводятся в систему без наклона страницы
 * (медиана углов длинных строк), фрагменты одной строки склеиваются через пробел.
 */
function joinLines(lines: TextLine[]): string {
  const angles = lines
    .filter((l) => l.w > 4 * l.h)
    .map((l) => Math.atan2(l.uy, l.ux))
    .toSorted((a, b) => a - b);
  const skew = angles.length ? angles[Math.floor(angles.length / 2)] : 0;
  const cos = Math.cos(skew);
  const sin = Math.sin(skew);
  const items = lines
    .map((l) => ({
      text: l.text,
      x: l.cx * cos + l.cy * sin - l.w / 2,
      y: -l.cx * sin + l.cy * cos,
      h: l.h
    }))
    .toSorted((a, b) => a.y - b.y);
  const rows: { y: number; h: number; items: typeof items }[] = [];
  for (const it of items) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(it.y - row.y) < 0.5 * Math.min(it.h, row.h)) row.items.push(it);
    else rows.push({ y: it.y, h: it.h, items: [it] });
  }
  return fixPage(
    rows
      .map((r) =>
        r.items
          .toSorted((a, b) => a.x - b.x)
          .map((i) => i.text)
          .join(' ')
      )
      .join('\n')
  );
}
