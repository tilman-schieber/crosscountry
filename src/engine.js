import { CATEGORIES } from "./categories.js";

// Rarity model. A cell's score is the share of an imagined crowd that would give
// the same answer, then blended with your own past picks as if they were
// ALPHA-outweighed extra players.
//
// How well known a country is, from 0 to 1, is a weighted average of its rank
// among all countries for Wikipedia views, total GDP and population. Ranks, not
// raw values: a country ten times richer is not ten times more likely to be
// guessed, and no single outlier can swallow a cell.
//
// The chance that a country comes to mind is an S-curve of that score: the
// well-known countries are all about equally available (no cliff between
// Brazil and Bulgaria), while obscure ones fall away quickly, which is what
// makes a rare answer rare.
export const FAME_WEIGHTS = { views: 0.4, gdp: 0.4, population: 0.2 };
export const RECALL_MIDPOINT = 0.6; // fame score at which a country is recalled half as readily as the best known
export const RECALL_STEEPNESS = 6; // higher makes obscure countries rarer
export const ALPHA = 20; // how many of your own picks it takes to match the prior
export const MIN_ANSWERS = 3; // every cell must have at least this many valid answers
export const MAX_GUESSES = 10;
// Two categories are redundant when this share of the smaller one also fits the
// larger ("EU member" with "Uses the euro"); a board never contains such a pair.
export const MAX_OVERLAP = 0.85;

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// Can the nine cells be filled with nine different countries?
function hasDistinctFill(cellAnswers) {
  const order = cellAnswers.map((a, i) => i).sort((a, b) => cellAnswers[a].length - cellAnswers[b].length);
  const used = new Set();
  const place = (k) => {
    if (k === order.length) return true;
    for (const c of cellAnswers[order[k]]) {
      if (used.has(c.id)) continue;
      used.add(c.id);
      if (place(k + 1)) return true;
      used.delete(c.id);
    }
    return false;
  };
  return place(0);
}

export function createEngine(countries) {
  const matches = new Map(CATEGORIES.map((cat) => [cat.id, new Set(countries.filter(cat.test).map((c) => c.id))]));
  const usable = CATEGORIES.filter((cat) => matches.get(cat.id).size >= MIN_ANSWERS);
  const byId = new Map(CATEGORIES.map((cat) => [cat.id, cat]));
  // Rank of every country for one measure, as a share from 0 (lowest) to 1
  // (highest); null where the measure is unknown.
  const ranks = (measure) => {
    const values = countries.map(measure);
    const sorted = values.filter((v) => v != null).sort((a, b) => a - b);
    return new Map(countries.map((c, i) => [c.id, values[i] == null ? null : sorted.indexOf(values[i]) / (sorted.length - 1)]));
  };
  const rank = {
    views: ranks((c) => c.views),
    gdp: ranks((c) => (c.population && c.gdpPerCapita ? c.population * c.gdpPerCapita : null)),
    population: ranks((c) => c.population),
  };
  // Measures a country has no figure for are left out and the rest re-weighted.
  const fame = (c) => {
    let sum = 0, total = 0;
    for (const [key, w] of Object.entries(FAME_WEIGHTS)) {
      const r = rank[key].get(c.id);
      if (r != null) (sum += r * w), (total += w);
    }
    return total ? sum / total : 0;
  };
  const recall = (c) => 1 / (1 + Math.exp(-RECALL_STEEPNESS * (fame(c) - RECALL_MIDPOINT)));
  const weight = new Map(countries.map((c) => [c.id, recall(c)]));

  const overlap = (a, b) => {
    const A = matches.get(a.id), B = matches.get(b.id);
    let both = 0;
    for (const id of A) if (B.has(id)) both++;
    return both / Math.min(A.size, B.size);
  };
  const redundant = new Set();
  for (const a of usable) for (const b of usable) if (a !== b && overlap(a, b) >= MAX_OVERLAP) redundant.add(`${a.id}|${b.id}`);

  const answers = (rowId, colId) => {
    const a = matches.get(rowId), b = matches.get(colId);
    return countries.filter((c) => a.has(c.id) && b.has(c.id));
  };

  // Same seed + same data always yields the same board.
  function generateBoard(seed) {
    const rand = mulberry32(hashString(String(seed)));
    for (let attempt = 0; attempt < 5000; attempt++) {
      const picked = [];
      const groups = {};
      while (picked.length < 6) {
        const cat = usable[Math.floor(rand() * usable.length)];
        if (picked.includes(cat) || (groups[cat.group] || 0) >= 2) continue;
        if (picked.some((p) => redundant.has(`${p.id}|${cat.id}`))) continue;
        groups[cat.group] = (groups[cat.group] || 0) + 1;
        picked.push(cat);
      }
      const rows = picked.slice(0, 3), cols = picked.slice(3);
      const cells = rows.flatMap((r) => cols.map((c) => answers(r.id, c.id)));
      if (cells.some((a) => a.length < MIN_ANSWERS)) continue;
      if (!hasDistinctFill(cells)) continue;
      return { seed: String(seed), rows: rows.map((c) => c.id), cols: cols.map((c) => c.id) };
    }
    throw new Error("could not generate a board");
  }

  // Probability (0..1) for every valid answer of a cell, most likely first.
  // `counts` maps country id -> how often you have picked it on earlier boards.
  function distribution(rowId, colId, counts = {}) {
    const valid = answers(rowId, colId);
    const totalWeight = valid.reduce((s, c) => s + weight.get(c.id), 0);
    const totalCount = valid.reduce((s, c) => s + (counts[c.id] || 0), 0);
    return valid
      .map((c) => ({
        country: c,
        p: (ALPHA * (weight.get(c.id) / totalWeight) + (counts[c.id] || 0)) / (ALPHA + totalCount),
      }))
      .sort((a, b) => b.p - a.p);
  }

  return { generateBoard, distribution, answers, category: (id) => byId.get(id), count: (id) => matches.get(id).size, usable, redundant };
}
