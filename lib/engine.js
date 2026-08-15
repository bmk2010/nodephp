import fs from "fs";
import {
  Worker,
  receiveMessageOnPort,
  MessageChannel,
} from "node:worker_threads";

const RAW_TAG_RE = /<style\b|<script\b/i;
const RAW_CLOSE_RE = /<\/style\s*>|<\/script\s*>/i;

const KILL_MARKER = "__NODEPHP_KILL__";
const CONNECT_TIMEOUT_MS = 30000;

const connectWorkerSource = `
const { parentPort } = require("node:worker_threads");
parentPort.on("message", async (msg) => {
  const { port, url, method, data, signal } = msg;
  try {
    const options = { method, headers: {} };
    if (data && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      options.headers["Content-Type"] = "application/json";
      options.body = typeof data === "object" ? JSON.stringify(data) : String(data);
    }
    const response = await globalThis.fetch(url, options);
    const contentType = response.headers.get("content-type") || "";
    let responseData = null;
    if (contentType.includes("application/json")) {
      responseData = await response.json();
    } else {
      responseData = await response.text();
    }
    port.postMessage({
      status: response.status,
      ok: response.ok,
      data: responseData,
      headers: Object.fromEntries(response.headers.entries())
    });
  } catch (err) {
    port.postMessage({ __error: String((err && err.stack) || err) });
  } finally {
    port.close();
    Atomics.store(signal, 0, 1);
    Atomics.notify(signal, 0);
  }
});
`;

let connectWorker = null;

function getConnectWorker() {
  if (!connectWorker) {
    connectWorker = new Worker(connectWorkerSource, { eval: true });
    connectWorker.unref();
    connectWorker.on("error", () => {
      connectWorker = null;
    });
  }
  return connectWorker;
}

function resetConnectWorker(worker) {
  try {
    worker.terminate();
  } catch {
    // ignore
  }
  connectWorker = null;
}

