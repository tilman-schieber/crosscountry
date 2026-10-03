#!/usr/bin/env python3
"""Build data/countries.json, the single source of truth the game reads.

Sources, in order of trust:
  1. mledoze/countries      structural facts (region, borders, landlocked, area, languages, currencies)
  2. World Bank API         population, GDP per capita (most recent non-empty value)
  3. data/curated.json      small closed sets (memberships, monarchies, driving side) + overrides
  4. flag SVGs (mledoze)    rasterised, pixels bucketed into named colours
  5. Wikimedia pageviews    12 months of enwiki views = the "fame" prior for rarity
  6. Wikidata               population of each capital (city proper)
  7. Wikipedia              all-time Olympic medal table

Everything fetched is cached in data/raw/; delete a file there to refetch it.
Run: python3 data/build.py   (needs Pillow and rsvg-convert)
"""
import colorsys
import io
import json
import statistics
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

from tables import read_tables

HERE = Path(__file__).parent
RAW = HERE / "raw"
UA = "crosscountry-build/0.1 (personal hobby project)"
PAGEVIEW_RANGE = ("2025090100", "2026083100")

# Any colour covering >= FLAG_ANY of the flag counts, so stars, crescents and
# coats of arms are included. Colours below FLAG_MAIN are small details; they are
# written to the report so a wrong one can be settled in curated.json.
FLAG_MAIN = 0.03
FLAG_ANY = 0.005
FLAG_WIDTH = 480

SUBREGION_TO_CONTINENT = {
    "North America": "North America",
    "Central America": "North America",
    "Caribbean": "North America",
    "South America": "South America",
}


def fetch(url, cache_name, binary=False, pause=0.05):
    path = RAW / cache_name
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        for attempt in range(6):
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    path.write_bytes(r.read())
                break
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    raise
                if attempt == 5:
                    raise
                wait = int(e.headers.get("Retry-After") or 0) or 5 * (attempt + 1)
                print(f"  {cache_name}: HTTP {e.code}, waiting {wait}s", file=sys.stderr)
                time.sleep(wait)
            except OSError as e:  # transient network errors
                if attempt == 5:
                    raise
                print(f"  retry {cache_name}: {e}", file=sys.stderr)
                time.sleep(2 * (attempt + 1))
        time.sleep(pause)
    return path.read_bytes() if binary else path.read_text()


def world_bank(indicator):
    url = f"https://api.worldbank.org/v2/country/all/indicator/{indicator}?format=json&per_page=400&mrnev=1"
    rows = json.loads(fetch(url, f"wb_{indicator}.json"))[1]
    return {r["countryiso3code"]: (r["value"], r["date"]) for r in rows if r["value"] is not None}


def wikipedia_titles():
    query = """SELECT ?iso ?title WHERE { ?c wdt:P298 ?iso. ?a schema:about ?c;
      schema:isPartOf <https://en.wikipedia.org/>; schema:name ?title. }"""
    url = "https://query.wikidata.org/sparql?format=json&query=" + urllib.parse.quote(query)
    rows = json.loads(fetch(url, "wikidata_titles.json"))["results"]["bindings"]
    titles = {}
    for r in rows:
        titles.setdefault(r["iso"]["value"], []).append(r["title"]["value"])
    return titles


def capital_populations():
    """Largest city-proper population Wikidata has for any capital of each ISO code."""
    query = "SELECT ?iso ?pop WHERE { ?c wdt:P298 ?iso; wdt:P36 ?cap. ?cap wdt:P1082 ?pop. }"
    url = "https://query.wikidata.org/sparql?format=json&query=" + urllib.parse.quote(query)
    best = {}
    for r in json.loads(fetch(url, "wikidata_capital_pop.json"))["results"]["bindings"]:
        iso, pop = r["iso"]["value"], float(r["pop"]["value"])
        best[iso] = max(best.get(iso, 0), int(pop))
    return best


# Team names in the medal table that are not a country name or alias in mledoze.
OLYMPIC_NAMES = {"Chinese Taipei": "TWN", "Great Britain": "GBR", "Turkey": "TUR"}


