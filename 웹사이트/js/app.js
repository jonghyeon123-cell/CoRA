import { loginUser, registerUser, resetPassword, sendChatMessage, sendChatMessageStructured, fetchCourseFootprint } from "./api.js";
import { addMessage, clearUser, setLastResult, setLoading, setUser, store, subscribe } from "./state.js";
import { renderConnectionStatus, renderMessages, renderResult, renderFootprintResults, renderRecommendations, renderRoadmapSuggestion, renderNextCourseCard } from "./components.js";

const days = ["월", "화", "수", "목", "금","토","일"];
const timeSlots = ["09:00-10:15", "10:30-11:45", "12:00-13:15", "13:30-14:45", "15:00-16:15", "16:30-17:45","18:00-18:50","19:00-19:50","20:00-20:50","21:00-21:50","22:00-22:50"];
const gradeScale = { "A+": 4.5, A0: 4.0, "B+": 3.5, B0: 3.0, "C+": 2.5, C0: 2.0, "D+": 1.5, D0: 1.0, F: 0 };

let careerRoadmap = {};
let courseNames = {};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 데이터 로드
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function loadRoadmapData() {
  try {
    const [roadmapRes, coursesRes] = await Promise.all([
      fetch("/roadmap.json"),
      fetch("/api/courses")
    ]);
    careerRoadmap = await roadmapRes.json();
    courseNames = await coursesRes.json();
    renderDepartmentOptions();
    initializeCareerTrack();
    renderHomeDashboard();
  } catch (e) {
    console.error("데이터 로드 실패:", e);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Workspace SPA 라우터
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const pageMain = document.querySelector("#page-main");
const pageChat = document.querySelector("#page-chat");
const navChat = document.querySelector("#nav-chat");

// viewName → #page-main 내 섹션 ID 매핑
const VIEW_SECTIONS = {
  home:      "dashboard",
  history:   "schedule",
  footprint: "course-footprint",
  career:    "career"
};

// hash → viewName (레거시 hash 포함)
const HASH_TO_VIEW = {
  "": "home", home: "home", dashboard: "home",
  history: "history", schedule: "history",
  footprint: "footprint", "course-footprint": "footprint",
  career: "career", chat: "chat"
};

const ALL_WS_SECTIONS = Object.values(VIEW_SECTIONS);

function navigateTo(viewName, pushState = true) {
  const isChat = viewName === "chat";

  pageMain.classList.toggle("hidden", isChat);
  if (pageChat) pageChat.classList.toggle("hidden", !isChat);

  if (!isChat) {
    // 모든 워크스페이스 섹션 숨김 후 대상만 표시 (.hidden 클래스 사용 — !important 보장)
    ALL_WS_SECTIONS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add("hidden");
    });
    const sectionId = VIEW_SECTIONS[viewName] || "dashboard";
    const section = document.getElementById(sectionId);
    if (section) section.classList.remove("hidden");
    if (viewName === "home") renderHomeDashboard();
  } else {
    setTimeout(() => document.querySelector("#chat-input")?.focus(), 120);
  }

  pageMain.classList.toggle("is-workspace", !isChat && viewName !== "home");

  if (pushState) {
    history.pushState({ view: viewName }, "", `#${viewName}`);
  }

  document.querySelectorAll("[data-view]").forEach(link => {
    link.classList.toggle("nav-active", link.dataset.view === viewName);
  });
}

// nav 클릭
document.querySelectorAll("[data-view]").forEach(link => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    navigateTo(link.dataset.view);
  });
});

// back / forward
window.addEventListener("popstate", (e) => {
  const viewName = (e.state?.view) || HASH_TO_VIEW[location.hash.slice(1)] || "home";
  navigateTo(viewName, false);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 상태 및 DOM 참조
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const storageKeys = {
  accounts: "campus-mate-accounts",
  session: "campus-mate-session",
  schedule: "campus-mate-schedule",
  grades: "campus-mate-grades",
  career: "campus-mate-career",
  semesterHistory: "cora-semester-history",
  academicProfile: "cora-academic-profile"
};

// 사용자별 스토리지 네임스페이스 — 로그인 전: anon, 로그인 후: 이메일 기반
function userKey(suffix) {
  const email = store.user?.email;
  return email ? `cora-${email}-${suffix}` : `cora-anon-${suffix}`;
}

let scheduleItems = loadList(storageKeys.schedule, [
  { id: crypto.randomUUID(), title: "웹프로그래밍", day: "월", time: "10:30", room: "공학관 204" },
  { id: crypto.randomUUID(), title: "데이터베이스", day: "수", time: "13:30", room: "새롬관 312" }
]);

let gradeItems = loadList(storageKeys.grades, [
  { id: crypto.randomUUID(), title: "자료구조", credit: 3, score: "A0" },
  { id: crypto.randomUUID(), title: "컴퓨터구조", credit: 3, score: "B+" }
]);

let semesterHistory = [];
let selectedSemesterId = null;
let editingCourseId = null;
let editingSemesterInfoId = null;
let userAcademicProfile = { primaryMajor: "", secondaryMajor: "" };

const TERM_ORDER = { "1": 0, "summer": 1, "2": 2, "winter": 3 };
const TERM_LABEL = { "1": "1학기", "summer": "여름학기", "2": "2학기", "winter": "겨울학기" };

const logoChatToggle = document.querySelector("#logo-chat-toggle");
const messageList = document.querySelector("#message-list");
const resultSummary = document.querySelector("#result-summary");
const connectionStatus = document.querySelector("#connection-status");
const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");

const accountPanel = document.querySelector(".account-panel");
const authTabs = document.querySelectorAll("[data-auth-mode]");
const authFeedback = document.querySelector("#auth-feedback");
const loginForm = document.querySelector("#login-form");
const registerForm = document.querySelector("#register-form");
const resetForm = document.querySelector("#reset-form");
const logoutButton = document.querySelector("#logout-button");
const userChip = document.querySelector("#user-chip");
const accountSummary = document.querySelector("#account-summary");

const trackPreview = document.querySelector("#track-preview");

const scheduleForm = document.querySelector("#schedule-form");
const timetableGrid = document.querySelector("#timetable-grid");
const gpaForm = document.querySelector("#gpa-form");
const gradeList = document.querySelector("#grade-list");
const gpaTotal = document.querySelector("#gpa-total");
const careerForm = document.querySelector("#career-form");
const careerDepartment = document.querySelector("#career-department");
const careerGrade = document.querySelector("#career-grade");
const careerTrack = document.querySelector("#career-track");
const careerCourseList = document.querySelector("#career-course-list");
const careerResult = document.querySelector("#career-result");

const semesterAddBtn = document.querySelector("#semester-add-btn");
const semesterListEl = document.querySelector("#semester-list");
const semesterDetailPanel = document.querySelector("#semester-detail");
const semesterAnalysisPanel = document.querySelector("#semester-analysis");
const semesterAddPanel = document.querySelector("#semester-add-panel");
const semesterAddForm = document.querySelector("#semester-add-form");
const semesterAddCancel = document.querySelector("#semester-add-cancel");

restoreSession();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 구독 & 이벤트
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
subscribe((currentStore) => {
  renderMessages(messageList, currentStore.messages);
  // 로딩 중: 타이핑 인디케이터 추가 (replaceChildren 이후 append)
  if (currentStore.isLoading) {
    const typingEl = document.createElement("article");
    typingEl.className = "message assistant chatbot-typing";
    typingEl.innerHTML =
      '<span class="message-meta">CORA</span>' +
      '<div class="typing-dots"><span></span><span></span><span></span></div>';
    messageList.appendChild(typingEl);
    messageList.scrollTop = messageList.scrollHeight;
  }
  renderResult(resultSummary, currentStore.lastResult);
  renderConnectionStatus(connectionStatus, currentStore);
  renderLoginState(currentStore.user);
});

if (logoChatToggle) {
  logoChatToggle.addEventListener("click", () => navigateTo("home"));
}

authTabs.forEach((tab) => tab.addEventListener("click", () => setAuthMode(tab.dataset.authMode)));

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(loginForm);
  const email = normalizeEmail(formData.get("email"));
  const password = String(formData.get("password") || "");
  const loginResult = await loginUser({ email, password });
  const user = loginResult.ok ? loginResult.user : loginResult.offline ? await authenticateStoredUser(email, password) : null;

  if (!user) { showAuthFeedback(loginResult.message || "가입된 이메일과 비밀번호를 확인해 주세요.", "error"); return; }

  setUser(user);
  loadUserData();
  renderSemesterNav();
  renderHomeDashboard();
  saveSession(user, formData.get("remember") === "on");
  loginForm.reset();
  window.location.hash = "#dashboard";
  showAuthFeedback("", "success");
  setLastResult({ title: "로그인 완료", summary: `${user.name}님, ${user.department} 계정으로 로그인했습니다.`, source: user.source || "api" });
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(registerForm);
  const password = String(formData.get("password") || "");
  const passwordConfirm = String(formData.get("passwordConfirm") || "");

  if (password.length < 6) { showAuthFeedback("비밀번호는 6자 이상으로 입력해 주세요.", "error"); return; }
  if (password !== passwordConfirm) { showAuthFeedback("비밀번호 확인이 일치하지 않습니다.", "error"); return; }

  const registerPayload = {
    name: String(formData.get("name") || "").trim(),
    studentId: String(formData.get("studentId") || "").trim(),
    department: String(formData.get("department") || "").trim(),
    email: normalizeEmail(formData.get("email")),
    password
  };
  let result = await registerUser(registerPayload);
  if (result.offline) result = await registerStoredUser(registerPayload);
  if (!result.ok) { showAuthFeedback(result.message, "error"); return; }

  setUser(result.user);
  loadUserData();
  renderSemesterNav();
  renderHomeDashboard();
  saveSession(result.user, true);
  registerForm.reset();
  window.location.hash = "#dashboard";
  showAuthFeedback("회원가입이 완료되었습니다.", "success");
  setLastResult({ title: "회원가입 완료", summary: `${result.user.name}님 계정을 생성하고 로그인했습니다.`, source: result.user.source || "api" });
});

