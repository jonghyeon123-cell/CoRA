// 재사용 가능한 렌더링 함수입니다. UI 컴포넌트 교체가 필요하면 이 파일 중심으로 수정합니다.

function formatMessageContent(raw) {
  const compactText = String(raw || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .trim();

  return compactText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // 헤딩 (multiline, \n 변환 전에 처리)
    .replace(/^### (.+)$/gm, '<strong class="msg-h3">$1</strong>')
    .replace(/^## (.+)$/gm,  '<strong class="msg-h2">$1</strong>')
    .replace(/^# (.+)$/gm,   '<strong class="msg-h1">$1</strong>')
    // 구분선
    .replace(/^---+$/gm, '<span class="msg-hr" aria-hidden="true"></span>')
    // 순서 없는 목록
    .replace(/^[*-]\s+(.+)$/gm, '<span class="msg-li">$1</span>')
    // 순서 있는 목록
    .replace(/^(\d+)\.\s+(.+)$/gm, '<span class="msg-li"><b class="msg-li-num">$1.</b> $2</span>')
    // 인라인 볼드 / 이탤릭
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g,     "<em>$1</em>")
    // 줄바꿈 (마지막)
    .replace(/\n/g, "<br>");
}

export function createMessageElement(message) {
  const article = document.createElement("article");
  article.className = `message ${message.role}`;

  const meta = document.createElement("span");
  meta.className = "message-meta";
  meta.textContent = message.role === "user" ? "나" : "CORA";

  const content = document.createElement("div");
  content.className = "msg-content";
  content.innerHTML = formatMessageContent(message.content);

  article.append(meta, content);
  return article;
}

export function renderMessages(container, messages) {
  container.replaceChildren(...messages.map(createMessageElement));
  container.scrollTop = container.scrollHeight;
}

export function renderResult(container, result) {
  if (!result) {
    container.innerHTML = '<p class="empty-state">아직 활동이 없습니다.</p>';
    return;
  }

  const resultCard = document.createElement("div");
  resultCard.className = "result-card";

  const title = document.createElement("strong");
  title.textContent = result.title || (result.source === "mock" ? "Mock Result" : "Chat Result");

  const summary = document.createElement("p");
  summary.textContent = result.summary || result.reply;

  resultCard.append(title, summary);
  container.replaceChildren(resultCard);
}

export function renderConnectionStatus(element, { isLoading, lastResult }) {
  if (isLoading) {
    element.textContent = "전송 중";
    return;
  }

  element.textContent = lastResult?.source === "api" ? "API 연결됨" : "Mock API";
}

export function renderFootprintResults(container, data) {
  if (!data) {
    container.innerHTML = '<p class="empty-state">결과가 없습니다.</p>';
    return;
  }

  if (data.error) {
    container.innerHTML = `<p class="empty-state">오류가 발생했습니다: ${data.error}</p>`;
    return;
  }

  const { matchedGroupSize = 0, recommendations = [], source } = data;

  const wrapper = document.createElement("div");
  wrapper.className = "footprint-wrapper";

  const meta = document.createElement("p");
  meta.className = "footprint-meta";
  const sourceLabel = source === "footprint" ? "수강 발자취 분석" : "로드맵 기반 추천";
  const cohortCtx = [data.department, data.track].filter(Boolean).join(" · ");
  meta.textContent = `${sourceLabel} · ${cohortCtx ? cohortCtx + " " : ""}유사 학생 ${matchedGroupSize}명 기준`;
  wrapper.append(meta);

  if (source !== "footprint" && source !== "error") {
    const note = document.createElement("p");
    note.className = "footprint-fallback-note";
    note.textContent = "유사 수강 이력이 부족해 로드맵 기반으로 추천합니다.";
    wrapper.append(note);
  }

  if (recommendations.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "추천 과목이 없습니다. 이수 과목이나 트랙을 다시 확인해 주세요.";
    wrapper.append(empty);
    container.replaceChildren(wrapper);
    return;
  }

  const list = document.createElement("div");
  list.className = "footprint-list";

  recommendations.forEach(rec => {
    const card = document.createElement("article");
    card.className = "footprint-card";

    const header = document.createElement("div");
    header.className = "footprint-card-header";

    const name = document.createElement("strong");
    name.textContent = `${rec.courseName} (${rec.courseId})`;

    const badge = document.createElement("span");
    badge.className = "footprint-badge";
    badge.textContent = rec.percentage != null ? `${rec.percentage}%` : "추천";

    header.append(name, badge);

    const reason = document.createElement("p");
    reason.className = "footprint-reason";
    reason.textContent = rec.reason;

    card.append(header, reason);

    if (rec.percentage != null) {
      const bar = document.createElement("div");
      bar.className = "footprint-bar";
      const fill = document.createElement("span");
      fill.className = "footprint-bar-fill";
      fill.style.width = `${rec.percentage}%`;
      bar.append(fill);
      card.append(bar);
    }

    list.append(card);
  });

  wrapper.append(list);
  container.replaceChildren(wrapper);
}

// source 레이블 매핑
const SOURCE_LABEL = { keyword: "키워드", vector: "의미검색", footprint: "발자취" };

export function renderRecommendationCard(rec) {
  const card = document.createElement("article");
  card.className = "rec-card";

  const header = document.createElement("div");
  header.className = "rec-card-header";

  const name = document.createElement("strong");
  name.className = "rec-card-name";
  name.textContent = `${rec.courseName} (${rec.courseId})`;

  const badge = document.createElement("span");
  badge.className = "rec-card-badge";
  badge.textContent = rec.percentage != null ? `${rec.percentage}%` : (SOURCE_LABEL[rec.source] || rec.source || "추천");

  header.append(name, badge);

  const reason = document.createElement("p");
  reason.className = "rec-card-reason";
  reason.textContent = rec.reason || "";

  card.append(header, reason);

  if (rec.prerequisites && rec.prerequisites.length > 0) {
    const pre = document.createElement("p");
    pre.className = "rec-card-prereq";
    pre.textContent = `선수과목: ${rec.prerequisites.join(", ")}`;
    card.append(pre);
  }

  if (rec.percentage != null) {
    const bar = document.createElement("div");
    bar.className = "rec-bar";
    const fill = document.createElement("span");
    fill.className = "rec-bar-fill";
    fill.style.width = `${Math.min(rec.percentage, 100)}%`;
    bar.append(fill);
    card.append(bar);
  }

  return card;
}

export function renderRecommendations(container, recommendations) {
  if (!recommendations || recommendations.length === 0) return;

  const wrapper = document.createElement("div");
  wrapper.className = "rec-wrapper";

  const heading = document.createElement("p");
  heading.className = "rec-heading";
  heading.textContent = "추천 과목";
  wrapper.append(heading);

  const list = document.createElement("div");
  list.className = "rec-list";
  recommendations.forEach(rec => list.append(renderRecommendationCard(rec)));
  wrapper.append(list);

  container.append(wrapper);
}

export function renderNextCourseCard(course) {
  const card = document.createElement("article");
  card.className = "next-course-card";

  const header = document.createElement("div");
  header.className = "next-course-card-header";

  const id = document.createElement("span");
  id.className = "next-course-card-id";
  id.textContent = course.courseId;

  const name = document.createElement("strong");
  name.className = "next-course-card-name";
  name.textContent = course.courseName;

  header.append(id, name);

  const reason = document.createElement("p");
  reason.className = "next-course-card-reason";
  reason.textContent = course.reason || "";

  const btn = document.createElement("button");
  btn.className = "next-course-detail-btn";
  btn.type = "button";
  btn.dataset.courseId = course.courseId;
  btn.dataset.courseName = course.courseName;
  btn.textContent = "AI에게 물어보기";

  card.append(header, reason, btn);
  return card;
}

export function renderRoadmapSuggestion(container, roadmap) {
  if (!roadmap || roadmap.length === 0) return;

  const wrapper = document.createElement("div");
  wrapper.className = "rec-roadmap-wrapper";

  const heading = document.createElement("p");
  heading.className = "rec-heading";
  heading.textContent = "로드맵 제안";
  wrapper.append(heading);

  roadmap.forEach(step => {
    const item = document.createElement("div");
    item.className = "rec-roadmap-step";
    const label = document.createElement("strong");
    label.textContent = step.label || step.courseId || "";
    const desc = document.createElement("span");
    desc.textContent = step.description || step.courseName || "";
    item.append(label, desc);
    wrapper.append(item);
  });

  container.append(wrapper);
}
