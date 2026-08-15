import fs from "fs";

const RAW_TAG_RE = /<style\b|<script\b/i;
const RAW_CLOSE_RE = /<\/style\s*>|<\/script\s*>/i;

// JavaScript mantig'i bo'lgan qatorni aniqlash uchun naqshlar.
const JS_PATTERNS = [
  // O'zgaruvchi e'lon qilish / biriktirish: var_name = ..., var_name += ...
  /^var_[a-zA-Z0-9_]+\s*([+\-*/%]?=|:|\+\+|--)/,
  // NodePHP o'zgaruvchisi ustida chaqiruv: var_name(...), var_bot.send(...)
  /^var_[a-zA-Z0-9_]+\s*(\.[a-zA-Z_]\w*)*\s*\(/,
  // const/let/var e'lonlari
  /^(const|let|var)\s+/,
  // Boshqaruv kalit so'zlari (keyin ( talab qilinadi)
  /^(if|for|while|switch|catch|with)\s*\(/,
  /^do\s*\{/,
  /^(try|finally)\s*\{/,
  /^else\s*(\{|if|;)/,
  /^class\s+[A-Za-z_$]/,
  /^function\s+/,
  // Qaytish / uzish: ; yoki } bilan tugashi shart
  /^(return|throw|break|continue|yield)\b[\s\S]*[;}]\s*$/,
  /^case\b.*:\s*$/,
  /^default\s*:/,
  // Import/export/await/new/async/typeof/delete/this
  /^(import|export|await)\b/,
  /^new\s+[A-Z]/,
  /^async\s*(function|\()/,
  /^(typeof|delete)\s+/,
  /^this\./,
  // Kontekst va global obyektlar
  /^(console|res|req|process|globalThis|Date|JSON|Math|Object|Array|Promise|String|Number|Boolean)\b/,
  // Kontekst va global funksiyalar (connect, readFile, writeFile qo'shildi)
  /^(fetch|file|connect|readFile|writeFile|parseInt|parseFloat|require)\s*\(/,
  // Blok qavslari: { yoki } alohida qator
  /^[{}]/,
];

/**
 * <?nodephp ... ?> bloklarini (sof JS) oddiy shablon qismlaridan ajratadi.
 */
function splitEscapeBlocks(code) {
  const items = [];
  const OPEN_TAG = "<?nodephp";
  const CLOSE_TAG = "?>";
  let pos = 0;

  while (true) {
    const openIdx = code.indexOf(OPEN_TAG, pos);
    if (openIdx === -1) {
      if (pos < code.length) items.push({ type: "template", text: code.slice(pos) });
      break;
    }
    if (openIdx > pos) {
      items.push({ type: "template", text: code.slice(pos, openIdx) });
    }
    const contentStart = openIdx + OPEN_TAG.length;
    const closeIdx = code.indexOf(CLOSE_TAG, contentStart);
    if (closeIdx === -1) {
      items.push({ type: "js", text: code.slice(contentStart) });
      break;
    }
    items.push({ type: "js", text: code.slice(contentStart, closeIdx) });
    pos = closeIdx + CLOSE_TAG.length;
  }

  return items;
}

function isBlockOpener(trimmed) {
  return (
    /^(if|for|while|switch|catch|with)\s*\([\s\S]*\{\s*$/.test(trimmed) ||
    /^else\s*(\{|if)/.test(trimmed) ||
    /^do\s*\{/.test(trimmed) ||
    /^(try|finally)\s*\{/.test(trimmed) ||
    /^function[\s\S]*\{\s*$/.test(trimmed) ||
    /^class\s+[A-Za-z_$][\s\S]*\{\s*$/.test(trimmed)
  );
}

function countBracketDelta(line) {
  const cleaned = line
    .replace(/\/\/.*$/g, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, "")
    .replace(/'(?:[^'\\]|\\.)*'/g, "")
    .replace(/`(?:[^`\\]|\\.)*`/g, "");
  const open = (cleaned.match(/[({[]/g) || []).length;
  const close = (cleaned.match(/[)}\]]/g) || []).length;
  return open - close;
}

/**
 * NodePHP Transpiler
 */
export function transpileNodePHP(code) {
  const transpiled = code.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, "var_$1");
  const items = splitEscapeBlocks(transpiled);
  const processedLines = [];

  let inRawBlock = false;
  let jsDepth = 0;

  const emitHTML = (text) => {
    const safeHTML = text.replace(/\\/g, "\\\\").replace(/`/g, "\\`");
    processedLines.push(
      `  if (!res.writableEnded) { res.write(\`${safeHTML}\n\`); }`
    );
  };

  for (const item of items) {
    if (item.type === "js") {
      for (const ln of item.text.split("\n")) {
        processedLines.push(ln);
      }
      continue;
    }

    for (const line of item.text.split("\n")) {
      const trimmed = line.trim();

      if (!trimmed) {
        processedLines.push(line);
        continue;
      }

      if (!inRawBlock && RAW_TAG_RE.test(trimmed)) {
        inRawBlock = true;
      }
      const closesRawBlock = inRawBlock && RAW_CLOSE_RE.test(trimmed);

      if (inRawBlock) {
        emitHTML(line);
      } else {
        const isJSStatement = jsDepth > 0 || JS_PATTERNS.some((p) => p.test(trimmed));

        if (isJSStatement) {
          processedLines.push(line);
          if (jsDepth === 0 && isBlockOpener(trimmed)) {
            // block opener
          } else {
            jsDepth = Math.max(0, jsDepth + countBracketDelta(line));
          }
        } else {
          const parsedHTML = line.replace(
            /var_([a-zA-Z0-9_]+)((?:\.[a-zA-Z_]\w*|\[[^\]]*\])*)/g,
            "${var_$1$2}"
          );
          emitHTML(parsedHTML);
        }
      }

      if (closesRawBlock) {
        inRawBlock = false;
      }
    }
  }

  return processedLines.join("\n");
}

/**
 * Runtime Engine
 */
export async function executeNodePHP(filePath, req, res) {
  if (!fs.existsSync(filePath)) {
    if (!res.headersSent) {
      res.status?.(404) || (res.statusCode = 404);
      return res.json
        ? res.json({ error: "404 Not Found: Fayl topilmadi" })
        : res.end("404 Not Found");
    }
    return;
  }

  try {
    const rawCode = fs.readFileSync(filePath, "utf-8");
    const compiledJS = transpileNodePHP(rawCode);

    const host = req.headers?.host || "localhost:3000";
    const urlObj = new URL(req.url, `http://${host}`);
    const queryParams = Object.fromEntries(urlObj.searchParams.entries());
    const bodyParams = req.body || {};

    // Standard Context
    const context = {
      req,
      res,
      console,
      fetch: globalThis.fetch,

      // 1. connect() - Asinxron so'rovlarni osonlashtirilgan (await shart bo'lmagan) asinxron wrapper'i
      connect: async (url, method = "GET", data = null) => {
        try {
          const options = {
            method: method.toUpperCase(),
            headers: {}
          };

          if (data && ["POST", "PUT", "PATCH", "DELETE"].includes(options.method)) {
            options.headers["Content-Type"] = "application/json";
            options.body = typeof data === "object" ? JSON.stringify(data) : data;
          }

          const response = await globalThis.fetch(url, options);
          const contentType = response.headers.get("content-type");

          let responseData = null;
          if (contentType && contentType.includes("application/json")) {
            responseData = await response.json();
          } else {
            responseData = await response.text();
          }

          return {
            status: response.status,
            ok: response.ok,
            data: responseData,
            headers: Object.fromEntries(response.headers.entries())
          };
        } catch (err) {
          throw new Error(`NodePHP connect() Error: ${err.message}`);
        }
      },

      // 2. readFile() - Fayl o'qish
      readFile: (targetPath) => {
        if (!fs.existsSync(targetPath)) {
          throw new Error(`NodePHP readFile Error: '${targetPath}' fayli topilmadi`);
        }
        return fs.readFileSync(targetPath, "utf-8");
      },

      // 3. writeFile() - Faylga yozish yoki yangi fayl ochish
      writeFile: (targetPath, content) => {
        try {
          const dataToWrite = typeof content === "object" ? JSON.stringify(content, null, 2) : String(content);
          fs.writeFileSync(targetPath, dataToWrite, "utf-8");
          return true;
        } catch (err) {
          throw new Error(`NodePHP writeFile Error: ${err.message}`);
        }
      },

      // file()
      file: (targetMethod) => {
        const isMatchingMethod =
          req.method.toUpperCase() === targetMethod.toUpperCase();

        if (!isMatchingMethod) return false;

        return {
          valueOf: () => true,
          [Symbol.toPrimitive]: () => true,

          query: (key = null) => {
            if (key) return queryParams[key] || null;
            return queryParams;
          },

          body: (key = null) => {
            if (key) return bodyParams[key] || null;
            return bodyParams;
          },

          all: () => {
            return {
              query: queryParams,
              body: bodyParams,
              headers: req.headers,
            };
          },
        };
      },
    };

    const AsyncFunction = Object.getPrototypeOf(
      async function () {}
    ).constructor;
    const runCode = new AsyncFunction(...Object.keys(context), compiledJS);

    if (!res.headersSent) {
      res.setHeader?.("Content-Type", "text/html; charset=utf-8");
    }

    await runCode(...Object.values(context));

    if (!res.writableEnded) {
      res.end();
    }
  } catch (err) {
    console.error("NodePHP Engine Runtime Error:", err);
    if (!res.headersSent) {
      res.status?.(500) || (res.statusCode = 500);
      const errorMessage = {
        error: "NodePHP Runtime Error",
        details: err.message,
      };
      return res.json
        ? res.json(errorMessage)
        : res.end(JSON.stringify(errorMessage));
    }
    if (!res.writableEnded) {
      res.end();
    }
  }
}