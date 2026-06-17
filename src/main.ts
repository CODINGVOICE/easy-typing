import "./styles.css";
import {
  GAME_KEYS,
  KEYBOARD_ROWS,
  LESSONS,
  STAGES,
  type Lesson,
  type LessonItem,
  type LessonStage
} from "./data";
import { normalizePinyin } from "./pinyin";

interface ItemResult {
  appearances: number;
  correct: number;
  totalErrors: number;
  lastErrors: number;
}

interface AppState {
  activeStage: LessonStage;
  activeLessonId: string;
  itemIndex: number;
  input: string;
  errors: number;
  completed: boolean;
  attemptRecorded: boolean;
  feedback: string;
  results: Record<string, ItemResult>;
}

type GameFruit = "apple" | "orange" | "pear" | "peach" | "grapes" | "watermelon";

interface GameTarget {
  id: number;
  key: string;
  fruit: GameFruit;
  x: number;
  y: number;
  speed: number;
  size: number;
  hue: number;
  wobble: number;
}

interface GameBullet {
  id: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  age: number;
  duration: number;
}

interface GameEffect {
  id: number;
  x: number;
  y: number;
  age: number;
  text: string;
}

interface TypingGameState {
  status: "running" | "over";
  score: number;
  missed: number;
  targets: GameTarget[];
  bullets: GameBullet[];
  effects: GameEffect[];
  lastTimestamp: number;
  spawnTimer: number;
  nextSpawnDelay: number;
  nextId: number;
}

const LEGACY_STORAGE_KEYS = [
  "pinyin-typing-game-progress-v1",
  "pinyin-typing-game-progress-v2",
  "pinyin-typing-game-progress-v3"
];
const AUTO_ADVANCE_DELAY_MS = 850;
const GAME_MAX_MISSES = 10;
const GAME_BASE_TARGET_SPEED = 44;
const GAME_TARGET_SPEED_VARIANCE = 18;
const GAME_INITIAL_SPAWN_DELAY = 950;
const GAME_BASE_SPAWN_DELAY = 1450;
const GAME_MIN_SPAWN_DELAY = 430;
const GAME_FRUITS: GameFruit[] = [
  "apple",
  "orange",
  "pear",
  "peach",
  "grapes",
  "watermelon"
];
const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root not found.");
}

const firstLesson = LESSONS[0];
clearStoredProgress();
const initialLesson = firstLesson;

let state: AppState = {
  activeStage: initialLesson.stage,
  activeLessonId: initialLesson.id,
  itemIndex: getStartItemIndex(initialLesson),
  input: "",
  errors: 0,
  completed: false,
  attemptRecorded: false,
  feedback: "准备好了就开始。",
  results: {}
};

let autoAdvanceTimer: number | null = null;
let typingGame = createTypingGameState();
let gameAnimationFrame: number | null = null;

function createTypingGameState(): TypingGameState {
  return {
    status: "running",
    score: 0,
    missed: 0,
    targets: [],
    bullets: [],
    effects: [],
    lastTimestamp: 0,
    spawnTimer: 0,
    nextSpawnDelay: GAME_INITIAL_SPAWN_DELAY,
    nextId: 1
  };
}

function resetTypingGame(): void {
  typingGame = createTypingGameState();
  render();
}

const getLesson = (): Lesson =>
  LESSONS.find((lesson) => lesson.id === state.activeLessonId) ?? firstLesson;

const getItem = (): LessonItem => getLesson().items[state.itemIndex];

const normalizeKeyInput = (value: string): string =>
  value.replace(/[A-Z]/g, (char) => char.toLowerCase());

const normalizeForItem = (item: LessonItem, value: string): string =>
  item.kind === "key" ? normalizeKeyInput(value) : normalizePinyin(value);

const getExpected = (item = getItem()): string =>
  item.kind === "key" ? normalizeKeyInput(item.answer) : normalizePinyin(item.answer);

const getProgressKey = (lessonId: string, itemId: string): string =>
  `${lessonId}:${itemId}`;

const createEmptyResult = (): ItemResult => ({
  appearances: 0,
  correct: 0,
  totalErrors: 0,
  lastErrors: 0
});

const ensureItemResult = (lessonId: string, itemId: string): ItemResult => {
  const key = getProgressKey(lessonId, itemId);
  state.results[key] ??= createEmptyResult();

  return state.results[key];
};

