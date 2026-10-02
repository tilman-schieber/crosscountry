// Every category is a predicate over one country record from data/countries.json.
// `group` keeps boards varied: the generator allows at most two categories per group.
// `how` is the player-facing explanation shown in the help dialog; keep it in
// step with `test` and with how data/build.py derives the field.

const M = 1e6;

const has = (v) => v !== null && v !== undefined;
const startsWith = (letter) => (c) => c.name.toUpperCase().startsWith(letter);

const WORLD_BANK = "World Bank, latest year available";

// Rules shared by a whole group are explained once, under the group's heading.
export const GROUPS = {
  continent: {
    title: "Continent",
    how:
      "A country with territory on two continents counts for both. The Europe–Asia line is read generously around the Caucasus and the eastern Mediterranean. " +
      "Overseas territories do not count.",
  },
  flag: {
    title: "Flag",
    how:
      "Each flag is drawn at 480 pixels wide and every pixel is sorted into red, orange, yellow, green, blue, white or black. " +
      "Pixels on the edge between two colours are skipped, because they blend into a colour that is not on the flag. " +
      "A colour counts if it covers at least 0.5% of the flag, so stars, crescents and coats of arms count. " +
      "Dark reds and maroons are red, gold is yellow, light and dark blues are blue. Teal counts as green, aquamarine as blue. Grey, purple and pink are ignored. " +
      "A few flags are corrected by hand where the count misses a fine or pale emblem. " +
      "Emblems always count.",
  },
  borders: {
    title: "Borders",
    how:
      "Land borders between the 197 countries in the game. Overseas territories do not count (France does not border Brazil), " +
      "but exclaves do (Spain borders Morocco at Ceuta and Melilla). Bridges, tunnels and sea borders do not count.",
  },
  size: { title: "Size" },
  wealth: {
    title: "Wealth",
    how:
      `GDP per person in current US dollars, not adjusted for prices. Source: ${WORLD_BANK}. ` +
      "Taiwan and North Korea use rough figures entered by hand.",
  },
  people: {
    title: "People",
    how:
      "City share is the part of the population living in urban areas, as each country's own statistics office defines them. " +
      `Density is residents divided by land area. Both from the ${WORLD_BANK}.`,
  },
  land: { title: "Land" },
  sport: {
    title: "Sport",
    how:
      "Medal counts add Summer and Winter Games and all medal colours, from Wikipedia's all-time medal table. " +
      "Only medals won under the country's own name count. Medals of teams that no longer exist are left out: " +
      "the Soviet Union, the Unified Team and the Russian Olympic Committee are not added to Russia, " +
      "East and West Germany are not added to Germany, and Yugoslavia and Czechoslovakia are not passed on to their successors.",
  },
  language: {
    title: "Language",
    how:
      "The language is listed as official or national in the mledoze/countries dataset. " +
      "Languages that are official in practice count too (English in the United States). Widely spoken but unofficial languages do not.",
  },
  currency: {
    title: "Currency",
    how: "Counts any currency the mledoze/countries dataset lists as in official use, including a second currency used alongside the country's own.",
  },
  name: { title: "Name", how: "Uses the name the game shows when a guess completes, which can differ from other spellings (Ivory Coast rather than Côte d'Ivoire)." },
  org: { title: "Organisations" },
  state: { title: "State" },
  history: { title: "History" },
  misc: { title: "Other" },
};

const CONTINENT_NOTES = {
  Africa: "",
  Asia: "",
  Europe: "",
  "North America": "Includes Central America and the Caribbean.",
  "South America": "The mainland only; no Caribbean islands.",
  Oceania: "Australia, New Zealand and the Pacific islands, including countries that straddle the line to Asia.",
};
const continents = Object.entries(CONTINENT_NOTES).map(([name, note]) => ({
  id: `continent:${name}`,
  label: name,
  group: "continent",
  how: note,
  test: (c) => c.continents.includes(name),
}));

