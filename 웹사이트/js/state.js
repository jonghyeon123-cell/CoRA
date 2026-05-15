// 앱 전역 상태를 한곳에서 관리해 챗봇 연결 시 변경 지점을 줄입니다.
export const store = {
  user: null,
  messages: [
    {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "안녕하세요. CORA 챗봇입니다. 시간표, 학점, 진로 트랙 관련 질문을 도와드릴게요.",
      createdAt: new Date().toISOString()
    }
  ],
  isLoading: false,
  lastResult: null
};

const listeners = new Set();

export function subscribe(listener) {
  listeners.add(listener);
  listener(store);

  return () => listeners.delete(listener);
}

export function setLoading(isLoading) {
  store.isLoading = isLoading;
  notify();
}

export function setUser(user) {
  store.user = user;
  notify();
}

export function clearUser() {
  store.user = null;
  notify();
}

export function addMessage(message) {
  store.messages = [
    ...store.messages,
    {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...message
    }
  ];
  notify();
}

export function setLastResult(result) {
  store.lastResult = result;
  notify();
}

function notify() {
  listeners.forEach((listener) => listener(store));
}
