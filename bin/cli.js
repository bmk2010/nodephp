#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { startServer } from "../lib/server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const command = process.argv[2];

if (command === "start") {
  // Lokalda Express serverni ishga tushirish
  const port = process.env.PORT || 3000;
  startServer(port);
} else if (command === "init" || command === "build") {
  // Vercel uchun kerakli fayllarni foydalanuvchi loyihasiga avto-generatsiya qilish
  const userRootDir = process.cwd();
  const packageDir = path.join(__dirname, "..");

  // 1. api/index.js (Vercel Handler) ni nusxalash
  const apiDir = path.join(userRootDir, "api");
  if (!fs.existsSync(apiDir)) fs.mkdirSync(apiDir, { recursive: true });

  const handlerContent = `// NodePHP Vercel Auto-generated Handler (Universal Export)
export default async function handler(req, res) {
  const mod = await import('nodephp-js/vercel');
  const actualHandler = mod.default || mod;
  return actualHandler(req, res);
}
`;
  fs.writeFileSync(path.join(apiDir, "index.js"), handlerContent);

  // 2. vercel.json ni yaratish
  const vercelConfig = {
    functions: {
      "api/index.js": {
        includeFiles: "**/*.np",
      },
    },
    routes: [
      {
        src: "/(.*)",
        dest: "/api/index.js",
      },
    ],
  };
  fs.writeFileSync(
    path.join(userRootDir, "vercel.json"),
    JSON.stringify(vercelConfig, null, 2),
  );

  console.log(
    "✅ NodePHP: Vercel konfiguratsiyasi muvaffaqiyatli tayyorlandi!",
  );
} else {
  console.log(`
  🚀 NodePHP CLI

  Buyruqlar:
    nodephp start    - Lokalda test qilish (default port: 3000)
    nodephp build    - Vercel uchun konfiguratsiyani tayyorlash
  `);
}
