// Makes src/map-data.js: a dot grid of the world, each dot tagged with a region.
// Run: node tools/make-map.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { feature } from "topojson-client";
import { geoContains, geoCentroid } from "d3-geo";

const topo = JSON.parse(readFileSync(new URL("../node_modules/world-atlas/countries-110m.json", import.meta.url)));
const countries = feature(topo, topo.objects.countries).features;

// Region ids. The order must match REGIONS in src/game.js.
const NA = 0, CA = 1, SA = 2, WE = 3, EE = 4, ME = 5, NAF = 6, AF = 7, SAS = 8, EA = 9, SEA = 10, OC = 11;

const BY_NAME = {
  "Mexico": CA, "Greenland": NA, "Iceland": WE, "Russia": EE, "Turkey": ME,
  "Kazakhstan": EE, "Uzbekistan": EE, "Turkmenistan": EE, "Kyrgyzstan": EE, "Tajikistan": EE,
  "Afghanistan": SAS, "Myanmar": SEA, "Papua New Guinea": OC, "Sudan": NAF, "Cyprus": ME,
  "Georgia": EE, "Armenia": EE, "Azerbaijan": EE, "Mongolia": EA, "Taiwan": EA,
  "Norway": WE, "Sweden": WE, "Finland": WE, "Denmark": WE, "Austria": WE, "Italy": WE,
  "Slovenia": WE, "Czechia": EE, "Poland": EE, "Hungary": EE, "Croatia": EE, "Greece": EE,
  "Timor-Leste": SEA, "Solomon Is.": OC, "Vanuatu": OC, "Fiji": OC, "New Caledonia": OC,
};

function regionOf(f) {
  const name = f.properties.name;
  if (name === "Antarctica" || name === "Fr. S. Antarctic Lands") return -1;
  if (name in BY_NAME) return BY_NAME[name];
  const [lon, lat] = geoCentroid(f);
  if (lon < -30) return lat >= 25 ? NA : lat >= 7 ? CA : SA;
  if (lat > 36 && lon < 45) return lon < 16 ? WE : EE;
  if (lon < 52 && lat < 36 && !(lon >= 34 && lat > 12)) return lat > 17 ? NAF : AF;
  if (lon >= 34 && lon < 63 && lat > 12 && lat < 42) return ME;
  if (lon >= 60 && lon < 92 && lat < 37) return SAS;
  if (lon >= 92 && lat > 20) return EA;
  if (lon >= 92 && lat > -11) return SEA;
  if (lon > 110 && lat <= -11) return OC;
  if (lat > 45) return EE;
  return -1;
}

const regions = countries.map(regionOf);
const unknown = countries.filter((f, i) => regions[i] === -1).map((f) => f.properties.name);
console.log("No region:", unknown.join(", "));

const STEP = 2.2;
const LAT_TOP = 82, LAT_BOTTOM = -56;
const cols = Math.round(360 / STEP);
const rows = Math.round((LAT_TOP - LAT_BOTTOM) / STEP);
const dots = [];
for (let r = 0; r < rows; r++) {
  const lat = LAT_TOP - r * STEP;
  const shift = r % 2 ? STEP / 2 : 0;
  for (let c = 0; c < cols; c++) {
    const lon = -180 + c * STEP + shift;
    for (let i = 0; i < countries.length; i++) {
      if (regions[i] < 0) continue;
      if (geoContains(countries[i], [lon, lat])) { dots.push(c, r, regions[i]); break; }
    }
  }
}
const counts = new Array(12).fill(0);
for (let i = 2; i < dots.length; i += 3) counts[dots[i]]++;
console.log("Dots:", dots.length / 3, "per region:", counts.join(" "));

writeFileSync(new URL("../src/map-data.js", import.meta.url),
  `// Made by tools/make-map.mjs from world-atlas (Natural Earth). Do not edit.\n` +
  `export const MAP = {cols:${cols},rows:${rows},dots:[${dots.join(",")}]};\n`);
