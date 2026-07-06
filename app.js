/* ¡Hablemos! — スペイン語会話 6ヶ月チャレンジ */
"use strict";

/* ══════════════ 状態管理 ══════════════ */
const LS_KEY = "hablemos-v1";

const defaultState = () => ({
  xp: 0,
  streak: 0,
  lastDay: null,
  steps: {},   // steps[unitId] = { learn:true, listen:true, speak:true, test:true }
  stats: {},   // stats[itemId] = { right, wrong, due, interval }
  settings: { rate: 0.9, voiceName: null },
});

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return Object.assign(defaultState(), JSON.parse(raw));
  } catch (e) { /* 壊れたデータは初期化 */ }
  return defaultState();
}
function saveState() { localStorage.setItem(LS_KEY, JSON.stringify(state)); }

/* ── ユニット・アイテムの展開 ── */
const UNITS = [];
CURRICULUM.forEach((phase) => {
  phase.units.forEach((u) => UNITS.push(Object.assign({ phaseRef: phase }, u)));
});

function unitItems(unit) {
  const w = unit.words.map((x, i) => Object.assign({ id: `${unit.id}-w${i}`, kind: "word" }, x));
  const p = unit.phrases.map((x, i) => Object.assign({ id: `${unit.id}-p${i}`, kind: "phrase" }, x));
  return w.concat(p);
}
const ALL_ITEMS = UNITS.flatMap(unitItems);
const ITEM_BY_ID = Object.fromEntries(ALL_ITEMS.map((it) => [it.id, it]));

function unitSteps(unitId) { return state.steps[unitId] || {}; }
function isUnitComplete(unitId) {
  const s = unitSteps(unitId);
  return s.learn && s.listen && s.speak && s.test;
}
function isUnitUnlocked(index) {
  return index === 0 || isUnitComplete(UNITS[index - 1].id);
}
function currentUnitIndex() {
  for (let i = 0; i < UNITS.length; i++) if (!isUnitComplete(UNITS[i].id)) return i;
  return UNITS.length - 1;
}

/* ── XP・レベル・ストリーク ── */
const LEVEL_TITLES = ["入門者", "旅行者", "おしゃべり見習い", "会話上手", "ペラペラ候補", "ネイティブ小学生レベル"];
function levelInfo() {
  const lv = Math.min(Math.floor(state.xp / 300) + 1, 30);
  const title = LEVEL_TITLES[Math.min(Math.floor((lv - 1) / 4), LEVEL_TITLES.length - 1)];
  return { lv, title };
}
function addXP(n) {
  state.xp += n;
  touchStreak();
  saveState();
  renderTopbar();
}
function todayStr(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}
function touchStreak() {
  const today = todayStr();
  if (state.lastDay === today) return;
  state.streak = state.lastDay === todayStr(-1) ? state.streak + 1 : 1;
  state.lastDay = today;
}
function itemStat(id) {
  if (!state.stats[id]) state.stats[id] = { right: 0, wrong: 0, due: null, interval: 0 };
  return state.stats[id];
}
function markAnswer(id, correct) {
  const st = itemStat(id);
  if (correct) {
    st.right++;
    st.interval = st.interval ? Math.min(st.interval * 2, 30) : 1;
  } else {
    st.wrong++;
    st.interval = 1;
  }
  const d = new Date();
  d.setDate(d.getDate() + st.interval);
  st.due = d.toISOString().slice(0, 10);
  saveState();
}

/* ══════════════ 音声(TTS) ══════════════ */
let voices = [];
function refreshVoices() {
  voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("es"));
}
if ("speechSynthesis" in window) {
  refreshVoices();
  speechSynthesis.onvoiceschanged = refreshVoices;
}
function pickVoice() {
  if (!voices.length) refreshVoices();
  if (state.settings.voiceName) {
    const v = voices.find((v) => v.name === state.settings.voiceName);
    if (v) return v;
  }
  // 自然な声を優先(Mónica/Paulina はApple端末の高品質音声)
  const preferred = ["Mónica", "Paulina", "Google español"];
  for (const name of preferred) {
    const v = voices.find((v) => v.name.includes(name));
    if (v) return v;
  }
  return voices[0] || null;
}
function ttsText(es) {
  // "el tío / la tía" → 両方読み上げ、記号は整理
  return es.replace(/\s*\/\s*/g, ", ");
}
function speak(text) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(ttsText(text));
  u.lang = "es-ES";
  u.rate = state.settings.rate;
  const v = pickVoice();
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}

/* ══════════════ 音声認識 ══════════════ */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;

