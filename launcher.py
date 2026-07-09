import json
import os
import shutil
import sys
import subprocess
import threading
import tkinter as tk
import time
import urllib.request
import webbrowser
from pathlib import Path
from tkinter import messagebox, ttk

from smart_home.server import build_server


class PixelHomeLauncher:
    DEFAULT_PORT = 8000

    def __init__(self, root):
        self.root = root
        self.server = None
        self.server_process = None
        self.url = ""
        root.title("Pixel Home")
        root.geometry("700x280")
        root.resizable(False, False)
        root.protocol("WM_DELETE_WINDOW", self.close)

        frame = ttk.Frame(root, padding=24)
        frame.pack(fill="both", expand=True)
        ttk.Label(frame, text="Pixel Home", font=("Segoe UI", 20, "bold")).pack(anchor="w")
        ttk.Label(frame, text="智能家居控制与视觉识别平台").pack(anchor="w", pady=(0, 20))
        ttk.Label(frame, text="运行模式").pack(anchor="w")

        source_ready = self.project_run_script().is_file()
        self.mode = tk.StringVar(value="hybrid" if getattr(sys, "frozen", False) and source_ready else "demo")
        modes = ttk.Frame(frame)
        modes.pack(fill="x", pady=(4, 14))
        ttk.Radiobutton(modes, text="演示模式", variable=self.mode, value="demo").pack(side="left")
        yolo_state = "normal" if source_ready else "disabled"
        ttk.Radiobutton(
            modes,
            text="YOLO模式（Orange Pi/源码）",
            variable=self.mode,
            value="yolo",
            state=yolo_state,
        ).pack(side="left", padx=16)
        ttk.Radiobutton(
            modes,
            text="无人机/灭火器专用模式",
            variable=self.mode,
            value="specialized",
            state=yolo_state,
        ).pack(side="left")
        ttk.Radiobutton(
            modes,
            text="混合识别模式（推荐）",
            variable=self.mode,
            value="hybrid",
            state=yolo_state,
        ).pack(side="left", padx=16)

        self.status = tk.StringVar(value="尚未启动")
        ttk.Label(frame, textvariable=self.status).pack(anchor="w", pady=(0, 14))
        buttons = ttk.Frame(frame)
        buttons.pack(fill="x")
        self.start_button = ttk.Button(buttons, text="启动系统", command=self.start)
        self.start_button.pack(side="left")
        self.open_button = ttk.Button(buttons, text="打开管理界面", command=self.open_ui, state="disabled")
        self.open_button.pack(side="left", padx=8)
        ttk.Button(buttons, text="退出", command=self.close).pack(side="right")
        ttk.Label(
            frame,
            text="双击打包程序会优先自动启动 hybrid 模式；硬件接口已预留。",
            foreground="#555555",
        ).pack(anchor="w", pady=(20, 0))
        if getattr(sys, "frozen", False):
            self.root.after(350, self.start)

    @staticmethod
    def project_root():
        if getattr(sys, "frozen", False):
            return Path(sys.executable).resolve().parents[2]
        return Path(__file__).resolve().parent

    def project_run_script(self):
        return self.project_root() / "run.py"

    def start(self):
        if self.server:
            return self.open_ui()
        if self.server_process:
            return self.open_ui()
        port = self.DEFAULT_PORT
        if getattr(sys, "frozen", False) and self.mode.get() in {"yolo", "specialized", "hybrid"}:
            return self.start_external_server(port)
        try:
            self.server = build_server("127.0.0.1", port, vision_mode=self.mode.get())
        except Exception as error:
            self.server = None
            messagebox.showerror(
                "启动失败",
                f"无法启动 http://127.0.0.1:{port}/\n\n"
                f"请确认8000端口没有被其他程序占用。\n\n{error}",
            )
            return
        self.url = f"http://127.0.0.1:{port}/"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.status.set(f"系统运行中：{self.url}")
        self.start_button.configure(state="disabled")
        self.open_button.configure(state="normal")
        self.root.after(250, self.open_ui)

    def health_mode(self, port):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=0.5) as response:
                return json.loads(response.read().decode("utf-8")).get("mode")
        except Exception:
            return None

    def python_command(self, run_script, port, mode):
        candidates = [
            self.project_root() / ".venv" / "Scripts" / "python.exe",
            Path.home() / ".cache" / "codex-runtimes" / "codex-primary-runtime" / "dependencies" / "python" / "python.exe",
        ]
        for candidate in candidates:
            if candidate.is_file():
                return [str(candidate), str(run_script), "--port", str(port), "--vision", mode]
        python = shutil.which("python")
        if python:
            return [python, str(run_script), "--port", str(port), "--vision", mode]
        py_launcher = shutil.which("py")
        if py_launcher:
            return [py_launcher, "-3", str(run_script), "--port", str(port), "--vision", mode]
        return None

    def start_external_server(self, port):
        mode = self.mode.get()
        existing_mode = self.health_mode(port)
        if existing_mode:
            if existing_mode == mode:
                self.url = f"http://127.0.0.1:{port}/"
                self.status.set(f"系统运行中：{self.url}（{mode}）")
                self.start_button.configure(state="disabled")
                self.open_button.configure(state="normal")
                return self.open_ui()
            messagebox.showerror(
                "启动失败",
                f"8000端口已有 PixelHome 服务运行，当前模式是 {existing_mode}。\n\n"
                f"请先关闭旧服务，再启动 {mode} 模式。",
            )
            return

        run_script = self.project_run_script()
        if not run_script.is_file():
            messagebox.showerror("启动失败", f"未找到源码入口：{run_script}")
            return
        command = self.python_command(run_script, port, mode)
        if not command:
            messagebox.showerror("启动失败", "未找到 python，请先安装 Python 并配置到 PATH。")
            return

        log_path = self.project_root() / "data" / "pixel_home_ai.log"
        log_path.parent.mkdir(exist_ok=True)
        log_file = log_path.open("a", encoding="utf-8")
        env = dict(os.environ)
        vision_deps = self.project_root() / ".vision-deps"
        if vision_deps.is_dir():
            current_pythonpath = env.get("PYTHONPATH")
            env["PYTHONPATH"] = str(vision_deps) if not current_pythonpath else f"{vision_deps}{os.pathsep}{current_pythonpath}"
        self.server_process = subprocess.Popen(
            command,
            cwd=self.project_root(),
            stdout=log_file,
            stderr=subprocess.STDOUT,
            env=env,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )

        for _ in range(80):
            if self.server_process.poll() is not None:
                self.server_process = None
                messagebox.showerror("启动失败", f"{mode} 模式启动失败，请查看日志：{log_path}")
                return
            if self.health_mode(port) == mode:
                self.url = f"http://127.0.0.1:{port}/"
                self.status.set(f"系统运行中：{self.url}（{mode}）")
                self.start_button.configure(state="disabled")
                self.open_button.configure(state="normal")
                return self.open_ui()
            time.sleep(0.25)
        messagebox.showerror("启动失败", f"{mode} 模式启动超时，请查看日志：{log_path}")

    def open_ui(self):
        if self.url:
            webbrowser.open(self.url)

    def close(self):
        if self.server:
            self.server.shutdown()
            self.server.server_close()
        if self.server_process:
            self.server_process.terminate()
        self.root.destroy()


def main():
    root = tk.Tk()
    PixelHomeLauncher(root)
    root.mainloop()


if __name__ == "__main__":
    main()
