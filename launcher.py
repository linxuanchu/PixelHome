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
        root.geometry("700x280")
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
        yolo_state = "disabled" if getattr(sys, "frozen", False) else "normal"
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
            text="硬件接口已预留，领取Arduino与Orange Pi后接入。",
            foreground="#555555",
        ).pack(anchor="w", pady=(20, 0))

    @staticmethod
    def free_port():
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            return sock.getsockname()[1]

    def start(self):
        if self.server:
            return self.open_ui()
        port = self.free_port()
        try:
            self.server = build_server("127.0.0.1", port, vision_mode=self.mode.get())
        except Exception as error:
            self.server = None
            messagebox.showerror("启动失败", str(error))
            return
        self.url = f"http://127.0.0.1:{port}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.status.set(f"系统运行中：{self.url}")
        self.start_button.configure(state="disabled")
        self.open_button.configure(state="normal")
        self.root.after(250, self.open_ui)

    def open_ui(self):
        if self.url:
            webbrowser.open(self.url)

    def close(self):
        if self.server:
            self.server.shutdown()
            self.server.server_close()
        self.root.destroy()


def main():
    root = tk.Tk()
    PixelHomeLauncher(root)
    root.mainloop()


if __name__ == "__main__":
    main()
