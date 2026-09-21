// 현우의 받아쓰기 연습 - 화면 렌더링 & 음성(TTS) 로직

const mainEl = document.getElementById("main");
const homeBtn = document.getElementById("homeBtn");

// ---------------- 음성 재생 (Web Speech API) ----------------
// 띄어 읽기가 꺼져 있으면 문장을 통째로 한 번에 재생해 가장 자연스럽게 읽고,
// 켜져 있으면 어절 단위로 살짝(0.02초)씩 쉬어 읽는다.
const DEFAULT_SPEAK_RATE = 1;
const PAUSE_OFF_MS = 0;
const PAUSE_ON_MS = 20;
const ITEM_PAUSE_MS = 1100; // 전체 다시듣기에서 문항 사이 쉬는 시간
const VOICE_STORAGE_KEY = "hyunwoo-dictation-voice-uri";
const RATE_STORAGE_KEY = "hyunwoo-dictation-rate";
const PAUSE_STORAGE_KEY = "hyunwoo-dictation-pause-on";

let SPEAK_RATE = parseFloat(localStorage.getItem(RATE_STORAGE_KEY)) || DEFAULT_SPEAK_RATE;
let PAUSE_ON = localStorage.getItem(PAUSE_STORAGE_KEY) === "1";
let WORD_PAUSE_MS = PAUSE_ON ? PAUSE_ON_MS : PAUSE_OFF_MS;

let koVoices = []; // 이 기기/브라우저가 제공하는 한국어 음성 목록
let koVoice = null; // 현재 선택된 음성
let playToken = 0; // 재생 세대 토큰: 새 재생이 시작되면 이전 재생 체인을 무효화
let voiceListGaveUp = false; // 한참 찾아도 목소리 목록이 하나도 안 잡히는 기기/브라우저
const voiceChangeListeners = [];

function pickKoreanVoice() {
  const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  koVoices = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith("ko"));

  const savedURI = localStorage.getItem(VOICE_STORAGE_KEY);
  koVoice =
    (savedURI && koVoices.find((v) => v.voiceURI === savedURI)) ||
    koVoices.find((v) => v.lang === "ko-KR") ||
    koVoices[0] ||
    null;

  voiceChangeListeners.forEach((fn) => fn());
}

function setKoreanVoice(voiceURI) {
  koVoice = koVoices.find((v) => v.voiceURI === voiceURI) || null;
  if (koVoice) localStorage.setItem(VOICE_STORAGE_KEY, koVoice.voiceURI);
}

if (window.speechSynthesis) {
  pickKoreanVoice();
  window.speechSynthesis.onvoiceschanged = pickKoreanVoice;
  // 일부 안드로이드 브라우저는 voiceschanged 이벤트 없이 음성 목록을
  // 뒤늦게 채워 넣는 경우가 있어, 몇 초간 다시 확인해 준다.
  let voicePollCount = 0;
  const voicePollTimer = setInterval(() => {
    voicePollCount += 1;
    pickKoreanVoice();
    if (koVoices.length > 0 || voicePollCount >= 8) {
      clearInterval(voicePollTimer);
      if (koVoices.length === 0) {
        voiceListGaveUp = true;
        voiceChangeListeners.forEach((fn) => fn());
      }
    }
  }, 500);
}

function supportsTTS() {
  return "speechSynthesis" in window;
}

function stopSpeaking() {
  playToken += 1;
  if (supportsTTS()) window.speechSynthesis.cancel();
}

function makeUtterance(text) {
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "ko-KR";
  utter.rate = SPEAK_RATE;
  utter.pitch = 1;
  if (koVoice) utter.voice = koVoice;
  return utter;
}

// 일부 기기는 실제로 말을 한 번 시켜봐야 그제서야 음성 목록이 채워진다.
// (getVoices()가 계속 빈 배열만 주다가, speak() 이후에야 값이 생기는 경우)
function retryVoicePickAfterSpeak() {
  if (koVoices.length > 0) return;
  setTimeout(() => {
    if (koVoices.length === 0) pickKoreanVoice();
  }, 400);
}

