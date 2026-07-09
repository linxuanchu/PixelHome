# Pixel Home 阶段 1

## 协作提醒

每位组员修改功能、接口、模型、数据集、3D预览或硬件适配后，请同步更新 [CHANGELOG.md](CHANGELOG.md)，至少写清楚修改人、修改日期、修改内容、涉及文件、运行或测试方式、后续注意事项。这样其他人拉取代码后能快速知道项目变了什么。

## 当前最高优先级：无人机与灭火器识别

老师指定的基础识别类别为：

- `drone`：无人机
- `fire_extinguisher`：灭火器

项目优先使用来源、许可和验证材料清楚的现成检测权重，再用现场图片验证；只有现成模型未达标时才进行增量微调。测试图片必须检查授权、清除重复图和错误图，并统一为以上两个类别。独立测试集不得与模型已知训练来源重叠，最终验收需展示模型来源、光照测试和未参与训练的新图片识别效果。

当前已采用两个质量可核验的现成专用权重作为正式基线，不从零训练：无人机使用YOLO11n Drone Detector，灭火器使用鲁尔大学FireSafetyNet YOLOv8。模型筛选和光照测试见 [MODEL_EVALUATION.md](MODEL_EVALUATION.md)。

仓库已包含经过验证的基线权重，若权重损坏或被误删，可运行 `python download_specialized_models.py` 恢复。

### 推荐模式：Hybrid 三模型并行（`--vision hybrid`）

已实现 hybrid 模式解决原 specialized 模式的误报问题。该模式同时运行三个模型——通用 YOLO11n（COCO 80 类）+ 无人机专用模型 + 灭火器专用模型，合并结果后**仅输出置信度最高的单个标签**，无人机/灭火器类别的检测阈值默认为 **80%** 以抑制低置信度假阳性。

```powershell
# 安装 AI 依赖（首次使用）
python -m pip install -r requirements-ai.txt

# 启动 hybrid 模式（推荐）
python run.py --vision hybrid

# 可选：手动调节专用模型置信度阈值（0.65~0.85 之间）
python run.py --vision hybrid --specialized-confidence 0.75
```

| 模式 | 命令 | 模型数 | 能识别通用物体 | 能识别无人机/灭火器 | 误报控制 |
|---|---|---|---|---|---|
| `demo` | `python run.py` | 0 | 固定演示结果 | 固定演示结果 | — |
| `yolo` | `--vision yolo` | 1 | COCO 80 类 | ❌ 无训练数据 | 低 |
| `specialized` | `--vision specialized` | 2 | ❌ | ✅ | 差（0.5 阈值，误报多） |
| `hybrid` | `--vision hybrid` | 3 | ✅ | ✅ | 好（0.8 阈值 + top-1 去噪） |

### 误报问题已解决

原 specialized 模式在置信度 0.5 阈值下可将其他物品误判为无人机或灭火器。Hybrid 模式通过两条策略抑制误报：

1. **置信度阈值提升至 80%**：专用模型在正确目标上实测置信度 0.7~0.92，大部分误报集中在 0.5~0.7，提高阈值即可滤除；
2. **Top-1 输出**：只保留所有检出标签中置信度最高的那一个，避免"一个人同时被识别成 chair + drone"的荒谬场景。

模型权重固定存放在 `models/baseline/`。后续自己的训练图片、标签和训练缓存不直接提交Git；数据集规则见 [datasets/README.md](datasets/README.md)，模型发布规则见 [models/README.md](models/README.md)。只有完成独立测试、记录来源和版本的候选权重才进入共享仓库。

## 验收必须通过功能：摄像头实时识别

已通过浏览器 `getUserMedia` API 接入电脑摄像头，无需额外硬件即可完成实时目标识别：

- **单次拍照**：开启摄像头后点击 📸，拍一帧送后端推理；
- **连续实时检测**：点击 🔄 实时检测，每 0.8 秒自动拍帧并回传后端，识别结果和告警（无人机/灭火器）实时刷新；
- 摄像头权限由浏览器管理，首次使用需用户允许；仅 `localhost` / `127.0.0.1` 下可用（非 HTTPS 安全策略限制）。

后端接口 `POST /api/vision/detect` 接受 `image_data`（base64 JPEG），前端 Canvas 截图通过该接口回传。阶段 2 如需接入物理摄像头（RTSP / USB 直连），后端接口无需改动，只需新增硬件采集适配器替换浏览器的 `getUserMedia` 环节。

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

真实 AI 推理为可选扩展，安装依赖后可选三种模式：

```powershell
python -m pip install -r requirements-ai.txt

# 通用 YOLO 模式（COCO 80 类，不含无人机/灭火器）
python run.py --vision yolo --model yolo11n.pt

# 无人机/灭火器专用模式（两个专用模型，误报较多）
python run.py --vision specialized

# 推荐：Hybrid 三模型并行（通用 + 无人机 + 灭火器，误报已抑制）
python run.py --vision hybrid
```

首次使用默认模型时 Ultralytics 会自动下载权重。Web GUI 支持上传图片、电脑摄像头单次拍照或连续实时检测；普通启动则使用确定性演示识别，方便无网络环境验收其余功能。

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
- YOLO 真实推理适配器与三种检测模式（通用/专用/Hybrid），保存来源、标签、可信度和时间。
- 浏览器摄像头接入，支持单次拍照与 0.8 秒间隔连续实时检测。
- 无人机与灭火器检测告警信号系统，前端实时弹出并支持确认消除。
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
- 摄像头：浏览器端已通过 getUserMedia 接入电脑摄像头，支持实时连续检测；阶段 2 如需物理摄像头直连，后端接口无需改动，只需新增硬件采集适配器。
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