document.querySelector("#forgot-pw-btn")?.addEventListener("click", () => setAuthMode("reset"));
document.querySelector("#reset-back-btn")?.addEventListener("click", () => setAuthMode("login"));

resetForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(resetForm);
  const name = String(formData.get("name") || "").trim();
  const email = normalizeEmail(formData.get("email"));
  const newPassword = String(formData.get("password") || "");
  const newPasswordConfirm = String(formData.get("passwordConfirm") || "");

  if (newPassword.length < 6) { showAuthFeedback("비밀번호는 6자 이상으로 입력해 주세요.", "error"); return; }
  if (newPassword !== newPasswordConfirm) { showAuthFeedback("비밀번호 확인이 일치하지 않습니다.", "error"); return; }

  const result = await resetPassword({ name, email, newPassword });
  if (!result.ok) { showAuthFeedback(result.message || "재설정에 실패했습니다.", "error"); return; }

  resetForm.reset();
  showAuthFeedback("비밀번호가 재설정되었습니다. 새 비밀번호로 로그인하세요.", "success");
  setAuthMode("login");
});

logoutButton.addEventListener("click", () => {
  clearUser();
  clearSavedSession();
  // 메모리 초기화: 다음 사용자가 이전 사용자 데이터를 볼 수 없도록
  semesterHistory = [];
  userAcademicProfile = { primaryMajor: "", secondaryMajor: "" };
  selectedSemesterId = null;
  renderSemesterNav();
  renderHomeDashboard();
  setAuthMode("login");
  navigateTo("home");
  setLastResult({ title: "로그아웃", summary: "현재 브라우저에 저장된 로그인 상태를 해제했습니다.", source: "local" });
});

scheduleForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(scheduleForm);
  const item = { id: crypto.randomUUID(), title: formData.get("courseTitle").trim(), day: formData.get("courseDay"), time: formData.get("courseTime"), room: formData.get("courseRoom").trim() };
  scheduleItems = [...scheduleItems, item];
  saveList(storageKeys.schedule, scheduleItems);
  renderTimetable();
  renderStats();
  scheduleForm.reset();
  setLastResult({ title: "시간표 추가", summary: `${item.day}요일 ${item.time}에 ${item.title} 수업을 추가했습니다.`, source: "local" });
});

timetableGrid.addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-remove-class]");
  if (!removeButton) return;
  const targetId = removeButton.dataset.removeClass;
  const removedItem = scheduleItems.find((item) => item.id === targetId);
  scheduleItems = scheduleItems.filter((item) => item.id !== targetId);
  saveList(storageKeys.schedule, scheduleItems);
  renderTimetable();
  renderStats();
  if (removedItem) setLastResult({ title: "시간표 삭제", summary: `${removedItem.title} 수업을 시간표에서 삭제했습니다.`, source: "local" });
});

gpaForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(gpaForm);
  const item = { id: crypto.randomUUID(), title: formData.get("gradeCourse").trim(), credit: Number(formData.get("gradeCredit")), score: formData.get("gradeScore") };
  gradeItems = [...gradeItems, item];
  saveList(storageKeys.grades, gradeItems);
  renderGrades();
  renderStats();
  gpaForm.reset();
  setLastResult({ title: "학점 계산", summary: `${item.title} ${item.credit}학점 ${item.score}를 반영했습니다. 현재 GPA는 ${calculateGpa().toFixed(2)}입니다.`, source: "local" });
});

gradeList.addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-remove-grade]");
  if (!removeButton) return;
  const targetId = removeButton.dataset.removeGrade;
  const removedItem = gradeItems.find((item) => item.id === targetId);
  gradeItems = gradeItems.filter((item) => item.id !== targetId);
  saveList(storageKeys.grades, gradeItems);
  renderGrades();
  renderStats();
  if (removedItem) setLastResult({ title: "학점 항목 삭제", summary: `${removedItem.title} 항목을 계산 목록에서 삭제했습니다.`, source: "local" });
});

careerDepartment.addEventListener("change", () => {
  const savedSelection = loadCareerSelection();
  renderCareerTrackOptions(savedSelection.track);
  renderCareerCourseList(savedSelection.completedCourses || []);
  renderCareerResult();
});
careerGrade.addEventListener("change", () => renderCareerResult());
careerTrack.addEventListener("change", () => renderCareerResult());
careerCourseList.addEventListener("change", () => renderCareerResult());

careerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  handleRoadmapView();
});

careerResult.addEventListener("click", (event) => {
  // ── 1. 다음 추천 과목 보기 (즉시 패널) ──────────────────────
  const nextBtn = event.target.closest("[data-next-courses]");
  if (nextBtn) {
    const panel = careerResult.querySelector("#next-course-panel");
    if (!panel) return;
    const selection = getCareerSelection();
    const courses = getNextRoadmapCourses(selection);
    renderNextCourseRecommendations(panel, courses);
    panel.classList.remove("hidden");
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }

  // ── 2. 과목별 AI 질문 버튼 (next-course-card 내부) ──────────
  const courseBtn = event.target.closest("[data-course-id]");
  if (courseBtn) {
    const courseId = courseBtn.dataset.courseId;
    const courseName = courseBtn.dataset.courseName;
    navigateTo("chat");
    chatInput.value = `${courseName}(${courseId}) 과목에 대해 알려줘. 선수과목, 수업 내용을 포함해서 간결하게 설명해줘.`;
    setTimeout(() => chatInput.focus(), 120);
    return;
  }

  // ── 3. AI 심화 상담 (기존 data-career-chat 유지) ────────────
  const chatButton = event.target.closest("[data-career-chat]");
  if (!chatButton) return;
  const selection = getCareerSelection();
  const analysis = getCareerAnalysis(selection);
  const missingText = formatCourseList(analysis.missingRequired, 8);
  const nextText = formatCourseList(analysis.nextCourses, 6);
  navigateTo("chat");
  chatInput.value = `${analysis.department.name} ${selection.grade}학년 ${analysis.track.name} 트랙으로 가고 싶어.\n아직 안 들은 핵심 과목은 ${missingText}이고,\n다음 추천 과목은 ${nextText}야.\n선수과목과 난이도를 고려해서 어떤 순서로 들으면 좋을지 알려줘.`;
});

