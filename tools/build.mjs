// Builds the game.
//   dist/          the installable web app (GitHub Pages)
//   dist-preview/  one HTML file for the Claude preview (no head tags, everything inline)
// Run: node tools/build.mjs
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, readdirSync, statSync } from "node:fs";

function listFiles(dir, prefix = "") {
  return readdirSync(dir).flatMap((f) => statSync(dir + f).isDirectory() ? listFiles(`${dir}${f}/`, `${prefix}${f}/`) : [prefix + f]);
}

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const version = JSON.parse(read("package.json")).version;

const js = (await build({
  entryPoints: [new URL("src/main.js", root).pathname],
  bundle: true, minify: true, format: "iife", target: ["safari15", "chrome100"], write: false,
})).outputFiles[0].text;
const css = read("src/style.css");
// The icon sprite goes inline at the top of the body, so <use href="#i-..."> works everywhere.
const body = read("src/body.html").replace("<!--SPRITE-->", read("src/art/sprite.svg").trim());

// Web app.
rmSync(new URL("dist", root), { recursive: true, force: true });
mkdirSync(new URL("dist", root), { recursive: true });
writeFileSync(new URL("dist/app.js", root), js);
writeFileSync(new URL("dist/style.css", root), css);
writeFileSync(new URL("dist/index.html", root), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<title>Hype Inc.</title>
<meta name="description" content="Grow your homemade product into a world brand before the big companies copy it.">
<meta name="theme-color" content="#0A1022">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Hype Inc.">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/favicon.svg" type="image/svg+xml">
<link rel="icon" href="icons/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="icons/apple-touch-icon-180.png">
<link rel="stylesheet" href="style.css?v=${version}">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);height:100%}</style>
</head>
<body>
${body}
<script src="app.js?v=${version}"></script>
<script>
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
</script>
</body>
</html>
`);
cpSync(new URL("public", root), new URL("dist", root), { recursive: true });
cpSync(new URL("src/manifest.webmanifest", root), new URL("dist/manifest.webmanifest", root));
// The service worker caches every file of the game, so it works offline.
const files = listFiles(new URL("dist/", root).pathname).filter((f) => !/^(sw\.js|\.nojekyll|icons\/app-icon-1024\.png)$/.test(f));
writeFileSync(new URL("dist/sw.js", root), read("src/sw.js").replaceAll("__VERSION__", version).replace("__FILES__", JSON.stringify(files)));
writeFileSync(new URL("dist/.nojekyll", root), "");

// Preview: one HTML file with the fonts inline. Sound files go next to it.
rmSync(new URL("dist-preview", root), { recursive: true, force: true });
mkdirSync(new URL("dist-preview", root), { recursive: true });
cpSync(new URL("public/sound", root), new URL("dist-preview/sound", root), { recursive: true });
const inlineFonts = (text) => text.replace(/url\("fonts\/([^"]+)"\)/g, (_, f) =>
  `url("data:font/woff2;base64,${readFileSync(new URL(`public/fonts/${f}`, root)).toString("base64")}")`);
writeFileSync(new URL("dist-preview/index.html", root), `<title>Hype Inc.</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
html{height:100%}
${inlineFonts(css)}
</style>
${body}
<script>
${js.replace(/<\/script/gi, "<\\/script")}
</script>
`);
console.log(`Built v${version}: dist/ and dist-preview/index.html (${Math.round(js.length / 1024)} KB js)`);
