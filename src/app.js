import { CATEGORIES, GROUPS } from "./categories.js";
import { createEngine, MAX_GUESSES } from "./engine.js";

const DAY_KEY = "crosscountry.day."; // + YYYY-MM-DD: that day's game, once a guess has been made
const TIME_ZONE = "Europe/Berlin"; // the day changes at midnight there, wherever you play

const $ = (id) => document.getElementById(id);
const load = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const save = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable: the game still works, it just forgets
  }
};
const normalize = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const pct = (p) => `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`;
// Answered cells are tinted like a relief map: lowlands for common answers, highlands for rare ones.
const tier = (p) => (p < 0.05 ? "rare" : p < 0.2 ? "mid" : "common");

const countries = await (await fetch("data/countries.json")).json();
const engine = createEngine(countries);
const byId = new Map(countries.map((c) => [c.id, c]));
// keys: full names and aliases. tails: the same names from each later word on,
// so "Turkey" finds "Republic of Turkey" and "Bissau" finds "Guinea-Bissau".
const searchIndex = countries.map((c) => {
  const names = [c.name, ...c.alt];
  const tails = names.flatMap((n) => {
    const words = n.split(/[\s,'-]+/).filter(Boolean);
    return words.slice(1).map((_, i) => normalize(words.slice(i + 1).join("")));
  });
  return { country: c, keys: names.map(normalize), tails: tails.filter((t) => t.length > 3) };
});

let game; // { board, cells: [countryId|null]*9, scores: [p|null]*9, guessesLeft, over }
let day; // YYYY-MM-DD of the board on screen; it is also the board's seed
let selected = null;
let match = null; // the one country the typed text identifies, if any

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date());
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const shiftDay = (d, by) => new Date(Date.parse(d) + by * 864e5).toISOString().slice(0, 10);
const formatDay = (d) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(d));

// A stored game can name categories that have since been removed; it is ignored then.
const playable = (g) => [...g.board.rows, ...g.board.cols].every((id) => engine.category(id));

// Every date has exactly one board. Looking at a day does not store anything;
// the game is saved from the first guess on.
function openDay(d) {
  day = isDay(d) && d <= today() ? d : today();
  const stored = load(DAY_KEY + day, null);
  if (stored && playable(stored)) {
    game = stored;
  } else {
    game = {
      board: engine.generateBoard(day),
      cells: Array(9).fill(null),
      scores: Array(9).fill(null),
      guessesLeft: MAX_GUESSES,
      over: false,
    };
  }
  selected = game.over ? null : game.cells.findIndex((c) => !c);
  const hash = day === today() ? "" : `#${day}`;
  if (location.hash !== hash) history.replaceState(null, "", hash || location.pathname);
  $("guess").value = "";
  updateMatch();
  setMessage("");
  render();
  // Not when embedded as a preview: focusing would pull the host page's keyboard and scroll.
  if (!game.over && window.self === window.top) $("guess").focus();
}

function persist() {
  save(DAY_KEY + day, game);
}

function cellCategories(i) {
  return [game.board.rows[Math.floor(i / 3)], game.board.cols[i % 3]];
}

function finishIfDone() {
  if (!game.over && (game.guessesLeft === 0 || game.cells.every(Boolean))) game.over = true;
}

function guess(country) {
  if (game.over || selected === null || game.cells[selected]) return;
  const i = selected;
  const [row, col] = cellCategories(i);
  const hit = engine.distribution(row, col).find((d) => d.country.id === country.id);
  game.guessesLeft--;
  if (hit) {
    game.cells[i] = country.id;
    game.scores[i] = hit.p;
    selected = game.cells.findIndex((c) => !c);
    if (selected === -1) selected = null;
    setMessage("");
  } else {
    setMessage(`${country.name} does not fit.`, true);
    shake(i);
  }
  finishIfDone();
  persist();
  render();
}

function totalScore() {
  return game.scores.reduce((sum, p) => sum + (p === null ? 100 : p * 100), 0);
}

function setMessage(text, wrong = false) {
  $("message").textContent = text;
  $("message").classList.toggle("wrong", wrong);
}

function shake(i) {
  requestAnimationFrame(() => {
    const el = document.querySelector(`.cell[data-i="${i}"]`);
    if (!el) return;
    el.classList.add("shake");
    setTimeout(() => el.classList.remove("shake"), 400); // not animationend: it never fires in a background tab
  });
}