// 채팅 전송 이벤트
chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message || store.isLoading) return;
  addMessage({ role: "user", content: message });
  chatInput.value = "";
  chatInput.style.height = "auto";
  setLoading(true);
  const result = await sendChatMessageStructured({ message, history: store.messages });
  setLastResult({ title: result.source === "api" ? "챗봇 응답" : "챗봇 Mock 응답", summary: result.summary || result.reply, source: result.source });
  addMessage({ role: "assistant", content: result.reply });

  // 구조화 추천 카드 렌더링 (추천 과목이 있을 때만)
  if (result.recommendations && result.recommendations.length > 0) {
    const msgContainer = messageList.lastElementChild;
    if (msgContainer) renderRecommendations(msgContainer, result.recommendations);
  }
  if (result.roadmap && result.roadmap.length > 0) {
    const msgContainer = messageList.lastElementChild;
    if (msgContainer) renderRoadmapSuggestion(msgContainer, result.roadmap);
  }

  setLoading(false);
});

// 엔터 키로 메시지 전송
chatInput.addEventListener("keydown", (e) => {
  if (e.isComposing) return;
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 초기화
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
navigateTo(HASH_TO_VIEW[location.hash.slice(1)] || "home", false);
renderTimetable();
renderGrades();
loadUserData();
loadRoadmapData();
renderStats();
renderSemesterNav();
renderHomeDashboard();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 렌더링 함수들
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function renderLoginState(user) {
  document.body.classList.toggle("is-authenticated", Boolean(user));
  userChip.textContent = user ? `${user.name}님` : "로그인 전";
  logoutButton.classList.toggle("hidden", !user);
  accountPanel.querySelector("h2").textContent = user ? "내 계정" : "계정 정보";
  renderAccountPanel(user);
}

function renderAccountPanel(user) {
  if (!accountSummary) return;
  accountSummary.innerHTML = "";

  if (!user) {
    const placeholder = document.createElement("p");
    placeholder.className = "acct-placeholder";
    placeholder.textContent = "로그인 후 계정 정보가 표시됩니다.";
    accountSummary.append(placeholder);
    return;
  }

  // 관심 트랙: localStorage 우선, 없으면 DOM select
  const careerData = loadCareerSelection();
  const rawTrack = careerData.track || (careerTrack ? careerTrack.value : "") || "";
  const trackLabel = rawTrack ? (getTrackPreviewName(rawTrack) || rawTrack) : "-";

  // 현재 학기: semesterHistory에서 가장 최근 학기
  const sorted = [...semesterHistory].sort((a, b) =>
    b.year !== a.year ? b.year - a.year : (TERM_ORDER[b.termType] ?? 99) - (TERM_ORDER[a.termType] ?? 99));
  const latest = sorted[0];
  const semLabel = latest ? `${latest.year}년 ${TERM_LABEL[latest.termType] || latest.termType}` : "-";

  // 이메일 인증 완료 row
  const verifiedRow = document.createElement("div");
  verifiedRow.className = "acct-row acct-row-verified";
  const vIcon = document.createElement("span");
  vIcon.className = "acct-verified-icon";
  vIcon.textContent = "✓";
  const vText = document.createElement("span");
  vText.className = "acct-verified-text";
  vText.textContent = user.email || user.studentId || "";
  verifiedRow.append(vIcon, vText);

  // 이름 / 관심 트랙 / 현재 학기 rows
  const infoRows = [
    { label: "이름", value: user.name || "-" },
    { label: "관심 트랙", value: trackLabel },
    { label: "현재 학기", value: semLabel }
  ].map(({ label, value }) => {
    const row = document.createElement("div");
    row.className = "acct-row";
    const labelEl = document.createElement("span");
    labelEl.className = "acct-label";
    labelEl.textContent = label;
    const valueEl = document.createElement("span");
    valueEl.className = "acct-value";
    valueEl.textContent = value;
    row.append(labelEl, valueEl);
    return row;
  });

  accountSummary.append(verifiedRow, ...infoRows);
}

function setAuthMode(mode) {
  loginForm.classList.toggle("hidden", mode !== "login");
  registerForm.classList.toggle("hidden", mode !== "register");
  resetForm.classList.toggle("hidden", mode !== "reset");
  authTabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.authMode === mode));
  showAuthFeedback("");
}

function showAuthFeedback(message, type = "") {
  authFeedback.textContent = message;
  authFeedback.classList.toggle("is-error", type === "error");
  authFeedback.classList.toggle("is-success", type === "success");
}

function renderTimetable() {
  const table = document.createElement("table");
  table.className = "timetable-table";
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  headerRow.append(createCell("th", "시간"));
  days.forEach((day) => headerRow.append(createCell("th", day)));
  thead.append(headerRow);
  const tbody = document.createElement("tbody");
  timeSlots.forEach((time) => {
    const row = document.createElement("tr");
    const timeCell = createCell("th", time);
    timeCell.className = "time-cell";
    row.append(timeCell);
    days.forEach((day) => {
      const cell = document.createElement("td");
      scheduleItems.filter((item) => item.day === day && item.time === time).forEach((item) => cell.append(createClassBlock(item)));
      row.append(cell);
    });
    tbody.append(row);
  });
  table.append(thead, tbody);
  timetableGrid.replaceChildren(table);
}

function createClassBlock(item) {
  const block = document.createElement("div");
  block.className = "class-block";
  const title = document.createElement("strong");
  title.textContent = item.title;
  const room = document.createElement("span");
  room.textContent = item.room;
  const removeButton = document.createElement("button");
  removeButton.className = "class-remove";
  removeButton.type = "button";
  removeButton.textContent = "×";
  removeButton.dataset.removeClass = item.id;
  block.append(title, room, removeButton);
  return block;
}

function renderGrades() {
  gpaTotal.textContent = calculateGpa().toFixed(2);
  if (!gradeItems.length) {
    gradeList.innerHTML = '<p class="empty-state">아직 입력한 과목이 없습니다.</p>';
    return;
  }
  gradeList.replaceChildren(...gradeItems.map(createGradeItem));
}

function createGradeItem(item) {
  const article = document.createElement("article");
  article.className = "grade-item";
  const main = document.createElement("div");
  main.className = "grade-main";
  const title = document.createElement("strong");
  title.textContent = item.title;
  const credit = document.createElement("span");
  credit.textContent = `${item.credit}학점`;
  main.append(title, credit);
  const score = document.createElement("span");
  score.className = "grade-score";
  score.textContent = item.score;
  const removeButton = document.createElement("button");
  removeButton.className = "remove-grade";
  removeButton.type = "button";
  removeButton.textContent = "삭제";
  removeButton.dataset.removeGrade = item.id;
  article.append(main, score, removeButton);
  return article;
}

function initializeCareerTrack() {
  const savedSelection = loadCareerSelection();
  const deptKeys = Object.keys(careerRoadmap);
  const savedDept = savedSelection.department;
  if (savedDept && careerRoadmap[savedDept]) {
    careerDepartment.value = savedDept;
  } else if (deptKeys.length > 0) {
    careerDepartment.value = deptKeys[0];
  }
  if (savedSelection.grade) careerGrade.value = String(savedSelection.grade);
  renderCareerTrackOptions(savedSelection.track);
  renderCareerCourseList(savedSelection.completedCourses || []);
  renderCareerResult();
}

function renderDepartmentOptions() {
  careerDepartment.replaceChildren(
    ...Object.keys(careerRoadmap).map((dept) => {
      const option = document.createElement("option");
      option.value = dept;
      option.textContent = dept;
      return option;
    })
  );
}

function renderCareerTrackOptions(preferredTrack = "") {
  const dept = careerDepartment.value;
  const department = careerRoadmap[dept];
  if (!department) return;
  const trackEntries = Object.entries(department.tracks);
  careerTrack.replaceChildren(
    ...trackEntries.map(([key]) => {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = key;
      return option;
    })
  );
  careerTrack.value = department.tracks[preferredTrack] ? preferredTrack : trackEntries[0][0];
}

function renderCareerCourseList(completedCourses = []) {
  const dept = careerDepartment.value;
  const department = careerRoadmap[dept];
  if (!department) return;
  const seen = new Set();
  const allCourses = Object.values(department.tracks)
    .flatMap(track => track.stages.flatMap(stage => stage.courses))
    .filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; });

  careerCourseList.replaceChildren(
    ...allCourses.map((course) => {
      const label = document.createElement("label");
      label.className = "course-check-item";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = course.id;
      checkbox.checked = completedCourses.includes(course.id);
      const text = document.createElement("span");
      text.textContent = `${course.name} (${course.id})`;
      label.append(checkbox, text);
      return label;
    })
  );
}

