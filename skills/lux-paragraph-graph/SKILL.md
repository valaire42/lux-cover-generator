---
name: lux-paragraph-graph
description: >
  把用户指定的文章段落转成带露可丝形象的横向手绘说明图：先在 flow、timeline、decision-map、comparison、concept-diagram 中选择关系图型并生成 Visual Card，经过人工确认后使用内置 image_gen 生成完整母图，再保存真实 prompt/reference/raw artifact，确定性输出精确像素和同比例多尺寸。用户要求为文章正文制作段内图、流程图、时间线、选择路线图、客观对比图或概念结构图时使用。保留 Visual Card、完整母图和最终输出三个人工 Review；不用于文章封面、方图/竖图、自动发布、Markdown 写回或平台裁切校准。
---

# 露可丝段落说明图

采用“AI 选择关系与构图 + image_gen 完整生图 + 代码保证 artifact 和精确尺寸”。Visual Card 是语义事实源；prompt 和图片是派生产物。

## 启动

1. 运行 `pwd` 与 `git rev-parse --show-toplevel`，确认根目录为 `lux-cover-generator`；不一致时停止。
2. 完整读取 [references/workflow.md](references/workflow.md)。
3. 准备 Visual Card、spec 或 Review 时，完整读取 [references/formats.md](references/formats.md)。
4. 加载：
   - `assets/runtime.json`
   - [references/visual-vocabulary.yaml](references/visual-vocabulary.yaml)
   - [references/visual-profiles/lux-whiteboard-paragraph.yaml](references/visual-profiles/lux-whiteboard-paragraph.yaml)
   - [references/quality-rubric.md](references/quality-rubric.md)
5. 按 overlay 的 `extends` 加载共享基础 profile、露可丝 IP manifest、主风格图和 identity reference；不得复制或改写这些共享资产。
6. 用户必须明确给出每个 output 的最终 `width` 和 `height`。V1 只支持比例 1.5～2.5、单边 256～4096 的横图；不猜测尺寸。

## 内容抽象与视觉路由

1. 把用户指定段落原样保存为 `runs/lux-paragraph-graph/<run-id>/source.md` 并计算 SHA-256。
2. 用 [references/prompt-templates/visual-plan.md](references/prompt-templates/visual-plan.md) 保存真实 `visual-plan-prompt.md`。
3. 用户明确指定图型时服从用户；否则按主要关系选择：
   - 步骤、顺序、推进：`flow`
   - 年份、阶段、前后变化：`timeline`
   - 多候选且有推荐：`decision-map`
   - 多候选但客观比较：`comparison`
   - 原理、组成、如何工作：`concept-diagram`
4. 生成 `visual-card.md`，写明路由理由、传播目标、题头、元素、关系、推荐、露可丝姿势、允许符号、主动省略和输出组。
5. 立即停在 `visual-card-review`。用户批准前不得写 `graph-spec.json` 或生图 prompt。
6. 用户批准后写与当前 Visual Card SHA-256 绑定的 `reviews/visual-card.json`，再写严格的 `graph-spec.json`。

AI 负责判断关系；代码只校验已批准结构。不要实现或假装存在关键词分类器。

## 宽高比组

- 每个 output 只属于一个 `aspect_group`。
- 同组 outputs 必须具有完全相同宽高比。
- 每组选择一个 `master_output_id`。
- 同组从一个已批准 master 等比派生精确尺寸。
- 比例不同必须建立新组并重新调用 image_gen；不能从旧 master 裁切代替。

## 完整母图

对每个 `aspect_group`：

1. 使用 [references/prompt-templates/paragraph-graph.md](references/prompt-templates/paragraph-graph.md) 写真实 `prompt.md`。
2. 写 `references.json`，至少包含正式主风格图和露可丝 identity reference；其他比例可以增加已批准的 paragraph master。
3. 生图前运行：

   ```bash
   node skills/lux-paragraph-graph/scripts/guard-graph-attempt.mjs \
     --run <run-id> \
     --issue <group-id>
   ```

