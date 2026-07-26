# 露可丝白板封面 V3 运行流程

## 1. 输入与恢复

开始前确认：

- Git 根目录是 `lux-cover-generator`。
- 文章或 brief 真实存在；本地来源只读后复制为 `runs/<run-id>/article.md` 并计算 SHA-256。
- 用户明确给出每个 output 的 ID、platform、最终 width 和 height。
- V3 仅支持横向比例 1.5～2.5；单边 256～4096；总像素与输出数量遵守 renderer 配置。
- visual profile、platform preset、主风格参考、原始露可丝 IP 和字体均可加载。

缺少最终尺寸时返回 `BLOCKED_INPUT`。不能用平台常见尺寸、示例文章或测试素材代替用户输入。

从 `rndflow skip/only` 或中间阶段恢复时，检查依赖链中最早未满足的 Review。部分调用可以跳过无关阶段，但不能跳过适用的人工门禁。

## 2. 内容规划与 Review

1. 使用 `prompt-templates/content-plan.md`，把真实输入保存为 `content-plan-prompt.md`。
2. 生成 `content-card.md`，包含：
   - 逐行标题与重点片段；
   - 一句话核心概念和白名单隐喻；
   - 3～4 个有序步骤、固定 icon ID 和语义；
   - `pose_id` 与可观察的 `pose_intent`；
   - 全部输出和完全相同宽高比的分组；
   - 主动省略的信息。
3. 停在 `content-card-review`。
4. 用户批准后写 `reviews/content-card.json`，Review 必须绑定当前内容卡的项目内路径和 SHA-256。
5. 依据批准内容写 `cover-spec.json` V3。

内容卡改变后旧 Review 立即过期，必须重新批准。不能把零散聊天修改绕过内容卡直接写入生图 prompt。

## 3. 宽高比族

- 每个 output 只能属于一个 `aspect_group`。
- 同组比例使用整数交叉乘法完全相等。
- 每组指定一个 `master_output_id`，其宽高是归一化 `master.png` 的精确尺寸。
- 相同组的多个尺寸共享已批准母图并等比派生。
- 比例不同必须建立新组，调用 `image_gen` 重新构图；不能从旧母图直接裁出。
- 同一上传图明确需要兼容多个中心裁切时，group 可以声明 `semantic_core`。该组全部 outputs 必须使用 `shared-crop-core`；此时 `master.png` 使用 semantic core 尺寸，`master_output_id` 只保留组内 output 接线。

## 4. 完整母图生成

每个 `aspect_group`：

1. 创建 `runs/<run-id>/aspect-groups/<group-id>/`。
2. 使用 `prompt-templates/cover.md` 写真实 `prompt.md`。
3. 写 `references.json`：
   - `primary-style-authority` 必须是 profile 的正式主参考图；
   - `mandatory-identity-reference` 必须是 `assets/ip/lux.png`；
   - 不同比例重构可以增加已经人工批准的 `approved-master-cover-reference`。
4. 调用生成前运行：

   ```bash
   node skills/lux-cover/scripts/guard-cover-attempt.mjs --run <run-id> --issue <group-id>
   ```

5. 完整读取宿主 `imagegen` Skill，用内置 `image_gen` 生成完整封面，包括标题、露可丝、流程、纸张、边框与装饰。
   - 普通组按 master output 比例生成。
   - `shared-crop-core` 组按 `semantic_core` 比例生成完整内容核心，不生成上传图外围。顶部 12.5% 必须只有纯暖米白纸张纹理，供后续背景派生；不画外框、安全区线、标题、人物、图标、箭头或装饰。
6. 不得静默改用需要 API Key 的外部接口或 CLI。
7. 用工具返回的真实 artifact 运行：

   ```bash
   node skills/lux-cover/scripts/register-master.mjs \
     --spec runs/<run-id>/cover-spec.json \
     --aspect-group <group-id> \
     --source <真实-image-gen-artifact>
   ```

登记脚本验证 attempt、prompt、references、身份与风格 hash、PNG、比例漂移和尺寸；先在 `attempts/attempt-<n>/` 保存本次不可覆盖快照，再更新组根目录的当前 `raw.png`、精确 `master.png` 和 artifact。它不调用网络，也不伪造生图。

## 5. AI 检查与完整封面 Review

对每个 `master.png` 逐项检查并保存 `ai-review.json`：

- 预期标题与实际读到的标题逐行完全一致；
- 除标题外没有额外文字、数字、伪文字、Logo 或水印；
- manifest 中全部露可丝核心身份特征均已检查；
- `pose_id` 和 `pose_intent` 可观察地成立，脸与手自然；
- 流程数量、顺序和语义与 spec 一致；
- 风格符合 `lux-whiteboard`，没有负面约束；
- `defects` 为空。

AI 检查通过后展示 `master.png`、原始 artifact、标题事实源和检查清单，进入 `full-cover-review`。只有用户批准，才能写与当前 master hash 绑定的 `user-review.json`。