function renderCareerResult(selection = getCareerSelection()) {
  const analysis = getCareerAnalysis(selection);
  saveCareerSelection(selection);
  trackPreview.textContent = getTrackPreviewName(analysis.track.name);

  const summary = document.createElement("div");
  summary.className = "career-summary";
  const title = document.createElement("h3");
  title.textContent = `${analysis.department.name} · ${analysis.track.name}`;
  const description = document.createElement("p");
  description.textContent = analysis.track.description;
  const meter = document.createElement("div");
  meter.className = "career-meter";
  const meterLabel = document.createElement("div");
  meterLabel.className = "career-meter-label";
  const meterTitle = document.createElement("span");
  meterTitle.textContent = "핵심 과목 진행률";
  const meterValue = document.createElement("strong");
  meterValue.textContent = `${analysis.completionRate}%`;
  const meterTrack = document.createElement("div");
  meterTrack.className = "career-meter-track";
  const meterFill = document.createElement("span");
  meterFill.className = "career-meter-fill";
  meterFill.style.width = `${analysis.completionRate}%`;
  meterLabel.append(meterTitle, meterValue);
  meterTrack.append(meterFill);
  meter.append(meterLabel, meterTrack);
  summary.append(title, description, meter);

  const requiredSection = createCourseSection({ title: "핵심 과목", description: "초록색은 이미 들은 과목이고, 나머지는 트랙 완성에 필요한 과목입니다.", courses: analysis.track.required, completedCourses: analysis.completedCourses });
  const nextSection = createCourseSection({ title: "다음 추천 과목", description: `${selection.grade}학년 기준으로 우선 수강하면 좋은 과목입니다.`, courses: analysis.nextCourses, completedCourses: analysis.completedCourses, variant: "is-next", emptyText: "현재 선택 기준에서는 바로 추천할 남은 과목이 없습니다." });
  const roadmapSection = createRoadmapSection(analysis, selection);

  // 메인 CTA: 즉시 추천 패널
  const quickBtn = document.createElement("button");
  quickBtn.className = "career-chat-button";
  quickBtn.type = "button";
  quickBtn.dataset.nextCourses = "true";
  quickBtn.textContent = "다음 추천 과목 보기";

  // 추천 패널 — 클릭 전 숨김, 클릭 후 표시
  const nextPanel = document.createElement("div");
  nextPanel.id = "next-course-panel";
  nextPanel.className = "next-course-panel hidden";

  // AI 심화 버튼 (기존 data-career-chat 보존)
  const chatButton = document.createElement("button");
  chatButton.className = "career-chat-button career-chat-button--ghost";
  chatButton.type = "button";
  chatButton.dataset.careerChat = "true";
  chatButton.textContent = "AI에게 자세히 물어보기";

  careerResult.replaceChildren(summary, requiredSection, nextSection, roadmapSection, quickBtn, nextPanel, chatButton);
  return analysis;
}

function createCourseSection({ title, description, courses, completedCourses, variant = "", emptyText = "" }) {
  const section = document.createElement("section");
  section.className = "career-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const caption = document.createElement("p");
  caption.textContent = description;
  const tagList = document.createElement("div");
  tagList.className = "tag-list";

  if (!courses.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = emptyText || "표시할 과목이 없습니다.";
    section.append(heading, caption, empty);
    return section;
  }

  courses.forEach((course) => {
    const id = course?.id ?? course;
    const name = course?.name ?? courseNames[id] ?? id;
    const tag = document.createElement("span");
    tag.className = `course-tag${completedCourses.includes(id) ? " is-done" : ""}${variant ? ` ${variant}` : ""}`;
    tag.textContent = `${name} (${id})`;
    tagList.append(tag);
  });

  section.append(heading, caption, tagList);
  return section;
}

function createRoadmapSection(analysis, selection = {}) {
  const currentGrade = String(selection.grade || "");
  const completedCourses = analysis.completedCourses || [];

  const section = document.createElement("section");
  section.className = "career-section";
  const heading = document.createElement("h3");
  heading.textContent = "학년별 로드맵";
  const caption = document.createElement("p");
  caption.textContent = "✓ 완료  →  현재 학년 추천  ·  이후 과목";
  const timeline = document.createElement("div");
  timeline.className = "roadmap-timeline";

  Object.entries(analysis.track.byGrade).forEach(([grade, courses]) => {
    const isCurrentGrade = grade === currentGrade;
    const step = document.createElement("article");
    step.className = `roadmap-step${isCurrentGrade ? " is-current-grade" : ""}`;
    const title = document.createElement("strong");
    title.textContent = `${grade}학년`;
    const list = document.createElement("ul");
    courses.forEach((course) => {
      const id = course?.id ?? course;
      const name = course?.name ?? courseNames[id] ?? id;
      const isDone = completedCourses.includes(id);
      const isNext = isCurrentGrade && !isDone;
      const item = document.createElement("li");
      item.className = `roadmap-item${isDone ? " is-done" : isNext ? " is-next" : ""}`;
      item.textContent = `${name} (${id})`;
      list.append(item);
    });
    step.append(title, list);
    timeline.append(step);
  });

  section.append(heading, caption, timeline);
  return section;
}

function getCareerAnalysis(selection) {
  const dept = selection.department;
  const department = careerRoadmap[dept] || careerRoadmap[Object.keys(careerRoadmap)[0]];
  const trackKey = selection.track;
  const track = department?.tracks[trackKey] || Object.values(department?.tracks || {})[0];
  const completedIds = selection.completedCourses || [];

  const allCourses = track?.stages?.flatMap(stage => stage.courses) || [];
  const completedRequired = allCourses.filter(c => completedIds.includes(c.id));
  const missingRequired = allCourses.filter(c => !completedIds.includes(c.id));
  const currentStage = track?.stages?.find(s => s.year?.includes(String(selection.grade))) || track?.stages?.[0];
  const nextCourses = (currentStage?.courses || []).filter(c => !completedIds.includes(c.id)).slice(0, 6);
  const completionRate = allCourses.length ? Math.round((completedRequired.length / allCourses.length) * 100) : 0;

  const byGrade = {};
  track?.stages?.forEach(stage => {
    const yr = stage.year || "";
    const gradeNum = yr.replace("학년", "").split("~")[0].trim();
    byGrade[gradeNum] = stage.courses;
  });

  return {
    department: { name: dept },
    track: { name: trackKey, description: track?.description || "", required: allCourses, recommended: nextCourses, byGrade },
    completedCourses: completedIds, completedRequired, missingRequired, nextCourses, completionRate
  };
}

function getNextRoadmapCourses(selection) {
  const analysis = getCareerAnalysis(selection);
  const grade = Number(selection.grade);
  const completedIds = analysis.completedCourses || [];

  // 1순위: 현재 학년 stage에서 미이수
  let candidates = analysis.nextCourses.slice();

  // 2순위: 다음 학년 stage
  if (candidates.length === 0) {
    const nextGradeCourses = analysis.track.byGrade[String(grade + 1)] || [];
    candidates = nextGradeCourses.filter(c => !completedIds.includes(c.id));
  }

  // 3순위: 전체 미이수 필수 과목
  if (candidates.length === 0) {
    candidates = analysis.missingRequired.slice();
  }

  return candidates.slice(0, 5).map((course, idx) => ({
    courseId: course.id,
    courseName: course.name,
    reason: idx === 0
      ? `${grade}학년 우선 수강 과목`
      : `${analysis.track.name} 트랙 권장`
  }));
}

function renderNextCourseRecommendations(panel, courses) {
  panel.innerHTML = "";

  const heading = document.createElement("p");
  heading.className = "next-course-heading";
  heading.textContent = "다음 추천 과목";
  panel.appendChild(heading);

  if (courses.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "현재 기준으로 추천할 남은 과목이 없습니다.";
    panel.appendChild(empty);
    return;
  }

  const list = document.createElement("div");
  list.className = "next-course-list";
  courses.forEach(course => list.appendChild(renderNextCourseCard(course)));
  panel.appendChild(list);
}

