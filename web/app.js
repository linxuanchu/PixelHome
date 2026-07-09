const $ = (selector) => document.querySelector(selector);
const api = async (path, options = {}) => {
  const response = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  if (!response.ok) throw new Error((await response.json()).error || "请求失败");
  return response.json();
};
const post = (path, body) => api(path, { method: "POST", body: JSON.stringify(body) });
const patch = (path, body) => api(path, { method: "PATCH", body: JSON.stringify(body) });
const remove = (path) => api(path, { method: "DELETE" });
const stateText = (value) => ({ open: "已打开", closed: "已关闭" }[value] || value);
const esc = (value) => String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
let toastTimer;
let imageData = null;
let runtimeMode = 'demo';  // 从 /api/health 获取，未获取到时默认 demo
let webcamStream = null;   // 摄像头 MediaStream 引用
let continuousInterval = null;   // 实时检测定时器 ID
let continuousPending = false;   // 防止连续检测请求重叠
const CONTINUOUS_INTERVAL_MS = 800;  // 实时检测间隔（毫秒）

function toast(message) {
  const node = $("#toast"); node.textContent = message; node.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove("show"), 2400);
}

async function fetchMode() {
  try {
    const health = await api("/api/health");
    runtimeMode = health.mode || 'demo';
    updateDetectButtonState();
  } catch (_) { /* 保持默认 demo 模式 */ }
}

function updateDetectButtonState() {
  const btn = $("#detectButton");
  const needsImage = runtimeMode === 'yolo' || runtimeMode === 'specialized' || runtimeMode === 'hybrid';
  const hasImage = imageData || webcamStream;

  if (continuousInterval) {
    // 实时检测运行中：禁用单次检测按钮
    btn.disabled = true;
    btn.textContent = "⏳";
    btn.title = "实时检测运行中…";
    return;
  }

  if (needsImage && !hasImage) {
    btn.disabled = true;
    btn.title = "请先选择图片或开启摄像头";
  } else if (needsImage && webcamStream) {
    btn.disabled = false;
    btn.textContent = "📸";
    btn.title = "拍照识别";
  } else {
    btn.disabled = false;
    btn.textContent = "▶";
    btn.title = "运行识别";
  }
}

function renderHome(home) {
  $("#temperature").textContent = `${home.temperature} °C`;
  $("#sceneTemp").textContent = `${home.temperature}°`;
  $("#doorState").textContent = stateText(home.door);
  $("[data-device='door']").textContent = home.door === 'open' ? '关门' : '开门';
  $("#windowState").textContent = stateText(home.window);
  $("#lightState").textContent = `${home.light}%`;
  $("#lightOutput").textContent = `${home.light}%`; $("#lightSlider").value = home.light;
  $("#fanToggle").checked = home.fan;
  $("#sceneDoor").classList.toggle("open", home.door === "open");
  $("#sceneLamp").classList.toggle("on", home.light > 10);
  $("#sceneLamp").style.opacity = Math.max(.35, home.light / 100);
  $("#sceneFan").classList.toggle("on", home.fan);
}

function renderScore(score) {
  $("#homeScore").textContent = score.score;
  $("#homeScoreLabel").textContent = score.label;
  $("#homeScore").parentElement.title = score.reasons.join("；");
}

function renderPeople(people) {
  $("#peopleCount").textContent = people.length;
  $("#faceList").innerHTML = people.map(person => `
    <button class="face-card ${person.authorized ? "" : "denied"}" data-face="${person.face_key}">
      <span class="avatar">${esc(person.name.slice(0, 1))}</span><strong>${esc(person.name)}</strong>
      <span>${person.authorized ? "授权住户" : "未授权测试"}</span>
    </button>`).join("");
  document.querySelectorAll("[data-face]").forEach(button => button.addEventListener("click", () => recognize(button.dataset.face)));
}

function renderAdminPeople(people) {
  $("#adminPeople").innerHTML = people.map(person => `<div class="admin-row"><div><strong>${esc(person.name)}</strong><small>${esc(person.role)} · ${person.authorized ? "已授权" : "已停用"} · ${esc(person.face_key)}</small></div><div class="row-actions"><button data-edit-person="${person.id}" title="编辑">✎</button><button class="danger" data-delete-person="${person.id}" title="删除">×</button></div></div>`).join("");
  document.querySelectorAll("[data-edit-person]").forEach(button => button.addEventListener("click", () => openPersonForm(people.find(person => person.id === Number(button.dataset.editPerson)))));
  document.querySelectorAll("[data-delete-person]").forEach(button => button.addEventListener("click", () => deletePerson(Number(button.dataset.deletePerson))));
}