const JS_PATTERNS = [
  /^var_[a-zA-Z0-9_]+\s*([+\-*/%]?=|:|\+\+|--)/,
  /^var_[a-zA-Z0-9_]+\s*(\.[a-zA-Z_]\w*)*\s*\(/,
  /^(const|let|var)\s+/,
  /^(if|for|while|switch|catch|with)\s*\(/,
  /^do\s*\{/,
  /^(try|finally)\s*\{/,
  /^else\s*(\{|if|;)/,
  /^class\s+[A-Za-z_$]/,
  /^function\s+/,
  /^(return|throw|break|continue|yield)\b[\s\S]*[;}]\s*$/,
  /^case\b.*:\s*$/,
  /^default\s*:/,
  /^(import|export|await)\b/,
  /^new\s+[A-Z]/,
  /^async\s*(function|\()/,
  /^(typeof|delete)\s+/,
  /^this\./,
  /^(console|res|req|process|globalThis|Date|JSON|Math|Object|Array|Promise|String|Number|Boolean)\b/,
  /^(fetch|file|connect|readFile|writeFile|parseInt|parseFloat|require)\s*\(/,
  /^[{}]/,
  /^kill\s*;/,
];

function containsKillStatement(line) {
  const cleaned = line
    .replace(/\/\/.*$/g, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, "")
    .replace(/'(?:[^'\\]|\\.)*'/g, "")
    .replace(/`(?:[^`\\]|\\.)*`/g, "");
  return /\bkill\s*;/.test(cleaned);
}

function replaceKill(line) {
  if (!containsKillStatement(line)) return line;
  return line.replace(/\bkill\s*;/g, `throw ${JSON.stringify(KILL_MARKER)};`);
}

function splitEscapeBlocks(code) {
  const items = [];
  const OPEN_TAG = "<?nodephp";
  const CLOSE_TAG = "?>";
  let pos = 0;

  while (true) {
    const openIdx = code.indexOf(OPEN_TAG, pos);
    if (openIdx === -1) {
      if (pos < code.length)
        items.push({ type: "template", text: code.slice(pos) });
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

export function transpileNodePHP(code) {
  const items = splitEscapeBlocks(code);
  const processedLines = [];

  let inRawBlock = false;
  let jsDepth = 0;

  const normalizeVars = (line) =>
    line.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, "var_$1");

  const emitHTML = (text) => {
    // Escape backslashes, backticks, and dollar signs for template literal safety
    const safeHTML = text
      .replace(/\\/g, "\\\\")
      .replace(/`/g, "\\`")
      .replace(/\$(?!{var_)/g, "\\$");

    processedLines.push(
      `  if (!res.writableEnded) { res.write(\`${safeHTML}\n\`); }`,
    );
  };

  for (const item of items) {
    if (item.type === "js") {
      for (const ln of item.text.split("\n")) {
        processedLines.push(replaceKill(normalizeVars(ln)));
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
        const normalized = normalizeVars(trimmed);
        const isJSStatement =
          jsDepth > 0 || JS_PATTERNS.some((p) => p.test(normalized));

        if (isJSStatement) {
          processedLines.push(replaceKill(normalizeVars(line)));
          if (jsDepth === 0 && isBlockOpener(normalized)) {
            // block opener
          } else {
            jsDepth = Math.max(0, jsDepth + countBracketDelta(line));
          }
        } else {
          const parsedHTML = line.replace(
            /\$([a-zA-Z_][a-zA-Z0-9_]*)((?:\.[a-zA-Z_]\w*|\[[^\]]*\])*)/g,
            "${var_$1$2}",
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

    const context = {
      req,
      res,
      console,
      fetch: globalThis.fetch,

      connect: (url, method = "GET", data = null) => {
        const worker = getConnectWorker();
        const { port1, port2 } = new MessageChannel();
        // Har bir connect chaqiruvi uchun alohida signal buffer
        const signal = new Int32Array(new SharedArrayBuffer(4));

        try {
          worker.postMessage(
            {
              port: port2,
              url,
              method: String(method ?? "GET").toUpperCase(),
              data: data ?? null,
              signal,
            },
            [port2],
          );
        } catch (err) {
          throw new Error(`NodePHP connect() Error: ${err.message}`);
        }

        const started = Date.now();
        while (Atomics.wait(signal, 0, 0, 100) === "timed-out") {
          if (Date.now() - started > CONNECT_TIMEOUT_MS) {
            resetConnectWorker(worker);
            throw new Error(
              `NodePHP connect() Error: timeout (${CONNECT_TIMEOUT_MS}ms)`,
            );
          }
        }

        const received = receiveMessageOnPort(port1);
        const result = received && received.message;
        port1.close();
        if (!result) {
          throw new Error("NodePHP connect() Error: javob topilmadi");
        }
        if (result.__error) {
          throw new Error(`NodePHP connect() Error: ${result.__error}`);
        }
        return result;
      },

      readFile: (targetPath) => {
        if (!fs.existsSync(targetPath)) {
          throw new Error(
            `NodePHP readFile Error: '${targetPath}' fayli topilmadi`,
          );
        }
        const content = fs.readFileSync(targetPath, "utf-8");
        if (!content) {
          throw new Error(
            `NodePHP readFile Error: '${targetPath}' fayli bo'sh`,
          );
        }
        return content;
      },

      writeFile: (targetPath, content) => {
        try {
          const dataToWrite =
            typeof content === "object"
              ? JSON.stringify(content, null, 2)
              : String(content);
          fs.writeFileSync(targetPath, dataToWrite, "utf-8");
          return true;
        } catch (err) {
          throw new Error(`NodePHP writeFile Error: ${err.message}`);
        }
      },

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
      async function () {},
    ).constructor;
    const runCode = new AsyncFunction(...Object.keys(context), compiledJS);

    if (!res.getHeader?.("Content-Type")) {
      const origWrite = res.write.bind(res);
      let contentTypeSet = false;
      res.write = (...args) => {
        if (!contentTypeSet && !res.headersSent) {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          contentTypeSet = true;
        }
        return origWrite(...args);
      };
    }

    await runCode(...Object.values(context));

    if (!res.headersSent) {
      if (!res.getHeader?.("Content-Type")) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
      }
      res.end();
    } else if (!res.writableEnded) {
      res.end();
    }
  } catch (err) {
    if (err === KILL_MARKER) {
      if (!res.writableEnded) {
        res.end();
      }
      return;
    }
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
