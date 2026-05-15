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
const coraApiUrl = process.env.CORA_API_URL || "http://127.0.0.1:8000";
const accountsFilePath = join(projectRoot, ".data", "accounts.json");
const reviewsFilePath = join(projectRoot, ".data", "reviews.json");
const courseHistoryFilePath = join(projectRoot, "course_history.json");
const roadmapFilePath = join(projectRoot, "roadmap.json");
const scryptAsync = promisify(scrypt);

let courseHistoryCache = null;
let roadmapCache = null;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    setCorsHeaders(response);
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "POST" && request.url === "/api/chat") {
    await handleChatRequest(request, response);
    return;
  }

  if (request.method === "GET" && request.url === "/api/courses") {
    const courseNames = await getCourseNames();
    sendJson(response, 200, courseNames);
    return;
  }

    if (request.method === "GET" && request.url === "/api/reviews") {
    const reviews = await readReviews();
    sendJson(response, 200, reviews);
    return;
  }
 
  if (request.method === "POST" && request.url === "/api/reviews") {
    await handleReviewCreate(request, response);
    return;
  }
 
  if (request.method === "POST" && request.url.startsWith("/api/reviews/") && request.url.endsWith("/like")) {
    const reviewId = request.url.split("/")[3];
    await handleReviewLike(reviewId, request, response);
    return;
  }

  if (request.method === "GET" && request.url.startsWith("/api/course-footprint")) {
    await handleCourseFootprintRequest(request, response);
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

  if (request.method === "POST" && request.url === "/api/reset-password") {
    await handleResetPasswordRequest(request, response);
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

loadCourseHistory().then(data => { courseHistoryCache = data; });
loadRoadmap().then(data => { roadmapCache = data; });

// course_summaries.json 로드

async function getCourseNames() {
  try {
    const data = await readFile("../cora_data/course_summaries.json", "utf-8");
    const summaries = JSON.parse(data);
    const courseNames = {};
    Object.values(summaries).forEach(v => {
      if (v.학수번호) {
        courseNames[v.학수번호] = v.과목명;
      }
    });
    return courseNames;
  } catch {
    return {};
  }
}

async function handleChatRequest(request, response) {
  try {
    const body = await readJsonBody(request);

    if (!body.message || typeof body.message !== "string") {
      sendJson(response, 400, { error: "message is required" });
      return;
    }

    // 이 함수만 실제 챗봇 제공자 호출로 교체하면 프론트엔드 변경 없이 확장됩니다.
    const chatResult = await createAssistantReply(body.message, body.history || [], body.sessionId || null);
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

async function handleResetPasswordRequest(request, response) {
  try {
    const body = await readJsonBody(request);
    const name = String(body.name || "").trim();
    const email = normalizeEmail(body.email);
    const newPassword = String(body.newPassword || "");

    if (!name || !email || !newPassword) {
      sendJson(response, 400, { error: "이름, 이메일, 새 비밀번호를 모두 입력해 주세요." });
      return;
    }

    if (newPassword.length < 6) {
      sendJson(response, 400, { error: "비밀번호는 6자 이상이어야 합니다." });
      return;
    }

    const accounts = await readAccounts();
    const idx = accounts.findIndex(a => a.email === email && a.name === name);

    if (idx === -1) {
      sendJson(response, 404, { error: "이름과 이메일이 일치하는 계정을 찾을 수 없습니다." });
      return;
    }

    accounts[idx].passwordHash = await hashPassword(newPassword);
    await writeAccounts(accounts);
    sendJson(response, 200, { ok: true });
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

async function readReviews() {
  try {
    const content = await readFile(reviewsFilePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}
 
async function writeReviews(reviews) {
  await mkdir(dirname(reviewsFilePath), { recursive: true });
  await writeFile(reviewsFilePath, JSON.stringify(reviews, null, 2));
}
 
async function handleReviewCreate(request, response) {
  try {
    const body = await readJsonBody(request);
    const { dept, course, prof, rating, summary, content, authorId, authorName } = body;
 
    if (!dept || !course || !rating || !summary) {
      sendJson(response, 400, { error: "학과, 과목명, 평점, 한줄평은 필수입니다." });
      return;
    }
 
    const review = {
      id: crypto.randomUUID(),
      dept,
      course,
      prof: prof || "",
      rating: Number(rating),
      summary,
      content: content || "",
      authorId: authorId || "anonymous",
      authorName: authorName || "익명",
      likes: [],
      createdAt: new Date().toISOString()
    };
 
    const reviews = await readReviews();
    await writeReviews([review, ...reviews]);
    sendJson(response, 201, review);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
}
 
async function handleReviewLike(reviewId, request, response) {
  try {
    const body = await readJsonBody(request);
    const { userId } = body;
 
    const reviews = await readReviews();
    const review = reviews.find(r => r.id === reviewId);
 
    if (!review) {
      sendJson(response, 404, { error: "리뷰를 찾을 수 없습니다." });
      return;
    }
 
    if (review.likes.includes(userId)) {
      review.likes = review.likes.filter(id => id !== userId);
    } else {
      review.likes.push(userId);
    }
 
    await writeReviews(reviews);
    sendJson(response, 200, review);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
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

async function createAssistantReply(message, history, sessionId) {
  const response = await fetch(`${coraApiUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history, session_id: sessionId || null })
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
  setCorsHeaders(response);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Course Footprint — 수강 발자취 추천
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function loadCourseHistory() {
  try {
    const content = await readFile(courseHistoryFilePath, "utf-8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed)
      ? parsed.map(normalizeHistoryStudent).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function normalizeCourseId(courseId) {
  return String(courseId || "").trim().toUpperCase();
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeHistoryStudent(student) {
  if (!student || !Array.isArray(student.semesterHistory)) return null;
  const semesterHistory = student.semesterHistory
    .map(semester => Array.isArray(semester)
      ? [...new Set(semester.map(normalizeCourseId).filter(Boolean))]
      : [])
    .filter(semester => semester.length > 0);

  return {
    ...student,
    department: normalizeText(student.department),
    track: normalizeText(student.track || "전체"),
    semesterHistory,
    courseNames: student.courseNames || {}
  };
}

async function loadRoadmap() {
  try {
    const content = await readFile(roadmapFilePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

function calculateJaccardSimilarity(setA, setB) {
  const a = new Set(setA.map(normalizeCourseId).filter(Boolean));
  const b = new Set(setB.map(normalizeCourseId).filter(Boolean));
  const intersection = [...a].filter(x => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  if (union === 0) return 0;
  return intersection / union;
}

function analyzeCourseTransitions(matchedStudents, completedCourses) {
  const completed = new Set(completedCourses.map(normalizeCourseId).filter(Boolean));
  const courseFreq = new Map();

  for (const student of matchedStudents) {
    const { semesterHistory } = student;

    // 마지막으로 이수 과목이 등장한 학기 번호
    let lastCompletedSem = -1;
    for (let i = 0; i < semesterHistory.length; i++) {
      if (semesterHistory[i].some(c => completed.has(c))) lastCompletedSem = i;
    }
    if (lastCompletedSem === -1) continue;

    // 그 이후 학기의 미이수 과목만 집계
    const seen = new Set();
    for (let i = lastCompletedSem + 1; i < semesterHistory.length; i++) {
      for (const course of semesterHistory[i]) {
        if (!completed.has(course) && !seen.has(course)) {
          courseFreq.set(course, (courseFreq.get(course) || 0) + 1);
          seen.add(course);
        }
      }
    }
  }

  return courseFreq;
}

function buildCourseNameMap(roadmap, history = []) {
  const map = {};
  for (const student of history) {
    for (const [courseId, courseName] of Object.entries(student.courseNames || {})) {
      const normalizedId = normalizeCourseId(courseId);
      if (normalizedId && courseName) map[normalizedId] = courseName;
    }
  }
  for (const dept of Object.values(roadmap)) {
    for (const trackData of Object.values(dept.tracks || {})) {
      for (const stage of trackData.stages || []) {
        for (const course of stage.courses || []) {
          map[normalizeCourseId(course.id)] = course.name;
        }
      }
    }
  }
  return map;
}

function buildReason(courseId, completedCourses, matchedStudents, frequency) {
  let bestPrior = null;
  let bestCount = 0;

  for (const prior of completedCourses.map(normalizeCourseId).filter(Boolean)) {
    let count = 0;
    for (const student of matchedStudents) {
      const { semesterHistory } = student;
      let priorSem = -1;
      let courseSem = -1;
      for (let i = 0; i < semesterHistory.length; i++) {
        if (semesterHistory[i].includes(prior)) priorSem = i;
        if (semesterHistory[i].includes(courseId)) courseSem = i;
      }
      if (priorSem !== -1 && courseSem !== -1 && courseSem > priorSem) count++;
    }
    if (count > bestCount) { bestCount = count; bestPrior = prior; }
  }

  if (bestPrior && bestCount > 0) {
    return `${bestPrior} 이수 후 유사 학생 ${matchedStudents.length}명 중 ${frequency}명이 선택`;
  }
  return "유사 수강 패턴 학생들이 자주 선택한 과목";
}

function getRoadmapFallback(track, completedCourses, roadmap) {
  const completed = new Set(completedCourses.map(normalizeCourseId).filter(Boolean));
  for (const dept of Object.values(roadmap)) {
    const trackData = dept.tracks?.[track];
    if (!trackData) continue;
    return (trackData.stages || [])
      .flatMap(s => s.courses || [])
      .filter(c => !completed.has(normalizeCourseId(c.id)))
      .slice(0, 6)
      .map(c => ({
        courseId: c.id,
        courseName: c.name,
        frequency: null,
        percentage: null,
        reason: `${track} 트랙 로드맵 기반 추천`
      }));
  }
  return [];
}

function getFootprintRecommendations(department, track, completedCourses, history, roadmap) {
  const normalizedDepartment = normalizeText(department);
  const normalizedTrack = normalizeText(track);
  const normalizedCompleted = completedCourses.map(normalizeCourseId).filter(Boolean);

  // Primary: 같은 학과 + 같은 트랙
  let matched = history.filter(s => s.department === normalizedDepartment && s.track === normalizedTrack);

  // 엑셀 데이터의 제2전공 값(예: 심화전공)과 화면의 희망 트랙 값(AI/인공지능 등)이
  // 다를 수 있으므로, 표본이 적으면 같은 학과 전체로 보조 확장한다.
  if (matched.length < 3) {
    const extra = history.filter(s => s.department === normalizedDepartment && s.track !== normalizedTrack);
    matched = [...matched, ...extra];
  }

  const matchedGroupSize = matched.length;

  // completedCourses 없거나 매칭된 학생 없으면 roadmap fallback
  if (normalizedCompleted.length === 0 || matched.length === 0) {
    return {
      matchedGroupSize,
      recommendations: getRoadmapFallback(normalizedTrack, normalizedCompleted, roadmap),
      source: "roadmap-fallback"
    };
  }

  // Jaccard Similarity 필터링
  const withSimilarity = matched
    .map(student => {
      const all = student.semesterHistory.flat();
      const sim = calculateJaccardSimilarity(normalizedCompleted, all);
      return { student, sim };
    })
    .filter(({ sim }) => sim > 0)
    .sort((a, b) => b.sim - a.sim);

  const topStudents = withSimilarity.map(({ student }) => student);

  if (topStudents.length === 0) {
    return {
      matchedGroupSize,
      recommendations: getRoadmapFallback(normalizedTrack, normalizedCompleted, roadmap),
      source: "roadmap-fallback"
    };
  }

  // 다음 학기 전환 빈도 분석
  const courseFreq = analyzeCourseTransitions(topStudents, normalizedCompleted);
  const courseNameMap = buildCourseNameMap(roadmap, history);

  const recommendations = [...courseFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([courseId, freq]) => ({
      courseId,
      courseName: courseNameMap[courseId] || courseId,
      frequency: freq,
      percentage: Math.round((freq / topStudents.length) * 100),
      reason: buildReason(courseId, normalizedCompleted, topStudents, freq)
    }));

  if (recommendations.length === 0) {
    return {
      matchedGroupSize: topStudents.length,
      recommendations: getRoadmapFallback(normalizedTrack, normalizedCompleted, roadmap),
      source: "roadmap-fallback"
    };
  }

  return {
    matchedGroupSize: topStudents.length,
    recommendations,
    source: "footprint"
  };
}

async function handleCourseFootprintRequest(request, response) {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const department = url.searchParams.get("department") || "";
    const track = url.searchParams.get("track") || "";
    const completedParam = url.searchParams.get("completedCourses") || "";
    const completedCourses = completedParam
      ? completedParam.split(",").map(normalizeCourseId).filter(Boolean)
      : [];

    const history = courseHistoryCache || await loadCourseHistory();
    const roadmap = roadmapCache || await loadRoadmap();

    const result = getFootprintRecommendations(department, track, completedCourses, history, roadmap);
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
}
