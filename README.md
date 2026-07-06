# Pixel Home 阶段 1

## Windows桌面程序

阶段一演示可直接双击 `dist/PixelHome/PixelHome.exe`。轻量EXE使用演示模式并自动打开管理界面；YOLO模式从源码或Orange Pi运行。数据库保存在当前用户的 `%LOCALAPPDATA%/PixelHome`，关闭启动窗口会同时停止后台服务。

硬件接口已经预留，Arduino与Orange Pi到位后再接入真实串口和板端推理适配器。

面向 Design & Build 智能家居项目中物联网与智能科学专业的可独立运行组件。当前版本不依赖具体硬件，能够完成数据管理、目标识别接口、人脸门禁演示、GUI 展示、历史数据和远程控制；阶段 2 可通过适配器接入真实设备与模型。

阶段 1 的课程要求与实测证据见 [STAGE1_EVIDENCE.md](STAGE1_EVIDENCE.md)。
扩展接口、复杂度分析、开源借鉴与商业化边界见 [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md)。
硬件申请、联网方案和创新加分预留见 [HARDWARE_AND_BONUS_NOTES.md](HARDWARE_AND_BONUS_NOTES.md)。

## 一键运行

需要 Python 3.10 或更高版本，无需安装第三方包。

```powershell
python run.py
```

演示前可运行环境自检：

```powershell
python check_environment.py
```

它会分别报告基础控制台与真实 YOLO 模式是否就绪，避免现场才发现缺少模型依赖。

浏览器打开 `http://127.0.0.1:8000`。数据保存在 `data/pixel_home.db`。

真实 YOLO 模式为可选扩展：

```powershell
python -m pip install -r requirements-ai.txt
python run.py --vision yolo --model yolo11n.pt
```

首次使用默认模型时 Ultralytics 会下载权重。GUI 可上传图片并将其发送给真实模型；普通启动则使用确定性演示识别，方便无网络环境验收其余功能。

真实 YOLO 技能证明：

```powershell
python verify_yolo.py
```

该脚本使用 Ultralytics 官方示例图片和 `yolo11n.pt` 完成一次 CPU 推理，并打印类别、目标数量、最高可信度与 PASS 结论。

运行技能证明测试：

```powershell
python -m unittest discover -s tests -v
```

## 阶段 1 已覆盖

- 授权人员数据管理，内置两名授权住户和一名未授权访客。
- 人脸识别适配接口，识别通过后联动开启入口门。
- YOLO 真实推理适配器与演示适配器，保存来源、标签、可信度和时间。
- 响应式 Web GUI，可在电脑、平板及窄屏设备上使用。
- 温度、门窗、灯光、风扇状态展示与历史数据存储。
- 远程开门、风扇开关和灯光亮度控制。
- 可解释的“舒适安全评分”，作为阶段 1 创新功能。
- 连续门禁失败聚合告警及管理员处理流程。
- 管理员人员增删改、授权启停、温控和数据保留策略。
- 目标温度加回差控制；当前执行风扇，空调/HVAC adapter已预留。
- 索引化查询、批量遥测写入和历史数据清理。
- 模拟硬件让组件可以脱离实体模型独立评估。

## 结构与对接边界

```text
web/                    8-bit 响应式 GUI
smart_home/server.py    HTTP 路由与静态文件服务
smart_home/service.py   门禁、控制、识别和评分业务规则
smart_home/database.py  SQLite 数据访问
smart_home/adapters.py  硬件与 AI 的可替换适配器
tests/                  可重复运行的技能证明
```

硬件组只需对接两个方向：

1. 上报状态：温度、门窗状态、亮度及摄像头图片。
2. 接收命令：开关门、开关风扇和设置灯光亮度。

当前 `SimulatedHomeAdapter` 保存同一套输入输出契约。阶段 2 新建 `MqttHomeAdapter` 或 `SerialHomeAdapter`，无需修改 GUI、数据库和业务服务。

AI 组可直接启用 `UltralyticsVisionAdapter` 完成 YOLO 推理；人脸部分仍通过 `recognize_face()` 契约接入真实特征比对。

## API 契约

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/health` | 服务健康检查 |
| GET | `/api/dashboard` | 首页聚合状态与评分 |
| GET/POST | `/api/people` | 查询或新增授权人员 |
| GET | `/api/history?limit=80` | 查询传感器历史数据 |
| GET | `/api/events` | 查询门禁和控制事件 |
| POST | `/api/command` | 下发设备控制命令 |
| POST | `/api/access/recognize` | 执行人脸门禁验证 |
| POST | `/api/vision/detect` | 执行目标识别 |
| PATCH/DELETE | `/api/people/{id}` | 修改或删除人员 |
| GET | `/api/admin/suspects` | 查询可疑人员 |
| PATCH | `/api/admin/suspects/{key}` | 标记可疑记录已处理 |
| GET/PATCH | `/api/admin/settings` | 查询或修改系统策略 |
| GET | `/api/admin/storage` | 查询存储统计 |
| POST | `/api/admin/storage/cleanup` | 执行历史数据保留策略 |
| GET | `/api/capabilities` | 查询联网、LLM、节能和自训练模型能力 |

控制命令示例：

```json
{"device": "light", "value": 70}
```

状态契约示例：

```json
{
  "temperature": 24.6,
  "door": "closed",
  "window": "closed",
  "light": 45,
  "fan": false,
  "online": true
}
```

## 两位同学的协作建议

- 同学 A：`database.py`、`service.py`、真实设备适配器和接口联调。
- 同学 B：`web/`、YOLO/人脸模型适配器和识别结果展示。
- 共同维护：API 契约、测试用例、联调记录和阶段 2 架构决策。

开发时双方都以 adapter 契约为边界，先使用模拟数据并行工作。真实硬件或模型到位后，只替换对应 adapter。

## 阶段 2 决策与扩展

- 通信协议尚未确定：优先 MQTT，串口作为同机演示备选；确认主控板后再实现。
- 摄像头规格尚未确定：后端接口接受来源标识，未来扩展为图片上传或 RTSP 抽帧。
- 显示屏规格尚未确定：Web GUI 使用响应式布局；小屏可只展示评分、温度和告警。
- YOLO 适配器已经实现；默认演示模式不加载大模型，提交电脑安装依赖后可切换真实推理。
- 可继续增加自动温控、异常门窗告警、能耗分析、离线缓存与多房间设备注册。

## 演示顺序

1. 打开首页，说明模拟空间可以独立运行。
2. 点击两名授权住户，展示识别通过和自动开门。
3. 点击未授权访客，展示门禁拒绝。
4. 调节灯光并开启风扇，展示控制、场景动画和事件日志。
5. 运行目标识别，展示识别标签和结果持久化。
6. 展示测试结果与 adapter 结构，说明阶段 2 如何接真实硬件。