const flagColors = ["red", "blue", "green", "yellow", "white", "black", "orange"].map((color) => ({
  id: `flag:${color}`,
  label: `Flag has ${color}`,
  group: "flag",
  how: color === "orange" ? "Orange only counts when it covers at least 3% of the flag; a smaller amount is treated as yellow." : "",
  test: (c) => c.flagColors.includes(color),
}));

const flagOther = [
  {
    id: "flag:no-red",
    label: "Flag without red",
    group: "flag",
    how: `No red anywhere on the flag, not even in a small emblem.`,
    test: (c) => !c.flagColors.includes("red"),
  },
  {
    id: "flag:two",
    label: "Flag has exactly 2 colours",
    group: "flag",
    how: "Exactly two colours, counting every detail, so an emblem in a third colour disqualifies.",
    test: (c) => c.flagColors.length === 2,
  },
  {
    id: "flag:rwb",
    label: "Flag is only red, white and blue",
    group: "flag",
    how: "All three colours present and no other, counting every detail, so an emblem in a fourth colour disqualifies.",
    test: (c) => c.flagColors.join() === "blue,red,white",
  },
  {
    id: "flag:four-plus",
    label: "Flag has 4+ colours",
    group: "flag",
    how: `Four or more different colours, counting every detail.`,
    test: (c) => c.flagColors.length >= 4,
  },
];

const NEIGHBOURS = { CHN: "China", RUS: "Russia", BRA: "Brazil", DEU: "Germany", FRA: "France", IND: "India", SAU: "Saudi Arabia", COD: "DR Congo", TUR: "Turkey" };
const bordersCountry = Object.entries(NEIGHBOURS).map(([id, name]) => ({
  id: `borders:${id}`,
  label: `Borders ${name}`,
  group: "borders",
  test: (c) => c.borders.includes(id),
}));

const borders = [
  {
    id: "landlocked",
    label: "Landlocked",
    group: "borders",
    how: "Has no coast on an ocean or a sea connected to one. A shore on the Caspian Sea does not count as a coast.",
    test: (c) => c.landlocked,
  },
  {
    id: "borders:none",
    label: "No land borders",
    group: "borders",
    how: `Borders none of the other countries by land. This is not the same as being an island: an island can be shared, and a continent-sized country can have no neighbours.`,
    test: (c) => c.borders.length === 0,
  },
  {
    id: "borders:one",
    label: "Exactly 1 land neighbour",
    group: "borders",
    how: `Borders exactly one other country by land.`,
    test: (c) => c.borders.length === 1,
  },
  {
    id: "borders:5plus",
    label: "5+ land neighbours",
    group: "borders",
    how: `Borders five or more other countries by land.`,
    test: (c) => c.borders.length >= 5,
  },
];

const size = [
  {
    id: "area:big",
    label: "Area over 1M km²",
    group: "size",
    how: "Total area above 1,000,000 km², as listed in the mledoze/countries dataset. Overseas territories are not included.",
    test: (c) => c.area > 1e6,
  },
  {
    id: "area:small",
    label: "Area under 10,000 km²",
    group: "size",
    how: "Total area below 10,000 km², as listed in the mledoze/countries dataset.",
    test: (c) => c.area < 1e4,
  },
  {
    id: "pop:100m",
    label: "Population over 100M",
    group: "size",
    how: `More than 100 million residents. Source: ${WORLD_BANK} (2025 for nearly all countries). Taiwan and Vatican City use rounded figures entered by hand.`,
    test: (c) => has(c.population) && c.population > 100 * M,
  },
  {
    id: "pop:1m",
    label: "Population under 1M",
    group: "size",
    how: `Fewer than 1 million residents. Source: ${WORLD_BANK} (2025 for nearly all countries).`,
    test: (c) => has(c.population) && c.population < M,
  },
];

