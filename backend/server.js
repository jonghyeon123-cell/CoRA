// Node.js 기본 모듈만 사용한 REST API 예시 서버입니다.
// 실제 서비스에서는 이 파일 안에서 LLM SDK, DB, 인증, 로깅 등을 연결하면 됩니다.
import http from "node:http";
import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = normalize(join(__dirname, ".."));
const port = process.env.PORT || 3000;
const host = process.env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
const openAiModel = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const accountsFilePath = join(projectRoot, ".data", "accounts.json");
const scryptAsync = promisify(scrypt);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const server = http.createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/api/chat") {
    await handleChatRequest(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/login") {
    await handleLoginRequest(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/register") {
    await handleRegisterRequest(request, response);
    return;
  }

  if (request.method === "GET" || request.method === "HEAD") {
    await serveStaticFile(request, response, request.method === "HEAD");
    return;
  }

  sendJson(response, 405, { error: "Method not allowed" });
});

server.listen(port, host, () => {
  console.log(`Server running at http://${host}:${port}`);
});

async function handleChatRequest(request, response) {
  try {
    const body = await readJsonBody(request);

    if (!body.message || typeof body.message !== "string") {
      sendJson(response, 400, { error: "message is required" });
      return;
    }

    // 이 함수만 실제 챗봇 제공자 호출로 교체하면 프론트엔드 변경 없이 확장됩니다.
    const chatResult = await createAssistantReply(body.message, body.history || []);
    sendJson(response, 200, chatResult);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
}

async function handleLoginRequest(request, response) {
  try {
    const body = await readJsonBody(request);
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");

    if (!email || !password) {
      sendJson(response, 400, { error: "email and password are required" });
      return;
    }

    const accounts = await readAccounts();
    const account = accounts.find((item) => item.email === email);
    const isValidPassword = account ? await verifyPassword(password, account.passwordHash) : false;

    if (!account || !isValidPassword) {
      sendJson(response, 401, { error: "이메일 또는 비밀번호가 올바르지 않습니다." });
      return;
    }

    sendJson(response, 200, { user: toPublicUser(account) });
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
}

async function handleRegisterRequest(request, response) {
  try {
    const body = await readJsonBody(request);
    const userInput = {
      name: String(body.name || "").trim(),
      studentId: String(body.studentId || "").trim(),
      department: String(body.department || "").trim(),
      email: normalizeEmail(body.email),
      password: String(body.password || "")
    };

    if (!userInput.name || !userInput.studentId || !userInput.department || !userInput.email || !userInput.password) {
      sendJson(response, 400, { error: "모든 회원가입 항목을 입력해 주세요." });
      return;
    }

    if (userInput.password.length < 6) {
      sendJson(response, 400, { error: "비밀번호는 6자 이상이어야 합니다." });
      return;
    }

    const accounts = await readAccounts();
    const isDuplicated = accounts.some((account) => account.email === userInput.email);

    if (isDuplicated) {
      sendJson(response, 409, { error: "이미 가입된 이메일입니다." });
      return;
    }

    const account = {
      id: crypto.randomUUID(),
      name: userInput.name,
      studentId: userInput.studentId,
      department: userInput.department,
      email: userInput.email,
      passwordHash: await hashPassword(userInput.password),
      createdAt: new Date().toISOString()
    };

    await writeAccounts([...accounts, account]);
    sendJson(response, 201, { user: toPublicUser(account) });
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
}

async function readAccounts() {
  try {
    const content = await readFile(accountsFilePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}

async function writeAccounts(accounts) {
  await mkdir(dirname(accountsFilePath), { recursive: true });
  await writeFile(accountsFilePath, JSON.stringify(accounts, null, 2));
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await scryptAsync(password, salt, 64);
  return `${salt}:${derivedKey.toString("hex")}`;
}

async function verifyPassword(password, storedHash = "") {
  const [salt, key] = storedHash.split(":");
  if (!salt || !key) return false;

  const derivedKey = await scryptAsync(password, salt, 64);
  const storedKey = Buffer.from(key, "hex");

  return storedKey.length === derivedKey.length && timingSafeEqual(storedKey, derivedKey);
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function toPublicUser(account) {
  return {
    id: account.id,
    name: account.name,
    studentId: account.studentId,
    department: account.department,
    email: account.email,
    source: "api"
  };
}

async function createAssistantReply(message, history) {
  const response = await fetch("http://localhost:8000/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history })
  });

  if (!response.ok) {
    throw new Error(`CoRA API failed (${response.status})`);
  }

  return await response.json();
}

function buildChatInput(message, history = []) {
  const recentMessages = Array.isArray(history) ? history.slice(-8) : [];

  return [
    {
      role: "developer",
      content:
        "너는 CORA 웹사이트의 학생 포털 도우미 챗봇이다. 시간표, 학점계산기, 진로 트랙, 로그인, 사이트 사용법을 한국어로 짧고 친절하게 안내한다."
    },
    ...recentMessages
      .filter((item) => ["user", "assistant"].includes(item.role) && item.content)
      .map((item) => ({
        role: item.role,
        content: String(item.content).slice(0, 1600)
      })),
    {
      role: "user",
      content: message
    }
  ];
}

function extractOpenAiText(result) {
  if (typeof result.output_text === "string" && result.output_text.trim()) {
    return result.output_text.trim();
  }

  const text = (result.output || [])
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === "output_text" && content.text)
    .map((content) => content.text)
    .join("\n")
    .trim();

  return text || "응답을 받았지만 표시할 텍스트가 없습니다.";
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf-8");
  return rawBody ? JSON.parse(rawBody) : {};
}

async function serveStaticFile(request, response, isHeadRequest = false) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = normalize(join(projectRoot, requestedPath));

  if (!safePath.startsWith(projectRoot)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  try {
    const file = await readFile(safePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(safePath)] || "application/octet-stream"
    });
    response.end(isHeadRequest ? undefined : file);
  } catch {
    sendJson(response, 404, { error: "Not found" });
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}
