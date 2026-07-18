/* ¡Repasa! — 本編(¡Hablemos!)の単語とフレーズだけを聞き流し */
"use strict";

/* ══════════════ データ展開 ══════════════
   ../data.js の CURRICULUM(本編と同一データ)から3つのデッキを作る:
   - units:   ユニット順(単語→フレーズ)。1サイクル = 1ユニット(18個)
   - words:   単語だけ通し。1サイクル = 48語(= 1フェーズ分)
   - phrases: フレーズだけ通し。1サイクル = 24本(= 1フェーズ分) */
const unitItemsAll = [], wordsAll = [], phrasesAll = [];
CURRICULUM.forEach((phase) => {
  phase.units.forEach((u) => {
    const tag = (it) => ({ es: it.es, en: it.en, ja: it.ja, cat: u.title, icon: u.icon });
    const w = u.words.map(tag), p = u.phrases.map(tag);
    wordsAll.push(...w);
    phrasesAll.push(...p);
    unitItemsAll.push(...w, ...p);
  });
});

const DECKS = {
  units:   { label: "ユニット順",   icon: "📚", items: unitItemsAll, cycleSize: 18, cycleLabel: "ユニット", unitWord: "個", approx: "約3分" },
  words:   { label: "単語だけ",     icon: "🎧", items: wordsAll,     cycleSize: 48, cycleLabel: "サイクル", unitWord: "語", approx: "約6分" },
  phrases: { label: "フレーズだけ", icon: "💬", items: phrasesAll,   cycleSize: 24, cycleLabel: "サイクル", unitWord: "本", approx: "約4分" },
};
const DECK_KEYS = Object.keys(DECKS);

function cycleCount(deck) { return Math.ceil(DECKS[deck].items.length / DECKS[deck].cycleSize); }
function cycleOf(deck, idx) { return Math.floor(idx / DECKS[deck].cycleSize); }
function cycleStart(deck, c) { return c * DECKS[deck].cycleSize; }
function cycleEnd(deck, c) { return Math.min((c + 1) * DECKS[deck].cycleSize, DECKS[deck].items.length); } // exclusive
function cycleCats(deck, c) {
  const items = DECKS[deck].items.slice(cycleStart(deck, c), cycleEnd(deck, c));
  return [...new Set(items.map((x) => x.cat))];
}

/* ══════════════ 状態管理 ══════════════ */
const LS_KEY = "repaso-v1";
const defaultState = () => ({
  settings: { rate: 0.9, gap: 0.5, itemGap: 1.2, esTwice: false, esVoice: null },
  repeatMode: { units: "cycle", words: "cycle", phrases: "cycle" }, // cycle | continue | all
  resume: { units: null, words: null, phrases: null },              // 最後に再生したアイテムの通し番号
  cycleMax: { units: {}, words: {}, phrases: {} },                  // サイクル内で聞いた最大数(進捗表示用)
});

let state = loadState();
function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      const d = defaultState();
      return {
        settings: Object.assign(d.settings, s.settings),
        repeatMode: Object.assign(d.repeatMode, s.repeatMode),
        resume: Object.assign(d.resume, s.resume),
        cycleMax: Object.assign(d.cycleMax, s.cycleMax),
      };
    }
  } catch (e) { /* 壊れたデータは初期化 */ }
  return defaultState();
}
function saveState() { localStorage.setItem(LS_KEY, JSON.stringify(state)); }

/* ══════════════ 音声(TTS) ══════════════ */
let allVoices = [];
function refreshVoices() { allVoices = speechSynthesis.getVoices(); }
if ("speechSynthesis" in window) {
  refreshVoices();
  speechSynthesis.onvoiceschanged = refreshVoices;
}
const PREFERRED = {
  "es-ES": ["Mónica", "Paulina", "Google español"],
  "en-US": ["Samantha", "Google US English", "Karen", "Daniel"],
  "ja-JP": ["Kyoko", "Google 日本語", "O-Ren"],
};
function voiceFor(lang) {
  if (!allVoices.length) refreshVoices();
  const short = lang.slice(0, 2);
  const cands = allVoices.filter((v) => v.lang.toLowerCase().startsWith(short));
  if (lang === "es-ES" && state.settings.esVoice) {
    const v = cands.find((v) => v.name === state.settings.esVoice);
    if (v) return v;
  }
  for (const name of PREFERRED[lang] || []) {
    const v = cands.find((v) => v.name.includes(name));
    if (v) return v;
  }
  return cands.find((v) => v.lang.replace("_", "-") === lang) || cands[0] || null;
}

