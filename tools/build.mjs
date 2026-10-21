// Builds the game.
//   dist/          the installable web app (GitHub Pages)
//   dist-preview/  one HTML file for the Claude preview (no head tags, everything inline)
// Run: node tools/build.mjs
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const version = JSON.parse(read("package.json")).version;

const js = (await build({
  entryPoints: [new URL("src/main.js", root).pathname],
  bundle: true, minify: true, format: "iife", target: ["safari15", "chrome100"], write: false,
})).outputFiles[0].text;
const css = read("src/style.css");
const body = read("src/body.html");
const fonts = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bungee&family=Rubik:wght@400;600;700&display=swap">`;

// Web app.
rmSync(new URL("dist", root), { recursive: true, force: true });
mkdirSync(new URL("dist/icons", root), { recursive: true });
writeFileSync(new URL("dist/app.js", root), js);
writeFileSync(new URL("dist/style.css", root), css);
writeFileSync(new URL("dist/index.html", root), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<title>Hype Inc.</title>
<meta name="description" content="Spread your homemade soda across the world before MegaCorp copies it.">
<meta name="theme-color" content="#0a1424">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Hype Inc.">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon-192.png">
<link rel="apple-touch-icon" href="icons/icon-180.png">
${fonts}
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
writeFileSync(new URL("dist/sw.js", root), read("src/sw.js").replace("__VERSION__", version));
cpSync(new URL("src/manifest.webmanifest", root), new URL("dist/manifest.webmanifest", root));
if (existsSync(new URL("icons", root))) cpSync(new URL("icons", root), new URL("dist/icons", root), { recursive: true });
writeFileSync(new URL("dist/.nojekyll", root), "");

// Preview: one file.
mkdirSync(new URL("dist-preview", root), { recursive: true });
writeFileSync(new URL("dist-preview/index.html", root), `<title>Hype Inc.</title>
<meta name="claude:viewport-fit-sides" content="cover">
${fonts}
<style>
html{height:100%}
${css}
</style>
${body}
<script>
${js.replace(/<\/script/gi, "<\\/script")}
</script>
`);
console.log(`Built v${version}: dist/ and dist-preview/index.html (${Math.round(js.length / 1024)} KB js)`);