const wealth = [
  { id: "gdp:rich", label: "GDP per capita over $30k", group: "wealth", how: "Above $30,000.", test: (c) => has(c.gdpPerCapita) && c.gdpPerCapita > 30000 },
  { id: "gdp:poor", label: "GDP per capita under $2k", group: "wealth", how: "Below $2,000.", test: (c) => has(c.gdpPerCapita) && c.gdpPerCapita < 2000 },
];

const people = [
  { id: "urban:high", label: "Over 80% live in cities", group: "people", how: "City share above 80%.", test: (c) => has(c.urbanPct) && c.urbanPct > 80 },
  { id: "urban:low", label: "Under 35% live in cities", group: "people", how: "City share below 35%.", test: (c) => has(c.urbanPct) && c.urbanPct < 35 },
  {
    id: "age:65",
    label: "Over 15% of people are 65+",
    group: "people",
    how: `More than 15% of residents are aged 65 or older. Source: ${WORLD_BANK}.`,
    test: (c) => has(c.over65Pct) && c.over65Pct > 15,
  },
  { id: "density:high", label: "Over 300 people per km²", group: "people", how: "Density above 300.", test: (c) => has(c.density) && c.density > 300 },
  { id: "density:low", label: "Under 20 people per km²", group: "people", how: "Density below 20.", test: (c) => has(c.density) && c.density < 20 },
  {
    id: "capital:1m",
    label: "Capital city over 1M people",
    group: "people",
    how:
      "The capital itself has more than 1,000,000 residents, by the city-proper figure on Wikidata. The wider metro area does not count, " +
      "so a capital with a small core city does not qualify however large its agglomeration. Where a country has several capitals, the largest one is used.",
    test: (c) => c.capitalPopulation > 1e6,
  },
];

const land = [
  {
    id: "forest:half",
    label: "Over half covered by forest",
    group: "land",
    how: `Forest covers more than 50% of the land area. Source: ${WORLD_BANK} (2023 for nearly all countries).`,
    test: (c) => has(c.forestPct) && c.forestPct > 50,
  },
];

const sport = [
  { id: "olympic:10", label: "More than 10 Olympic medals", group: "sport", how: "Eleven or more medals.", test: (c) => c.olympicMedals > 10 },
  { id: "olympic:none", label: "Never won an Olympic medal", group: "sport", how: "Zero medals.", test: (c) => c.olympicMedals === 0 },
];

const languages = ["English", "French", "Spanish", "Arabic", "Portuguese"].map((lang) => ({
  id: `lang:${lang}`,
  label: `${lang} is an official language`,
  group: "language",
  test: (c) => c.languages.includes(lang),
}));

const currency = [
  {
    id: "cur:EUR",
    label: "Uses the euro",
    group: "currency",
    how: `Includes countries outside the EU that use it, and one African country the dataset lists as using it alongside other currencies.`,
    test: (c) => c.currencies.includes("EUR"),
  },
  {
    id: "cur:USD",
    label: "Uses the US dollar",
    group: "currency",
    how: `The United States and the countries that have adopted the dollar as an official currency.`,
    test: (c) => c.currencies.includes("USD"),
  },
];

const names = [
  ...["A", "B", "C", "G", "M", "N", "S", "T"].map((l) => ({
    id: `name:${l}`,
    label: `Name starts with ${l}`,
    group: "name",
    test: startsWith(l),
  })),
  { id: "name:ends-a", label: "Name ends with A", group: "name", test: (c) => c.name.toLowerCase().endsWith("a") },
  {
    id: "name:short",
    label: "Name has 5 letters or fewer",
    group: "name",
    how: `Counts letters only; spaces and hyphens are ignored.`,
    test: (c) => c.name.replace(/[^\p{L}]/gu, "").length <= 5,
  },
  {
    id: "name:same-ends",
    label: "Name starts and ends with the same letter",
    group: "name",
    how: `First and last letter of the whole name match, ignoring case.`,
    test: (c) => c.name.length > 1 && c.name[0].toLowerCase() === c.name.at(-1).toLowerCase(),
  },
  {
    id: "name:two-words",
    label: "Name has 2+ words",
    group: "name",
    how: `The name contains a space or a hyphen, so hyphenated names count.`,
    test: (c) => /[\s-]/.test(c.name),
  },
  {
    id: "name:capital-same-letter",
    label: "Capital starts with same letter as country",
    group: "name",
    how:
      `The capital's English name and the country's name begin with the same letter. ` +
      "Where a country has several capitals, the first one listed in the dataset is used.",
    test: (c) => c.capital && c.capital[0].toUpperCase() === c.name[0].toUpperCase(),
  },
];

