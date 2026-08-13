import { executeNodePHP, transpileNodePHP } from "../lib/engine.js";
import { startServer } from "../lib/server.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures");
process.chdir(__dirname);

let passed = 0;
let failed = 0;
const failures = [];

function assert(name, actual, expected, opts = {}) {
  const ok = opts.includes
    ? String(actual).includes(String(expected))
    : String(actual) === String(expected);
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.error(`  ✗ ${name}`);
    console.error(`      expected: ${JSON.stringify(expected)}`);
    console.error(`      actual:   ${JSON.stringify(actual)}`);
  }
}

function assertTrue(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.error(`  ✗ ${name} ${detail}`);
  }
}

function makeReq(method = "GET", url = "/", body = {}) {
  return { method, url, headers: { host: "localhost:3000" }, body };
}

function makeRes() {
  const chunks = [];
  const res = {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    headers: {},
    _chunks: chunks,
    get body() {
      return chunks.join("");
    },
    setHeader(k, v) {
      this.headers[k] = v;
    },
    write(chunk) {
      chunks.push(String(chunk));
      return true;
    },
    end(chunk) {
      if (chunk !== undefined) chunks.push(String(chunk));
      this.writableEnded = true;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.headers["Content-Type"] = "application/json";
      chunks.push(JSON.stringify(obj));
      this.writableEnded = true;
    },
    send() {
      this.writableEnded = true;
    },
  };
  return res;
}

function transpileTests() {
  console.log("\n— Transpile testlari —");

  let out = transpileNodePHP("<h1>Hello $name</h1>");
  assert("html $var -> template expression", out, "${var_name}", { includes: true });
  assert("html res.write guarded", out, "if (!res.writableEnded)", { includes: true });

  out = transpileNodePHP("<p>$config.title</p>");
  assert("property access interpolated", out, "${var_config.title}", { includes: true });

  out = transpileNodePHP("$name = \"World\";");
  assert("assignment stays JS", out, 'var_name = "World";', { includes: true });

  out = transpileNodePHP("<?nodephp\nconst upper = \"x\".toUpperCase();\nres.write(upper);\n?>");
  assert("escape block JS passthrough", out, "res.write(upper);", { includes: true });
  assertTrue("open tag removed", !out.includes("<?nodephp"));
  assertTrue("close tag removed", !out.includes("?>"));

  out = transpileNodePHP("<style>\nh1 { color: red; }\n</style>");
  assert("style content raw", out, "h1 { color: red; }", { includes: true });
  assertTrue("no interpolation inside style", !out.includes("${"));

  out = transpileNodePHP("<script>\nlet n = 5;\n</script>");
  assert("script content raw", out, "let n = 5;", { includes: true });

  out = transpileNodePHP("if (true) {\n  <p>$name</p>\n}");
  assert("inner HTML after block opener interpolated", out, "${var_name}", { includes: true });
  assert("closing brace present", out, "}", { includes: true });

  out = transpileNodePHP('if (file("POST")) {\n  <p>ok</p>\n}');
  assert("file() condition kept as JS", out, 'if (file("POST")) {', { includes: true });

  out = transpileNodePHP("<p>a`b</p>");
  assert("backtick escaped", out, "a\\`b", { includes: true });

  out = transpileNodePHP("<p>for more info</p>");
  assert("keyword-in-text not JS", out, "for more info", { includes: true });
  assert("keyword-in-text emitted as HTML", out, "res.write", { includes: true });

  out = transpileNodePHP("<p>$5.00</p>");
  assert("dollar before number stays literal", out, "$5.00", { includes: true });

  out = transpileNodePHP("<?nodephp\nlet a = 1;");
  assert("unclosed escape block treated as JS", out, "let a = 1;", { includes: true });

  out = transpileNodePHP("$list = [1, 2, 3];\n<ul>\n  <li>$list[0]</li>\n</ul>");
  assert("array index interpolated", out, "${var_list[0]}", { includes: true });
}

async function runtimeTests() {
  console.log("\n— Runtime testlari —");

  let res = makeRes();
  await executeNodePHP(path.join(fixturesDir, "basic.np"), makeReq("GET", "/basic.np"), res);
  assert("basic renders Hello World", res.body, "Hello World!", { includes: true });
  assert("basic renders property", res.body, "NodePHP", { includes: true });
  assertTrue("basic ends response", res.writableEnded);

  res = makeRes();
  await executeNodePHP(path.join(fixturesDir, "post.np"), makeReq("GET", "/post.np"), res);
  assert("GET branch", res.body, "Bu GET so'rovi", { includes: true });
  assertTrue("GET branch does not leak POST", !res.body.includes("POST: "));

  res = makeRes();
  await executeNodePHP(
    path.join(fixturesDir, "post.np"),
    makeReq("POST", "/post.np", { name: "Ali" }),
    res,
  );
  assert("POST branch uses body", res.body, "POST: Ali", { includes: true });

  res = makeRes();
  await executeNodePHP(path.join(fixturesDir, "escape.np"), makeReq("GET", "/escape.np"), res);
  assert("escape block res.write", res.body, "<b>SALOM</b>", { includes: true });
  assert("escape block followed by HTML", res.body, "Done", { includes: true });

  res = makeRes();
  await executeNodePHP(path.join(fixturesDir, "json.np"), makeReq("GET", "/json.np"), res);
  assertTrue("json content-type set", res.headers["Content-Type"] === "application/json");
  assert("json body", JSON.parse(res.body), { ok: true, msg: "salom" });

  res = makeRes();
  await executeNodePHP(path.join(fixturesDir, "error.np"), makeReq("GET", "/error.np"), res);
  assertTrue("runtime error -> 500", res.statusCode === 500);
  assert("runtime error json", JSON.parse(res.body).error, "NodePHP Runtime Error");

  res = makeRes();
  await executeNodePHP(path.join(fixturesDir, "missing.np"), makeReq("GET", "/missing.np"), res);
  assertTrue("missing file -> 404", res.statusCode === 404);
}

async function e2eTests() {
  console.log("\n— E2E (HTTP) testlari —");

  const server = startServer(0);
  await new Promise((r) => (server.listening ? r() : server.once("listening", r)));
  const base = `http://localhost:${server.address().port}`;

  const r1 = await fetch(`${base}/fixtures/basic.np`);
  const b1 = await r1.text();
  assert("e2e GET basic.np -> 200", r1.status, 200);
  assert("e2e body renders", b1, "Hello World!", { includes: true });

  const r2 = await fetch(`${base}/fixtures/post.np`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Doston" }),
  });
  const b2 = await r2.text();
  assert("e2e POST branch -> 200", r2.status, 200);
  assert("e2e POST body renders", b2, "POST: Doston", { includes: true });

  const r3 = await fetch(`${base}/no-such-file.np`);
  assert("e2e missing -> 404", r3.status, 404);

  server.close();
}

transpileTests();
await runtimeTests();
await e2eTests();

console.log(`\n═══════════════════════════════════════`);
console.log(`Natija: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log(`\nMuvaffaqiyatsiz testlar:`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