def olympic_medals(chosen):
    """Combined summer + winter medal totals per country id; teams that no longer exist are ignored."""
    html = fetch("https://en.wikipedia.org/api/rest_v1/page/html/All-time_Olympic_Games_medal_table", "olympics.html")
    table = max((t for t in read_tables(html) if t and "Combined total" in t[0]), key=len)
    by_name = {}
    for c in chosen:
        for n in {c["name"]["common"], c["name"]["official"], *c.get("altSpellings", [])}:
            by_name.setdefault(n.lower(), c["cca3"])
    medals, unmatched = {}, []
    for row in table[2:]:
        name = row[0].split("(")[0].strip()
        if name == "Totals" or len(row) < 5:
            continue
        cid = OLYMPIC_NAMES.get(name) or by_name.get(name.lower())
        if cid:
            medals[cid] = int(row[-1].replace(",", ""))
        else:
            unmatched.append(name)
    return medals, unmatched


def pageviews(title):
    safe = urllib.parse.quote(title.replace(" ", "_"), safe="")
    url = ("https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/"
           f"all-access/user/{safe}/monthly/{PAGEVIEW_RANGE[0]}/{PAGEVIEW_RANGE[1]}")
    try:
        data = json.loads(fetch(url, f"pageviews/{safe}.json", pause=1.0))
    except urllib.error.HTTPError as e:
        if e.code != 404:  # only a missing article means "no views"
            raise
        return 0
    # Median month, not the sum: one news event should not make a country famous.
    return int(statistics.median([i["views"] for i in data.get("items", [])] or [0])) * 12


def classify_pixel(r, g, b):
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    h *= 360
    if v < 0.22:
        return "black"
    if s < 0.18:
        return "white" if v > 0.75 else None  # greys are not a flag colour
    if h < 14 or h >= 335:
        return "red"
    if h < 38:
        return "orange"
    if h < 68:
        return "yellow"
    if h < 180:  # teal greens (Mozambique) are still green; aquamarine (Bahamas) is blue
        return "green"
    if h < 265:
        return "blue"
    return None  # purple / pink: too rare to be a category


def flag_colors(cca3):
    svg = fetch(f"https://raw.githubusercontent.com/mledoze/countries/master/data/{cca3.lower()}.svg",
                f"flags/{cca3.lower()}.svg", binary=True)
    png = subprocess.run(["rsvg-convert", "-w", str(FLAG_WIDTH)], input=svg, capture_output=True, check=True).stdout
    img = Image.open(io.BytesIO(png)).convert("RGBA")
    width, height = img.size
    names = {}

    def name_of(pixel):
        if pixel not in names:
            r, g, b, a = pixel
            names[pixel] = classify_pixel(r, g, b) if a >= 128 else None
        return names[pixel]

    grid = [name_of(p) for p in img.get_flattened_data()]
    counts, total = {}, 0
    for y in range(1, height - 1):
        for x in range(1, width - 1):
            i = y * width + x
            name = grid[i]
            total += 1
            # Only pixels surrounded by their own colour count. Where two colours meet,
            # anti-aliasing blends them into a third (yellow on blue gives a green edge)
            # that is not on the flag.
            if name and grid[i - 1] == name and grid[i + 1] == name and grid[i - width] == name and grid[i + width] == name:
                counts[name] = counts.get(name, 0) + 1
    shares = {k: n / total for k, n in counts.items()}
    # A sliver of orange is gold shading next to yellow, not a colour of its own.
    if 0 < shares.get("orange", 0) < FLAG_MAIN:
        shares["yellow"] = shares.get("yellow", 0) + shares.pop("orange")
    return shares