/**
 * 문장 하나를 읽는다. 간격(WORD_PAUSE_MS)이 0이면 문장 전체를 한 번에
 * 재생해 가장 자연스럽게 읽고, 0보다 크면 어절 단위로 끊어서 그만큼
 * 쉬어가며 읽는다.
 * onDone: 모두 읽고 나면 호출. myToken이 최신 재생 세대와 다르면 중간에 조용히 멈춘다.
 */
function speakSentence(text, myToken, onDone) {
  if (!supportsTTS()) {
    onDone && onDone();
    return;
  }

  if (WORD_PAUSE_MS <= 0) {
    const utter = makeUtterance(text);
    const finish = () => {
      if (myToken !== playToken) return;
      onDone && onDone();
    };
    utter.onend = finish;
    utter.onerror = finish;
    window.speechSynthesis.speak(utter);
    retryVoicePickAfterSpeak();
    return;
  }

  const words = text.split(" ").filter(Boolean);
  let i = 0;

  function speakNext() {
    if (myToken !== playToken) return; // 다른 재생이 시작되어 무효화됨
    if (i >= words.length) {
      onDone && onDone();
      return;
    }
    const utter = makeUtterance(words[i]);
    utter.onend = () => {
      if (myToken !== playToken) return;
      i += 1;
      setTimeout(speakNext, WORD_PAUSE_MS);
    };
    utter.onerror = () => {
      if (myToken !== playToken) return;
      i += 1;
      setTimeout(speakNext, WORD_PAUSE_MS);
    };
    window.speechSynthesis.speak(utter);
    retryVoicePickAfterSpeak();
  }
  speakNext();
}

// ---------------- 라우팅 ----------------

function currentRoute() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (hash.startsWith("round/")) {
    const id = parseInt(hash.split("/")[1], 10);
    const round = ROUNDS.find((r) => r.id === id);
    if (round) return { view: "round", round };
  }
  return { view: "home" };
}

function render() {
  stopSpeaking();
  const route = currentRoute();
  homeBtn.style.visibility = route.view === "home" ? "hidden" : "visible";
  if (route.view === "round") {
    renderRoundView(route.round);
  } else {
    renderHomeView();
  }
  mainEl.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  window.scrollTo(0, 0);
}

// ---------------- 홈 화면 ----------------

function renderHomeView() {
  const units = [];
  const unitIndex = new Map();
  for (const round of ROUNDS) {
    if (!unitIndex.has(round.unit)) {
      unitIndex.set(round.unit, { unit: round.unit, rounds: [] });
      units.push(unitIndex.get(round.unit));
    }
    unitIndex.get(round.unit).rounds.push(round);
  }

  mainEl.innerHTML = "";

  if (!supportsTTS()) {
    const warn = document.createElement("div");
    warn.className = "tts-warning";
    warn.dataset.show = "true";
    warn.textContent =
      "⚠️ 이 브라우저에서는 음성 읽어주기 기능을 사용할 수 없어요. 최신 크롬이나 사파리 브라우저로 열어 주세요.";
    mainEl.appendChild(warn);
  }

  for (const group of units) {
    const section = document.createElement("section");
    section.className = "unit-section";

    const heading = document.createElement("h2");
    heading.className = "unit-heading";
    heading.textContent = group.unit;
    section.appendChild(heading);

    const grid = document.createElement("div");
    grid.className = "round-grid";

    for (const round of group.rounds) {
      const card = document.createElement("button");
      card.className = "round-card";
      card.type = "button";
      card.innerHTML = `
        <span class="round-num">${round.id}회</span>
        <span class="round-progress">문항 ${round.items.length}개</span>
      `;
      card.addEventListener("click", () => {
        window.location.hash = `#/round/${round.id}`;
      });
      grid.appendChild(card);
    }

    section.appendChild(grid);
    mainEl.appendChild(section);
  }
}

// ---------------- 회차 상세 화면 ----------------

