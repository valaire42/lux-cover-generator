---
name: lux-cover
description: >
  从文章或 brief 生成带露可丝形象的多尺寸横向文章封面：先人工确认标题、3～4 步流程和姿势意图，再用内置 image_gen 按宽高比族生成“露可丝手绘知识白板”完整母图；保存真实 prompt/reference/raw artifact，并确定性输出精确像素、同比例多尺寸、平台截图校准后的无外框纸张安全留边，或为同一上传图的多个理论中心裁切生成共同可见内容核心和各比例预览。用户要求制作或调整 X、B站、微信公众号等横向文章封面、指定多组宽高、改变露可丝姿势、兼容 4:3/16:9 等多种展示裁切、校准平台裁切或验证封面 artifact 时使用。保留内容、完整封面、平台 calibration 和最终输出人工 Review；不用于一般图片生成、方图/竖图、批量发布或平台账号操作。
---

# 露可丝文章封面

采用“AI 内容规划 + image_gen 完整封面 + 确定性尺寸与平台适配”。V3 的图片模型生成标题、露可丝、流程、纸张、边框和装饰；代码不重画标题，只负责可机械证明的 artifact、hash、比例、精确尺寸、安全留边和预览。

## 启动

1. 运行 `pwd` 与 `git rev-parse --show-toplevel`，确认根目录为 `lux-cover-generator`；不一致时停止。
2. 完整读取 [references/workflow.md](references/workflow.md)。
3. 准备内容卡、V3 spec、Review 或 calibration 时，完整读取 [references/formats.md](references/formats.md)。
4. 加载：
   - [references/visual-profiles/lux-whiteboard.yaml](references/visual-profiles/lux-whiteboard.yaml)
   - [references/platform-presets.yaml](references/platform-presets.yaml)
   - [references/quality-rubric.md](references/quality-rubric.md)
   - `assets/renderer.json`
   - `assets/ip/manifest.json`
5. 用户必须明确给出每个 output 的最终 `width` 和 `height`。平台名只选择 preset，不能替代最终像素事实。
6. V3 支持比例 1.5～2.5、单边 256～4096；不推测缺失尺寸。
7. 安全区是 opt-in：用户没有明确提出裁切、安全区、多种展示比例共用或提供平台裁切证据时，默认使用 `adaptation.mode: none`，只保留正常设计内边距；不得仅根据平台名或 preset 主动缩小内容、增加纸张留白带或声称已适配裁切。

## 内容规划

1. 把原文只读复制为 `runs/<run-id>/article.md`，计算 SHA-256，不修改来源文件。
2. 用 [references/prompt-templates/content-plan.md](references/prompt-templates/content-plan.md) 保存真实 `content-plan-prompt.md`。
3. 生成 `content-card.md`：
   - 一个 1～2 行标题簇和重点片段；文章已有标题时，默认只能调整换行和强调片段边界，按行拼接后的文字必须与来源标题逐字一致，包括空格、标点和英文大小写；
   - 一个白名单核心隐喻；
   - 3～4 个步骤、固定 icon ID 和语义；
   - `pose_id` 与可观察的 `pose_intent`；
   - 输出列表与完全相同宽高比的分组；
   - 主动省略内容。
4. 不得把缩写、润色、营销化改写或 AI 提炼标题混入普通内容卡审批。只有用户单独明确授权改写标题并批准具体新标题后，才允许偏离来源标题；普通的“批准内容卡”不构成改写授权。
5. 到达 `content-card-review` 后立即停止。
6. 用户批准后才写 `reviews/content-card.json` 和 `cover-spec.json` V3。Review 必须绑定当前内容卡 hash。

## 宽高比族

- 同组 outputs 必须具有完全相同宽高比，例如 `1200 × 628` 与 `600 × 314`。
- 每组选择一个 `master_output_id`。
- 同组使用一个已批准 master 等比派生精确尺寸。
- 比例不同必须创建不同组并重新调用 image_gen 构图，不能裁切旧母图代替。
- 只有同一上传图明确需要兼容多个中心裁切时，使用 `shared-crop-core`：group 增加 `semantic_core` 精确尺寸，全部组内 outputs 使用相同的理论裁切合同。此时 master 是语义核心，不是上传图。

## 完整母图

对每个 `aspect_group`：

1. 使用 [references/prompt-templates/cover.md](references/prompt-templates/cover.md) 写真实 `prompt.md`。
2. 写 `references.json`。必须包含正式主风格图和 `assets/ip/lux.png`；不同宽高比重构可增加已批准 master。
3. 生图前运行：

   ```bash
   node skills/lux-cover/scripts/guard-cover-attempt.mjs --run <run-id> --issue <group-id>
   ```

4. 完整读取宿主 `imagegen` Skill，并用内置 `image_gen` 生成一张完整封面。不得静默切换到需要 API Key 的外部路径。
   - 普通组按 master output 比例生成完整封面。
   - `shared-crop-core` 组按 `semantic_core` 比例生成完整语义画面；顶部 12.5% 只保留纯纸张纹理供确定性背景派生，不画外框、安全区标记或语义内容。
