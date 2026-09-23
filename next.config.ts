import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // OCR: нативный ONNX Runtime и WASM-сборка mupdf грузятся из node_modules как есть, без бандлинга.
  serverExternalPackages: ['onnxruntime-node', 'mupdf']
};

export default nextConfig;