function renderSuspects(suspects) {
  const open = suspects.filter(item => item.status === "open");
  $("#suspectCount").textContent = open.length;
  $("#suspectList").innerHTML = open.length ? open.map(item => `<div class="admin-row"><div><strong>${esc(item.subject_key)}</strong><small>${item.failure_count} 次失败 · ${esc(item.last_seen_at)}</small></div><div class="row-actions"><button class="resolve" data-resolve="${esc(item.subject_key)}" title="标记已处理">✓</button></div></div>`).join("") : "<p class='section-note'>当前没有待处理告警</p>";
  document.querySelectorAll("[data-resolve]").forEach(button => button.addEventListener("click", async () => { await patch(`/api/admin/suspects/${encodeURIComponent(button.dataset.resolve)}`, {}); toast("可疑记录已处理"); refresh(); }));
}

function renderSettings(settings, storage) {
  $("#climateMode").value = settings["climate.mode"];
  $("#targetTemperature").value = settings["climate.target_temperature"];
  $("#hysteresis").value = settings["climate.hysteresis"];
  $("#retentionDays").value = settings["storage.retention_days"];
  $("#storageStats").innerHTML = `<span>遥测 ${storage.telemetry_rows}</span><span>事件 ${storage.event_rows}</span><span>识别 ${storage.detection_rows}</span><span>门禁 ${storage.access_rows}</span><span>${(storage.database_bytes / 1024).toFixed(1)} KB</span>`;
}

function renderEvents(events) {
  $("#eventList").innerHTML = events.length ? events.slice(0, 6).map(event => `
    <div class="event ${event.level}"><span class="event-dot"></span><p>${event.message}</p><time>${event.created_at.slice(11, 16)}</time></div>`).join("") : "<p>暂无系统动态</p>";
}

function renderChart(history) {
  const temperatures = history.filter(item => item.metric === "temperature").slice(-18);
  if (!temperatures.length) return;

  const values = temperatures.map(item => Number(item.value));
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);

  // 动态范围：数据跨度小于 2°C 时自动扩展，确保柱子有视觉差异
  const range = Math.max(dataMax - dataMin, 2.0);
  const pad = range * 0.25;                     // 上下各留 25% 余量
  const floor = dataMin - pad;
  const scale = 100 / (range + pad * 2);         // 总高度 100%

  $("#temperatureChart").innerHTML = temperatures.map(item => {
    const value = Number(item.value);
    const height = Math.max(8, Math.min(100, (value - floor) * scale));
    // 当前值高亮标记
    const isLatest = item === temperatures[temperatures.length - 1];
    return `<i class="chart-bar${isLatest ? ' chart-bar-latest' : ''}" style="height:${height.toFixed(1)}%" data-value="${value}°C"></i>`;
  }).join("");
}

async function refresh() {
  try {
    const [dashboard, people, history, suspects, settings, storage] = await Promise.all([api("/api/dashboard"), api("/api/people"), api("/api/history?limit=80"), api("/api/admin/suspects"), api("/api/admin/settings"), api("/api/admin/storage")]);
    renderHome(dashboard.home); renderScore(dashboard.home_score); renderPeople(people); renderAdminPeople(people); renderSuspects(suspects); renderSettings(settings, storage); renderEvents(dashboard.events); renderChart(history);
    renderAlerts(dashboard.alerts || {});
    $("#connectionText").textContent = "模拟空间在线";
  } catch (error) { $("#connectionText").textContent = "连接中断"; toast(error.message); }
}

function openPersonForm(person = null) {
  $("#personForm").classList.remove("hidden");
  $("#personId").value = person?.id || "";
  $("#personName").value = person?.name || "";
  $("#personRole").value = person?.role || "resident";
  $("#personFaceKey").value = person?.face_key || "";
  $("#personAuthorized").checked = person ? Boolean(person.authorized) : true;
  $("#personName").focus();
}

function closePersonForm() { $("#personForm").classList.add("hidden"); $("#personForm").reset(); $("#personId").value = ""; }

async function savePerson(event) {
  event.preventDefault();
  const id = $("#personId").value;
  const payload = { name: $("#personName").value.trim(), role: $("#personRole").value, face_key: $("#personFaceKey").value.trim(), authorized: $("#personAuthorized").checked };
  try { id ? await patch(`/api/people/${id}`, payload) : await post("/api/people", payload); closePersonForm(); toast(id ? "人员信息已更新" : "授权人员已新增"); refresh(); }
  catch (error) { toast(error.message); }
}

