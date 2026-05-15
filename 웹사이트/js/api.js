// 백엔드 REST API와 통신하는 레이어입니다. 실제 서비스 연결 시 endpoint별 내부 구현만 교체합니다.
const CHAT_ENDPOINT = "/api/chat";
const SESSION_STORAGE_KEY = "cora-session-id";
const LOGIN_ENDPOINT = "/api/login";
const REGISTER_ENDPOINT = "/api/register";

export async function registerUser({ name, studentId, department, email, password }) {
  return requestAuth(REGISTER_ENDPOINT, {
    name,
    studentId,
    department,
    email,
    password
  });
}

export async function loginUser({ email, password }) {
  return requestAuth(LOGIN_ENDPOINT, {
    email,
    password
  });
}

async function requestAuth(endpoint, payload) {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        ok: false,
        message: data.error || `요청이 실패했습니다. (${response.status})`
      };
    }

    return {
      ok: true,
      user: data.user
    };
  } catch {
    return {
      ok: false,
      offline: true,
      message: "서버에 연결할 수 없어 로컬 데모 저장으로 처리합니다."
    };
  }
}

export async function sendChatMessage({ message, history }) {
  try {
    const response = await fetch(CHAT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message,
        history
      })
    });

    if (!response.ok) {
      throw new Error(`Chat API failed with ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    // 정적 파일로 열었을 때도 프론트엔드 흐름을 확인할 수 있도록 임시 응답을 제공합니다.
    return createMockChatResponse(message, error);
  }
}

export function getOrCreateSessionId() {
  let sid = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (!sid) {
    sid = crypto.randomUUID();
    sessionStorage.setItem(SESSION_STORAGE_KEY, sid);
  }
  return sid;
}

export async function sendChatMessageStructured({ message, history }) {
  const sessionId = getOrCreateSessionId();
  try {
    const response = await fetch(CHAT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history, sessionId })
    });

    if (!response.ok) {
      throw new Error(`Chat API failed with ${response.status}`);
    }

    const data = await response.json();

    // session_id가 반환되면 갱신 (서버가 새로 발급한 경우)
    if (data.session_id) {
      sessionStorage.setItem(SESSION_STORAGE_KEY, data.session_id);
    }

    return data;
  } catch (error) {
    return { ...createMockChatResponse(message, error), recommendations: [], session_id: sessionId };
  }
}

function createMockChatResponse(message, error) {
  return {
    id: crypto.randomUUID(),
    reply: `임시 응답입니다. 실제 서버가 연결되면 "${message}"에 대한 모델 응답이 이 자리에 표시됩니다.`,
    summary: "현재는 Mock 응답으로 UI와 상태 관리 흐름을 검증 중입니다.",
    source: "mock",
    error: error.message
  };
}

const RESET_PASSWORD_ENDPOINT = "/api/reset-password";

export async function resetPassword({ name, email, newPassword }) {
  try {
    const response = await fetch(RESET_PASSWORD_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, newPassword })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, message: data.error || `요청 실패 (${response.status})` };
    return { ok: true };
  } catch {
    return { ok: false, message: "서버에 연결할 수 없습니다." };
  }
}

const FOOTPRINT_ENDPOINT = "/api/course-footprint";

export async function fetchCourseFootprint({ department, track, completedCourses }) {
  try {
    const params = new URLSearchParams({
      department,
      track,
      completedCourses: completedCourses.join(",")
    });
    const response = await fetch(`${FOOTPRINT_ENDPOINT}?${params}`);
    if (!response.ok) throw new Error(`Footprint API failed (${response.status})`);
    return await response.json();
  } catch (error) {
    return { ok: false, error: error.message, matchedGroupSize: 0, recommendations: [], source: "error" };
  }
}