function renderRoundView(round) {
  mainEl.innerHTML = "";

  if (!supportsTTS()) {
    const warn = document.createElement("div");
    warn.className = "tts-warning";
    warn.dataset.show = "true";
    warn.textContent =
      "⚠️ 이 브라우저에서는 음성 읽어주기 기능을 사용할 수 없어요. 최신 크롬이나 사파리 브라우저로 열어 주세요.";
    mainEl.appendChild(warn);
  }

  const head = document.createElement("div");
  head.className = "round-view-head";
  head.innerHTML = `
    <h2 class="round-view-title">${round.id}회 받아쓰기
      <span class="unit-tag">${round.unit}</span>
    </h2>
  `;

  const replayBtn = document.createElement("button");
  replayBtn.type = "button";
  replayBtn.className = "replay-all-btn";
  replayBtn.innerHTML = `<span>🔁</span><span>전체 다시듣기</span>`;
  head.appendChild(replayBtn);
  mainEl.appendChild(head);

  const list = document.createElement("div");
  list.className = "item-list";
  mainEl.appendChild(list);

  const itemRows = [];

  round.items.forEach((text, idx) => {
    const row = document.createElement("div");
    row.className = "dictation-item";
    row.dataset.active = "false";

    const num = document.createElement("div");
    num.className = "item-num";
    num.textContent = String(idx + 1);

    const textWrap = document.createElement("div");
    textWrap.className = "item-text-wrap";
    const textEl = document.createElement("div");
    textEl.className = "item-text";
    textEl.dataset.hidden = "true";
    textEl.textContent = text;
    const hint = document.createElement("div");
    hint.className = "item-hint";
    hint.textContent = "스피커 버튼을 눌러 듣고, 정답은 '보이기'로 확인해 보세요";
    textWrap.appendChild(textEl);
    textWrap.appendChild(hint);

    const controls = document.createElement("div");
    controls.className = "item-controls";

    const speakBtn = document.createElement("button");
    speakBtn.type = "button";
    speakBtn.className = "icon-btn speak-btn";
    speakBtn.setAttribute("aria-label", `${idx + 1}번 문항 듣기`);
    speakBtn.textContent = "🔊";

    const revealBtn = document.createElement("button");
    revealBtn.type = "button";
    revealBtn.className = "icon-btn reveal-btn";
    revealBtn.setAttribute("aria-label", `${idx + 1}번 문항 정답 보기`);
    revealBtn.textContent = "👁";

    revealBtn.addEventListener("click", () => {
      const hidden = textEl.dataset.hidden === "true";
      textEl.dataset.hidden = hidden ? "false" : "true";
      revealBtn.dataset.revealed = hidden ? "true" : "false";
      hint.style.visibility = hidden ? "hidden" : "visible";
    });

    speakBtn.addEventListener("click", () => {
      stopSpeaking();
      const myToken = playToken;
      itemRows.forEach((r) => (r.row.dataset.active = "false"));
      row.dataset.active = "true";
      speakBtn.dataset.playing = "true";
      replayBtn.dataset.playing = "false";
      speakSentence(text, myToken, () => {
        if (myToken !== playToken) return;
        speakBtn.dataset.playing = "false";
        row.dataset.active = "false";
      });
    });

    controls.appendChild(speakBtn);
    controls.appendChild(revealBtn);

    row.appendChild(num);
    row.appendChild(textWrap);
    row.appendChild(controls);
    list.appendChild(row);

    itemRows.push({ row, speakBtn, text });
  });

  replayBtn.addEventListener("click", () => {
    if (replayBtn.dataset.playing === "true") {
      stopSpeaking();
      replayBtn.dataset.playing = "false";
      itemRows.forEach((r) => {
        r.row.dataset.active = "false";
        r.speakBtn.dataset.playing = "false";
      });
      return;
    }
    stopSpeaking();
    const myToken = playToken;
    replayBtn.dataset.playing = "true";
    replayBtn.querySelector("span:last-child").textContent = "중지하기";

    let i = 0;
    function playNext() {
      if (myToken !== playToken) return;
      if (i >= itemRows.length) {
        replayBtn.dataset.playing = "false";
        replayBtn.querySelector("span:last-child").textContent = "전체 다시듣기";
        itemRows.forEach((r) => (r.row.dataset.active = "false"));
        return;
      }
      itemRows.forEach((r) => (r.row.dataset.active = "false"));
      const current = itemRows[i];
      current.row.dataset.active = "true";
      current.speakBtn.dataset.playing = "true";
      current.row.scrollIntoView({ behavior: "smooth", block: "center" });
      speakSentence(current.text, myToken, () => {
        if (myToken !== playToken) return;
        current.speakBtn.dataset.playing = "false";
        i += 1;
        setTimeout(playNext, ITEM_PAUSE_MS);
      });
    }
    playNext();
  });
}