async function deletePerson(id) {
  if (!window.confirm("删除后无法通过该身份开门，确认删除？")) return;
  try { await remove(`/api/people/${id}`); toast("人员已删除"); refresh(); } catch (error) { toast(error.message); }
}

async function command(payload) {
  try { const home = await post("/api/command", payload); renderHome(home); $("#commandStatus").textContent = "已执行"; toast("设备命令执行成功"); await refresh(); }
  catch (error) { toast(error.message); }
}

async function recognize(faceKey) {
  const resultNode = $("#accessResult"); resultNode.className = "access-result neutral"; resultNode.textContent = "识别中...";
  const result = await post("/api/access/recognize", { face_key: faceKey });
  resultNode.className = `access-result ${result.authorized ? "success" : "warning"}`;
  resultNode.textContent = result.authorized ? `识别通过 · ${result.person.name} · ${(result.confidence * 100).toFixed(0)}%` : "识别拒绝 · 未授权人员 · 已自动关门";
  if (!result.authorized) {
    await command({ device: "door", action: "close" });
  }
  await refresh();
}

async function detect(silent = false) {
  // 摄像头模式：先拍照再识别
  if (webcamStream) {
    imageData = captureFromWebcam();
    if (!imageData) {
      if (!silent) toast("摄像头拍照失败");
      return;
    }
    updateDetectButtonState();
  }

  // 非 demo 模式下需要先选择图片或开启摄像头
  if ((runtimeMode === 'yolo' || runtimeMode === 'specialized' || runtimeMode === 'hybrid') && !imageData) {
    if (!silent) toast("请先选择一张检测图片或开启摄像头");
    return;
  }
  try {
    const camera = $("#cameraView");
    if (!silent) camera.classList.add("scanning");
    const result = await post("/api/vision/detect", { source: imageData ? "browser-upload" : "demo-camera", image_data: imageData });
    setTimeout(() => { camera.classList.remove("scanning"); camera.classList.add("active"); camera.querySelector("p").textContent = `可信度 ${(result.confidence * 100).toFixed(0)}%`; }, 700);
    if (result.labels.length === 0) {
      $("#detectionLabels").innerHTML = '<span class="no-detection">未检测到目标</span>';
    } else {
      $("#detectionLabels").innerHTML = result.labels.map(label => {
        const conf = result.label_confidences?.[label];
        const confText = conf != null ? ` ${(conf * 100).toFixed(0)}%` : '';
        return `<span>${label}<small>${confText}</small></span>`;
      }).join("");
    }
    // 实时模式下静默刷新告警数据
    if (!silent) await refresh(); else await fetchAlerts();
  } catch (error) {
    if (!silent) toast("检测失败: " + error.message);
  }
}

// ── Detection alert signals ──
async function fetchAlerts() {
  try {
    const alerts = await api("/api/alerts");
    renderAlerts(alerts);
  } catch (_) { /* alerts unavailable (demo mode or server not ready) */ }
}

function renderAlerts(alerts) {
  const droneAlert = alerts["detection:drone"];
  const extinguisherAlert = alerts["detection:fire_extinguisher"];
  const hasAny = droneAlert || extinguisherAlert;
  $("#alertRow").classList.toggle("hidden", !hasAny);
  updateAlertButton($("#alertDrone"), $("#droneBadge"), droneAlert, "fired-drone");
  updateAlertButton($("#alertExtinguisher"), $("#extinguisherBadge"), extinguisherAlert, "fired");
}

function updateAlertButton(button, badge, alert, cssClass) {
  if (alert) {
    button.classList.add(cssClass);
    badge.textContent = `${(alert.confidence * 100).toFixed(0)}%`;
    button.title = `${alert.display_name} 已识别 · 可信度 ${(alert.confidence * 100).toFixed(0)}% · ${alert.fired_at}`;
  } else {
    button.classList.remove("fired", "fired-drone");
    badge.textContent = "—";
    button.title = button.dataset.alert === "detection:drone" ? "无人机检测信号" : "灭火器检测信号";
  }
}

async function acknowledgeAlert(eventType) {
  try {
    await post("/api/alerts/ack", { event_type: eventType });
    await fetchAlerts();
  } catch (_) { /* ignore */ }
}

$("#alertDrone").addEventListener("click", () => acknowledgeAlert("detection:drone"));
$("#alertExtinguisher").addEventListener("click", () => acknowledgeAlert("detection:fire_extinguisher"));