4. 完整读取宿主 `imagegen` Skill，用内置 `image_gen` 生成完整段落图。不得静默切换到需要 API Key 的外部接口。
5. 用工具返回的真实 artifact 运行：

   ```bash
   node skills/lux-paragraph-graph/scripts/register-master.mjs \
     --spec runs/lux-paragraph-graph/<run-id>/graph-spec.json \
     --aspect-group <group-id> \
     --source <真实-image-gen-artifact>
   ```

6. 登记结果必须包含不可覆盖的 `attempts/attempt-<n>/`，以及当前 `raw.png`、精确尺寸 `master.png` 和 `artifact.json`。

## AI 检查与完整母图 Review

1. 按 quality rubric 检查 `master.png` 并保存真实 `ai-review.json`。
2. 逐项记录 expected/observed/unexpected text 和 allowed/observed/unexpected symbols。
3. 检查露可丝全部 identity traits、pose intent、visual type、元素顺序、推荐关系、paragraph profile 和缺陷。
4. 任一失败项或非空 `defects` 都不能提交批准。
5. AI 检查通过后展示 master、raw、文字/符号合同和检查清单，停在 `full-graph-review`。
6. 用户批准后才写与当前 master hash 绑定的 `user-review.json`。

中文、露可丝身份和审美不是机械事实。AI 自评不能替代用户 Review。

## 修正上限

- 每组最多两次：一次初始生成，加一次只针对单一明确缺陷的定向修正。
- 修正 prompt 必须列出只改什么，以及哪些已接受内容必须保持。
- 第二次仍失败就停止；不能更换 issue ID 绕过上限。

## 精确输出与最终 Review

所有 master 均批准后运行：

```bash
node skills/lux-paragraph-graph/scripts/render.mjs \
  --spec runs/lux-paragraph-graph/<run-id>/graph-spec.json
node skills/lux-paragraph-graph/scripts/validate-run.mjs --run <run-id>
```

渲染器只做同组等比派生、精确像素、artifact、validation 和 contact sheet；不重画文字，不做跨比例裁切。

展示全部输出、contact sheet 和机械报告，停在 `final-output-review`。用户批准后写 `reviews/final-output.json`，subject 是当前聚合 `references.json`。再次运行 `validate-run.mjs`；只有返回 `human_status: accepted` 才能描述为本次范围已接受。

## Review 返回

每个暂停点返回：

```yaml
status: waiting_for_user
skill: lux-paragraph-graph
checkpoint: visual-card-review | full-graph-review | final-output-review
review_material: <绝对路径或完整内容>
question: <只询问本门禁需要确认的事项>
resume_from: <批准后的具体步骤>
```

外层 `rndflow skip/only` 可以从中间阶段进入，但必须恢复依赖链中最早未满足的 Review。不得把用户沉默视为批准。

## 调整路由

- 原文抽象、图型、题头、元素或推荐关系错误：回到 Visual Card 并重新 Review。
- 生图文字、额外文字/符号、身份、手、姿势、结构或风格错误：使用唯一一次定向修正。
- 单一比例构图错误：只重做对应 aspect group。
- 同比例尺寸、hash 或拉伸错误：修确定性代码并补测试，不重新生图。
- 最终尺寸传播效果不接受：记录用户指出的具体问题，不伪造批准。

## 完成边界

实现或修改 Skill 后运行 `npm run build`；项目检查会覆盖两个 Skill 的文件完整性、脚本语法、配置接线、正式素材 hash、软链接和占位扫描。

不要自动扫描或写回 Markdown，不做批量、发布、平台 calibration、方图/竖图、Web UI、数据库或服务。不要修改 `.env`、提交、推送、发布、删除旧代码或搬迁共享资产，除非用户另行明确授权。