homeBtn.addEventListener("click", () => {
  window.location.hash = "#/";
});

// ---------------- 목소리 선택 ----------------

const voiceSelectWrap = document.querySelector(".voice-select-wrap");
const voiceSelect = document.getElementById("voiceSelect");
const voiceRefreshBtn = document.getElementById("voiceRefreshBtn");

function renderVoiceOptions() {
  if (!supportsTTS()) {
    voiceSelectWrap.style.display = "none";
    return;
  }
  voiceSelectWrap.style.display = "flex";

  if (koVoices.length === 0) {
    voiceSelect.innerHTML = "";
    const opt = document.createElement("option");
    opt.textContent = voiceListGaveUp ? "기본 목소리로 재생돼요" : "목소리 찾는 중...";
    voiceSelect.appendChild(opt);
    voiceSelect.disabled = true;
    return;
  }

  voiceSelect.disabled = false;
  voiceSelect.innerHTML = "";
  koVoices.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v.voiceURI;
    opt.textContent = v.name;
    if (koVoice && v.voiceURI === koVoice.voiceURI) opt.selected = true;
    voiceSelect.appendChild(opt);
  });
}

voiceSelect.addEventListener("change", () => {
  stopSpeaking();
  setKoreanVoice(voiceSelect.value);
});

voiceRefreshBtn.addEventListener("click", () => {
  voiceListGaveUp = false;
  pickKoreanVoice();
});

voiceChangeListeners.push(renderVoiceOptions);
renderVoiceOptions();

// ---------------- 재생 속도 설정 패널 ----------------

const settingsBtn = document.getElementById("settingsBtn");
const settingsBackdrop = document.getElementById("settingsBackdrop");
const settingsCloseBtn = document.getElementById("settingsCloseBtn");
const settingsResetBtn = document.getElementById("settingsResetBtn");
const rateRange = document.getElementById("rateRange");
const rateValue = document.getElementById("rateValue");

function syncSettingsUI() {
  rateRange.value = String(SPEAK_RATE);
  rateValue.textContent = `${SPEAK_RATE.toFixed(2)}배`;
}

function openSettings() {
  syncSettingsUI();
  settingsBackdrop.hidden = false;
}

function closeSettings() {
  settingsBackdrop.hidden = true;
}

settingsBtn.addEventListener("click", openSettings);
settingsCloseBtn.addEventListener("click", closeSettings);
settingsBackdrop.addEventListener("click", (e) => {
  if (e.target === settingsBackdrop) closeSettings();
});

rateRange.addEventListener("input", () => {
  SPEAK_RATE = parseFloat(rateRange.value);
  rateValue.textContent = `${SPEAK_RATE.toFixed(2)}배`;
  localStorage.setItem(RATE_STORAGE_KEY, String(SPEAK_RATE));
});

settingsResetBtn.addEventListener("click", () => {
  SPEAK_RATE = DEFAULT_SPEAK_RATE;
  localStorage.removeItem(RATE_STORAGE_KEY);
  syncSettingsUI();
});

// ---------------- 띄어 읽기 토글 (헤더) ----------------

const pauseToggle = document.getElementById("pauseToggle");

pauseToggle.checked = PAUSE_ON;

pauseToggle.addEventListener("change", () => {
  PAUSE_ON = pauseToggle.checked;
  WORD_PAUSE_MS = PAUSE_ON ? PAUSE_ON_MS : PAUSE_OFF_MS;
  localStorage.setItem(PAUSE_STORAGE_KEY, PAUSE_ON ? "1" : "0");
});

window.addEventListener("hashchange", render);
window.addEventListener("DOMContentLoaded", render);
render();
