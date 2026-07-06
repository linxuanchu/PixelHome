# 模型发布规则

`baseline/` 保存组员克隆仓库后可直接使用的正式基线模型。当前两份模型均小于GitHub单文件100 MB限制，因此使用普通Git提交，不要求组员额外安装Git LFS。

后续自训模型按以下流程发布：

1. 训练产生的 `last.pt`、每轮checkpoint和实验目录保留在本机或共享存储，不直接提交。
2. 候选 `best.pt` 必须在未参与训练的测试集上验证无人机、灭火器、弱光和复杂背景。
3. 记录数据集版本、类别映射、训练参数、mAP、误检漏检案例、许可证和SHA256。
4. 通过小组确认后，将权重改为有含义的版本名并更新程序默认路径与 `MODEL_EVALUATION.md`。
5. 单文件接近或超过100 MB时改用Git LFS或GitHub Release，不在普通Git历史中反复替换大文件。

当前基线SHA256：

| 文件 | SHA256 |
|---|---|
| `drone_yolo11n.pt` | `311b8bea0a5a9f2b2dd407ade666a91831bbcb4dcd9d4b6580dbe33aac3123be` |
| `fire_extinguisher_yolov8.pt` | `4f83c93496ae6ac8842e91c70a0477a7dac761848bccb9401729931699ddeb0c` |
