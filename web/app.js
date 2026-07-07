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

function toast(message) {
  const node = $("#toast"); node.textContent = message; node.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove("show"), 2400);
}

function renderHome(home) {
  $("#temperature").textContent = `${home.temperature} °C`;
  $("#sceneTemp").textContent = `${home.temperature}°`;
  $("#doorState").textContent = stateText(home.door);
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
  $("#temperatureChart").innerHTML = temperatures.map(item => {
    const value = Number(item.value); const height = Math.max(12, Math.min(100, (value - 15) * 6));
    return `<i class="chart-bar" style="height:${height}%" data-value="${value}°C"></i>`;
  }).join("");
}

async function refresh() {
  try {
    const [dashboard, people, history, suspects, settings, storage] = await Promise.all([api("/api/dashboard"), api("/api/people"), api("/api/history?limit=80"), api("/api/admin/suspects"), api("/api/admin/settings"), api("/api/admin/storage")]);
    renderHome(dashboard.home); renderScore(dashboard.home_score); renderPeople(people); renderAdminPeople(people); renderSuspects(suspects); renderSettings(settings, storage); renderEvents(dashboard.events); renderChart(history);
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
  resultNode.textContent = result.authorized ? `识别通过 · ${result.person.name} · ${(result.confidence * 100).toFixed(0)}%` : "识别拒绝 · 未授权人员";
  await refresh();
}

async function detect() {
  const camera = $("#cameraView"); camera.classList.add("scanning");
  const result = await post("/api/vision/detect", { source: imageData ? "browser-upload" : "demo-camera", image_data: imageData });
  setTimeout(() => { camera.classList.remove("scanning"); camera.classList.add("active"); camera.querySelector("p").textContent = `可信度 ${(result.confidence * 100).toFixed(0)}%`; }, 700);
  $("#detectionLabels").innerHTML = result.labels.map(label => `<span>${label}</span>`).join("");
  await refresh();
}

$("#refreshButton").addEventListener("click", refresh);
$("[data-device='door']").addEventListener("click", () => command({ device: "door", action: "open" }));
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
  const reader = new FileReader();
  reader.onload = () => { imageData = reader.result; $("#cameraView").style.backgroundImage = `url(${imageData})`; $("#cameraView").style.backgroundSize = "cover"; $("#cameraView p").textContent = file.name; toast("图片已载入，可运行目标识别"); };
  reader.readAsDataURL(file);
});
refresh();
setInterval(refresh, 15000);

// ═══════════════════════════════════════════
// 3D 视图集成
// ═══════════════════════════════════════════
let view3dActive = true;
let room3dReady = false;

// 显示加载状态
function show3dLoading(msg) {
  const layer = $('#room3dLayer');
  if (layer) layer.innerHTML = `<div style="display:grid;place-items:center;height:100%;color:#677087;font:13px Consolas,monospace">${msg}</div>`;
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
