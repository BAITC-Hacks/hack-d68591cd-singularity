# Модели OCR (PaddleOCR PP-OCRv5, ONNX)

Используются в `src/features/orgdiff/lib/ocr.ts` через `onnxruntime-node`, работают офлайн.

| Файл | Модель | Источник | Лицензия |
|---|---|---|---|
| `det.onnx` (4,8 МБ) | PP-OCRv5_mobile_det — детектор строк (DB) | [PaddlePaddle/PP-OCRv5_mobile_det_onnx](https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det_onnx) | Apache-2.0 |
| `rec.onnx` (7,9 МБ) | eslav_PP-OCRv5_mobile_rec — распознаватель восточнославянских языков (русский, украинский, белорусский) + латиница, цифры | [PaddlePaddle/eslav_PP-OCRv5_mobile_rec_onnx](https://huggingface.co/PaddlePaddle/eslav_PP-OCRv5_mobile_rec_onnx) | Apache-2.0 |
| `rec_dict.txt` | словарь распознавателя (517 символов, `PostProcess.character_dict` из `inference.yml` того же репозитория) | там же | Apache-2.0 |

Официальные ONNX-экспорты команды PaddleOCR (`inference.onnx`, переименованы). Классы CTC: 0 — blank, 1…517 — словарь, 518 — пробел.