function getCareerSelection() {
  return {
    department: careerDepartment.value,
    grade: Number(careerGrade.value),
    track: careerTrack.value,
    completedCourses: [...careerCourseList.querySelectorAll("input:checked")].map((input) => input.value)
  };
}

function getTrackPreviewName(trackName) {
  if (trackName === "인공지능") return "AI";
  if (trackName.includes("/")) return trackName.split("/")[0];
  return trackName.replace(" 개발", "");
}

function loadCareerSelection() {
  try {
    const saved = localStorage.getItem(userKey("career"));
    return saved ? JSON.parse(saved) : {};
  } catch { return {}; }
}

function saveCareerSelection(selection) {
  localStorage.setItem(userKey("career"), JSON.stringify(selection));
}

function renderStats() {
  trackPreview.textContent && (trackPreview.textContent = getTrackPreviewName(getCareerSelection().track));
}

function calculateGpa() {
  const totalCredits = gradeItems.reduce((sum, item) => sum + item.credit, 0);
  if (!totalCredits) return 0;
  return gradeItems.reduce((sum, item) => sum + item.credit * gradeScale[item.score], 0) / totalCredits;
}

function createCell(tagName, text) {
  const cell = document.createElement(tagName);
  cell.textContent = text;
  return cell;
}

async function registerStoredUser({ name, studentId, department, email, password }) {
  if (!name || !studentId || !department || !email) return { ok: false, message: "모든 항목을 입력해 주세요." };
  const accounts = loadList(storageKeys.accounts, []);
  if (accounts.some((a) => a.email === email)) return { ok: false, message: "이미 가입된 이메일입니다." };
  const user = { id: crypto.randomUUID(), name, studentId, department, email, source: "local" };
  const account = { ...user, passwordHash: await hashPassword(password), createdAt: new Date().toISOString() };
  saveList(storageKeys.accounts, [...accounts, account]);
  return { ok: true, user };
}

async function authenticateStoredUser(email, password) {
  const accounts = loadList(storageKeys.accounts, []);
  const passwordHash = await hashPassword(password);
  const account = accounts.find((item) => item.email === email && item.passwordHash === passwordHash);
  return account ? toPublicUser(account) : null;
}

function saveSession(user, shouldRemember) {
  const payload = JSON.stringify({ user, savedAt: new Date().toISOString() });
  sessionStorage.setItem(storageKeys.session, payload);
  if (shouldRemember) { localStorage.setItem(storageKeys.session, payload); return; }
  localStorage.removeItem(storageKeys.session);
}

function restoreSession() {
  const savedSession = localStorage.getItem(storageKeys.session) || sessionStorage.getItem(storageKeys.session);
  if (!savedSession) return;
  try {
    const session = JSON.parse(savedSession);
    if (session?.user?.email) setUser(session.user);
  } catch { clearSavedSession(); }
}

function clearSavedSession() {
  localStorage.removeItem(storageKeys.session);
  sessionStorage.removeItem(storageKeys.session);
}

function toPublicUser(account) {
  return { id: account.id, name: account.name, studentId: account.studentId, department: account.department, email: account.email, source: account.source || "local" };
}

function normalizeEmail(value) { return String(value || "").trim().toLowerCase(); }