$("#refreshButton").addEventListener("click", refresh);
$("[data-device='door']").addEventListener("click", () => {
  const isOpen = $('#doorState').textContent === '已打开';
  command({ device: "door", action: isOpen ? "close" : "open" });
});
$("#fanToggle").addEventListener("change", event => command({ device: "fan", action: event.target.checked ? "on" : "off" }));
$("#lightSlider").addEventListener("input", event => $("#lightOutput").textContent = `${event.target.value}%`);
$("#lightSlider").addEventListener("change", event => command({ device: "light", value: Number(event.target.value) }));
$("#detectButton").addEventListener("click", detect);
$("#addPersonButton").addEventListener("click", () => openPersonForm());
$("#cancelPersonButton").addEventListener("click", closePersonForm);
$("#personForm").addEventListener("submit", savePerson);
$("#settingsForm").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    await patch("/api/admin/settings", { "climate.mode": $("#climateMode").value, "climate.target_temperature": Number($("#targetTemperature").value), "climate.hysteresis": Number($("#hysteresis").value), "storage.retention_days": Number($("#retentionDays").value) });
    toast("温控与存储策略已保存"); refresh();
  } catch (error) { toast(error.message); }
});
$("#cleanupButton").addEventListener("click", async () => {
  try { const result = await post("/api/admin/storage/cleanup", {}); toast(`清理完成，共删除 ${Object.values(result.deleted).reduce((sum, value) => sum + value, 0)} 条`); refresh(); }
  catch (error) { toast(error.message); }
});
$("#imageInput").addEventListener("change", event => {
  const file = event.target.files[0]; if (!file) return;
  // 如果摄像头开着，先关掉
  if (webcamStream) stopWebcam();
  const reader = new FileReader();
  reader.onload = () => { imageData = reader.result; const view = $("#cameraView"); view.style.backgroundImage = `url("${imageData}")`; view.style.backgroundSize = "contain"; view.style.backgroundPosition = "center"; view.style.backgroundRepeat = "no-repeat"; view.querySelector("p").textContent = file.name; updateDetectButtonState(); toast("图片已载入，可运行目标识别"); };
  reader.readAsDataURL(file);
});

// ── 摄像头控制 ──────────────────────────────────────────
async function startWebcam() {
  try {
    webcamStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "environment" }
    });
    const video = $("#webcamVideo");
    video.srcObject = webcamStream;
    video.style.display = "block";
    // 隐藏文件上传的背景图
    const view = $("#cameraView");
    view.style.backgroundImage = "none";
    view.querySelector("p").textContent = "摄像头实时预览";
    // 更新按钮状态
    $("#webcamButton").textContent = "🔴 关闭摄像头";
    $("#webcamButton").classList.add("active");
    $("#continuousButton").classList.remove("hidden");
    imageData = null;
    updateDetectButtonState();
    toast("摄像头已开启，可拍照或开启实时检测");
  } catch (error) {
    toast("无法访问摄像头: " + (error.name === "NotAllowedError" ? "请允许浏览器使用摄像头权限" : error.message));
    webcamStream = null;
  }
}

function stopWebcam() {
  stopContinuous();
  if (webcamStream) {
    webcamStream.getTracks().forEach(track => track.stop());
    webcamStream = null;
  }
  const video = $("#webcamVideo");
  video.srcObject = null;
  video.style.display = "none";
  const view = $("#cameraView");
  view.style.backgroundImage = "";
  view.querySelector("p").textContent = "等待摄像头画面";
  $("#webcamButton").textContent = "📷 开启摄像头";
  $("#webcamButton").classList.remove("active");
  $("#continuousButton").classList.add("hidden");
  imageData = null;
  updateDetectButtonState();
}

function captureFromWebcam() {
  const video = $("#webcamVideo");
  const canvas = $("#webcamCanvas");
  if (!video.videoWidth) return null;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.85);
}

$("#webcamButton").addEventListener("click", () => {
  if (webcamStream) {
    stopWebcam();
  } else {
    startWebcam();
  }
});

// ── 实时连续检测 ────────────────────────────────────────
async function continuousTick() {
  if (continuousPending) return;  // 上一帧还在等后端响应，跳过
  continuousPending = true;
  try {
    const dataUrl = captureFromWebcam();
    if (!dataUrl) return;
    const result = await post("/api/vision/detect", {
      source: "webcam-live",
      image_data: dataUrl,
    });
    // 更新 UI
    const camera = $("#cameraView");
    camera.querySelector("p").textContent =
      `实时检测 · ${(result.confidence * 100).toFixed(0)}%`;

    if (result.labels.length === 0) {
      $("#detectionLabels").innerHTML =
        '<span class="no-detection">未检测到目标</span>';
    } else {
      $("#detectionLabels").innerHTML = result.labels.map(label => {
        const conf = result.label_confidences?.[label];
        const confText = conf != null ? ` ${(conf * 100).toFixed(0)}%` : '';
        return `<span>${label}<small>${confText}</small></span>`;
      }).join("");
    }
    // 静默拉取告警
    await fetchAlerts();
  } catch (_) {
    // 连续模式下网络抖动不弹 toast，静默跳过
  } finally {
    continuousPending = false;
  }
}