function render() {
  const board = $("board");
  board.replaceChildren();
  const span = (className, textContent) => Object.assign(document.createElement("span"), { className, textContent });
  // Rows are lettered and columns numbered, like the grid references of a map index.
  const label = (text, ref) => {
    const el = Object.assign(document.createElement("div"), { className: "label" });
    if (ref) el.append(span("ref", ref), span("", text));
    return el;
  };
  board.append(label(""));
  game.board.cols.forEach((id, n) => board.append(label(engine.category(id).label, String(n + 1))));
  game.cells.forEach((countryId, i) => {
    if (i % 3 === 0) board.append(label(engine.category(game.board.rows[i / 3]).label, "ABC"[i / 3]));
    const cell = document.createElement("button");
    cell.className = "cell";
    cell.dataset.i = i;
    if (!countryId) cell.append(span("ref", `${"ABC"[Math.floor(i / 3)]} ${(i % 3) + 1}`));
    if (countryId) {
      const c = byId.get(countryId);
      cell.classList.add("filled", `tier-${tier(game.scores[i])}`);
      // Themes pick whether to show the name or the code.
      cell.append(span("emoji", c.emoji), span("name", c.name), span("code", c.id), span("pct", pct(game.scores[i])));
    }
    if (game.over) cell.classList.add("over");
    if (i === selected) cell.classList.add("selected");
    cell.addEventListener("click", () => selectCell(i));
    board.append(cell);
  });

  $("day").textContent = formatDay(day);
  $("next-day").disabled = day >= today();
  $("to-today").hidden = day >= today();
  $("share").hidden = !game.over;
  $("guesses").textContent = game.over ? "" : `${game.guessesLeft} guesses left`;
  $("score").textContent = game.over ? `Score ${totalScore().toFixed(1)}` : "";
  $("entry").hidden = game.over;
  $("give-up").hidden = game.over;
  if (game.over && !$("message").textContent) setMessage("Tap a cell to see every answer. Lower score is better.");
  renderAnswers();
}

function selectCell(i) {
  if (!game.over && game.cells[i]) return;
  selected = i;
  render();
  if (!game.over) $("guess").focus();
}

function renderAnswers() {
  const section = $("answers");
  section.hidden = !(game.over && selected !== null);
  if (section.hidden) return;
  const [row, col] = cellCategories(selected);
  const title = document.createElement("h2");
  title.textContent = `${engine.category(row).label} × ${engine.category(col).label}`;
  const list = document.createElement("ol");
  for (const { country, p } of engine.distribution(row, col)) {
    const li = document.createElement("li");
    if (game.cells[selected] === country.id) li.className = "mine";
    li.append(
      Object.assign(document.createElement("span"), { textContent: `${country.emoji} ${country.name}` }),
      Object.assign(document.createElement("span"), { textContent: pct(p) }),
    );
    list.append(li);
  }
  section.replaceChildren(title, list);
}

// Reverse incremental search: nothing is offered while the typed text could
// still mean several countries, so the input never hints at answers. A country
// completes once the text is a full name or alias, or a prefix only it has.
// Full names are tried before word tails, so "Guinea" means Guinea even though
// Papua New Guinea ends with it. The first test that matches anything decides.
function identify(q) {
  if (!q) return null;
  const used = new Set(game.cells.filter(Boolean));
  const open = searchIndex.filter((e) => !used.has(e.country.id));
  // Short aliases (UK, USA, DRC) only count when typed in full.
  const starts = (k) => k.length > 3 && k.startsWith(q);
  const tests = [
    (e) => e.keys.includes(q),
    (e) => e.keys.some(starts),
    (e) => e.tails.includes(q),
    (e) => e.tails.some(starts),
  ];
  for (const test of tests) {
    const hits = open.filter(test);
    if (hits.length) return hits.length === 1 ? hits[0].country : null;
  }
  return null;
}

function updateMatch() {
  match = identify(normalize($("guess").value));
  const ul = $("suggestions");
  ul.replaceChildren();
  if (!match) return;
  const li = Object.assign(document.createElement("li"), { className: "active", textContent: match.name });
  li.addEventListener("mousedown", (e) => {
    e.preventDefault();
    choose(match);
  });
  ul.append(li);
}

function choose(country) {
  if (selected === null) {
    setMessage("Pick a cell first.");
    return;
  }
  $("guess").value = "";
  updateMatch();
  guess(country);
}

// Arrow keys walk the selection to the next open cell in that direction.
function moveSelection(dRow, dCol) {
  if (game.over || selected === null) return;
  let row = Math.floor(selected / 3) + dRow, col = (selected % 3) + dCol;
  while (row >= 0 && row < 3 && col >= 0 && col < 3) {
    if (!game.cells[row * 3 + col]) {
      selected = row * 3 + col;
      render();
      return;
    }
    row += dRow;
    col += dCol;
  }
}

const ARROWS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
$("guess").addEventListener("input", updateMatch);
$("guess").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && match) {
    choose(match);
  } else if (ARROWS[e.key]) {
    // Left and right stay with the text cursor while something is typed.
    if (e.key.match(/Left|Right/) && $("guess").value) return;
    e.preventDefault();
    moveSelection(...ARROWS[e.key]);
  }
});

// Options
const THEME_KEY = "crosscountry.theme";
const THEMES = { atlas: "Atlas", terminal: "Terminal", swiss: "Swiss" };