async function hashPassword(password) {
  if (crypto.subtle && window.isSecureContext) {
    const encodedPassword = new TextEncoder().encode(password);
    const hashBuffer = await crypto.subtle.digest("SHA-256", encodedPassword);
    return [...new Uint8Array(hashBuffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  let hash = 0;
  for (const character of password) { hash = (hash << 5) - hash + character.charCodeAt(0); hash |= 0; }
  return `fallback-${hash >>> 0}`;
}

function loadList(key, fallback) {
  try { const saved = localStorage.getItem(key); return saved ? JSON.parse(saved) : fallback; }
  catch { return fallback; }
}

function saveList(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 과목 객체 배열 → 읽기 좋은 문자열 변환
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function formatCourseList(courses, max = 8) {
  if (!Array.isArray(courses) || courses.length === 0) return "없음";
  return courses
    .slice(0, max)
    .map(c => {
      if (typeof c === "string") return c;
      const name = c.courseName ?? c.name ?? c.title ?? "";
      const id   = c.courseId   ?? c.id   ?? c.code  ?? "";
      if (!name && !id) return null;
      return name && id ? `${name}(${id})` : (name || id);
    })
    .filter(Boolean)
    .join(", ") || "없음";
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 수강 발자취 — 학기 히스토리 렌더링
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const SECONDARY_MAJOR_OPTIONS = ["없음", "이중전공", "융합전공", "학생설계전공", "심화전공"];

function loadAcademicProfile() {
  try {
    const saved = localStorage.getItem(userKey("academicProfile"));
    if (saved) return JSON.parse(saved);
    // 저장된 프로필 없으면 가장 최근 학기에서 유추
    const sorted = [...semesterHistory].sort((a, b) =>
      b.year !== a.year ? b.year - a.year : (TERM_ORDER[b.termType] ?? 99) - (TERM_ORDER[a.termType] ?? 99));
    if (sorted.length) return { primaryMajor: sorted[0].primaryMajor || "", secondaryMajor: sorted[0].secondaryMajor || "" };
    return { primaryMajor: "", secondaryMajor: "" };
  } catch { return { primaryMajor: "", secondaryMajor: "" }; }
}

function saveAcademicProfile(profile) {
  localStorage.setItem(userKey("academicProfile"), JSON.stringify(profile));
}

// 로그인/로그아웃 시 사용자별 데이터를 메모리에 재로드
function loadUserData() {
  semesterHistory = loadList(userKey("semesterHistory"), []).map(sem => ({
    ...sem,
    courses: (sem.courses || []).map(c => ({ ...c, majorType: normalizeCourseCategory(c.majorType) })),
    primaryMajor: sem.primaryMajor ?? sem.major ?? "",
    secondaryMajor: sem.secondaryMajor ?? sem.secondMajor ?? ""
  }));
  selectedSemesterId = null;
  userAcademicProfile = loadAcademicProfile();
}

function buildSecondaryMajorSelect(name, currentValue) {
  const sel = document.createElement("select");
  sel.name = name;
  sel.className = "footprint-major-select";
  const val = currentValue || "없음";
  const opts = SECONDARY_MAJOR_OPTIONS.includes(val) ? SECONDARY_MAJOR_OPTIONS : [...SECONDARY_MAJOR_OPTIONS, val];
  opts.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v; opt.textContent = v;
    if (v === val) opt.selected = true;
    sel.append(opt);
  });
  return sel;
}

function normalizeCourseCategory(cat) {
  if (!cat) return "전공";
  if (cat === "기타") return "학문의 기초";
  return cat;
}

function createCourseDisplayRow(course) {
  const row = document.createElement("tr");
  const cat = normalizeCourseCategory(course.majorType);
  [course.courseId, course.courseName, cat].forEach(text => {
    const td = document.createElement("td");
    td.textContent = text;
    row.append(td);
  });
  const actionTd = document.createElement("td");
  const editBtn = document.createElement("button");
  editBtn.className = "footprint-edit-btn";
  editBtn.type = "button";
  editBtn.dataset.editCourse = course.id;
  editBtn.textContent = "수정";
  const rmBtn = document.createElement("button");
  rmBtn.className = "semester-course-remove";
  rmBtn.type = "button";
  rmBtn.dataset.removeCourse = course.id;
  rmBtn.textContent = "×";
  actionTd.append(editBtn, rmBtn);
  row.append(actionTd);
  return row;
}

function createCourseEditRow(course) {
  const row = document.createElement("tr");
  row.className = "footprint-edit-row";

  const codeCell = document.createElement("td");
  const codeInput = Object.assign(document.createElement("input"), {
    type: "text", name: "editCourseId", value: course.courseId, autocomplete: "off"
  });
  codeInput.className = "footprint-edit-input";
  codeCell.append(codeInput);

  const nameCell = document.createElement("td");
  const nameInput = Object.assign(document.createElement("input"), {
    type: "text", name: "editCourseName", value: course.courseName, autocomplete: "off"
  });
  nameInput.className = "footprint-edit-input";
  nameCell.append(nameInput);

  const typeCell = document.createElement("td");
  const typeSel = document.createElement("select");
  typeSel.name = "editMajorType";
  typeSel.className = "footprint-edit-select";
  const currentCat = normalizeCourseCategory(course.majorType);
  ["전공", "제2전공", "교양", "학문의 기초", "일반선택"].forEach(v => {
    const opt = document.createElement("option");
    opt.value = v; opt.textContent = v;
    if (v === currentCat) opt.selected = true;
    typeSel.append(opt);
  });
  typeCell.append(typeSel);

  const actionCell = document.createElement("td");
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "footprint-save-btn";
  saveBtn.dataset.saveCourse = course.id;
  saveBtn.textContent = "저장";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "footprint-cancel-btn";
  cancelBtn.dataset.cancelEdit = "true";
  cancelBtn.textContent = "취소";
  actionCell.append(saveBtn, cancelBtn);

  row.append(codeCell, nameCell, typeCell, actionCell);
  return row;
}

function sortSemesters(arr) {
  return [...arr].sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    return (TERM_ORDER[a.termType] ?? 99) - (TERM_ORDER[b.termType] ?? 99);
  });
}

function renderSemesterNav() {
  if (!semesterListEl) return;
  const sorted = sortSemesters(semesterHistory);
  if (!sorted.length) {
    semesterListEl.innerHTML = '<p class="empty-state" style="font-size:0.8rem">아직 추가된 학기가 없습니다.</p>';
    return;
  }
  semesterListEl.replaceChildren(
    ...sorted.map(sem => {
      const btn = document.createElement("button");
      btn.className = `semester-nav-item${sem.id === selectedSemesterId ? " is-active" : ""}`;
      btn.type = "button";
      btn.dataset.semesterId = sem.id;
      btn.textContent = `${sem.year} ${TERM_LABEL[sem.termType] || sem.termType}`;
      return btn;
    })
  );
}

function renderSemesterDetail() {
  if (!semesterDetailPanel) return;
  if (!selectedSemesterId) {
    semesterDetailPanel.innerHTML = '<p class="empty-state">왼쪽에서 학기를 선택하세요.</p>';
    return;
  }
  const sem = semesterHistory.find(s => s.id === selectedSemesterId);
  if (!sem) { semesterDetailPanel.innerHTML = '<p class="empty-state">학기를 찾을 수 없습니다.</p>'; return; }

  const header = document.createElement("div");
  header.className = "semester-card-header";
  const title = document.createElement("strong");
  title.className = "semester-card-title";
  title.textContent = `${sem.year}년 ${TERM_LABEL[sem.termType] || sem.termType}`;
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "semester-card-delete";
  deleteBtn.type = "button";
  deleteBtn.dataset.deleteSemester = sem.id;
  deleteBtn.textContent = "학기 삭제";
  header.append(title, deleteBtn);

  let metaEl;
  if (editingSemesterInfoId === sem.id) {
    metaEl = document.createElement("div");
    metaEl.className = "footprint-profile-section";
    const p1Label = document.createElement("label");
    p1Label.textContent = "제1전공 ";
    const p1Input = Object.assign(document.createElement("input"), {
      type: "text", name: "editPrimaryMajor", value: sem.primaryMajor || "", placeholder: "컴퓨터학과", autocomplete: "off"
    });
    p1Input.className = "footprint-edit-input";
    p1Label.append(p1Input);
    const p2Label = document.createElement("label");
    p2Label.textContent = "제2전공 ";
    p2Label.append(buildSecondaryMajorSelect("editSecondaryMajor", sem.secondaryMajor));
    const infoActions = document.createElement("div");
    infoActions.className = "footprint-profile-actions";
    const saveInfoBtn = document.createElement("button");
    saveInfoBtn.type = "button";
    saveInfoBtn.className = "footprint-save-btn";
    saveInfoBtn.dataset.saveSemesterInfo = sem.id;
    saveInfoBtn.textContent = "저장";
    const cancelInfoBtn = document.createElement("button");
    cancelInfoBtn.type = "button";
    cancelInfoBtn.className = "footprint-cancel-btn";
    cancelInfoBtn.dataset.cancelSemesterInfo = "true";
    cancelInfoBtn.textContent = "취소";
    infoActions.append(saveInfoBtn, cancelInfoBtn);
    metaEl.append(p1Label, p2Label, infoActions);
  } else {
    metaEl = document.createElement("div");
    metaEl.className = "semester-card-meta-row";
    const metaText = document.createElement("span");
    metaText.className = "semester-card-meta";
    const p1 = sem.primaryMajor || "";
    const p2 = sem.secondaryMajor && sem.secondaryMajor !== "없음" ? `제2전공: ${sem.secondaryMajor}` : "";
    metaText.textContent = [p1 ? `제1전공: ${p1}` : "", p2].filter(Boolean).join(" · ") || "소속 정보 없음";
    const editInfoBtn = document.createElement("button");
    editInfoBtn.className = "footprint-semester-edit-btn";
    editInfoBtn.type = "button";
    editInfoBtn.dataset.editSemesterInfo = sem.id;
    editInfoBtn.textContent = "학기 정보 수정";
    metaEl.append(metaText, editInfoBtn);
  }

  const courseSection = document.createElement("div");
  courseSection.className = "semester-courses";

  if (!sem.courses.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "아직 추가된 과목이 없습니다. 아래 폼으로 과목을 추가하세요.";
    courseSection.append(empty);
  } else {
    const table = document.createElement("table");
    table.className = "semester-course-table";
    const thead = document.createElement("thead");
    const hRow = document.createElement("tr");
    ["학수번호", "과목명", "구분", ""].forEach(h => {
      const th = document.createElement("th");
      th.textContent = h;
      hRow.append(th);
    });
    thead.append(hRow);
    const tbody = document.createElement("tbody");
    sem.courses.forEach(course => {
      tbody.append(editingCourseId === course.id
        ? createCourseEditRow(course)
        : createCourseDisplayRow(course));
    });
    table.append(thead, tbody);
    courseSection.append(table);
  }

  const addForm = document.createElement("form");
  addForm.className = "semester-course-add-form";
  addForm.id = "semester-course-add-form";
  const codeInput = Object.assign(document.createElement("input"), { type: "text", name: "courseId", placeholder: "학수번호", autocomplete: "off" });
  const nameInput = Object.assign(document.createElement("input"), { type: "text", name: "courseName", placeholder: "과목명", autocomplete: "off" });
  const majorSel = document.createElement("select");
  majorSel.name = "majorType";
  ["전공", "제2전공", "교양", "학문의 기초", "일반선택"].forEach(v => {
    const opt = document.createElement("option");
    opt.value = v; opt.textContent = v;
    majorSel.append(opt);
  });
  const addBtn = document.createElement("button");
  addBtn.type = "submit"; addBtn.textContent = "과목 추가";
  addForm.append(codeInput, nameInput, majorSel, addBtn);

  semesterDetailPanel.replaceChildren(header, metaEl, courseSection, addForm);
}

function renderSemesterAnalysis() {
  if (!semesterAnalysisPanel) return;
  if (!selectedSemesterId) {
    semesterAnalysisPanel.innerHTML = '<p class="empty-state">학기를 선택하면<br>분석이 표시됩니다.</p>';
    return;
  }
  const sem = semesterHistory.find(s => s.id === selectedSemesterId);
  if (!sem) return;

  const allCourses = semesterHistory.flatMap(s => s.courses);
  const uniqueCourseIds = [...new Set(allCourses.map(c => c.courseId))];
  const majorCount = sem.courses.filter(c => c.majorType === "전공").length;
  const secondMajorCount = sem.courses.filter(c => c.majorType === "제2전공").length;
  const liberalCount = sem.courses.filter(c => c.majorType === "교양").length;
  const liberalArtCount = sem.courses.filter(c => c.majorType === "학문의 기초").length;
  const electiveCount = sem.courses.filter(c => c.majorType === "일반선택").length;

  const wrapper = document.createElement("div");
  wrapper.className = "semester-analysis-wrapper";

  const heading = document.createElement("p");
  heading.className = "semester-analysis-heading";
  heading.textContent = "이수 현황";

  const statsGrid = document.createElement("div");
  statsGrid.className = "semester-analysis-stats";
  statsGrid.append(
    createAnalysisStat("전체 이수", `${allCourses.length}과목`),
    createAnalysisStat("이번 학기", `${sem.courses.length}과목`)
  );
  if (majorCount > 0) statsGrid.append(createAnalysisStat("전공", `${majorCount}과목`));
  if (secondMajorCount > 0) statsGrid.append(createAnalysisStat("제2전공", `${secondMajorCount}과목`));
  if (liberalCount > 0) statsGrid.append(createAnalysisStat("교양", `${liberalCount}과목`));
  if (liberalArtCount > 0) statsGrid.append(createAnalysisStat("학문의 기초", `${liberalArtCount}과목`));
  if (electiveCount > 0) statsGrid.append(createAnalysisStat("일반선택", `${electiveCount}과목`));

  wrapper.append(heading, statsGrid);

  if (Object.keys(careerRoadmap).length > 0) {
    const selection = loadCareerSelection();
    const analysis = getCareerAnalysis({ ...selection, completedCourses: uniqueCourseIds });

    const progressSection = document.createElement("div");
    progressSection.className = "semester-track-progress";

    const progressLabel = document.createElement("p");
    progressLabel.className = "semester-analysis-heading";
    progressLabel.textContent = "트랙 진도율";

    const trackName = document.createElement("span");
    trackName.className = "semester-track-name";
    trackName.textContent = `${analysis.department.name} · ${analysis.track.name}`;

    const meterTrack = document.createElement("div");
    meterTrack.className = "career-meter-track";
    const meterFill = document.createElement("span");
    meterFill.className = "career-meter-fill";
    meterFill.style.width = `${analysis.completionRate}%`;
    meterTrack.append(meterFill);

    const meterValue = document.createElement("span");
    meterValue.className = "semester-track-value";
    meterValue.textContent = `${analysis.completionRate}% (${analysis.completedRequired.length}/${analysis.track.required.length}과목)`;

    progressSection.append(progressLabel, trackName, meterTrack, meterValue);
    wrapper.append(progressSection);
  }

  semesterAnalysisPanel.replaceChildren(wrapper);
}

function createAnalysisStat(label, value) {
  const stat = document.createElement("div");
  stat.className = "semester-analysis-stat";
  const v = document.createElement("strong");
  v.textContent = value;
  const l = document.createElement("span");
  l.textContent = label;
  stat.append(v, l);
  return stat;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 수강 발자취 (Course Footprint)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const footprintForm = document.querySelector("#footprint-form");
const footprintDepartment = document.querySelector("#footprint-department");
const footprintTrack = document.querySelector("#footprint-track");
const footprintCourses = document.querySelector("#footprint-courses");
const footprintCourseError = document.querySelector("#footprint-course-error");
const footprintResult = document.querySelector("#footprint-result");

function validateFootprintCourse() {
  const raw = footprintCourses.value.trim();
  if (!raw) return { ok: false, message: "이수한 과목 코드를 입력해주세요." };
  if (/[,/]/.test(raw) || raw.split(/\s+/).length > 1) {
    return { ok: false, message: "이수한 과목 코드는 한 과목만 입력해주세요. (예: COSE213)" };
  }
  return { ok: true, courseId: raw.toUpperCase() };
}

if (footprintForm) {
  footprintForm.addEventListener("submit", handleFootprintSubmit);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 수강 발자취 — 학기 히스토리 이벤트
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if (semesterAddBtn) {
  semesterAddBtn.addEventListener("click", () => {
    const p1Input = semesterAddForm?.querySelector("[name='primaryMajor']");
    const p2Sel = semesterAddForm?.querySelector("[name='secondaryMajor']");
    if (p1Input) p1Input.value = userAcademicProfile.primaryMajor || "";
    if (p2Sel) p2Sel.value = userAcademicProfile.secondaryMajor || "없음";
    semesterAddPanel.classList.remove("hidden");
  });
}
if (semesterAddCancel) {
  semesterAddCancel.addEventListener("click", () => semesterAddPanel.classList.add("hidden"));
}
if (semesterAddPanel) {
  semesterAddPanel.addEventListener("click", (e) => {
    if (e.target === semesterAddPanel) semesterAddPanel.classList.add("hidden");
  });
}
if (semesterAddForm) {
  semesterAddForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const fd = new FormData(semesterAddForm);
    const year = Number(fd.get("year"));
    const termType = fd.get("termType");
    if (!year) return;
    const existing = semesterHistory.find(s => s.year === year && s.termType === termType);
    if (existing) { selectedSemesterId = existing.id; semesterAddPanel.classList.add("hidden"); renderSemesterNav(); renderSemesterDetail(); renderSemesterAnalysis(); return; }
    const primaryMajor = (fd.get("primaryMajor") || "").trim();
    const secondaryMajor = fd.get("secondaryMajor") || "없음";
    userAcademicProfile = { primaryMajor, secondaryMajor };
    saveAcademicProfile(userAcademicProfile);
    const newSem = { id: crypto.randomUUID(), year, termType, primaryMajor, secondaryMajor, courses: [] };
    semesterHistory = [...semesterHistory, newSem];
    saveList(userKey("semesterHistory"), semesterHistory);
    selectedSemesterId = newSem.id;
    semesterAddForm.reset();
    semesterAddPanel.classList.add("hidden");
    renderSemesterNav();
    renderSemesterDetail();
    renderSemesterAnalysis();
  });
}
if (semesterListEl) {
  semesterListEl.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-semester-id]");
    if (!btn) return;
    selectedSemesterId = btn.dataset.semesterId;
    editingCourseId = null;
    editingSemesterInfoId = null;
    renderSemesterNav();
    renderSemesterDetail();
    renderSemesterAnalysis();
  });
}
if (semesterDetailPanel) {
  semesterDetailPanel.addEventListener("click", (event) => {
    const deleteBtn = event.target.closest("[data-delete-semester]");
    if (deleteBtn) {
      const semId = deleteBtn.dataset.deleteSemester;
      semesterHistory = semesterHistory.filter(s => s.id !== semId);
      saveList(userKey("semesterHistory"), semesterHistory);
      if (selectedSemesterId === semId) selectedSemesterId = null;
      editingCourseId = null;
      editingSemesterInfoId = null;
      renderSemesterNav();
      renderSemesterDetail();
      renderSemesterAnalysis();
      return;
    }
    const removeBtn = event.target.closest("[data-remove-course]");
    if (removeBtn) {
      const courseItemId = removeBtn.dataset.removeCourse;
      const sem = semesterHistory.find(s => s.id === selectedSemesterId);
      if (!sem) return;
      sem.courses = sem.courses.filter(c => c.id !== courseItemId);
      if (editingCourseId === courseItemId) editingCourseId = null;
      saveList(userKey("semesterHistory"), semesterHistory);
      renderSemesterDetail();
      renderSemesterAnalysis();
      return;
    }
    const editBtn = event.target.closest("[data-edit-course]");
    if (editBtn) {
      editingCourseId = editBtn.dataset.editCourse;
      renderSemesterDetail();
      return;
    }
    const saveBtn = event.target.closest("[data-save-course]");
    if (saveBtn) {
      const courseItemId = saveBtn.dataset.saveCourse;
      const sem = semesterHistory.find(s => s.id === selectedSemesterId);
      if (!sem) return;
      const row = saveBtn.closest("tr");
      if (!row) return;
      const newCourseId = (row.querySelector("[name='editCourseId']")?.value || "").trim().toUpperCase();
      const newCourseName = (row.querySelector("[name='editCourseName']")?.value || "").trim();
      const newMajorType = row.querySelector("[name='editMajorType']")?.value || "전공";
      if (!newCourseId || !newCourseName) return;
      const course = sem.courses.find(c => c.id === courseItemId);
      if (!course) return;
      course.courseId = newCourseId;
      course.courseName = newCourseName;
      course.majorType = newMajorType;
      saveList(userKey("semesterHistory"), semesterHistory);
      editingCourseId = null;
      renderSemesterDetail();
      renderSemesterAnalysis();
      return;
    }
    const cancelBtn = event.target.closest("[data-cancel-edit]");
    if (cancelBtn) {
      editingCourseId = null;
      renderSemesterDetail();
      return;
    }
    const editInfoBtn = event.target.closest("[data-edit-semester-info]");
    if (editInfoBtn) {
      editingSemesterInfoId = editInfoBtn.dataset.editSemesterInfo;
      renderSemesterDetail();
      return;
    }
    const saveInfoBtn = event.target.closest("[data-save-semester-info]");
    if (saveInfoBtn) {
      const semId = saveInfoBtn.dataset.saveSemesterInfo;
      const sem = semesterHistory.find(s => s.id === semId);
      if (!sem) return;
      const section = semesterDetailPanel.querySelector(".footprint-profile-section");
      if (!section) return;
      const newPrimary = (section.querySelector("[name='editPrimaryMajor']")?.value || "").trim();
      const newSecondary = section.querySelector("[name='editSecondaryMajor']")?.value || "없음";
      sem.primaryMajor = newPrimary;
      sem.secondaryMajor = newSecondary;
      userAcademicProfile = { primaryMajor: newPrimary, secondaryMajor: newSecondary };
      saveAcademicProfile(userAcademicProfile);
      saveList(userKey("semesterHistory"), semesterHistory);
      editingSemesterInfoId = null;
      renderSemesterDetail();
      return;
    }
    const cancelInfoBtn = event.target.closest("[data-cancel-semester-info]");
    if (cancelInfoBtn) {
      editingSemesterInfoId = null;
      renderSemesterDetail();
    }
  });
  semesterDetailPanel.addEventListener("submit", (event) => {
    const form = event.target.closest("#semester-course-add-form");
    if (!form) return;
    event.preventDefault();
    const fd = new FormData(form);
    const courseId = (fd.get("courseId") || "").trim().toUpperCase();
    const courseName = (fd.get("courseName") || "").trim();
    if (!courseId || !courseName) return;
    const sem = semesterHistory.find(s => s.id === selectedSemesterId);
    if (!sem) return;
    sem.courses.push({ id: crypto.randomUUID(), courseId, courseName, majorType: fd.get("majorType") || "전공" });
    saveList(userKey("semesterHistory"), semesterHistory);
    editingCourseId = null;
    form.reset();
    renderSemesterDetail();
    renderSemesterAnalysis();
  });
}

