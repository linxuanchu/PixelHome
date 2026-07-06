import socket
import sys
import threading
import tkinter as tk
import webbrowser
from tkinter import messagebox, ttk

from smart_home.server import build_server


class PixelHomeLauncher:
    def __init__(self, root):
        self.root = root
        self.server = None
        self.url = ""
        root.title("Pixel Home")
        root.geometry("460x280")
        root.resizable(False, False)
        root.protocol("WM_DELETE_WINDOW", self.close)

        frame = ttk.Frame(root, padding=24)
        frame.pack(fill="both", expand=True)
        ttk.Label(frame, text="Pixel Home", font=("Segoe UI", 20, "bold")).pack(anchor="w")
        ttk.Label(frame, text="智能家居控制与视觉识别平台").pack(anchor="w", pady=(0, 20))
        ttk.Label(frame, text="运行模式").pack(anchor="w")

        self.mode = tk.StringVar(value="demo")
        modes = ttk.Frame(frame)
        modes.pack(fill="x", pady=(4, 14))
        ttk.Radiobutton(modes, text="演示模式", variable=self.mode, value="demo").pack(side="left")
        yolo_state = "disabled" if getattr(sys, "fr…14220 tokens truncated…eutral">等待识别</div>
      </article>

      <article class="vision-panel panel">
        <div class="panel-heading"><div><span class="kicker">YOLO PORT</span><h2>目标识别</h2></div><button class="icon-button" id="detectButton" title="运行识别">▶</button></div>
        <div class="camera-view" id="cameraView"><div class="scan-line"></div><div class="target-box"><span>CAM-01</span></div><p>等待摄像头画面</p></div>
        <label class="upload-button">选择检测图片<input id="imageInput" type="file" accept="image/*"></label>
        <div id="detectionLabels" class="label-row"><span>暂无识别结果</span></div>
      </article>

      <article class="history-panel panel">
        <div class="panel-heading"><div><span class="kicker">TIMELINE</span><h2>温度记录</h2></div><span>最近采样</span></div>
        <div class="chart" id="temperatureChart" aria-label="温度历史折线图"></div>
      </article>

      <article class="events-panel panel">
        <div class="panel-heading"><div><span class="kicker">EVENT LOG</span><h2>系统动态</h2></div><span>实时</span></div>
        <div id="eventList" class="event-list"></div>
      </article>

      <article class="admin-panel panel">
        <div class="panel-heading"><div><span class="kicker">ADMIN</span><h2>人员与权限</h2></div><button class="icon-button" id="addPersonButton" title="新增授权人员">＋</button></div>
        <form id="personForm" class="admin-form hidden">
          <input id="personId" type="hidden">
          <label>姓名<input id="personName" required maxlength="40"></label>
          <label>身份<select id="personRole"><option value="resident">住户</option><option value="visitor">访客</option><option value="admin">管理员</option></select></label>
          <label>识别键<input id="personFaceKey" required maxlength="80"></label>
          <label class="check-field"><input id="personAuthorized" type="checkbox" checked>允许门禁</label>
          <div class="form-actions"><button class="primary" type="submit">保存</button><button id="cancelPersonButton" type="button">取消</button></div>
        </form>
        <div id="adminPeople" class="admin-list"></div>
      </article>

      <article class="security-panel panel">
        <div class="panel-heading"><div><span class="kicker">SECURITY</span><h2>可疑人员</h2></div><span><b id="suspectCount">0</b> 条待处理</span></div>
        <p class="section-note">默认10分钟内失败3次触发告警，识别照片接口已预留。</p>
        <div id="suspectList" class="admin-list"></div>
      </article>

      <article class="settings-panel panel">
        <div class="panel-heading"><div><span class="kicker">POLICY</span><h2>温控与存储</h2></div><span>管理员</span></div>
        <form id="settingsForm" class="settings-form">
          <label>温控模式<select id="climateMode"><option value="auto">自动</option><option value="manual">手动</option></select></label>
          <label>目标温度<input id="targetTemperature" type="number" min="16" max="32" step="0.5"></label>
          <label>回差范围<input id="hysteresis" type="number" min="0.5" max="5" step="0.5"></label>
          <label>记录保留<input id="retentionDays" type="number" min="1" max="365"><span>天</span></label>
          <button class="primary" type="submit">应用策略</button>
        </form>
        <div class="capability-note"><strong>执行器：风扇</strong><span>空调/HVAC能力接口已预留，接入后无需修改温控策略。</span></div>
        <div id="storageStats" class="storage-stats"></div>
        <button id="cleanupButton" class="text-command" type="button">执行历史数据清理</button>
      </article>
    </section>
  </main>
  <div id="toast" class="toast" role="status"></div>
  <script src="/app.js"></script>
</body>
</html>
