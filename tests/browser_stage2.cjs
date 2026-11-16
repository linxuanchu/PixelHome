const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

(async () => {
  const [base, cameraFile, drone, extinguisher, outputDir] = process.argv.slice(2);
  const browser = await chromium.launch({
    channel: "msedge",
    args: [
      "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
      `--use-file-for-fake-video-capture=${cameraFile}`,
      "--enable-unsafe-swiftshader",
    ],
  });
  try {
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["camera"] });
    const page = await desktop.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(String(error)));
    await desktop.route("**/*", route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    await page.goto(base);
    await page.getByText("摄像头门禁", { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector("#room3dLayer canvas")?.width > 0);
    async function inspectCanvas(tab) {
      const canvas = tab.locator("#room3dLayer canvas");
      const box = await canvas.boundingBox();
      assert.ok(box.width > 200 && box.height > 130);
      const first = await canvas.screenshot();
      const { PNG } = require("pngjs");
      const pixels = PNG.sync.read(first).data;
      const palette = new Set();
      for (let i = 0; i < pixels.length; i += 64) palette.add(pixels.readUInt32BE(i));
      assert.ok(palette.size > 20, "3D canvas is blank");
      await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await tab.mouse.down();
      await tab.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 + 20, { steps: 6 });
      await tab.mouse.up();
      await tab.waitForTimeout(300);
      assert.notDeepEqual(await canvas.screenshot(), first, "3D scene did not respond");
    }
    await inspectCanvas(page);
    await page.screenshot({ path: path.join(outputDir, "desktop.png"), fullPage: true });
    await page.locator("#webcamButton").click();
    await page.waitForFunction(() => document.querySelector("#webcamVideo").videoWidth > 0);
    await page.locator("[data-enroll-person='1']").click();
    await page.getByText("人脸样本 1/5").waitFor();
    await page.locator("#cameraAccessButton").click();
    await page.getByText(/身份通过/).waitFor();
    await page.locator("#savePhotoButton").click();
    await page.getByText("照片已保存", { exact: true }).waitFor();
    const automatic = page.locator("#autoAccessToggle");
    const automated = page.waitForResponse(response => response.url().endsWith("/api/access/camera")
      && response.request().postDataJSON().automatic === true);
    await automatic.check();
    assert.equal((await (await automated).json()).status, "checked");
    const repeated = page.waitForResponse(response => response.url().endsWith("/api/access/camera")
      && response.request().postDataJSON().automatic === true);
    assert.equal((await (await repeated).json()).status, "waiting_for_clear");
    await automatic.uncheck();
    await page.locator("#savePhotoButton").click();
    await page.getByText("照片已保存", { exact: true }).waitFor();
    const saved = (await page.locator("#captureStatus").textContent()).trim();
    assert.ok(fs.existsSync(saved));
    assert.equal(fs.readFileSync(saved).subarray(0, 2).toString("hex"), "ffd8");
    await page.locator("#historyForm button").click();
    await page.waitForFunction(() => document.querySelector("#historyResults").children.length > 0);
    for (const [sample, label] of [[drone, "drone"], [extinguisher, "fire_extinguisher"]]) {
      await page.locator("#imageInput").setInputFiles(sample);
      await page.locator("#detectButton").click();
      await page.locator("#detectionLabels").getByText(label, { exact: false }).waitFor();
    }
    assert.deepEqual(errors, []);
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await mobile.route("**/*", route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    const phone = await mobile.newPage();
    await phone.goto(base);
    await phone.waitForFunction(() => document.querySelector("#room3dLayer canvas")?.width > 0);
    await inspectCanvas(phone);
    assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "mobile has horizontal overflow");
    await phone.screenshot({ path: path.join(outputDir, "mobile.png"), fullPage: true });
    console.log("Browser passed: local 3D, camera, enrollment, access, JPEG, history, YOLO, mobile");
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