function handleRoadmapView() {
  const selection = getCareerSelection();
  const analysis = renderCareerResult(selection);
  saveCareerSelection(selection);

  // 결과 패널 플래시 + 스크롤
  careerResult.classList.remove("career-result-flash");
  requestAnimationFrame(() => careerResult.classList.add("career-result-flash"));
  careerResult.addEventListener("animationend", () => careerResult.classList.remove("career-result-flash"), { once: true });
  careerResult.scrollIntoView({ behavior: "smooth", block: "nearest" });

  setLastResult({
    title: "진로 트랙 분석",
    summary: `${analysis.track.name} 트랙 기준으로 남은 핵심 과목 ${analysis.missingRequired.length}개와 다음 추천 과목 ${analysis.nextCourses.length}개를 정리했습니다.`,
    source: "local"
  });
}

async function handleFootprintSubmit(event) {
  event.preventDefault();

  const validation = validateFootprintCourse();
  if (footprintCourseError) footprintCourseError.textContent = validation.ok ? "" : validation.message;
  if (!validation.ok) return;

  footprintCourses.value = validation.courseId;
  const department = footprintDepartment.value;
  const track = footprintTrack.value;

  footprintResult.innerHTML = '<p class="footprint-loading">분석 중...</p>';

  const data = await fetchCourseFootprint({ department, track, completedCourses: [validation.courseId] });
  renderFootprintResults(footprintResult, { ...data, department, track });

  const count = data.recommendations?.length ?? 0;
  setLastResult({
    title: "수강 발자취 분석",
    summary: `${department} ${track} · ${validation.courseId} 기준 ${count}개 과목 추천`,
    source: data.source || "footprint"
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 챗봇 UX — 자동 스크롤 + 입력창 자동 높이 조정
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function scrollChatToLatest() {
  requestAnimationFrame(() => {
    messageList.scrollTop = messageList.scrollHeight;
  });
}

function autoResizeChatInput() {
  chatInput.style.height = "auto";
  // 8rem(128px) 상한: 이후 textarea 내부 스크롤
  chatInput.style.height = Math.min(chatInput.scrollHeight, 128) + "px";
}

if (chatInput) {
  chatInput.addEventListener("input", autoResizeChatInput);
}

// 메시지 목록에 내용이 추가될 때마다 자동으로 최신 위치로 스크롤
// (addMessage 후 renderRecommendations 카드가 붙을 때도 커버)
if (messageList) {
  new MutationObserver(scrollChatToLatest).observe(messageList, {
    childList: true,
    subtree: true
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 홈 대시보드
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function renderHomeDashboard() {
  renderAccountPanel(store.user);
  const allCourses = semesterHistory.flatMap(s => s.courses);

  const totalEl = document.querySelector("#home-total-courses");
  const majorDetailEl = document.querySelector("#home-major-detail");
  if (totalEl) totalEl.textContent = allCourses.length > 0 ? `${allCourses.length}과목` : "-";
  if (majorDetailEl) {
    const majorCount = allCourses.filter(c => c.majorType === "전공").length;
    const secondMajorCount = allCourses.filter(c => c.majorType === "제2전공").length;
    majorDetailEl.textContent = allCourses.length > 0
      ? (secondMajorCount > 0 ? `전공 ${majorCount} · 제2전공 ${secondMajorCount}` : `전공 ${majorCount}과목`)
      : "이수 과목을 추가해보세요";
  }

  const trackPctEl = document.querySelector("#home-track-pct");
  const trackPreviewEl = document.querySelector("#track-preview");
  if (trackPctEl) {
    try {
      const selection = loadCareerSelection();
      if (selection.track && Object.keys(careerRoadmap).length > 0) {
        const uniqueIds = [...new Set(allCourses.map(c => c.courseId))];
        const analysis = getCareerAnalysis({ ...selection, completedCourses: uniqueIds });
        trackPctEl.textContent = `${analysis.completionRate}%`;
        if (trackPreviewEl) trackPreviewEl.textContent = selection.track;
      } else {
        trackPctEl.textContent = "-";
        if (trackPreviewEl) trackPreviewEl.textContent = "진로 트랙을 설정해보세요";
      }
    } catch {
      trackPctEl.textContent = "-";
    }
  }

  const areaBarsEl = document.querySelector("#home-area-bars");
  if (areaBarsEl) {
    if (allCourses.length > 0) {
      const cats = ["전공", "교양", "일반선택"];
      const counts = cats.map(cat => allCourses.filter(c => c.majorType === cat).length);
      const max = Math.max(...counts, 1);
      areaBarsEl.innerHTML = "";
      cats.forEach((cat, i) => {
        if (counts[i] === 0) return;
        const pct = Math.round(counts[i] / max * 100);
        const row = document.createElement("div");
        row.className = "acad-bar-row";
        row.innerHTML = `<span class="acad-bar-label">${cat}</span><div class="acad-bar-track"><div class="acad-bar-fill" style="width:${pct}%"></div></div><span class="acad-bar-val">${counts[i]}과목</span>`;
        areaBarsEl.append(row);
      });
      if (areaBarsEl.children.length === 0) {
        areaBarsEl.innerHTML = '<p class="empty-state" style="font-size:0.8rem">학기를 추가하면 분석됩니다.</p>';
      }
    } else {
      areaBarsEl.innerHTML = '<p class="empty-state" style="font-size:0.8rem">학기를 추가하면 분석됩니다.</p>';
    }
  }
}

// 빠른 시작 카드 클릭
document.querySelectorAll("[data-qs]").forEach(btn => {
  btn.addEventListener("click", () => {
    const view = btn.dataset.qs;
    navigateTo(view);
    if (view === "history") setTimeout(() => document.querySelector("#semester-add-btn")?.click(), 50);
    else if (view === "footprint") setTimeout(() => document.querySelector("#footprint-courses")?.focus(), 50);
    else if (view === "career") setTimeout(() => document.querySelector("#career-track")?.focus(), 50);
    else if (view === "chat") setTimeout(() => document.querySelector("#chat-input")?.focus(), 120);
  });
});