// Lists from data/curated.json: [label, group, how].
const SETS = {
  eu: ["EU member", "org", `The 27 current member states of the European Union.`],
  nato: ["NATO member", "org", `The 32 current members of NATO.`],
  commonwealth: ["Commonwealth member", "org", `The 56 current members of the Commonwealth of Nations.`],
  asean: ["ASEAN member", "org", `The 11 members of ASEAN, as of 2025.`],
  g20: ["G20 member", "org", `The 19 countries of the G20. The European Union and African Union are members but are not countries.`],
  arab_league: ["Arab League member", "org", `The 22 members of the Arab League.`],
  apec: ["APEC member", "org", `The 20 APEC members that are countries in the game; member economies that are not countries are skipped.`],
  monarchy: [
    "Monarchy",
    "state",
    `The head of state is a monarch: 43 countries. Includes the Commonwealth realms that share the British monarch, the co-principality in the Pyrenees and the papacy.`,
  ],
  nuclear_weapons: [
    "Has nuclear weapons",
    "state",
    `The nine states that possess their own nuclear weapons, including the one that has never confirmed it. Hosting another country's weapons does not count.`,
  ],
  drives_left: ["Drives on the left", "misc", `Traffic keeps to the left side of the road: 54 countries.`],
  tourism_top20: [
    "Top 20 in tourist arrivals",
    "misc",
    "The 20 countries with the most international tourist arrivals in 2024, by UN Tourism figures, compiled from memory rather than a complete ranking. " +
      `Territories that are not countries in the game are skipped. The first 17 places are clear; the last three are close calls.`,
  ],
  ussr: ["Was part of the USSR", "history", `The 15 former Soviet republics.`],
  ottoman: [
    "Was part of the Ottoman Empire",
    "history",
    "Any part of the modern country's territory was under Ottoman rule or vassalage at some time: 36 countries. Read generously, so brief or partial control counts; " +
      `sieges and raids do not.`,
  ],
  desert: [
    "Has a desert",
    "land",
    "Contains at least part of a named desert: 50 countries. Read generously, so small and semi-arid deserts count; " +
      `a few doubtful cases are left out.`,
  ],
  equator: [
    "On the equator",
    "land",
    `The equator crosses the country's land, or passes between its islands: 13 countries.`,
  ],
  olympics_host: [
    "Has hosted the Olympics",
    "sport",
    `A city in today's territory has hosted Summer or Winter Games: 23 countries. Games held under a predecessor state count for the country that holds the city now.`,
  ],
  world_cup_host: [
    "Has hosted the men's World Cup",
    "sport",
    `Hosted or co-hosted the men's FIFA World Cup from 1930 through 2026: 19 countries. A tournament hosted by a constituent country counts for its state.`,
  ],
};
const sets = Object.entries(SETS).map(([id, [label, group, how]]) => ({
  id: `set:${id}`,
  label,
  group,
  how,
  test: (c) => c.sets.includes(id),
}));

export const CATEGORIES = [
  ...continents, ...flagColors, ...flagOther, ...bordersCountry, ...borders,
  ...size, ...wealth, ...people, ...land, ...sport, ...languages, ...currency, ...names, ...sets,
];