def main():
    curated = json.loads((HERE / "curated.json").read_text())
    base = json.loads(fetch("https://raw.githubusercontent.com/mledoze/countries/master/countries.json",
                            "mledoze.json"))
    chosen = [c for c in base if c.get("unMember") or c["cca3"] in curated["extra_countries"]]
    ids = {c["cca3"] for c in chosen}

    problems = []
    for name, s in curated["sets"].items():
        members = s["members"]
        if len(set(members)) != s["expect"] or len(members) != len(set(members)):
            problems.append(f"curated set {name}: {len(set(members))} unique of {len(members)}, expected {s['expect']}")
        problems += [f"curated set {name}: unknown country {m}" for m in members if m not in ids]
    if problems:
        sys.exit("\n".join(problems))

    population = world_bank("SP.POP.TOTL")
    gdp_pc = world_bank("NY.GDP.PCAP.CD")
    urban = world_bank("SP.URB.TOTL.IN.ZS")
    over65 = world_bank("SP.POP.65UP.TO.ZS")
    forest = world_bank("AG.LND.FRST.ZS")
    density = world_bank("EN.POP.DNST")
    capital_pop = capital_populations()
    medals, unmatched_teams = olympic_medals(chosen)
    titles = wikipedia_titles()

    out, report = [], []
    report.append(f"olympic teams not matched to a current country: {', '.join(unmatched_teams)}")
    for c in sorted(chosen, key=lambda c: c["name"]["common"]):
        cid = c["cca3"]
        wb_id = "XKX" if cid == "UNK" else cid
        stats = curated["stat_overrides"].get(cid, {})
        pop = stats.get("population", population.get(wb_id, (None,))[0])
        gdp = stats.get("gdpPerCapita", gdp_pc.get(wb_id, (None,))[0])
        if pop is None:
            report.append(f"no population: {cid}")
        if gdp is None:
            report.append(f"no GDP per capita: {cid}")

        shares = flag_colors(cid)
        colors = sorted(k for k, v in shares.items() if v >= FLAG_ANY)
        main = sorted(k for k, v in shares.items() if v >= FLAG_MAIN)
        override = curated["flag_color_overrides"].get(cid)
        if override is not None:
            # A list names the colours; a map also gives each one's share of the flag.
            colors = sorted(override)
            if isinstance(override, dict):
                shares = dict(shares, **override)
        elif colors != main:
            minor = {k: round(shares[k], 3) for k in colors if k not in main}
            report.append(f"flag minor colours for {cid} ({c['name']['common']}): {minor}")

        # Wikidata's article for an ISO code is sometimes the wrong entity
        # (NLD -> "Kingdom of the Netherlands"), so also try the common name.
        candidates = {*titles.get(wb_id, []), *titles.get(cid, []), c["name"]["common"]}
        views = max(pageviews(t) for t in candidates)
        if not views:
            report.append(f"no pageviews: {cid}")

        names = {c["name"]["common"], c["name"]["official"], *c.get("altSpellings", [])}
        names = sorted(n for n in names if len(n) > 1 and n != c["name"]["common"])
        out.append({
            "id": cid,
            "name": c["name"]["common"],
            "alt": names,
            "emoji": c.get("flag", ""),
            # The dataset's single continent, plus the second one for countries that straddle two.
            # The dataset's continent first, then the second one for countries that straddle two.
            "continents": [SUBREGION_TO_CONTINENT.get(c["subregion"], c["region"]), *curated["second_continent"].get(cid, [])],
            "subregion": c["subregion"],
            "capital": (c.get("capital") or [""])[0],
            "borders": sorted(b for b in c.get("borders", []) if b in ids),
            "landlocked": bool(c.get("landlocked")),
            "area": c.get("area"),
            "population": pop,
            "gdpPerCapita": round(gdp) if gdp is not None else None,
            "urbanPct": stats.get("urbanPct", urban.get(wb_id, (None,))[0]),
            "over65Pct": stats.get("over65Pct", over65.get(wb_id, (None,))[0]),
            "forestPct": stats.get("forestPct", forest.get(wb_id, (None,))[0]),
            "density": stats.get("density", density.get(wb_id, (None,))[0]),
            "capitalPopulation": stats.get("capitalPopulation", capital_pop.get(wb_id) or capital_pop.get(cid)),
            "olympicMedals": medals.get(cid, 0),
            "languages": sorted(c.get("languages", {}).values()),
            "currencies": sorted(c.get("currencies", {}).keys()),
            "flagColors": colors,
            # Share of the flag each colour covers; a hand-corrected colour the count missed is given an emblem's share.
            "flagShares": {k: round(shares.get(k, 0.02), 4) for k in colors},
            "sets": sorted(k for k, s in curated["sets"].items() if cid in s["members"]),
            "views": views,
        })

    (HERE / "countries.json").write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    (HERE / "build-report.txt").write_text("\n".join(report) + "\n")
    print(f"wrote {len(out)} countries; {len(report)} notes in data/build-report.txt")


if __name__ == "__main__":
    main()