5. 用工具返回的真实 artifact 运行：

   ```bash
   node skills/lux-cover/scripts/register-master.mjs \
     --spec runs/<run-id>/cover-spec.json \
     --aspect-group <group-id> \
     --source <image-gen-artifact>
   ```

6. 登记结果必须包含不可覆盖的 `attempts/attempt-<n>/` 快照，以及组根目录当前 `raw.png`、精确尺寸 `master.png` 和 `artifact.json`。不得用本地替代图冒充 raw。

## 完整封面检查与 Review

1. 按 quality rubric 检查 `master.png` 并保存真实 `ai-review.json`。
2. 必须逐行记录预期标题和实际读到的标题；检查额外文字、全部身份 traits、pose intent、流程和风格。
3. 任一失败项或非空 `defects` 都不能提交批准。
4. AI 检查通过后展示 master、标题事实源、原始 artifact 和检查清单，停在 `full-cover-review`。
5. 只有用户批准后才写与当前 master hash 绑定的 `user-review.json`。

图片里的中文与露可丝身份不是机械事实。机械检查和 AI 自评不能替代用户 Review。

## 修正上限

- 每组最多两次：一次初始生成，加一次针对单一明确缺陷的定向修正。
- 修正 prompt 必须列出只改什么，以及哪些已接受内容必须保持。
- 第二次仍失败就停止报告；不能换 issue ID 静默重置。

## 平台截图校准

只有用户要求裁切保证时：

1. 保存用户真实平台截图为 `calibrations/<id>/source.png`。
2. 明确记录 platform、surface 和设备条件。
3. 分析上传图坐标系的 normalized `visible_crop`，写 `calibration.json`。
4. 展示截图、可见框和适用范围，停在 `platform-calibration-review`。
5. 用户批准后写与 calibration hash 绑定的 `review.json`。

一个截图不能自动代表整个平台。没有真实截图与批准记录时，不能启用 `evidence-safe-padding`，也不能声称平台裁切已保证。

用户明确要求理论安全区或多比例共同裁切实验、但没有平台截图时，可以生成标明假设范围的构图候选与裁切预览；它不是 `evidence-safe-padding`，不能冒充平台实测保证。安全区构图只使用用户批准的实际裁切交集和一层正常内边距，不得再叠加放大的百分比留白或额外整体缩小，否则会让裁切后仍然空旷。

用户批准一张上传图的多个理论中心裁切范围后，可以使用 `shared-crop-core`。把全部 normalized crop 原样写入 spec，以 `user-approved-theoretical-crops` 标记证据级别；代码计算共同交集，不能把理论范围描述成平台实测保证。

## 精确输出

完整母图和所需 calibration 均批准后运行：

```bash
node skills/lux-cover/scripts/render-v3.mjs --spec runs/<run-id>/cover-spec.json
node skills/lux-cover/scripts/validate-v3-run.mjs --run <run-id>
```

V3 渲染器：

- 同比例等比派生每个精确尺寸；
- 禁止横纵拉伸；
- 对 `evidence-safe-padding` 把完整封面缩入批准的 visible crop；
- 对 `shared-crop-core` 把已批准 semantic core 用 `fit: inside` 放入全部理论裁切的共同交集；从 core 顶部通过机械检查的纯纸张条带派生同源背景，并为每个 crop 生成实际裁切预览；
- 外围只补暖米白纸张纹理，不画第二边框、胶带、装饰或语义内容；
- 保存 output artifact、crop overlay、visible preview、references、validation 和 contact sheet。

## 最终 Review

展示所有最终输出、crop overlay、visible preview、contact sheet 和机械报告，停在 `final-output-review`。

用户批准后写 `reviews/final-output.json`，subject 是当前 `references.json`。再次运行 `validate-v3-run.mjs`；只有命令返回 `human_status: accepted` 才能描述为本次范围已接受。

## 调整路由

- 内容事实错误：回到内容卡并重新 Review。
- 生图标题、额外文字、身份、手、姿势、流程或风格错误：使用唯一一次定向修正。
- 单一比例构图错误：只重做对应 aspect group。
- 同比例尺寸、hash 或拉伸错误：修确定性代码并补测试，不重新生图。
- 平台范围错误：重新分析截图并 Review，不改母图。
- 共同裁切范围错误：修正 spec 中的理论 crop 并重新生成预览；如果交集比例改变导致构图不可接受，只重做对应 semantic core。
- 同源纸张样本含标题、人物、图标、装饰或明显墨迹：停止并重做 semantic core，不能静默换成固定背景。
- 安全留边外围错误：只修 platform adapter 并补测试。

## Review 返回

每个暂停点返回：

```yaml
status: waiting_for_user
skill: lux-cover
checkpoint: content-card-review | full-cover-review | platform-calibration-review | final-output-review
review_material: <绝对路径或完整内容>
question: <只询问本门禁需要确认的事项>
resume_from: <批准后的具体步骤>
```

外层 `rndflow skip/only` 可以从任意阶段进入，但先恢复依赖链中最早未满足的门禁。不得把用户沉默视为批准。

## 完成条件

实现或修改 Skill 后运行项目检查：

```bash
npm run build
```

普通封面必须同时通过机械检查与适用的人工门禁。不要发布、提交、推送或修改 `.env`，除非用户另行明确授权。
