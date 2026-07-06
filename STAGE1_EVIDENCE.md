# Pixel Home 阶段 1 技能证明

验证日期：2026-07-05

## 课程要求映射

| 物联网/智科要求 | 当前组件 | 证据 |
| --- | --- | --- |
| 管理授权人员信息 | SQLite `people` 表及 `/api/people` | 初始化两名授权住户和一名未授权访客；自动化测试覆盖 |
| YOLO 目标识别 | `UltralyticsVisionAdapter` | `yolo11n.pt` CPU 真实推理及 API 集成验证通过 |
| 人脸识别门禁 2 真 1 假 | `/api/access/recognize` 与门控联动 | 两名授权身份通过、一名访客拒绝；自动化测试覆盖 |
| 友好 GUI | 响应式 8-bit Web 控制台 | 状态、控制、识别、历史和事件集中展示 |
| 历史数据统计 | `telemetry` 表及 `/api/history` | 温度、灯光、门窗状态按时间保存和展示 |
| 远程控制 | `/api/command` | 开门、风扇开关、灯光亮度控制；自动化测试覆盖 |
| 可独立运行 | 标准库 HTTP 服务、SQLite、模拟硬件 | 无实体硬件时可完整演示业务链路 |
| 阶段 2 可集成 | Home/Vision adapter 边界 | 可替换 MQTT、串口、摄像头和真实人脸模型 |

## 真实 YOLO 结果

验证命令：

```powershell
python verify_yolo.py
```

独立推理结果：

```text
Mode: yolo
Model: yolo11n.pt
Objects: 5
Labels: bus, person
Top confidence: 94.02%
YOLO verification: PASS
```

真实后端启动命令：

```powershell
python run.py --vision yolo --model yolo11n.pt --port 8002
```

将同一张图片提交到 `/api/vision/detect` 后返回：

```json
{
  "source": "api-integration",
  "labels": ["bus", "person"],
  "confidence": 0.9402,
  "count": 5,
  "mode": "yolo",
  "model": "yolo11n.pt"
}
```

这证明图片上传、HTTP 路由、业务服务、真实 YOLO 模型和结果序列化已经形成完整链路。

## 自动化测试

```powershell
python -m unittest discover -s tests -v
```

覆盖内容：授权门禁、拒绝门禁、设备控制、检测结果持久化、舒适安全评分、2 真 1 假初始化以及真实 YOLO adapter 图片解码/返回契约。

## 阶段 2 设计决策

- 保留 `/api/command` 和状态字段，硬件层替换为 MQTT 或串口 adapter。
- 摄像头接入后继续提交 Data URL，或新增流媒体抽帧 adapter，业务服务不变。
- 人脸识别模型通过现有 `recognize_face()` 契约接入，门禁业务规则不变。
- 未知显示屏规格下，Web GUI 按桌面、平板和窄屏响应；嵌入式小屏可只消费 dashboard API。
- YOLO、数据库、GUI 和硬件通信由独立模块负责，便于两位物联网同学与智科、电子、电管组并行开发。