function normalizeEs(s) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[¿¡?!.,;:'"()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[m][n];
}
function similarity(a, b) {
  if (!a.length && !b.length) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}
// 「el tío / la tía」のような表記から発話候補を作る
function spokenVariants(es) {
  const parts = es.split("/").map((p) => normalizeEs(p));
  const variants = new Set();
  parts.forEach((p) => {
    if (!p) return;
    variants.add(p);
    const noArticle = p.replace(/^(el|la|los|las|un|una)\s+/, "");
    variants.add(noArticle);
  });
  return [...variants];
}
function isSpokenMatch(transcript, targetEs) {
  const heard = normalizeEs(transcript);
  if (!heard) return false;
  return spokenVariants(targetEs).some(
    (v) => heard.includes(v) || similarity(heard, v) >= 0.72
  );
}

/* ══════════════ 画面描画 ══════════════ */
const $screen = document.getElementById("screen");
let activeRecognition = null;

function stopAudio() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  if (activeRecognition) { try { activeRecognition.abort(); } catch (e) {} activeRecognition = null; }
}

function renderTopbar() {
  const { lv, title } = levelInfo();
  document.querySelector("#stat-streak span").textContent = state.streak;
  document.querySelector("#stat-level span").textContent = `Lv.${lv} ${title}`;
  document.querySelector("#stat-xp span").textContent = state.xp;
}

function setTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
}
document.querySelectorAll(".tab").forEach((t) => {
  t.addEventListener("click", () => {
    stopAudio();
    if (t.dataset.tab === "home") renderHome();
    if (t.dataset.tab === "review") renderReview();
    if (t.dataset.tab === "settings") renderSettings();
  });
});

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function confetti() {
  const emojis = ["🎉", "⭐", "🎊", "💃", "🇪🇸", "🇲🇽", "✨"];
  for (let i = 0; i < 26; i++) {
    const p = el(`<div class="confetti-piece">${emojis[i % emojis.length]}</div>`);
    p.style.left = Math.random() * 100 + "vw";
    p.style.animationDuration = 1.8 + Math.random() * 1.6 + "s";
    p.style.animationDelay = Math.random() * 0.4 + "s";
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 4200);
  }
}