图片标题和人物身份不是机械事实。即使 AI 自评通过，没有用户批准也不能派生最终输出。

## 6. 定向修正与熔断

- 每组最多两次：一次初始生成，加一次定向修正。
- 修正 prompt 只描述一个明确缺陷，并列出所有不得改变的已接受内容。
- 第二次仍有标题、额外文字、身份、手、姿势、构图或风格问题时停止报告。
- 不得换 `issue_id` 绕过同一问题。
- 每个宽高比组只由 `cover-attempts.json` 记录生成次数。

## 7. 平台截图 calibration

只有用户要求平台裁切保证时才进入此阶段。

1. 用户提供真实上传截图，并说明平台、具体页面/surface 与设备条件。
2. 把截图复制为 `runs/<run-id>/calibrations/<id>/source.png`。
3. AI 分析上传图坐标系中的 normalized `visible_crop`，保存 `calibration.json`。
4. 显示截图、分析范围和 overlay，进入 `platform-calibration-review`。
5. 用户批准后写与 calibration hash 绑定的 `review.json`。

一个截图只证明记录的 surface。没有截图或没有批准时，可以做普通封面，但不能启用 `evidence-safe-padding` 或声称平台裁切已保证。平台 preset 不提供推测的安全区；裁切范围只能来自已批准的真实 calibration 或理论裁切合同。

## 8. 精确输出与安全留边

所有母图和所需 calibration 均批准后运行：

```bash
node skills/lux-cover/scripts/render-v3.mjs --spec runs/<run-id>/cover-spec.json
node skills/lux-cover/scripts/validate-v3-run.mjs --run <run-id>
```

`adaptation.mode: none`：

- 从同组已批准 master 等比输出精确尺寸；
- 不发生跨比例裁切或横纵拉伸；
- 全画幅输出同时作为 visible preview。

`adaptation.mode: evidence-safe-padding`：

- 先得到同尺寸普通封面；
- 把完整封面用 `fit: inside` 等比缩进已批准 `visible_crop`；
- 外围只生成 profile 暖米白纸张纹理；
- 外围不画第二圈边框、胶带、装饰、标题、人物、图标或其他语义内容；
- 生成最终上传图、crop overlay 和 simulated-visible。

`adaptation.mode: shared-crop-core`：

- 只在用户明确批准同一上传图的 2～4 个理论中心裁切范围后使用；
- `basis` 固定为 `user-approved-theoretical-crops`，不能冒充截图 calibration；
- 把 semantic core 用 `fit: inside` 等比放入全部 crop 的像素交集，不先缩成上传图比例；
- 从 semantic core 顶部 12.5% 提取纸张样本；暗色或高色差像素超过 profile 阈值时明确失败；
- 纸张样本通过后，按输出宽度等比缩放并纵向镜像铺展，不使用第二次 image generation；
- 输出共同交集 preview、每个实际 crop preview 和交集 overlay；
- artifact 记录 normalized 来源、像素 crop、inserted core、背景样本 hash 与 ink ratio。

每个 output 产生 PNG、artifact、两个 preview；run 产生聚合 references、validation 和 contact sheet。

## 9. 最终 Review

机械检查通过后展示：

- 每张最终输出；
- 每张 crop overlay；
- 每张 simulated-visible；
- contact sheet；
- validation 与 output artifact。

进入 `final-output-review`。用户批准后写 `reviews/final-output.json`，绑定聚合 `references.json` 的 hash；再次运行 `validate-v3-run.mjs`，只有返回 `human_status: accepted` 才能描述为本次范围已接受。

## 10. 错误修正

- 标题、核心概念、流程或姿势意图事实不对：回到内容卡并重新 Review。
- 生图标题、额外文字、身份、手、姿势或风格不对：使用唯一一次定向修正。
- 不同比例构图不自然：只重做对应 aspect group。
- 同比例尺寸错误或发生拉伸：修确定性代码并补测试，不重新生图。
- calibration 不准确：回到平台截图分析和 Review，不修改母图。
- 理论多裁切范围不准确：修正 `visible_crops` 后重新渲染；不能把它升级为截图证据。
- semantic core 的顶部纸张样本含语义像素：重做该 core；不能回退到固定 profile 背景掩盖接缝。
- 安全留边外围出现第二边框或内容：只修 platform adapter 并补测试。
- 最终输出传播效果不接受：记录用户指出的具体层级；不得把沉默视为批准。

## 11. 状态

- `WAITING_FOR_CONTENT_REVIEW`
- `WAITING_FOR_FULL_COVER_REVIEW`
- `WAITING_FOR_PLATFORM_CALIBRATION_REVIEW`
- `WAITING_FOR_FINAL_OUTPUT_REVIEW`
- `COMPLETED_SCOPE`
- `BLOCKED`
- `FAILED`

没有适用的人审结论时不能进入 `COMPLETED_SCOPE`。
