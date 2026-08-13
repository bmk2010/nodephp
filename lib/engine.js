import fs from "fs";

const RAW_TAG_RE = /<style\b|<script\b/i;
const RAW_CLOSE_RE = /<\/style\s*>|<\/script\s*>/i;

// JavaScript mantig'i bo'lgan qatorni aniqlash uchun naqshlar.
// Matn HTML qatori JS deb adashilmasligi uchun kalit so'zlardan keyin
// qo'shimcha belgi ( ( yoki { ) talab qilinadi.
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
  // Kontekst va global funksiyalar
  /^(fetch|file|parseInt|parseFloat|require)\s*\(/,
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
      // Yopilmay qolgan blok — oxirigacha sof JS deb olamiz
      items.push({ type: "js", text: code.slice(contentStart) });
      break;
    }
    items.push({ type: "js", text: code.slice(contentStart, closeIdx) });
    pos = closeIdx + CLOSE_TAG.length;
  }

  return items;
}

/**
 * Boshqaruv blokini ochuvchi satr (if/for/while/function/...).
 * Bunday blok ichida HTML qatorlari ham bo'lishi mumkin, shuning uchun
 * qavs balansini OSHIRMAYMIZ — ichidagi satrlar avtomatik aniqlanadi.
 */
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

/**
 * Satrdagi qavslar balansini hisoblaydi (string va izohlar tashqarida).
 * Natija: ochilgan - yopilgan qavslar soni.
 */
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
 * NodePHP kodini to'liq JavaScript (Async Function) kodiga o'giruvchi Transpiler
 */
export function transpileNodePHP(code) {
  // 1. $var syntaxini var_var ga o'girish (masalan: $name -> var_name)
  const transpiled = code.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, "var_$1");

  // 2. <?nodephp ... ?> (sof JS) bloklarini ajratib olamiz
  const items = splitEscapeBlocks(transpiled);

  const processedLines = [];

  // <style>/<script> bloki ichida CSS/JS xom matn yoziladi (o'zgartirilmaydi)
  let inRawBlock = false;
  // Ochiq qavslar balansi — ko'p qatorli JS konstruksiyalar uchun
  let jsDepth = 0;

  const emitHTML = (text) => {
    // Ekran belgilari (backtick va backslash) uchun xavfsizlash
    const safeHTML = text.replace(/\\/g, "\\\\").replace(/`/g, "\\`");
    processedLines.push(
      `  if (!res.writableEnded) { res.write(\`${safeHTML}\n\`); }`,
    );
  };

  for (const item of items) {
    // <?nodephp ... ?> bloki — sof JS, o'zgartirilmaydi
    if (item.type === "js") {
      for (const ln of item.text.split("\n")) {
        processedLines.push(ln);
      }
      continue;
    }

    // Oddiy shablon qismi — satrma-satr tahlil
    for (const line of item.text.split("\n")) {
      const trimmed = line.trim();

      // Bo'sh qatorlarni o'zgarmasdan saqlaymiz
      if (!trimmed) {
        processedLines.push(line);
        continue;
      }

      // <style>/<script> bloklarini ochish
      if (!inRawBlock && RAW_TAG_RE.test(trimmed)) {
        inRawBlock = true;
      }
      const closesRawBlock = inRawBlock && RAW_CLOSE_RE.test(trimmed);

      if (inRawBlock) {
        // CSS/JS xom matn — interpolatsiya qilinmaydi
        emitHTML(line);
      } else {
        const isJSStatement = jsDepth > 0 || JS_PATTERNS.some((p) => p.test(trimmed));

        if (isJSStatement) {
          // Sof JS kodi (yoki ochiq konstruksiya ichidagi satr)
          processedLines.push(line);
          if (jsDepth === 0 && isBlockOpener(trimmed)) {
            // Boshqaruv bloki (if/for/while/...) ochildi — balansni
            // oshirmaymiz, ichidagi HTML satrlari avtomatik aniqlanadi.
          } else {
            jsDepth = Math.max(0, jsDepth + countBracketDelta(line));
          }
        } else {
          // HTML ichidagi var_name larni Template Literal (${var_name}) ga o'giramiz.
          // Property va indekslar ham qo'shiladi:
          //   var_config.title -> ${var_config.title}
          //   var_list[i]      -> ${var_list[i]}
          const parsedHTML = line.replace(
            /var_([a-zA-Z0-9_]+)((?:\.[a-zA-Z_]\w*|\[[^\]]*\])*)/g,
            "${var_$1$2}",
          );
          emitHTML(parsedHTML);
        }
      }

      // <style>/<script> blokini yopish
      if (closesRawBlock) {
        inRawBlock = false;
      }
    }
  }

  return processedLines.join("\n");
}

/**
 * Transpile qilingan kodni bajaruvchi Runtime Engine
 */
export async function executeNodePHP(filePath, req, res) {
  // 1. Fayl mavjudligini tekshirish
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

    // URL va So'rov ma'lumotlarini tayyorlash
    const host = req.headers?.host || "localhost:3000";
    const urlObj = new URL(req.url, `http://${host}`);
    const queryParams = Object.fromEntries(urlObj.searchParams.entries());
    const bodyParams = req.body || {};

    // Standard Context yaratish
    const context = {
      req,
      res,
      console,
      fetch: globalThis.fetch,
      file: (targetMethod) => {
        const isMatchingMethod =
          req.method.toUpperCase() === targetMethod.toUpperCase();

        // Metod mos kelmasa false qaytaramiz — shunda
        // "if (file('POST'))" ishlaydi (obyekt if'da doim truthy bo'ladi).
        if (!isMatchingMethod) return false;

        return {
          // Primitive taqqoslash uchun ( masalan: if (file("POST")) )
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

    // 2. AsyncFunction orqali kodni bajarish (Telegram API, Database so'rovlari muammosiz ishlashi uchun)
    const AsyncFunction = Object.getPrototypeOf(
      async function () {},
    ).constructor;
    const runCode = new AsyncFunction(...Object.keys(context), compiledJS);

    // Koddagi har qanday HTML render uchun default Header o'rnatish
    if (!res.headersSent) {
      res.setHeader?.("Content-Type", "text/html; charset=utf-8");
    }

    await runCode(...Object.values(context));

    // 3. Agar kodingizda res.json() yoki res.send() ishlatilmagan va faqat HTML yozilgan bo'lsa, javobni yopamiz
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
    // Headerlar allaqachon yuborilgan bo'lsa ham, javobni osib qo'ymaslik uchun yopamiz
    if (!res.writableEnded) {
      res.end();
    }
  }
}