const recordAttempt = (isCorrect: boolean): void => {
  if (state.attemptRecorded) {
    return;
  }

  const lesson = getLesson();
  const item = getItem();
  const result = ensureItemResult(lesson.id, item.id);

  result.appearances += 1;
  result.correct += isCorrect ? 1 : 0;
  state.attemptRecorded = true;
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const renderTargetContent = (item: LessonItem): string =>
  item.kind === "key"
    ? `<span class="target-key">${escapeHtml(item.text)}</span>`
    : item.text
        .split("")
        .map((char) => `<span>${escapeHtml(char)}</span>`)
        .join("");

const renderTargetDisplay = (item: LessonItem): string => {
  const pinyin = item.pinyin?.filter(Boolean).join(" ");
  const classes = ["target-display", pinyin ? "has-pinyin" : ""]
    .filter(Boolean)
    .join(" ");

  return `
    <div class="${classes}">
      <div class="target-text ${item.kind === "key" ? "is-key" : ""}">
        ${renderTargetContent(item)}
      </div>
      ${
        pinyin
          ? `<div class="target-side-info">
              <div class="focus-label">${escapeHtml(item.focus)}</div>
              <div class="target-pinyin">${escapeHtml(pinyin)}</div>
            </div>`
          : ""
      }
    </div>
  `;
};

const renderProgressRail = (lesson: Lesson): string =>
  lesson.random || lesson.items.length > 80
    ? renderLargeProgress(lesson)
    : lesson.items
        .map((item, index) => {
          const key = getProgressKey(lesson.id, item.id);
          const result = state.results[key];
          const classes = [
            "rail-dot",
            index === state.itemIndex ? "active" : "",
            result?.appearances ? "done" : ""
          ]
            .filter(Boolean)
            .join(" ");
          const label = result?.appearances
            ? `练习 ${result.appearances} 次，正确 ${result.correct} 次`
            : `第 ${index + 1} 题`;

          return `<button class="${classes}" data-item-index="${index}" aria-label="${label}"></button>`;
        })
        .join("");

const renderLargeProgress = (lesson: Lesson): string => {
  const total = lesson.items.length;
  const unit = lesson.stage === "keyboard" ? "键" : "字";
  const itemProgress = Math.round(((state.itemIndex + 1) / total) * 1000) / 10;
  const stats = getCurrentLessonStats(lesson);
  const uniqueDoneCount = lesson.items.filter((item) => {
    const key = getProgressKey(lesson.id, item.id);
    return Boolean(state.results[key]?.appearances);
  }).length;
  const doneProgress = lesson.random
    ? stats.accuracyPercent
    : Math.round((uniqueDoneCount / total) * 1000) / 10;
  const progressText = lesson.random
    ? `随机 ${stats.accuracyText} 准确`
    : `第 ${state.itemIndex + 1}/${total} ${unit}`;

  return `
    <div
      class="large-progress"
      style="--item-progress: ${itemProgress}%; --done-progress: ${doneProgress}%"
    >
      <div class="large-progress-track">
        <span class="large-progress-done"></span>
        <span class="large-progress-current"></span>
      </div>
      <span class="large-progress-text">${progressText}</span>
    </div>
  `;
};

const renderExpectedTrack = (item: LessonItem): string => {
  const expected = getExpected(item);
  const input = normalizeForItem(item, state.input);
  const wrong = input.length > 0 && !expected.startsWith(input);

  return expected
    .split("")
    .map((char, index) => {
      let status = "";
      if (wrong && index === Math.max(0, input.length - 1)) {
        status = "wrong";
      } else if (index < input.length) {
        status = "done";
      } else if (index === input.length) {
        status = "next";
      }

      return `<span class="track-char ${status}">${escapeHtml(char)}</span>`;
    })
    .join("");
};

const renderStages = (): string =>
  STAGES.map((stage) => {
    const isActive = stage.id === state.activeStage;
    return `<button class="stage-tab ${
      isActive ? "active" : ""
    }" data-stage="${stage.id}">${escapeHtml(stage.title)}</button>`;
  }).join("");

const renderLessonList = (): string =>
  LESSONS.filter((lesson) => lesson.stage === state.activeStage)
    .map((lesson) => {
      const stats = getCurrentLessonStats(lesson);
      const isActive = lesson.id === state.activeLessonId;
      const countText =
        lesson.stage === "game" ? `${typingGame.score}分` : stats.accuracyText;
      const countAttribute =
        lesson.stage === "game" ? ` data-game-lesson-score` : "";

      return `
        <button class="lesson-row ${isActive ? "active" : ""}" data-lesson-id="${
          lesson.id
        }">
          <span>
            <strong>${escapeHtml(lesson.title)}</strong>
            <small>${escapeHtml(lesson.goal)}</small>
          </span>
          <span class="lesson-count"${countAttribute}>${escapeHtml(countText)}</span>
        </button>
      `;
    })
    .join("");

const getActiveKeys = (item: LessonItem): Set<string> => {
  const expected = getExpected(item);
  const input = normalizeForItem(item, state.input);
  const nextKey = expected.startsWith(input) ? expected[input.length] : "";
  return new Set([...(item.keys ?? []), nextKey].filter(Boolean));
};

const renderKeyboard = (item: LessonItem): string => {
  const activeKeys = getActiveKeys(item);
  const nextKey = getExpected(item)[normalizeForItem(item, state.input).length];

  return KEYBOARD_ROWS.map((row) => {
    const keys = row.keys
      .map((key) => {
        const classes = [
          "key-button",
          activeKeys.has(key) ? "target" : "",
          nextKey === key ? "next" : ""
        ]
          .filter(Boolean)
          .join(" ");

        return `<button class="${classes}" data-key="${key}" aria-label="输入 ${key.toUpperCase()}">${key.toUpperCase()}</button>`;
      })
      .join("");

    return `<div class="keyboard-row keyboard-row-${row.id}" style="--key-count: ${row.keys.length}">${keys}</div>`;
  }).join("");
};

const getCurrentLessonStats = (lesson: Lesson) => {
  const resultEntries = lesson.items
    .map((item) => state.results[getProgressKey(lesson.id, item.id)])
    .filter(
      (result): result is ItemResult =>
        Boolean(result) && result.appearances > 0
    );
  const appearances = resultEntries.reduce(
    (total, result) => total + result.appearances,
    0
  );
  const correct = resultEntries.reduce(
    (total, result) => total + result.correct,
    0
  );
  const accuracyText = `${correct}/${appearances}`;
  const accuracyPercent =
    appearances === 0 ? 0 : Math.round((correct / appearances) * 1000) / 10;

  return { appearances, correct, accuracyText, accuracyPercent };
};

const renderStats = (lesson: Lesson): string => {
  const stats = getCurrentLessonStats(lesson);

  return `
    <div class="stat">
      <span>${stats.appearances}次</span>
      <small>练习</small>
    </div>
    <div class="stat">
      <span>${stats.accuracyText}</span>
      <small>准确</small>
    </div>
  `;
};

const renderGameStats = (): string => `
  <div class="stat">
    <span data-game-score>${typingGame.score}</span>
    <small>得分</small>
  </div>
  <div class="stat">
    <span data-game-missed>${typingGame.missed}/${GAME_MAX_MISSES}</span>
    <small>漏掉</small>
  </div>
  <div class="stat">
    <span data-game-speed>${getGameSpeedLabel()}</span>
    <small>速度</small>
  </div>
`;

const renderTopbar = (subtitle: string, statsHtml: string): string => `
  <header class="topbar">
    <div class="brand">
      <span class="brand-mark">PY</span>
      <div>
        <h1>拼音打字乐园</h1>
        <p>${escapeHtml(subtitle)}</p>
      </div>
    </div>
    <div class="stats-strip">${statsHtml}</div>
  </header>
`;

const renderPrompt = (item: LessonItem, lesson: Lesson): string => {
  const input = normalizeForItem(item, state.input);
  const wrong = input.length > 0 && !getExpected(item).startsWith(input);
  const readyForNext = state.completed;

  return `
    <section class="practice-panel" aria-live="polite">
      <div class="practice-topline">
        <span class="stage-badge">${escapeHtml(
          STAGES.find((stage) => stage.id === lesson.stage)?.shortTitle ?? ""
        )}</span>
        <div class="rail">${renderProgressRail(lesson)}</div>
      </div>

      <div class="prompt-layout">
        <img class="map-art" src="/typing-map.svg" alt="" />
        <div class="target-area">
          ${
            item.pinyin
              ? ""
              : `<div class="focus-label">${escapeHtml(item.focus)}</div>`
          }
          ${renderTargetDisplay(item)}
        </div>
      </div>

      <div class="input-zone ${wrong ? "has-error" : ""}">
        <label class="input-label" for="typing-input">输入</label>
        <input
          id="typing-input"
          class="typing-input"
          value="${escapeHtml(state.input)}"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          ${readyForNext ? "disabled" : ""}
        />
        <div class="answer-track" aria-hidden="true">${renderExpectedTrack(item)}</div>
      </div>

      <div class="feedback-line ${wrong ? "warn" : readyForNext ? "done" : ""}">
        ${escapeHtml(state.feedback)}
      </div>

      <div class="keyboard" aria-label="屏幕键盘">${renderKeyboard(item)}</div>
    </section>
  `;
};

const renderTypingGamePanel = (): string => `
  <section class="practice-panel typing-game-panel" aria-label="打字游戏">
    <div class="typing-game-toolbar">
      <span class="game-badge">${typingGame.status === "over" ? "游戏结束" : "发射准备"}</span>
      <button class="game-reset-button" data-game-action="restart">重新开始</button>
    </div>
    <div class="typing-game-canvas-wrap">
      <canvas id="typing-game-canvas" aria-label="打字游戏画布"></canvas>
    </div>
  </section>
`;

function getGameSpeedFactor(): number {
  return 1 + Math.min(2.4, typingGame.score * 0.035);
}

function getGameSpeedLabel(): string {
  return `${getGameSpeedFactor().toFixed(1)}x`;
}

function labelGameKey(key: string): string {
  return /[a-z]/.test(key) ? key.toUpperCase() : key;
}

function normalizeGameKey(key: string): string {
  return key.length === 1 ? normalizeKeyInput(key) : "";
}

function isGameKey(key: string): boolean {
  return GAME_KEYS.includes(key);
}

function syncTypingGameHud(): void {
  document.querySelector("[data-game-score]")?.replaceChildren(
    String(typingGame.score)
  );
  document.querySelector("[data-game-missed]")?.replaceChildren(
    `${typingGame.missed}/${GAME_MAX_MISSES}`
  );
  document.querySelector("[data-game-speed]")?.replaceChildren(getGameSpeedLabel());
  document.querySelector("[data-game-lesson-score]")?.replaceChildren(
    `${typingGame.score}分`
  );
  document.querySelector(".game-badge")?.replaceChildren(
    typingGame.status === "over" ? "游戏结束" : "发射准备"
  );
}

function startTypingGameLoop(): void {
  if (gameAnimationFrame !== null) {
    return;
  }

  typingGame.lastTimestamp = 0;
  gameAnimationFrame = window.requestAnimationFrame(tickTypingGame);
}

function stopTypingGameLoop(): void {
  if (gameAnimationFrame === null) {
    return;
  }

  window.cancelAnimationFrame(gameAnimationFrame);
  gameAnimationFrame = null;
}

function getTypingGameContext():
  | {
      canvas: HTMLCanvasElement;
      ctx: CanvasRenderingContext2D;
      width: number;
      height: number;
    }
  | null {
  const canvas = document.querySelector<HTMLCanvasElement>("#typing-game-canvas");
  const ctx = canvas?.getContext("2d");

  if (!canvas || !ctx) {
    return null;
  }

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(320, rect.width);
  const height = Math.max(320, rect.height);
  const nextWidth = Math.round(width * dpr);
  const nextHeight = Math.round(height * dpr);

  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  return { canvas, ctx, width, height };
}

function tickTypingGame(timestamp: number): void {
  if (state.activeStage !== "game") {
    stopTypingGameLoop();
    return;
  }

  const context = getTypingGameContext();
  if (!context) {
    gameAnimationFrame = window.requestAnimationFrame(tickTypingGame);
    return;
  }

  const previousTimestamp = typingGame.lastTimestamp || timestamp;
  const delta = Math.min(0.05, (timestamp - previousTimestamp) / 1000);
  typingGame.lastTimestamp = timestamp;

  if (typingGame.status === "running") {
    updateTypingGame(delta, context.width, context.height);
  } else {
    updateTypingGameEffects(delta);
  }

  drawTypingGame(context.ctx, context.width, context.height, timestamp / 1000);
  syncTypingGameHud();
  gameAnimationFrame = window.requestAnimationFrame(tickTypingGame);
}

function updateTypingGame(delta: number, width: number, height: number): void {
  typingGame.spawnTimer += delta * 1000;

  if (typingGame.spawnTimer >= typingGame.nextSpawnDelay) {
    typingGame.spawnTimer = 0;
    typingGame.nextSpawnDelay = Math.max(
      GAME_MIN_SPAWN_DELAY,
      GAME_BASE_SPAWN_DELAY - typingGame.score * 18
    );
    spawnGameTarget(width);
  }

  const speedFactor = getGameSpeedFactor();
  typingGame.targets.forEach((target) => {
    target.y += target.speed * speedFactor * delta;
  });

  const missLine = height - 74;
  const remainingTargets: GameTarget[] = [];

  typingGame.targets.forEach((target) => {
    if (target.y > missLine) {
      typingGame.missed += 1;
      typingGame.effects.push({
        id: typingGame.nextId++,
        x: target.x,
        y: missLine,
        age: 0,
        text: "漏"
      });
      return;
    }

    remainingTargets.push(target);
  });

  typingGame.targets = remainingTargets;

  if (typingGame.missed >= GAME_MAX_MISSES) {
    typingGame.status = "over";
    typingGame.targets = [];
  }

  updateTypingGameEffects(delta);
}

function updateTypingGameEffects(delta: number): void {
  typingGame.bullets.forEach((bullet) => {
    bullet.age += delta * 1000;
  });
  typingGame.effects.forEach((effect) => {
    effect.age += delta * 1000;
  });
  typingGame.bullets = typingGame.bullets.filter(
    (bullet) => bullet.age < bullet.duration
  );
  typingGame.effects = typingGame.effects.filter((effect) => effect.age < 760);
}

function spawnGameTarget(width: number): void {
  const key = GAME_KEYS[Math.floor(Math.random() * GAME_KEYS.length)];
  const fruit = GAME_FRUITS[Math.floor(Math.random() * GAME_FRUITS.length)];
  const margin = 44;

  typingGame.targets.push({
    id: typingGame.nextId++,
    key,
    fruit,
    x: margin + Math.random() * Math.max(1, width - margin * 2),
    y: -42,
    speed: GAME_BASE_TARGET_SPEED + Math.random() * GAME_TARGET_SPEED_VARIANCE,
    size: 56,
    hue: Math.floor(Math.random() * 360),
    wobble: Math.random() * Math.PI * 2
  });
}

function handleTypingGameKey(rawKey: string): boolean {
  const key = normalizeGameKey(rawKey);

  if (!isGameKey(key)) {
    return false;
  }

  if (typingGame.status !== "running") {
    return true;
  }

  const target = typingGame.targets
    .filter((candidate) => candidate.key === key)
    .sort((a, b) => b.y - a.y)[0];

  if (!target) {
    return true;
  }

  const context = getTypingGameContext();
  const width = context?.width ?? 760;
  const height = context?.height ?? 520;

  typingGame.targets = typingGame.targets.filter(
    (candidate) => candidate.id !== target.id
  );
  typingGame.score += 1;
  typingGame.bullets.push({
    id: typingGame.nextId++,
    fromX: width / 2,
    fromY: height - 88,
    toX: target.x,
    toY: target.y,
    age: 0,
    duration: 360
  });
  typingGame.effects.push({
    id: typingGame.nextId++,
    x: target.x,
    y: target.y,
    age: 0,
    text: "+1"
  });
  syncTypingGameHud();

  return true;
}

function drawTypingGame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number
): void {
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#e8f7ff");
  sky.addColorStop(0.58, "#fff8e8");
  sky.addColorStop(1, "#e8f4ef");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  drawGameSky(ctx, width, height, time);
  drawGameTargets(ctx, time);
  drawGameBullets(ctx);
  drawGamePlane(ctx, width / 2, height - 42, time);
  drawGameEffects(ctx);

  if (typingGame.status === "over") {
    drawGameOver(ctx, width, height);
  }
}