function setTheme(id) {
  document.documentElement.dataset.theme = id;
  save(THEME_KEY, id);
  for (const input of $("themes").querySelectorAll("input")) input.checked = input.value === id;
}

for (const [id, name] of Object.entries(THEMES)) {
  const option = document.createElement("label");
  const input = Object.assign(document.createElement("input"), { type: "radio", name: "theme", value: id });
  input.addEventListener("change", () => setTheme(id));
  option.append(input, name);
  $("themes").append(option);
}
setTheme(document.documentElement.dataset.theme in THEMES ? document.documentElement.dataset.theme : "atlas");

const toggleOptions = (open) => {
  $("options").hidden = !open;
  $("gear").setAttribute("aria-expanded", String(open));
};
$("gear").addEventListener("click", () => toggleOptions($("options").hidden));
document.addEventListener("click", (e) => {
  if (!$("options").hidden && !e.target.closest("#options, #gear")) toggleOptions(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") toggleOptions(false);
});

$("give-up").addEventListener("click", () => {
  game.over = true;
  finishIfDone();
  persist();
  setMessage("");
  render();
});

$("prev-day").addEventListener("click", () => openDay(shiftDay(day, -1)));
$("next-day").addEventListener("click", () => openDay(shiftDay(day, 1)));
$("to-today").addEventListener("click", () => openDay(today()));
window.addEventListener("hashchange", () => openDay(location.hash.slice(1)));

// The shared result shows how rare each answer was, never which country it is.
function shareText() {
  const square = (p) => (p === null ? "⬜" : { common: "🟩", mid: "🟨", rare: "🟫" }[tier(p)]);
  const rows = [0, 3, 6].map((i) => game.scores.slice(i, i + 3).map(square).join(""));
  const filled = game.cells.filter(Boolean).length;
  const lines = [`Crosscountry ${day}`, `Score ${totalScore().toFixed(1)} · ${filled}/9`, ...rows, "🟩 common  🟨 under 20%  🟫 under 5%  ⬜ empty"];
  // A link to this day's board, unless the game is only running on this machine.
  if (!/(^|\.)localhost$|^127\.|^\[::1\]$/.test(location.hostname)) lines.push(`${location.origin}${location.pathname}#${day}`);
  return lines.join("\n");
}

$("share").addEventListener("click", async () => {
  const text = shareText();
  try {
    await navigator.clipboard.writeText(text);
    setMessage("Result copied to the clipboard.");
  } catch {
    setMessage(text); // clipboard unavailable: show it so it can be selected
  }
});

// Help: every criterion with the exact rule behind it, filtered as you type.
$("help-intro").textContent =
  `The game has ${countries.length} countries: the 193 UN members plus Vatican City, Palestine, Kosovo and Taiwan. ` +
  "Territories and dependencies are not included. A criterion is checked the same way for every guess; " +
  "where a fact is open to interpretation, the rule below says which reading the game uses. " +
  "A cell's percentage is the share of an imagined crowd that would give the same answer: countries that are well known " +
  "(by Wikipedia readership, economy and population) come to mind more, and so do countries that fit a criterion obviously, " +
  "rather than barely past a threshold, through a second continent, or through a small emblem on the flag.";

function renderHelp() {
  const words = $("help-search").value.toLowerCase().split(/\s+/).filter(Boolean);
  const list = $("help-list");
  list.replaceChildren();
  for (const [group, { title, how }] of Object.entries(GROUPS)) {
    const hits = CATEGORIES.filter((cat) => {
      if (cat.group !== group) return false;
      const text = `${cat.label} ${title} ${how ?? ""} ${cat.how ?? ""}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
    if (!hits.length) continue;
    list.append(Object.assign(document.createElement("h3"), { textContent: title }));
    if (how) list.append(Object.assign(document.createElement("p"), { className: "help-group", textContent: how }));
    for (const cat of hits) {
      const item = document.createElement("article");
      const head = document.createElement("header");
      head.append(
        Object.assign(document.createElement("strong"), { textContent: cat.label }),
        Object.assign(document.createElement("span"), { textContent: `${engine.count(cat.id)} of ${countries.length} countries` }),
      );
      item.append(head);
      if (cat.how) item.append(Object.assign(document.createElement("p"), { textContent: cat.how }));
      list.append(item);
    }
  }
  if (!list.children.length) list.append(Object.assign(document.createElement("p"), { className: "help-empty", textContent: "No criterion matches that search." }));
}

$("help-open").addEventListener("click", () => {
  $("help-search").value = "";
  renderHelp();
  $("help").showModal();
  $("help-list").scrollTop = 0;
});
$("help-close").addEventListener("click", () => $("help").close());
$("help").addEventListener("click", (e) => {
  if (e.target === $("help")) $("help").close(); // click on the backdrop
});
$("help").addEventListener("close", () => !game.over && $("guess").focus());
$("help-search").addEventListener("input", renderHelp);

// A date in the URL opens that day's board; otherwise today's.
openDay(location.hash.slice(1));