/* ══════════════ バックグラウンド再生の維持 ══════════════
   無音オーディオをループ再生してメディアセッションを維持し、
   ロック画面のコントロールと画面OFF時の再生継続を可能にする */
let keepAliveAudio = null;
function silentWavURI(sec) {
  const rate = 8000, n = rate * sec;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + n, true); w(8, "WAVEfmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true);
  v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  w(36, "data"); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  const b = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i += 1024) s += String.fromCharCode.apply(null, b.subarray(i, i + 1024));
  return "data:audio/wav;base64," + btoa(s);
}
function keepAliveOn() {
  if (!keepAliveAudio) {
    keepAliveAudio = new Audio(silentWavURI(3));
    keepAliveAudio.loop = true;
    keepAliveAudio.volume = 0.02;
    keepAliveAudio.setAttribute("playsinline", "");
  }
  keepAliveAudio.play().catch(() => {});
}
function keepAliveOff() { if (keepAliveAudio) keepAliveAudio.pause(); }

function setupMediaSession() {
  if (!("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.setActionHandler("play", () => resumePlayback());
    navigator.mediaSession.setActionHandler("pause", () => pausePlayback());
    navigator.mediaSession.setActionHandler("nexttrack", () => skip(1));
    navigator.mediaSession.setActionHandler("previoustrack", () => skip(-1));
  } catch (e) { /* 未対応アクションは無視 */ }
}
function updateMediaSession(it) {
  if (!("mediaSession" in navigator)) return;
  const c = cycleOf(P.deck, P.idx) + 1;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: it.es,
      artist: `${it.en} / ${it.ja}`,
      album: `¡Repasa! ${DECKS[P.deck].label} ${DECKS[P.deck].cycleLabel}${c}`,
      artwork: [{ src: "apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    });
    navigator.mediaSession.playbackState = P.playing ? "playing" : "paused";
  } catch (e) { /* 一部ブラウザのみ */ }
}

/* ══════════════ プレイヤー本体 ══════════════ */
const P = { deck: null, idx: 0, playing: false, token: 0, timer: null, utter: null };

function items() { return DECKS[P.deck].items; }
function currentItem() { return items()[P.idx]; }

function ttsText(es) { return es.replace(/\s*\/\s*/g, ", "); }

function startPlayback(deck, idx) {
  P.deck = deck;
  P.idx = Math.max(0, Math.min(idx, DECKS[deck].items.length - 1));
  P.playing = true;
  keepAliveOn();
  if ("speechSynthesis" in window) speechSynthesis.resume();
  renderPlayer();
  playCurrent();
}

function playCurrent() {
  const token = ++P.token;
  clearTimeout(P.timer);
  speechSynthesis.cancel();

  const it = currentItem();
  state.resume[P.deck] = P.idx;
  const c = cycleOf(P.deck, P.idx);
  const posInCycle = P.idx - cycleStart(P.deck, c) + 1;
  state.cycleMax[P.deck][c] = Math.max(state.cycleMax[P.deck][c] || 0, posInCycle);
  saveState();

  updateNowPlayingUI(it);
  updateMediaSession(it);

  const s = state.settings;
  const parts = [{ text: ttsText(it.es), lang: "es-ES", pause: s.gap }];
  if (s.esTwice) parts.push({ text: ttsText(it.es), lang: "es-ES", pause: s.gap });
  parts.push({ text: it.en, lang: "en-US", pause: s.gap });
  parts.push({ text: it.ja, lang: "ja-JP", pause: s.itemGap });
  speakSeq(parts, 0, token, () => advance(token));
}

function speakSeq(parts, i, token, done) {
  if (token !== P.token || !P.playing) return;
  if (i >= parts.length) { done(); return; }
  const p = parts[i];
  const u = new SpeechSynthesisUtterance(p.text);
  u.lang = p.lang;
  u.rate = state.settings.rate;
  const v = voiceFor(p.lang);
  if (v) u.voice = v;
  let moved = false;
  const go = () => {
    if (moved) return;
    moved = true;
    if (token !== P.token || !P.playing) return;
    P.timer = setTimeout(() => speakSeq(parts, i + 1, token, done), p.pause * 1000);
  };
  u.onend = go;
  u.onerror = go;
  P.utter = u; // GC対策(Chromeで発話が途切れるバグ回避)
  speechSynthesis.speak(u);
  // 保険: 発話イベントが来ない環境でも先に進める(音声未ロード時など)
  setTimeout(() => {
    if (!moved && token === P.token && P.playing && !speechSynthesis.speaking && !speechSynthesis.pending) go();
  }, 3000 + p.text.length * 350);
}

function advance(token) {
  if (token !== P.token || !P.playing) return;
  const deck = P.deck;
  const total = DECKS[deck].items.length;
  const mode = state.repeatMode[deck];
  const c = cycleOf(deck, P.idx);
  let next = P.idx + 1;

  if (mode === "cycle") {
    if (next >= cycleEnd(deck, c)) next = cycleStart(deck, c);
  } else if (mode === "all") {
    if (next >= total) next = 0;
  } else { // continue: 最後まで通したら停止
    if (next >= total) { finishDeck(); return; }
  }
  P.idx = next;
  playCurrent();
}

function finishDeck() {
  pausePlayback();
  state.resume[P.deck] = 0;
  saveState();
  updateNowPlayingUI(currentItem());
}

function pausePlayback() {
  P.playing = false;
  P.token++;
  clearTimeout(P.timer);
  speechSynthesis.cancel();
  keepAliveOff();
  if ("mediaSession" in navigator) { try { navigator.mediaSession.playbackState = "paused"; } catch (e) {} }
  updatePlayButtons();
  saveState();
}

function resumePlayback() {
  if (!P.deck) return;
  P.playing = true;
  keepAliveOn();
  if ("speechSynthesis" in window) speechSynthesis.resume();
  updatePlayButtons();
  playCurrent();
}

function skip(dir) {
  if (!P.deck) return;
  const total = DECKS[P.deck].items.length;
  P.idx = (P.idx + dir + total) % total;
  if (P.playing) playCurrent();
  else {
    state.resume[P.deck] = P.idx;
    saveState();
    updateNowPlayingUI(currentItem());
  }
}

/* ══════════════ 黒画面(ランニング)モード ══════════════ */
let wakeLock = null;
const $shade = document.getElementById("nightshade");

async function acquireWakeLock() {
  try {
    if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
  } catch (e) { wakeLock = null; }
}
async function enterShade() {
  $shade.hidden = false;
  updateShadeWord();
  await acquireWakeLock();
}
function exitShade() {
  $shade.hidden = true;
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}
function updateShadeWord() {
  if ($shade.hidden || !P.deck) return;
  const it = currentItem();
  $shade.querySelector(".ns-word").textContent = it ? it.es : "";
}
let lastTap = 0;
$shade.addEventListener("click", () => {
  const now = Date.now();
  if (now - lastTap < 400) exitShade();
  lastTap = now;
});
document.addEventListener("visibilitychange", () => {
  if (!$shade.hidden && document.visibilityState === "visible") acquireWakeLock();
});

/* ══════════════ 画面描画 ══════════════ */
const $screen = document.getElementById("screen");
let currentView = "units"; // units | words | phrases | settings | player

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function setTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
}
document.querySelectorAll(".tab").forEach((t) => {
  t.addEventListener("click", () => {
    const tab = t.dataset.tab;
    if (tab === "settings") renderSettings();
    else renderDeck(tab);
  });
});

function deckProgress(deck) {
  const n = cycleCount(deck);
  let heard = 0;
  for (let c = 0; c < n; c++) heard += Math.min(state.cycleMax[deck][c] || 0, cycleEnd(deck, c) - cycleStart(deck, c));
  return { heard, total: DECKS[deck].items.length };
}

const REPEAT_MODES = [
  { key: "cycle",    icon: "🔂", label: "サイクルをリピート" },
  { key: "continue", icon: "➡️", label: "最後まで通しで再生" },
  { key: "all",      icon: "🔁", label: "全体をリピート" },
];

const DECK_HERO = {
  units: (d) => `本編で習う単語とフレーズを<b>ユニットの順番どおり</b>に自動再生(es → en → ja)。1サイクル = 1ユニット(${d.cycleSize}個・${d.approx})。今週習ったユニットの復習にどうぞ。`,
  words: (d) => `本編の単語 ${d.items.length}語 だけを通しで自動再生。1サイクル = 1ヶ月分(${d.cycleSize}語・${d.approx})。`,
  phrases: (d) => `本編の会話フレーズ ${d.items.length}本 だけを通しで自動再生。1サイクル = 1ヶ月分(${d.cycleSize}本・${d.approx})。`,
};

/* ── デッキ画面 ── */
function renderDeck(deck) {
  currentView = deck;
  setTab(deck);
  const d = DECKS[deck];
  const n = cycleCount(deck);
  const prog = deckProgress(deck);
  const pct = Math.round((prog.heard / prog.total) * 100);

  $screen.innerHTML = "";
  $screen.appendChild(el(`
    <div class="hero">
      <h1>${d.icon} ${esc(d.label)}で聞き流し</h1>
      <p>${DECK_HERO[deck](d)}</p>
      <div class="total-bar"><div class="total-fill" style="width:${pct}%"></div></div>
      <div class="total-label">${prog.heard} / ${prog.total} 聞いた(${pct}%)</div>
    </div>
  `));

  // 続きから再生
  const r = state.resume[deck];
  if (r != null && r > 0) {
    const c = cycleOf(deck, r);
    const pos = r - cycleStart(deck, c) + 1;
    const size = cycleEnd(deck, c) - cycleStart(deck, c);
    const btn = el(`
      <button class="resume-card">
        <span class="r-icon">▶️</span>
        <span>
          <div class="r-title">続きから再生</div>
          <div class="r-sub">${d.cycleLabel}${c + 1} の ${pos}/${size} — ${esc(d.items[r].es)}</div>
        </span>
      </button>
    `);
    btn.addEventListener("click", () => startPlayback(deck, r));
    $screen.appendChild(btn);
  }

  // リピートモード
  const modeRow = el(`<div class="player-sub-controls" style="justify-content:flex-start;margin-bottom:14px"></div>`);
  REPEAT_MODES.forEach((m) => {
    const b = el(`<button class="chip-btn ${state.repeatMode[deck] === m.key ? "on" : ""}">${m.icon} ${m.label}</button>`);
    b.addEventListener("click", () => {
      state.repeatMode[deck] = m.key;
      saveState();
      renderDeck(deck);
    });
    modeRow.appendChild(b);
  });
  $screen.appendChild(modeRow);

  // サイクル一覧
  const list = el(`<div class="cycle-list"></div>`);
  const curCycle = r != null ? cycleOf(deck, r) : 0;
  for (let c = 0; c < n; c++) {
    const size = cycleEnd(deck, c) - cycleStart(deck, c);
    const heard = Math.min(state.cycleMax[deck][c] || 0, size);
    const done = heard >= size;
    const first = d.items[cycleStart(deck, c)];
    const cats = cycleCats(deck, c).join("・");
    const card = el(`
      <button class="cycle-card ${done ? "done" : ""} ${c === curCycle && r != null ? "current" : ""}">
        <span class="c-num">${deck === "units" ? first.icon : c + 1}</span>
        <span class="c-main">
          <div class="c-title">${d.cycleLabel}${c + 1} <small style="color:var(--sub);font-weight:400">(${size}${d.unitWord} · ${d.approx})</small></div>
          <div class="c-cats">${esc(cats)}</div>
          <div class="c-bar"><div class="c-fill" style="width:${Math.round((heard / size) * 100)}%"></div></div>
        </span>
        <span class="c-play">▶</span>
      </button>
    `);
    card.addEventListener("click", () => startPlayback(deck, cycleStart(deck, c)));
    list.appendChild(card);
  }
  $screen.appendChild(list);
  window.scrollTo(0, 0);
}

/* ── プレイヤー画面 ── */
function renderPlayer() {
  currentView = "player";
  setTab(P.deck);
  const deck = P.deck;

  $screen.innerHTML = "";
  const top = el(`
    <div class="player-top">
      <button class="back-btn">← 一覧</button>
      <span class="player-cycle"></span>
      <span class="player-count"></span>
    </div>
  `);
  top.querySelector(".back-btn").addEventListener("click", () => renderDeck(deck));
  $screen.appendChild(top);

  $screen.appendChild(el(`<div class="player-bar"><div class="player-fill"></div></div>`));

  $screen.appendChild(el(`
    <div class="now-card">
      <div class="n-cat"></div>
      <div class="n-es"></div>
      <div class="n-en"></div>
      <div class="n-ja"></div>
    </div>
  `));

  const controls = el(`
    <div class="player-controls">
      <button class="pc-btn" id="btn-prev">⏮</button>
      <button class="pc-btn main" id="btn-play">⏸</button>
      <button class="pc-btn" id="btn-next">⏭</button>
    </div>
  `);
  controls.querySelector("#btn-prev").addEventListener("click", () => skip(-1));
  controls.querySelector("#btn-next").addEventListener("click", () => skip(1));
  controls.querySelector("#btn-play").addEventListener("click", () => (P.playing ? pausePlayback() : resumePlayback()));
  $screen.appendChild(controls);

  const sub = el(`<div class="player-sub-controls"></div>`);
  const modeBtn = el(`<button class="chip-btn"></button>`);
  const setModeLabel = () => {
    const m = REPEAT_MODES.find((x) => x.key === state.repeatMode[P.deck]);
    modeBtn.textContent = `${m.icon} ${m.label}`;
  };
  setModeLabel();
  modeBtn.addEventListener("click", () => {
    const i = REPEAT_MODES.findIndex((x) => x.key === state.repeatMode[P.deck]);
    state.repeatMode[P.deck] = REPEAT_MODES[(i + 1) % REPEAT_MODES.length].key;
    saveState();
    setModeLabel();
  });
  sub.appendChild(modeBtn);

  const shadeBtn = el(`<button class="chip-btn">🌙 黒画面モード</button>`);
  shadeBtn.addEventListener("click", enterShade);
  sub.appendChild(shadeBtn);
  $screen.appendChild(sub);

  $screen.appendChild(el(`
    <div class="info-card" style="margin-top:16px">
      <p>📱 <b>画面を閉じて聞くには:</b> 再生したままロックしてもOK(ロック画面の⏯で操作)。
      もし音が止まる端末は <b>🌙黒画面モード</b> — 画面を真っ黒にしてスリープを防ぎ、確実に再生し続けます。</p>
    </div>
  `));

  updateNowPlayingUI(currentItem());
  updatePlayButtons();
  window.scrollTo(0, 0);
}

function updateNowPlayingUI(it) {
  updateShadeWord();
  if (currentView !== "player" || !it) return;
  const deck = P.deck;
  const c = cycleOf(deck, P.idx);
  const size = cycleEnd(deck, c) - cycleStart(deck, c);
  const pos = P.idx - cycleStart(deck, c) + 1;
  const $ = (sel) => $screen.querySelector(sel);
  if (!$(".now-card")) return;
  $(".player-cycle").textContent = `${DECKS[deck].icon} ${DECKS[deck].cycleLabel}${c + 1}/${cycleCount(deck)}`;
  $(".player-count").textContent = `${pos} / ${size}`;
  $(".player-fill").style.width = `${(pos / size) * 100}%`;
  $(".n-cat").textContent = `${it.icon} ${it.cat}`;
  $(".n-es").textContent = it.es;
  $(".n-en").textContent = `🇬🇧 ${it.en}`;
  $(".n-ja").textContent = `🇯🇵 ${it.ja}`;
  $(".now-card").classList.toggle("speaking", P.playing);
}

function updatePlayButtons() {
  const b = $screen.querySelector("#btn-play");
  if (b) b.textContent = P.playing ? "⏸" : "▶️";
  const card = $screen.querySelector(".now-card");
  if (card) card.classList.toggle("speaking", P.playing);
}

/* ── ⚙️ 設定 ── */
function renderSettings() {
  currentView = "settings";
  setTab("settings");
  refreshVoices();
  const s = state.settings;

  $screen.innerHTML = "";
  $screen.appendChild(el(`<div class="section-title">⚙️ 設定</div>`));

  const card = el(`<div class="info-card"></div>`);

  const rateRow = el(`
    <div class="setting-row">
      <label>🔊 話す速さ <span id="rate-val">${s.rate.toFixed(1)}</span></label>
      <input type="range" min="0.5" max="1.3" step="0.1" value="${s.rate}">
    </div>
  `);
  rateRow.querySelector("input").addEventListener("input", (e) => {
    s.rate = parseFloat(e.target.value);
    rateRow.querySelector("#rate-val").textContent = s.rate.toFixed(1);
    saveState();
  });
  card.appendChild(rateRow);

  const gapRow = el(`
    <div class="setting-row">
      <label>⏱ 言語間の間隔 <span id="gap-val">${s.gap.toFixed(1)}秒</span></label>
      <input type="range" min="0.2" max="1.5" step="0.1" value="${s.gap}">
    </div>
  `);
  gapRow.querySelector("input").addEventListener("input", (e) => {
    s.gap = parseFloat(e.target.value);
    gapRow.querySelector("#gap-val").textContent = s.gap.toFixed(1) + "秒";
    saveState();
  });
  card.appendChild(gapRow);

  const itemGapRow = el(`
    <div class="setting-row">
      <label>⏭ 次の言葉までの間隔 <span id="igap-val">${s.itemGap.toFixed(1)}秒</span></label>
      <input type="range" min="0.5" max="3" step="0.1" value="${s.itemGap}">
    </div>
  `);
  itemGapRow.querySelector("input").addEventListener("input", (e) => {
    s.itemGap = parseFloat(e.target.value);
    itemGapRow.querySelector("#igap-val").textContent = s.itemGap.toFixed(1) + "秒";
    saveState();
  });
  card.appendChild(itemGapRow);

  const twiceRow = el(`
    <div class="toggle-row">
      <span><div class="t-label">🔂 スペイン語を2回読む</div><div class="t-desc">es → es → en → ja の順になります</div></span>
      <label class="switch"><input type="checkbox" ${s.esTwice ? "checked" : ""}><span class="knob"></span></label>
    </div>
  `);
  twiceRow.querySelector("input").addEventListener("change", (e) => {
    s.esTwice = e.target.checked;
    saveState();
  });
  card.appendChild(twiceRow);

  const esVoices = allVoices.filter((v) => v.lang.toLowerCase().startsWith("es"));
  const voiceRow = el(`
    <div class="setting-row">
      <label>🗣 スペイン語の声</label>
      <select>${esVoices.length
        ? `<option value="">自動(おすすめ)</option>` + esVoices.map((v) => `<option value="${esc(v.name)}" ${v.name === s.esVoice ? "selected" : ""}>${esc(v.name)} (${esc(v.lang)})</option>`).join("")
        : "<option>スペイン語音声なし</option>"}</select>
    </div>
  `);
  voiceRow.querySelector("select").addEventListener("change", (e) => {
    s.esVoice = e.target.value || null;
    saveState();
    const u = new SpeechSynthesisUtterance("¡Hola! ¿Qué tal?");
    u.lang = "es-ES";
    const v = voiceFor("es-ES");
    if (v) u.voice = v;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
  card.appendChild(voiceRow);
  $screen.appendChild(card);

  const progLines = DECK_KEYS.map((k) => {
    const p = deckProgress(k);
    return `${DECKS[k].label}: ${p.heard} / ${p.total} ${DECKS[k].unitWord}`;
  }).join("<br>");
  $screen.appendChild(el(`
    <div class="info-card">
      <h3>📊 進捗</h3>
      <p>${progLines}</p>
    </div>
  `));

  $screen.appendChild(el(`
    <div class="info-card">
      <h3>🎧 このアプリについて</h3>
      <p>収録しているのは <b>本編 ¡Hablemos! と同じ 432個</b>(単語288+フレーズ144)だけ。
      本編で習った言葉を耳から定着させるための聞き流し専用アプリです。<br>
      ・<b>ユニット順</b>: 今週のユニットの復習に<br>
      ・<b>単語だけ / フレーズだけ</b>: 通しで一気に耳ならし<br>
      ・進捗は自動保存。「続きから再生」で再開できます</p>
    </div>
  `));

  $screen.appendChild(el(`
    <div class="info-card">
      <h3>🇪🇸 ほかのアプリ</h3>
      <p>ユニット学習・クイズ・スピーキングは <a href="../">¡Hablemos! 本編</a><br>
      本編に出てこない2000語の聞き流しは <a href="../listen/">¡Escucha!</a></p>
    </div>
  `));

  const resetCard = el(`
    <div class="info-card">
      <h3>🗑 データ管理</h3>
      <button class="btn danger">進捗をリセット</button>
    </div>
  `);
  resetCard.querySelector("button").addEventListener("click", () => {
    if (confirm("再生位置と進捗をすべてリセットしますか?(設定は残ります)")) {
      state.resume = { units: null, words: null, phrases: null };
      state.cycleMax = { units: {}, words: {}, phrases: {} };
      saveState();
      renderSettings();
    }
  });
  $screen.appendChild(resetCard);
  window.scrollTo(0, 0);
}

/* ══════════════ 起動 ══════════════ */
setupMediaSession();
renderDeck("units");

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