function startContinuous() {
  if (continuousInterval) return;
  continuousInterval = setInterval(continuousTick, CONTINUOUS_INTERVAL_MS);
  $("#continuousButton").textContent = "⏹ 停止实时";
  $("#continuousButton").classList.add("active");
  $("#cameraView").classList.add("scanning");
  updateDetectButtonState();
  toast(`实时检测已开启 · 每 ${(CONTINUOUS_INTERVAL_MS / 1000).toFixed(1)} 秒识别一次`);
}

function stopContinuous() {
  if (continuousInterval) {
    clearInterval(continuousInterval);
    continuousInterval = null;
  }
  continuousPending = false;
  $("#continuousButton").textContent = "🔄 实时检测";
  $("#continuousButton").classList.remove("active");
  $("#cameraView").classList.remove("scanning");
  updateDetectButtonState();
}

$("#continuousButton").addEventListener("click", () => {
  if (continuousInterval) {
    stopContinuous();
  } else {
    startContinuous();
  }
});
(async function init() {
  await fetchMode();
  refresh();
  fetchAlerts();
  setInterval(refresh, 15000);
  setInterval(fetchAlerts, 5000);  // poll alerts more frequently for near-real-time signals
})();

// ═══════════════════════════════════════════
// 3D 视图集成
// ═══════════════════════════════════════════
let view3dActive = true;
let room3dReady = false;

// 显示加载状态
function show3dLoading(msg) {
  const layer = $('#room3dLayer');
  if (layer) layer.innerHTML = `<div style="display:grid;place-items:center;height:100%;color:#8899b4;font:13px 'SF Mono',Consolas,monospace">${msg}</div>`;
}

// 等待 room3d 模块就绪后初始化
window.addEventListener('room3d-module-ready', async () => {
  show3dLoading('3D 场景加载中...');
  try {
    await window.Room3D.init('#room3dLayer');
    room3dReady = true;
    syncTo3D();
    console.log('[app] 3D 场景初始化完成');
  } catch (e) {
    console.warn('[app] 3D 初始化失败，回退到像素模式:', e.message);
    switchView('pixel');
    room3dReady = false;
  }
});

// 兜底：15 秒后模块仍未就绪则放弃
setTimeout(() => {
  if (!window.Room3D) {
    console.warn('[app] 3D 模块加载超时（CDN 可能不可达），切换像素模式');
    switchView('pixel');
  }
}, 15000);

// 视图切换
$('#btn3D').addEventListener('click', () => switchView('3d'));
$('#btnPixel').addEventListener('click', () => switchView('pixel'));

function switchView(mode) {
  view3dActive = mode === '3d';
  $('#btn3D').classList.toggle('active', view3dActive);
  $('#btnPixel').classList.toggle('active', !view3dActive);
  $('#roomContainer').classList.toggle('view-3d', view3dActive);
  $('#roomContainer').classList.toggle('view-pixel', !view3dActive);

  // 3D 模式下触发 resize 让 Three.js 画布正确
  if (view3dActive && room3dReady) {
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    syncTo3D();
  }
}

// 默认 3D 模式
switchView('3d');
show3dLoading('等待 3D 模块就绪...');

// 将当前 UI 状态同步到 3D 场景
function syncTo3D() {
  if (!room3dReady || !window.Room3D) return;
  const home = {
    door: $('#doorState').textContent,
    light: parseInt($('#lightState').textContent) || 0,
    fan: $('#fanToggle').checked,
    window: $('#windowState').textContent,
  };
  window.Room3D.updateDoor(home.door === '已打开');
  window.Room3D.updateLight(home.light);
  window.Room3D.updateFan(home.fan);
  window.Room3D.updateWindow(home.window);
}

// 增强 renderHome：同时更新 3D 场景
const _originalRenderHome = renderHome;
renderHome = function(home) {
  _originalRenderHome(home);
  if (room3dReady && window.Room3D) {
    window.Room3D.updateDoor(home.door === 'open');
    window.Room3D.updateLight(home.light);
    window.Room3D.updateFan(home.fan);
    window.Room3D.updateWindow(home.window);
  }
};
