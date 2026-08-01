import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse pulls in pdfjs-dist, whose ESM build does not survive webpack's
  // server bundling — it throws "Object.defineProperty called on non-object" at
  // import time. Loading it at runtime instead of bundling it keeps the module
  // intact. mammoth is listed for the same reason: it resolves optional
  // dependencies dynamically.
  serverExternalPackages: ["pdf-parse", "mammoth"],
};

export default nextConfig;