function drawGameSky(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number
): void {
  ctx.save();
  ctx.globalAlpha = 0.42;
  ctx.fillStyle = "#ffffff";
  for (let index = 0; index < 8; index += 1) {
    const x = (index * 137 + time * 18) % (width + 120) - 60;
    const y = 36 + (index % 4) * 52;
    ctx.beginPath();
    ctx.ellipse(x, y, 34, 12, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 28, y + 2, 24, 9, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const starColors = ["#f2b84b", "#ffd86b", "#7f9fe8"];
  for (let index = 0; index < 12; index += 1) {
    const x = (index * 89 + time * 34) % width;
    const y = 28 + ((index * 47) % Math.max(80, height - 160));
    const radius = 5 + (index % 3) * 1.6;
    const alpha = 0.48 + Math.sin(time * 3 + index * 0.7) * 0.16;

    drawSkyStar(
      ctx,
      x,
      y,
      radius,
      time * 0.3 + index * 0.22,
      starColors[index % starColors.length],
      alpha
    );
  }
  ctx.restore();
}

function drawSkyStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  rotation: number,
  color: string,
  alpha: number
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(rotation);

  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 1.45);

  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.36, color);
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

  ctx.fillStyle = gradient;
  ctx.strokeStyle = "rgba(76, 111, 191, 0.28)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();

  for (let point = 0; point < 10; point += 1) {
    const angle = -Math.PI / 2 + (point * Math.PI) / 5;
    const pointRadius = point % 2 === 0 ? radius : radius * 0.46;
    const pointX = Math.cos(angle) * pointRadius;
    const pointY = Math.sin(angle) * pointRadius;

    if (point === 0) {
      ctx.moveTo(pointX, pointY);
    } else {
      ctx.lineTo(pointX, pointY);
    }
  }

  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawGameTargets(ctx: CanvasRenderingContext2D, time: number): void {
  typingGame.targets.forEach((target) => {
    const wobbleX = Math.sin(time * 2 + target.wobble) * 8;
    const x = target.x + wobbleX;
    const y = target.y;
    const tilt = Math.sin(time * 1.8 + target.wobble) * 0.08;
    const labelSize = Math.max(21, Math.round(target.size * 0.42));

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    ctx.shadowColor = "rgba(27, 36, 48, 0.18)";
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 6;
    drawGameFruit(ctx, target.fruit, target.size);

    ctx.shadowColor = "transparent";
    ctx.fillStyle = "rgba(255, 255, 255, 0.82)";
    ctx.strokeStyle = "rgba(27, 36, 48, 0.28)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 3, target.size * 0.31, target.size * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#1b2430";
    ctx.font = `900 ${labelSize}px Inter, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(labelGameKey(target.key), 0, 4);
    ctx.restore();
  });
}

function drawGameFruit(
  ctx: CanvasRenderingContext2D,
  fruit: GameFruit,
  size: number
): void {
  ctx.save();
  ctx.scale(size / 56, size / 56);

  switch (fruit) {
    case "apple":
      drawApple(ctx);
      break;
    case "orange":
      drawOrange(ctx);
      break;
    case "pear":
      drawPear(ctx);
      break;
    case "peach":
      drawPeach(ctx);
      break;
    case "grapes":
      drawGrapes(ctx);
      break;
    case "watermelon":
      drawWatermelon(ctx);
      break;
  }

  ctx.restore();
}

function drawLeaf(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.55);
  ctx.fillStyle = "#4f8f53";
  ctx.strokeStyle = "#1f5d35";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, 0, 9, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawApple(ctx: CanvasRenderingContext2D): void {
  const body = ctx.createLinearGradient(-22, -22, 22, 26);
  body.addColorStop(0, "#ff8a78");
  body.addColorStop(0.58, "#e84f45");
  body.addColorStop(1, "#b93034");

  ctx.fillStyle = body;
  ctx.strokeStyle = "#7f2630";
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(0, -19);
  ctx.bezierCurveTo(15, -31, 34, -16, 25, 9);
  ctx.bezierCurveTo(18, 28, 4, 31, 0, 23);
  ctx.bezierCurveTo(-4, 31, -18, 28, -25, 9);
  ctx.bezierCurveTo(-34, -16, -15, -31, 0, -19);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = "#6b3d20";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(1, -22);
  ctx.quadraticCurveTo(2, -31, 8, -35);
  ctx.stroke();
  drawLeaf(ctx, 15, -31);
}

function drawOrange(ctx: CanvasRenderingContext2D): void {
  const body = ctx.createRadialGradient(-9, -11, 4, 0, 0, 29);
  body.addColorStop(0, "#ffd56c");
  body.addColorStop(0.55, "#f29a2e");
  body.addColorStop(1, "#dc6d28");

  ctx.fillStyle = body;
  ctx.strokeStyle = "#b95223";
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.arc(0, 2, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "rgba(255, 244, 190, 0.6)";
  for (let index = 0; index < 9; index += 1) {
    const angle = (Math.PI * 2 * index) / 9;
    ctx.beginPath();
    ctx.arc(Math.cos(angle) * 16, 2 + Math.sin(angle) * 15, 1.7, 0, Math.PI * 2);
    ctx.fill();
  }
  drawLeaf(ctx, 11, -24);
}

function drawPear(ctx: CanvasRenderingContext2D): void {
  const body = ctx.createLinearGradient(-17, -25, 20, 30);
  body.addColorStop(0, "#e9f08b");
  body.addColorStop(0.58, "#b9d45b");
  body.addColorStop(1, "#77a846");

  ctx.fillStyle = body;
  ctx.strokeStyle = "#5a7d33";
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(0, -27);
  ctx.bezierCurveTo(17, -25, 16, -3, 13, 4);
  ctx.bezierCurveTo(31, 14, 20, 34, 0, 32);
  ctx.bezierCurveTo(-20, 34, -31, 14, -13, 4);
  ctx.bezierCurveTo(-16, -3, -17, -25, 0, -27);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = "#6b3d20";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(2, -27);
  ctx.lineTo(6, -35);
  ctx.stroke();
  drawLeaf(ctx, 15, -31);
}

function drawPeach(ctx: CanvasRenderingContext2D): void {
  const body = ctx.createLinearGradient(-23, -23, 24, 26);
  body.addColorStop(0, "#ffb18a");
  body.addColorStop(0.5, "#f47b6d");
  body.addColorStop(1, "#d95d7c");

  ctx.fillStyle = body;
  ctx.strokeStyle = "#b44a62";
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(0, -25);
  ctx.bezierCurveTo(28, -24, 34, 8, 13, 29);
  ctx.bezierCurveTo(6, 36, -6, 36, -13, 29);
  ctx.bezierCurveTo(-34, 8, -28, -24, 0, -25);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = "rgba(129, 45, 63, 0.48)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -17);
  ctx.bezierCurveTo(9, 1, 5, 19, 0, 27);
  ctx.stroke();
  drawLeaf(ctx, 12, -28);
}

function drawGrapes(ctx: CanvasRenderingContext2D): void {
  const grapes = [
    [-8, -18],
    [8, -18],
    [-18, -6],
    [0, -5],
    [18, -6],
    [-10, 8],
    [10, 8],
    [0, 20]
  ];

  ctx.strokeStyle = "#5b317f";
  ctx.lineWidth = 2.2;
  grapes.forEach(([x, y], index) => {
    const body = ctx.createRadialGradient(x - 4, y - 5, 2, x, y, 13);
    body.addColorStop(0, index % 2 === 0 ? "#d7a1ff" : "#be86f0");
    body.addColorStop(0.62, "#8d55c2");
    body.addColorStop(1, "#5d368c");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(x, y, 11.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });

  ctx.strokeStyle = "#6b3d20";
  ctx.lineWidth = 3.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, -25);
  ctx.quadraticCurveTo(1, -32, 9, -35);
  ctx.stroke();
  drawLeaf(ctx, 16, -31);
}

function drawWatermelon(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "#3c9f56";
  ctx.strokeStyle = "#1f5d35";
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(-29, 16);
  ctx.quadraticCurveTo(0, -29, 29, 16);
  ctx.quadraticCurveTo(0, 28, -29, 16);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#fdf3d7";
  ctx.beginPath();
  ctx.moveTo(-23, 14);
  ctx.quadraticCurveTo(0, -21, 23, 14);
  ctx.quadraticCurveTo(0, 22, -23, 14);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#ef5d67";
  ctx.beginPath();
  ctx.moveTo(-18, 12);
  ctx.quadraticCurveTo(0, -15, 18, 12);
  ctx.quadraticCurveTo(0, 18, -18, 12);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#4b1e2b";
  [[-7, 5], [0, 10], [8, 4]].forEach(([x, y]) => {
    ctx.beginPath();
    ctx.ellipse(x, y, 1.7, 3.2, 0.35, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawGameBullets(ctx: CanvasRenderingContext2D): void {
  typingGame.bullets.forEach((bullet) => {
    const rawProgress = Math.min(1, bullet.age / bullet.duration);
    const progress = 1 - (1 - rawProgress) ** 3;
    const tailProgress = Math.max(0, progress - 0.24);
    const x = bullet.fromX + (bullet.toX - bullet.fromX) * progress;
    const y = bullet.fromY + (bullet.toY - bullet.fromY) * progress;
    const tailX = bullet.fromX + (bullet.toX - bullet.fromX) * tailProgress;
    const tailY = bullet.fromY + (bullet.toY - bullet.fromY) * tailProgress;
    const beamGradient = ctx.createLinearGradient(tailX, tailY, x, y);

    ctx.save();
    beamGradient.addColorStop(0, "rgba(242, 184, 75, 0)");
    beamGradient.addColorStop(0.34, "rgba(255, 237, 151, 0.62)");
    beamGradient.addColorStop(1, "rgba(217, 93, 79, 0.96)");

    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(242, 184, 75, 0.68)";
    ctx.shadowBlur = 18;
    ctx.strokeStyle = beamGradient;
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(x, y);
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#fff5ba";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(x, y);
    ctx.stroke();

    const headGradient = ctx.createRadialGradient(x, y, 1, x, y, 16);
    headGradient.addColorStop(0, "#ffffff");
    headGradient.addColorStop(0.35, "#ffe071");
    headGradient.addColorStop(1, "rgba(217, 93, 79, 0)");
    ctx.fillStyle = headGradient;
    ctx.beginPath();
    ctx.arc(x, y, 16, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#d95d4f";
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fill();

    for (let index = 0; index < 3; index += 1) {
      const sparkProgress = Math.max(0, progress - 0.08 * index);
      const sparkX = bullet.fromX + (bullet.toX - bullet.fromX) * sparkProgress;
      const sparkY = bullet.fromY + (bullet.toY - bullet.fromY) * sparkProgress;

      ctx.globalAlpha = 0.55 - index * 0.12;
      ctx.fillStyle = index % 2 === 0 ? "#f2b84b" : "#ffffff";
      ctx.beginPath();
      ctx.arc(sparkX, sparkY, 2.4 - index * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }

    if (rawProgress < 0.38) {
      const flashProgress = rawProgress / 0.38;

      ctx.globalAlpha = 1 - flashProgress;
      ctx.fillStyle = "#fff5ba";
      ctx.beginPath();
      ctx.arc(bullet.fromX, bullet.fromY, 7 + flashProgress * 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#f2b84b";
      ctx.lineWidth = 2;
      for (let index = 0; index < 6; index += 1) {
        const angle = (Math.PI * 2 * index) / 6;
        const inner = 6 + flashProgress * 6;
        const outer = 16 + flashProgress * 18;

        ctx.beginPath();
        ctx.moveTo(
          bullet.fromX + Math.cos(angle) * inner,
          bullet.fromY + Math.sin(angle) * inner
        );
        ctx.lineTo(
          bullet.fromX + Math.cos(angle) * outer,
          bullet.fromY + Math.sin(angle) * outer
        );
        ctx.stroke();
      }
    }

    if (rawProgress > 0.72) {
      const ringProgress = (rawProgress - 0.72) / 0.28;
      ctx.globalAlpha = 1 - ringProgress;
      ctx.strokeStyle = "#f2b84b";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(bullet.toX, bullet.toY, 8 + ringProgress * 26, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  });
}

function drawGamePlane(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  time: number
): void {
  const bob = Math.sin(time * 4) * 2;
  const flame = 1 + Math.sin(time * 18) * 0.18;

  ctx.save();
  ctx.translate(x, y + bob);

  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "#1b2430";
  ctx.beginPath();
  ctx.ellipse(0, 36, 58, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.strokeStyle = "#1b2430";
  ctx.lineWidth = 3;

  ctx.fillStyle = "#4c6fbf";
  ctx.beginPath();
  ctx.moveTo(-12, -8);
  ctx.quadraticCurveTo(-46, 8, -64, 24);
  ctx.quadraticCurveTo(-32, 30, -10, 20);
  ctx.lineTo(-4, 7);
  ctx.closePath();
  ctx.moveTo(12, -8);
  ctx.quadraticCurveTo(46, 8, 64, 24);
  ctx.quadraticCurveTo(32, 30, 10, 20);
  ctx.lineTo(4, 7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#203040";
  ctx.beginPath();
  ctx.moveTo(-8, 18);
  ctx.lineTo(-32, 35);
  ctx.lineTo(-8, 30);
  ctx.closePath();
  ctx.moveTo(8, 18);
  ctx.lineTo(32, 35);
  ctx.lineTo(8, 30);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const bodyGradient = ctx.createLinearGradient(-16, -48, 16, 32);
  bodyGradient.addColorStop(0, "#f5fbff");
  bodyGradient.addColorStop(0.45, "#197c7a");
  bodyGradient.addColorStop(1, "#0f5f5d");
  ctx.fillStyle = bodyGradient;
  ctx.beginPath();
  ctx.moveTo(0, -58);
  ctx.bezierCurveTo(19, -31, 18, 12, 6, 33);
  ctx.lineTo(0, 39);
  ctx.lineTo(-6, 33);
  ctx.bezierCurveTo(-18, 12, -19, -31, 0, -58);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const cockpitGradient = ctx.createLinearGradient(0, -38, 0, -5);
  cockpitGradient.addColorStop(0, "#d8f5ff");
  cockpitGradient.addColorStop(1, "#4c6fbf");
  ctx.fillStyle = cockpitGradient;
  ctx.beginPath();
  ctx.ellipse(0, -23, 8, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.72)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-4, -38);
  ctx.quadraticCurveTo(0, -43, 4, -38);
  ctx.moveTo(0, -2);
  ctx.lineTo(0, 24);
  ctx.stroke();

  ctx.strokeStyle = "#1b2430";
  ctx.lineWidth = 3;
  ctx.fillStyle = "#f2b84b";
  ctx.beginPath();
  ctx.ellipse(-13, 15, 5, 9, 0, 0, Math.PI * 2);
  ctx.ellipse(13, 15, 5, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  const flameGradient = ctx.createLinearGradient(0, 28, 0, 58);
  flameGradient.addColorStop(0, "#fff5ba");
  flameGradient.addColorStop(0.48, "#f2b84b");
  flameGradient.addColorStop(1, "rgba(217, 93, 79, 0)");
  ctx.fillStyle = flameGradient;
  ctx.beginPath();
  ctx.moveTo(-8, 31);
  ctx.quadraticCurveTo(0, 44 + flame * 8, 8, 31);
  ctx.quadraticCurveTo(0, 40, -8, 31);
  ctx.fill();

  ctx.fillStyle = "#d95d4f";
  ctx.beginPath();
  ctx.arc(0, 34, 4 + Math.sin(time * 14) * 1.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawGameEffects(ctx: CanvasRenderingContext2D): void {
  typingGame.effects.forEach((effect) => {
    const progress = Math.min(1, effect.age / 760);

    ctx.save();
    ctx.globalAlpha = 1 - progress;
    ctx.fillStyle = effect.text === "漏" ? "#d95d4f" : "#4f8f53";
    ctx.font = "900 24px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(effect.text, effect.x, effect.y - progress * 28);
    ctx.strokeStyle = "#f2b84b";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(effect.x, effect.y, 14 + progress * 28, 0, Math.PI * 2);
    ctx.stroke();

    if (effect.text !== "漏") {
      ctx.strokeStyle = "#fff5ba";
      ctx.lineWidth = 2;
      for (let index = 0; index < 8; index += 1) {
        const angle = (Math.PI * 2 * index) / 8;
        const inner = 8 + progress * 18;
        const outer = 18 + progress * 34;

        ctx.beginPath();
        ctx.moveTo(
          effect.x + Math.cos(angle) * inner,
          effect.y + Math.sin(angle) * inner
        );
        ctx.lineTo(
          effect.x + Math.cos(angle) * outer,
          effect.y + Math.sin(angle) * outer
        );
        ctx.stroke();
      }
    }

    ctx.restore();
  });
}

function drawGameOver(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): void {
  ctx.save();
  ctx.fillStyle = "rgba(27, 36, 48, 0.72)";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "900 42px Inter, sans-serif";
  ctx.fillText("游戏结束", width / 2, height / 2 - 28);
  ctx.font = "900 24px Inter, sans-serif";
  ctx.fillText(`${typingGame.score} 分`, width / 2, height / 2 + 20);
  ctx.restore();
}

const render = (): void => {
  const lesson = getLesson();

  if (state.activeStage === "game") {
    app.innerHTML = `
      <div class="app-shell">
        ${renderTopbar(lesson.title, renderGameStats())}

        <main class="game-layout">
          <aside class="lesson-panel">
            <div class="stage-tabs">${renderStages()}</div>
            <div class="lesson-list">${renderLessonList()}</div>
          </aside>

          ${renderTypingGamePanel()}
        </main>
      </div>
    `;

    startTypingGameLoop();
    return;
  }

  stopTypingGameLoop();
  const item = getItem();

  app.innerHTML = `
    <div class="app-shell">
      ${renderTopbar(lesson.title, renderStats(lesson))}

      <main class="game-layout">
        <aside class="lesson-panel">
          <div class="stage-tabs">${renderStages()}</div>
          <div class="lesson-list">${renderLessonList()}</div>
        </aside>

        ${renderPrompt(item, lesson)}
      </main>
    </div>
  `;

  const input = document.querySelector<HTMLInputElement>("#typing-input");
  if (input && !state.completed) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
};

function clearStoredProgress(): void {
  try {
    LEGACY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Storage can be unavailable in restricted browser modes; in-memory state still resets.
  }
}

const setLesson = (lessonId: string): void => {
  const lesson = LESSONS.find((candidate) => candidate.id === lessonId);
  if (!lesson) {
    return;
  }

  clearAutoAdvance();
  state = {
    ...state,
    activeStage: lesson.stage,
    activeLessonId: lesson.id,
    itemIndex: getStartItemIndex(lesson),
    input: "",
    errors: 0,
    completed: false,
    attemptRecorded: false,
    feedback: "准备好了就开始。"
  };

  if (lesson.stage === "game") {
    typingGame = createTypingGameState();
  }

  render();
};

const setStage = (stage: LessonStage): void => {
  const nextLesson = LESSONS.find((lesson) => lesson.stage === stage);
  if (!nextLesson) {
    return;
  }

  clearAutoAdvance();
  state = {
    ...state,
    activeStage: stage,
    activeLessonId: nextLesson.id,
    itemIndex: getStartItemIndex(nextLesson),
    input: "",
    errors: 0,
    completed: false,
    attemptRecorded: false,
    feedback: "准备好了就开始。"
  };

  if (stage === "game") {
    typingGame = createTypingGameState();
  }

  render();
};

const goToItem = (index: number): void => {
  clearAutoAdvance();
  const lesson = getLesson();
  const bounded = Math.max(0, Math.min(index, lesson.items.length - 1));
  state = {
    ...state,
    itemIndex: bounded,
    input: "",
    errors: 0,
    completed: false,
    attemptRecorded: false,
    feedback: "准备好了就开始。"
  };

  render();
};

const completeItem = (): void => {
  const lesson = getLesson();
  const item = getItem();
  const result = ensureItemResult(lesson.id, item.id);

  recordAttempt(state.errors === 0);
  result.totalErrors += state.errors;
  result.lastErrors = state.errors;
  state.completed = true;
  state.feedback =
    state.errors === 0 ? "按得很稳，马上下一题。" : "已经完成，马上下一题。";
  scheduleAutoAdvance();
};

const updateInput = (value: string): void => {
  if (state.completed) {
    return;
  }

  const item = getItem();
  const expected = getExpected(item);
  const nextValue = item.kind === "key" ? value.slice(-1) : value;
  const normalized = normalizeForItem(item, nextValue);
  const wasWrong =
    state.input.length > 0 && !expected.startsWith(normalizeForItem(item, state.input));
  const isWrong = normalized.length > 0 && !expected.startsWith(normalized);

  state.input = nextValue;

  if (isWrong && !wasWrong) {
    state.errors += 1;
    recordAttempt(false);
  }

  if (normalized.length === 0) {
    state.feedback = "准备好了就开始。";
  } else if (isWrong) {
    state.feedback = "这个音还没对上。";
  } else if (normalized === expected) {
    completeItem();
  } else {
    state.feedback = "继续，保持按准。";
  }

  render();
};

const appendKey = (key: string): void => {
  const item = getItem();
  if (item.kind === "pinyin" && !/^[a-z]$/i.test(key)) {
    return;
  }

  if (item.kind === "key" && key.length !== 1) {
    return;
  }

  updateInput(item.kind === "key" ? key : `${state.input}${key.toLowerCase()}`);
};

const moveNext = (): void => {
  clearAutoAdvance();
  const lesson = getLesson();
  if (lesson.random) {
    goToItem(getRandomItemIndex(lesson, state.itemIndex));
    return;
  }

  if (state.itemIndex < lesson.items.length - 1) {
    goToItem(state.itemIndex + 1);
    return;
  }

  goToItem(0);
};

function getStartItemIndex(lesson: Lesson): number {
  return lesson.random ? getRandomItemIndex(lesson) : 0;
}

function getRandomItemIndex(lesson: Lesson, currentIndex = -1): number {
  if (lesson.items.length <= 1) {
    return 0;
  }

  const candidate = Math.floor(Math.random() * lesson.items.length);

  if (candidate !== currentIndex) {
    return candidate;
  }

  return (candidate + 1 + Math.floor(Math.random() * (lesson.items.length - 1))) %
    lesson.items.length;
}

function clearAutoAdvance(): void {
  if (autoAdvanceTimer === null) {
    return;
  }

  window.clearTimeout(autoAdvanceTimer);
  autoAdvanceTimer = null;
}

function scheduleAutoAdvance(): void {
  clearAutoAdvance();
  const lessonId = state.activeLessonId;
  const itemIndex = state.itemIndex;

  autoAdvanceTimer = window.setTimeout(() => {
    autoAdvanceTimer = null;

    if (
      state.activeLessonId !== lessonId ||
      state.itemIndex !== itemIndex ||
      !state.completed
    ) {
      return;
    }

    moveNext();
  }, AUTO_ADVANCE_DELAY_MS);
}

app.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.id !== "typing-input") {
    return;
  }
  updateInput(target.value);
});

app.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const keyButton = target.closest<HTMLButtonElement>("[data-key]");
  if (keyButton?.dataset.key) {
    appendKey(keyButton.dataset.key);
    return;
  }

  const stageButton = target.closest<HTMLButtonElement>("[data-stage]");
  if (stageButton?.dataset.stage) {
    setStage(stageButton.dataset.stage as LessonStage);
    return;
  }

  const lessonButton = target.closest<HTMLButtonElement>("[data-lesson-id]");
  if (lessonButton?.dataset.lessonId) {
    setLesson(lessonButton.dataset.lessonId);
    return;
  }

  const gameAction = target.closest<HTMLButtonElement>("[data-game-action]");
  if (gameAction?.dataset.gameAction === "restart") {
    resetTypingGame();
    return;
  }

  const itemButton = target.closest<HTMLButtonElement>("[data-item-index]");
  if (itemButton?.dataset.itemIndex) {
    goToItem(Number(itemButton.dataset.itemIndex));
    return;
  }

});

document.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey) {
    return;
  }

  if (state.activeStage === "game") {
    const handled = handleTypingGameKey(event.key);
    if (handled) {
      event.preventDefault();
    }
    return;
  }

  const target = event.target;
  if (target instanceof HTMLInputElement) {
    return;
  }

  if (state.completed) {
    return;
  }

  if (event.key === "Backspace") {
    event.preventDefault();
    updateInput(state.input.slice(0, -1));
    return;
  }

  if (/^[a-z]$/i.test(event.key) || (getItem().kind === "key" && event.key.length === 1)) {
    event.preventDefault();
    appendKey(event.key);
  }
});

render();
