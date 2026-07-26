/**
 * Automate Netlify Drop upload (anonymous free deploy).
 * Usage: node scripts/netlify-drop-deploy.cjs
 */
const puppeteer = require("puppeteer-core");
const path = require("node:path");
const fs = require("node:fs");

const zipPath = path.resolve("/Users/jonathan/Downloads/phl-apc-deploy.zip");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const outDir = path.resolve(__dirname, "..");

if (!fs.existsSync(zipPath)) {
  console.error("Missing zip:", zipPath);
  process.exit(1);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(180000);

  try {
    console.log("Opening Netlify Drop…");
    await page.goto("https://app.netlify.com/drop", { waitUntil: "networkidle2" });

    const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 60000 });
    console.log("Uploading", zipPath);
    await fileInput.uploadFile(zipPath);

    console.log("Waiting for deploy to finish…");
    const handle = await page.waitForFunction(() => {
      const anchors = [...document.querySelectorAll("a[href]")];
      const hit = anchors.find((a) => {
        const href = a.href || "";
        return (
          href.includes(".netlify.app") &&
          !href.includes("app.netlify.com") &&
          !href.includes("docs.netlify")
        );
      });
      if (hit) return hit.href;

      const text = document.body?.innerText || "";
      const m = text.match(/https:\/\/[a-z0-9-]+\.netlify\.app\/?/i);
      return m ? m[0] : null;
    }, { timeout: 180000 });

    const url = await handle.jsonValue();
    console.log("DEPLOY_URL=" + url);
    fs.writeFileSync(path.join(outDir, "DEPLOY_URL.txt"), String(url) + "\n");
  } catch (err) {
    const shot = path.join(outDir, "deploy-error.png");
    try { await page.screenshot({ path: shot, fullPage: true }); } catch {}
    console.error("Deploy failed:", err && err.message ? err.message : err);
    console.error("Screenshot:", shot);
    try { fs.writeFileSync(path.join(outDir, "deploy-error.html"), await page.content()); } catch {}
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
