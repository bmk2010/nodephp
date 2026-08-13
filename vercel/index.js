import path from "path";
import fs from "fs";
import { executeNodePHP } from "../lib/engine.js";

export default async function handler(req, res) {
  // So'rov URL manzilidan query parameterlarni ajratib olamiz
  const cleanUrl = req.url.split("?")[0];

  // Qidirilishi kerak bo'lgan ehtimoliy fayl yo'llari (Vercel uchun)
  let possiblePaths = [];

  if (cleanUrl === "/" || cleanUrl === "" || cleanUrl === "/api") {
    possiblePaths = [
      path.join(process.cwd(), "api", "index.np"),
      path.join(process.cwd(), "index.np"),
    ];
  } else {
    // Agar URL oxirida .np bo'lmasa, uni qo'shib tekshiramiz
    const normalizedUrl = cleanUrl.endsWith(".np")
      ? cleanUrl
      : `${cleanUrl}.np`;

    possiblePaths = [
      path.join(process.cwd(), normalizedUrl),
      path.join(
        process.cwd(),
        "api",
        normalizedUrl.replace(/^\/api\//, "").replace(/^\//, ""),
      ),
    ];
  }

  // Haqiqatdan mavjud bo'lgan birinchi .np faylini topamiz
  let targetFilePath = null;
  for (const filePath of possiblePaths) {
    if (fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
      targetFilePath = filePath;
      break;
    }
  }

  // Agar birorta ham .np fayl topilmasa 404 qaytaramiz
  if (!targetFilePath) {
    if (!res.headersSent) {
      res.status?.(404) || (res.statusCode = 404);
      const errResponse = {
        error: "404 Not Found: So'ralgan NodePHP (.np) fayli topilmadi",
      };
      return res.json
        ? res.json(errResponse)
        : res.end(JSON.stringify(errResponse));
    }
    return;
  }

  // Barcha mantiqni va asinxron ijroni engine.js ga topshiramiz
  try {
    await executeNodePHP(targetFilePath, req, res);
  } catch (err) {
    console.error("Vercel NodePHP Execution Error:", err);
    if (!res.headersSent) {
      res.status?.(500) || (res.statusCode = 500);
      const errResponse = {
        error: "NodePHP Vercel Handler Error",
        details: err.message,
      };
      return res.json
        ? res.json(errResponse)
        : res.end(JSON.stringify(errResponse));
    }
  }
}