/* ── ホーム(学習パス) ── */
function renderHome() {
  stopAudio();
  setTab("home");
  const done = UNITS.filter((u) => isUnitComplete(u.id)).length;
  const pct = Math.round((done / UNITS.length) * 100);
  const cur = currentUnitIndex();

  $screen.innerHTML = "";
  $screen.appendChild(el(`
    <div class="hero">
      <h1>¡Hablemos! 🇪🇸</h1>
      <p>半年でスペイン語ネイティブと会話しよう</p>
      <div class="goal-bar"><div class="goal-fill" style="width:${pct}%"></div></div>
      <div class="goal-label">${done} / ${UNITS.length} ユニット完了(${pct}%)</div>
    </div>
  `));

  CURRICULUM.forEach((phase) => {
    const ph = el(`
      <section class="phase">
        <div class="phase-head">
          <span class="badge" style="background:${phase.color}">${phase.month}</span>
          <h2>${esc(phase.title)}</h2>
          <small>${esc(phase.en)}</small>
        </div>
        <div class="unit-grid"></div>
      </section>
    `);
    const grid = ph.querySelector(".unit-grid");
    phase.units.forEach((u) => {
      const gi = UNITS.findIndex((x) => x.id === u.id);
      const unlocked = isUnitUnlocked(gi);
      const complete = isUnitComplete(u.id);
      const s = unitSteps(u.id);
      const cls = complete ? "completed" : !unlocked ? "locked" : gi === cur ? "current" : "";
      const card = el(`
        <button class="unit-card ${cls}">
          <div class="u-icon">${u.icon}</div>
          <div class="u-title">${esc(u.title)}</div>
          <div class="u-en">${esc(u.en)}</div>
          <div class="u-progress">
            ${["learn", "listen", "speak", "test"].map((k) => `<div class="u-dot ${s[k] ? "done" : ""}"></div>`).join("")}
          </div>
        </button>
      `);
      if (unlocked) card.addEventListener("click", () => renderUnit(gi));
      else card.addEventListener("click", () => {
        card.animate([{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(0)" }], { duration: 250 });
      });
      grid.appendChild(card);
    });
    $screen.appendChild(ph);
  });
  window.scrollTo(0, 0);
}

/* ── ユニット画面 ── */
const STEP_DEFS = [
  { key: "learn", icon: "📖", name: "学ぶ", desc: "新しい単語とフレーズをカードで覚える" },
  { key: "listen", icon: "🎧", name: "聞く", desc: "音だけ聞いて意味を当てるクイズ" },
  { key: "speak", icon: "🗣", name: "話す", desc: "マイクに向かってスペイン語で言う" },
  { key: "test", icon: "🏆", name: "テスト", desc: "総仕上げ!8問以上正解でクリア" },
];

function renderUnit(gi) {
  stopAudio();
  setTab("home");
  const unit = UNITS[gi];
  const s = unitSteps(unit.id);

  $screen.innerHTML = "";
  $screen.appendChild(el(`<button class="back-btn">← ホームへ戻る</button>`));
  $screen.lastElementChild.addEventListener("click", renderHome);

  $screen.appendChild(el(`
    <div class="unit-header">
      <div class="big-icon">${unit.icon}</div>
      <h1>${esc(unit.title)}</h1>
      <p>${esc(unit.en)} — 単語${unit.words.length} + フレーズ${unit.phrases.length}</p>
    </div>
  `));

  const list = el(`<div class="step-list"></div>`);
  STEP_DEFS.forEach((def, i) => {
    const prevDone = i === 0 || s[STEP_DEFS[i - 1].key];
    const doneCls = s[def.key] ? "done" : "";
    const lockCls = prevDone ? "" : "locked";
    const card = el(`
      <button class="step-card ${doneCls} ${lockCls}">
        <span class="s-icon">${def.icon}</span>
        <span><span class="s-name">${def.name}</span><div class="s-desc">${def.desc}</div></span>
        <span class="s-check">${s[def.key] ? "✅" : prevDone ? "▶️" : "🔒"}</span>
      </button>
    `);
    card.addEventListener("click", () => startStep(gi, def.key));
    list.appendChild(card);
  });
  $screen.appendChild(list);
  window.scrollTo(0, 0);
}

function startStep(gi, key) {
  const unit = UNITS[gi];
  if (key === "learn") startLearn(gi);
  if (key === "listen") startListenQuiz(gi);
  if (key === "speak") startSpeak(gi);
  if (key === "test") startTest(gi);
}

function completeStep(gi, key, xp) {
  const unit = UNITS[gi];
  if (!state.steps[unit.id]) state.steps[unit.id] = {};
  const already = state.steps[unit.id][key];
  state.steps[unit.id][key] = true;
  addXP(already ? Math.floor(xp / 3) : xp); // 復習でも少しXP
  saveState();
  return !already;
}

function lessonHeader(onQuit) {
  const head = el(`
    <div class="lesson-top">
      <button class="quit">✕</button>
      <div class="progress-track"><div class="progress-fill" style="width:0%"></div></div>
    </div>
  `);
  head.querySelector(".quit").addEventListener("click", onQuit);
  return head;
}

/* ── 📖 学ぶ:フラッシュカード ── */
function startLearn(gi) {
  stopAudio();
  const unit = UNITS[gi];
  const items = unitItems(unit);
  let idx = 0;

  function show() {
    const it = items[idx];
    $screen.innerHTML = "";
    const head = lessonHeader(() => renderUnit(gi));
    head.querySelector(".progress-fill").style.width = `${(idx / items.length) * 100}%`;
    $screen.appendChild(head);
    $screen.appendChild(el(`<div class="prompt-label">カードをタップして意味を見る 👆</div>`));

    const card = el(`
      <div class="flashcard">
        <span class="kind-tag">${it.kind === "word" ? "単語" : "フレーズ"} ${idx + 1}/${items.length}</span>
        <div class="es">${esc(it.es)}</div>
        <div class="answer" style="display:none">
          <hr class="divider">
          <div class="en">🇬🇧 ${esc(it.en)}</div>
          <div class="ja">🇯🇵 ${esc(it.ja)}</div>
        </div>
        <div class="hint">タップでめくる</div>
      </div>
    `);
    let flipped = false;
    card.addEventListener("click", () => {
      flipped = true;
      card.querySelector(".answer").style.display = "block";
      card.querySelector(".hint").style.display = "none";
    });
    $screen.appendChild(card);

    const row = el(`
      <div class="btn-row">
        <button class="btn secondary">🔊 もう一度</button>
        <button class="btn primary">次へ →</button>
      </div>
    `);
    row.children[0].addEventListener("click", () => speak(it.es));
    row.children[1].addEventListener("click", () => {
      if (!flipped) { card.click(); return; } // 意味を見てから次へ
      idx++;
      if (idx < items.length) show();
      else finish();
    });
    $screen.appendChild(row);
    speak(it.es);
    window.scrollTo(0, 0);
  }

  function finish() {
    stopAudio();
    const first = completeStep(gi, "learn", 20);
    resultScreen({
      emoji: "📖", title: "カード学習 完了!",
      sub: `${unit.title}の${items.length}個をひと通り学びました`,
      xp: first ? 20 : 6,
      onNext: () => renderUnit(gi),
    });
  }
  show();
}

/* ── 🎧 聞く:リスニングクイズ ── */
function startListenQuiz(gi) {
  stopAudio();
  const unit = UNITS[gi];
  const items = shuffle(unitItems(unit));
  const queue = items.slice();
  let done = 0;
  const total = items.length;

  function makeChoices(answer) {
    const pool = shuffle(ALL_ITEMS.filter((x) => x.id !== answer.id && x.ja !== answer.ja));
    const sameUnit = pool.filter((x) => x.id.startsWith(unit.id));
    const picks = shuffle(sameUnit.slice(0, 6).concat(pool.slice(0, 4))).slice(0, 3);
    return shuffle([answer, ...picks]);
  }

  function show() {
    const it = queue.shift();
    $screen.innerHTML = "";
    const head = lessonHeader(() => renderUnit(gi));
    head.querySelector(".progress-fill").style.width = `${(done / total) * 100}%`;
    $screen.appendChild(head);

    $screen.appendChild(el(`<div class="prompt-label">🎧 音を聞いて意味を選ぼう</div>`));
    const q = el(`
      <div class="quiz-question">
        <button class="audio-btn">🔊</button>
      </div>
    `);
    q.querySelector(".audio-btn").addEventListener("click", () => speak(it.es));
    $screen.appendChild(q);

    const choicesBox = el(`<div class="choices"></div>`);
    const fb = el(`<div class="feedback"></div>`);
    let answered = false;

    makeChoices(it).forEach((c) => {
      const btn = el(`
        <button class="choice">
          <div class="c-en">🇬🇧 ${esc(c.en)}</div>
          <div class="c-ja">🇯🇵 ${esc(c.ja)}</div>
        </button>
      `);
      btn.addEventListener("click", () => {
        if (answered) return;
        answered = true;
        const correct = c.id === it.id;
        markAnswer(it.id, correct);
        choicesBox.querySelectorAll(".choice").forEach((b) => (b.disabled = true));
        if (correct) {
          btn.classList.add("correct");
          fb.textContent = "¡Muy bien! 正解 🎉";
          fb.className = "feedback ok";
          done++;
          setTimeout(next, 900);
        } else {
          btn.classList.add("wrong");
          [...choicesBox.children].find((b) => b.dataset.id === it.id)?.classList.add("correct");
          fb.innerHTML = `正解: <b>${esc(it.es)}</b> — ${esc(it.ja)}`;
          fb.className = "feedback ng";
          queue.push(it); // 後でもう一度出題
          const retry = el(`<div class="btn-row"><button class="btn primary">次へ →</button></div>`);
          retry.children[0].addEventListener("click", next);
          $screen.appendChild(retry);
        }
      });
      btn.dataset.id = c.id;
      choicesBox.appendChild(btn);
    });
    $screen.appendChild(choicesBox);
    $screen.appendChild(fb);
    speak(it.es);
    window.scrollTo(0, 0);
  }

  function next() {
    if (queue.length) show();
    else {
      stopAudio();
      const first = completeStep(gi, "listen", 30);
      resultScreen({
        emoji: "🎧", title: "リスニング クリア!",
        sub: "耳がスペイン語に慣れてきました",
        xp: first ? 30 : 10,
        onNext: () => renderUnit(gi),
      });
    }
  }
  show();
}

/* ── 🗣 話す:スピーキング練習 ── */
function startSpeak(gi) {
  stopAudio();
  const unit = UNITS[gi];
  const items = unitItems(unit);
  const targets = shuffle(items.filter((x) => x.kind === "phrase"))
    .concat(shuffle(items.filter((x) => x.kind === "word")).slice(0, 4));
  let idx = 0;

  function show() {
    const it = targets[idx];
    $screen.innerHTML = "";
    const head = lessonHeader(() => renderUnit(gi));
    head.querySelector(".progress-fill").style.width = `${(idx / targets.length) * 100}%`;
    $screen.appendChild(head);

    $screen.appendChild(el(`<div class="prompt-label">🗣 これをスペイン語で言ってみよう (${idx + 1}/${targets.length})</div>`));
    $screen.appendChild(el(`
      <div class="quiz-question">
        <div class="q-meaning-en">🇬🇧 ${esc(it.en)}</div>
        <div class="q-meaning-ja">🇯🇵 ${esc(it.ja)}</div>
        <div class="q-es" style="display:none">${esc(it.es)}</div>
      </div>
    `));

    const heard = el(`<div class="heard"></div>`);
    const fb = el(`<div class="feedback"></div>`);

    if (SR) {
      const mic = el(`<button class="mic-btn">🎤</button>`);
      const hint = el(`<div class="mic-hint">マイクをタップして話す</div>`);
      mic.addEventListener("click", () => {
        if (mic.classList.contains("listening")) { activeRecognition?.stop(); return; }
        stopAudio();
        const rec = new SR();
        activeRecognition = rec;
        rec.lang = "es-ES";
        rec.interimResults = false;
        rec.maxAlternatives = 5;
        mic.classList.add("listening");
        hint.textContent = "聞いています… もう一度タップで停止";
        rec.onresult = (e) => {
          const alts = [...e.results[0]].map((r) => r.transcript);
          const match = alts.find((t) => isSpokenMatch(t, it.es));
          const best = match || alts[0] || "";
          heard.innerHTML = `聞こえた言葉: <b>${esc(best)}</b>`;
          if (match) success(); else fail();
        };
        rec.onerror = (e) => {
          mic.classList.remove("listening");
          if (e.error === "not-allowed" || e.error === "service-not-allowed") {
            hint.textContent = "マイクが使えません。下のボタンで自己チェックしてね";
            showSelfCheck();
          } else {
            hint.textContent = "聞き取れませんでした。もう一度タップ";
          }
        };
        rec.onend = () => { mic.classList.remove("listening"); activeRecognition = null; };
        try { rec.start(); } catch (e) { hint.textContent = "もう一度タップしてください"; }
      });
      $screen.appendChild(mic);
      $screen.appendChild(hint);
    } else {
      $screen.appendChild(el(`<div class="mic-hint" style="margin-top:16px">このブラウザは音声認識に未対応です。<br>声に出して言ってから、自己チェックしよう!</div>`));
      showSelfCheck();
    }

    $screen.appendChild(heard);
    $screen.appendChild(fb);

    const helpRow = el(`
      <div class="btn-row">
        <button class="btn secondary">🔊 答えを聞く</button>
        <button class="btn secondary">👀 答えを見る</button>
      </div>
    `);
    helpRow.children[0].addEventListener("click", () => speak(it.es));
    helpRow.children[1].addEventListener("click", () => {
      $screen.querySelector(".q-es").style.display = "block";
      if (SR) showSelfCheck(); // 見た後は自己申告で進める
    });
    $screen.appendChild(helpRow);

    function showSelfCheck() {
      if ($screen.querySelector(".selfcheck")) return;
      const row = el(`
        <div class="btn-row selfcheck">
          <button class="btn danger">まだ 🙅</button>
          <button class="btn primary">言えた! ✅</button>
        </div>
      `);
      row.children[0].addEventListener("click", () => { markAnswer(it.id, false); speak(it.es); $screen.querySelector(".q-es").style.display = "block"; });
      row.children[1].addEventListener("click", () => { markAnswer(it.id, true); next(); });
      $screen.appendChild(row);
    }

    function success() {
      markAnswer(it.id, true);
      fb.textContent = "¡Perfecto! 完璧 🎉";
      fb.className = "feedback ok";
      setTimeout(next, 1100);
    }
    function fail() {
      markAnswer(it.id, false);
      $screen.querySelector(".q-es").style.display = "block";
      fb.innerHTML = `もう一回! 正解: <b>${esc(it.es)}</b>`;
      fb.className = "feedback ng";
      speak(it.es);
      if (!$screen.querySelector(".skiprow")) {
        const row = el(`<div class="btn-row skiprow"><button class="btn secondary">スキップ →</button></div>`);
        row.children[0].addEventListener("click", next);
        $screen.appendChild(row);
      }
    }
    window.scrollTo(0, 0);
  }

  function next() {
    stopAudio();
    idx++;
    if (idx < targets.length) show();
    else {
      const first = completeStep(gi, "speak", 30);
      resultScreen({
        emoji: "🗣", title: "スピーキング クリア!",
        sub: "実際に口に出すのが上達への一番の近道です",
        xp: first ? 30 : 10,
        onNext: () => renderUnit(gi),
      });
    }
  }
  show();
}

/* ── 🏆 テスト ── */
function startTest(gi) {
  stopAudio();
  const unit = UNITS[gi];
  const items = shuffle(unitItems(unit)).slice(0, 10);
  let idx = 0, score = 0;

  function show() {
    const it = items[idx];
    const typeB = Math.random() < 0.5; // A: 音→意味 / B: 意味→スペイン語
    $screen.innerHTML = "";
    const head = lessonHeader(() => renderUnit(gi));
    head.querySelector(".progress-fill").style.width = `${(idx / items.length) * 100}%`;
    $screen.appendChild(head);

    const pool = shuffle(ALL_ITEMS.filter((x) => x.id !== it.id && x.es !== it.es));
    const sameUnit = pool.filter((x) => x.id.startsWith(unit.id));
    const distractors = shuffle(sameUnit.slice(0, 6).concat(pool.slice(0, 4))).slice(0, 3);
    const choices = shuffle([it, ...distractors]);

    if (typeB) {
      $screen.appendChild(el(`<div class="prompt-label">🏆 Q${idx + 1}: スペイン語はどれ?</div>`));
      $screen.appendChild(el(`
        <div class="quiz-question">
          <div class="q-meaning-en">🇬🇧 ${esc(it.en)}</div>
          <div class="q-meaning-ja">🇯🇵 ${esc(it.ja)}</div>
        </div>
      `));
    } else {
      $screen.appendChild(el(`<div class="prompt-label">🏆 Q${idx + 1}: 音を聞いて意味を選ぼう</div>`));
      const q = el(`<div class="quiz-question"><button class="audio-btn">🔊</button></div>`);
      q.querySelector(".audio-btn").addEventListener("click", () => speak(it.es));
      $screen.appendChild(q);
      speak(it.es);
    }

    const box = el(`<div class="choices"></div>`);
    const fb = el(`<div class="feedback"></div>`);
    let answered = false;
    choices.forEach((c) => {
      const btn = typeB
        ? el(`<button class="choice"><div class="c-es">${esc(c.es)}</div></button>`)
        : el(`<button class="choice"><div class="c-en">🇬🇧 ${esc(c.en)}</div><div class="c-ja">🇯🇵 ${esc(c.ja)}</div></button>`);
      btn.dataset.id = c.id;
      btn.addEventListener("click", () => {
        if (answered) return;
        answered = true;
        const correct = c.id === it.id;
        markAnswer(it.id, correct);
        box.querySelectorAll(".choice").forEach((b) => (b.disabled = true));
        if (correct) { score++; btn.classList.add("correct"); fb.textContent = "正解! 🎉"; fb.className = "feedback ok"; }
        else {
          btn.classList.add("wrong");
          [...box.children].find((b) => b.dataset.id === it.id)?.classList.add("correct");
          fb.innerHTML = `正解: <b>${esc(it.es)}</b>`;
          fb.className = "feedback ng";
        }
        if (typeB) speak(it.es);
        setTimeout(next, correct ? 900 : 1800);
      });
      box.appendChild(btn);
    });
    $screen.appendChild(box);
    $screen.appendChild(fb);
    window.scrollTo(0, 0);
  }

  function next() {
    idx++;
    if (idx < items.length) show();
    else finish();
  }

  function finish() {
    stopAudio();
    const passed = score >= Math.ceil(items.length * 0.8);
    if (passed) {
      const first = completeStep(gi, "test", 50);
      const unitDone = isUnitComplete(unit.id);
      resultScreen({
        emoji: unitDone ? "🏆" : "🎉",
        title: `${score}/${items.length} 正解 — 合格!`,
        sub: unitDone ? `「${unit.title}」ユニット完全クリア! 次のユニットが解放されました` : "テスト合格!",
        xp: first ? 50 : 15,
        confetti: true,
        onNext: renderHome,
      });
    } else {
      resultScreen({
        emoji: "💪",
        title: `${score}/${items.length} 正解`,
        sub: "あと少し!「学ぶ」や「聞く」で復習してもう一度挑戦しよう",
        xp: 5,
        onNext: () => renderUnit(gi),
        retry: () => startTest(gi),
      });
      addXP(5);
    }
  }
  show();
}

/* ── 結果画面 ── */
function resultScreen({ emoji, title, sub, xp, onNext, retry, confetti: doConfetti }) {
  $screen.innerHTML = "";
  const div = el(`
    <div class="result-screen">
      <div class="big">${emoji}</div>
      <h1>${esc(title)}</h1>
      <p>${esc(sub)}</p>
      <div class="xp-pop">+${xp} XP ⭐</div>
      <div class="btn-row" style="flex-direction:column"></div>
    </div>
  `);
  const row = div.querySelector(".btn-row");
  if (retry) {
    const r = el(`<button class="btn secondary">🔁 もう一度挑戦</button>`);
    r.addEventListener("click", retry);
    row.appendChild(r);
  }
  const nextBtn = el(`<button class="btn primary">続ける →</button>`);
  nextBtn.addEventListener("click", onNext);
  row.appendChild(nextBtn);
  $screen.appendChild(div);
  if (doConfetti) confetti();
  window.scrollTo(0, 0);
}

/* ── 🔁 復習タブ ── */
function learnedItems() {
  return UNITS.filter((u) => unitSteps(u.id).learn).flatMap(unitItems);
}
function dueItems() {
  const today = todayStr();
  return learnedItems().filter((it) => {
    const st = state.stats[it.id];
    return st && st.due && st.due <= today;
  });
}
function weakItems() {
  return learnedItems()
    .map((it) => ({ it, st: state.stats[it.id] }))
    .filter((x) => x.st && x.st.wrong > 0 && x.st.wrong >= x.st.right)
    .sort((a, b) => b.st.wrong - a.st.wrong)
    .slice(0, 10);
}

function renderReview() {
  stopAudio();
  setTab("review");
  const due = dueItems();
  const weak = weakItems();

  $screen.innerHTML = "";
  $screen.appendChild(el(`<div class="section-title">🔁 復習</div>`));

  const dueCard = el(`
    <div class="info-card">
      <h3>📅 今日の復習 — ${due.length}個</h3>
      <p>${due.length ? "忘れかけたタイミングで復習すると記憶に定着します" : "今日の復習はありません。新しいユニットを進めよう!"}</p>
    </div>
  `);
  if (due.length) {
    const b = el(`<div class="btn-row"><button class="btn primary">復習をはじめる →</button></div>`);
    b.children[0].addEventListener("click", () => startReviewSession(shuffle(due).slice(0, 12)));
    dueCard.appendChild(b);
  }
  $screen.appendChild(dueCard);

  const weakCard = el(`<div class="info-card"><h3>😅 ニガテな言葉 TOP${weak.length}</h3></div>`);
  if (!weak.length) {
    weakCard.appendChild(el(`<p>まだ苦手な言葉はありません。¡Genial!</p>`));
  } else {
    weak.forEach(({ it, st }) => {
      const row = el(`
        <div class="weak-item">
          <button class="audio-btn small">🔊</button>
          <div>
            <div class="w-es">${esc(it.es)}</div>
            <div class="w-meaning">🇬🇧 ${esc(it.en)} / 🇯🇵 ${esc(it.ja)}</div>
          </div>
          <div class="w-count">✗${st.wrong}</div>
        </div>
      `);
      row.querySelector("button").addEventListener("click", () => speak(it.es));
      weakCard.appendChild(row);
    });
    const b = el(`<div class="btn-row"><button class="btn secondary">ニガテ克服クイズ →</button></div>`);
    b.children[0].addEventListener("click", () => startReviewSession(shuffle(weak.map((x) => x.it))));
    weakCard.appendChild(b);
  }
  $screen.appendChild(weakCard);
  window.scrollTo(0, 0);
}

function startReviewSession(items) {
  stopAudio();
  if (!items.length) return renderReview();
  const queue = items.slice();
  let done = 0, correctCount = 0;
  const total = queue.length;

  function show() {
    const it = queue.shift();
    $screen.innerHTML = "";
    const head = lessonHeader(renderReview);
    head.querySelector(".progress-fill").style.width = `${(done / total) * 100}%`;
    $screen.appendChild(head);
    $screen.appendChild(el(`<div class="prompt-label">🎧 音を聞いて意味を選ぼう</div>`));
    const q = el(`<div class="quiz-question"><button class="audio-btn">🔊</button></div>`);
    q.querySelector(".audio-btn").addEventListener("click", () => speak(it.es));
    $screen.appendChild(q);

    const pool = shuffle(ALL_ITEMS.filter((x) => x.id !== it.id && x.ja !== it.ja)).slice(0, 3);
    const box = el(`<div class="choices"></div>`);
    const fb = el(`<div class="feedback"></div>`);
    let answered = false;
    shuffle([it, ...pool]).forEach((c) => {
      const btn = el(`<button class="choice"><div class="c-en">🇬🇧 ${esc(c.en)}</div><div class="c-ja">🇯🇵 ${esc(c.ja)}</div></button>`);
      btn.dataset.id = c.id;
      btn.addEventListener("click", () => {
        if (answered) return;
        answered = true;
        const ok = c.id === it.id;
        markAnswer(it.id, ok);
        box.querySelectorAll(".choice").forEach((b) => (b.disabled = true));
        if (ok) { correctCount++; btn.classList.add("correct"); fb.textContent = "¡Bien! 🎉"; fb.className = "feedback ok"; }
        else {
          btn.classList.add("wrong");
          [...box.children].find((b) => b.dataset.id === it.id)?.classList.add("correct");
          fb.innerHTML = `正解: <b>${esc(it.es)}</b>`; fb.className = "feedback ng";
        }
        done++;
        setTimeout(() => (queue.length ? show() : finish()), ok ? 900 : 1800);
      });
      box.appendChild(btn);
    });
    $screen.appendChild(box);
    $screen.appendChild(fb);
    speak(it.es);
    window.scrollTo(0, 0);
  }

  function finish() {
    stopAudio();
    const xp = 5 + correctCount * 2;
    addXP(xp);
    resultScreen({
      emoji: "🧠", title: `復習完了! ${correctCount}/${total} 正解`,
      sub: "コツコツ復習が半年後の会話力をつくります",
      xp, onNext: renderReview,
    });
  }
  show();
}

/* ── ⚙️ 設定 ── */
function renderSettings() {
  stopAudio();
  setTab("settings");
  refreshVoices();
  $screen.innerHTML = "";
  $screen.appendChild(el(`<div class="section-title">⚙️ 設定</div>`));

  const card = el(`<div class="info-card"></div>`);

  // 話す速さ
  const rateRow = el(`
    <div class="setting-row">
      <label>🔊 話す速さ <span id="rate-val">${state.settings.rate.toFixed(1)}</span></label>
      <input type="range" min="0.5" max="1.2" step="0.1" value="${state.settings.rate}">
    </div>
  `);
  rateRow.querySelector("input").addEventListener("input", (e) => {
    state.settings.rate = parseFloat(e.target.value);
    rateRow.querySelector("#rate-val").textContent = state.settings.rate.toFixed(1);
    saveState();
  });
  card.appendChild(rateRow);

  // 声の選択
  const voiceRow = el(`
    <div class="setting-row">
      <label>🗣 声</label>
      <select>${voices.length ? voices.map((v) => `<option value="${esc(v.name)}" ${v.name === state.settings.voiceName ? "selected" : ""}>${esc(v.name)} (${v.lang})</option>`).join("") : "<option>スペイン語音声なし</option>"}</select>
    </div>
  `);
  voiceRow.querySelector("select").addEventListener("change", (e) => {
    state.settings.voiceName = e.target.value;
    saveState();
    speak("¡Hola! ¿Cómo estás?");
  });
  card.appendChild(voiceRow);

  const testRow = el(`<div class="setting-row"><label>テスト再生</label><button class="btn secondary" style="flex:0;padding:8px 16px">🔊 ¡Hola!</button></div>`);
  testRow.querySelector("button").addEventListener("click", () => speak("¡Hola! Mucho gusto. ¿Cómo estás?"));
  card.appendChild(testRow);
  $screen.appendChild(card);

  // 学習状況
  const done = UNITS.filter((u) => isUnitComplete(u.id)).length;
  const { lv, title } = levelInfo();
  $screen.appendChild(el(`
    <div class="info-card">
      <h3>📊 学習状況</h3>
      <p>レベル: Lv.${lv}(${title})<br>
      XP: ${state.xp} ⭐<br>
      連続学習: ${state.streak}日 🔥<br>
      完了ユニット: ${done} / ${UNITS.length}<br>
      学習した言葉: ${learnedItems().length} / ${ALL_ITEMS.length}個</p>
    </div>
  `));

  $screen.appendChild(el(`
    <div class="info-card">
      <h3>💡 使い方のコツ</h3>
      <p>・1日1ステップでOK(約5〜10分)<br>
      ・「話す」は必ず声に出す — 恥ずかしがらない!<br>
      ・「復習」タブを毎日のぞくと記憶が定着<br>
      ・音声認識はChrome/Safariで動作します</p>
    </div>
  `));

  const resetCard = el(`
    <div class="info-card">
      <h3>🗑 データ管理</h3>
      <div class="btn-row"><button class="btn danger">進捗をリセット</button></div>
    </div>
  `);
  resetCard.querySelector("button").addEventListener("click", () => {
    if (confirm("本当にすべての進捗をリセットしますか?")) {
      localStorage.removeItem(LS_KEY);
      state = defaultState();
      renderTopbar();
      renderHome();
    }
  });
  $screen.appendChild(resetCard);
  window.scrollTo(0, 0);
}

/* ══════════════ 起動 ══════════════ */
renderTopbar();
renderHome();

// PWA: Service Worker 登録(https or localhost のみ)
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
