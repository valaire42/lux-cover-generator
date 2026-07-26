# V3 封面内容规划 Prompt

你正在为文章生成“露可丝手绘知识白板”封面内容卡。只规划事实和语义，不生成图片，不决定像素坐标。

## 输入

- 文章全文：`<ARTICLE>`
- 用户指定输出：`<OUTPUTS>`
- 可用隐喻 ID：`evidence-loop`、`learning-path`、`build-cycle`、`filter-funnel`
- 可用图标 ID：`clipboard-check`、`human-review`、`sandbox-test`、`evidence-verdict`、`lightbulb`、`document`、`loop`、`code`
- 建议姿势 ID：`presenting`、`pointing`、`thinking`

## 规划规则

1. 只从文章提炼，不添加文章未支持的结论。
2. 输入是已有标题的文章时，标题文字以来源文章标题为唯一事实源。只能选择 1～2 行换行位置和强调片段边界；按行拼接后的标题必须与来源标题逐字一致，包括空格、标点和英文大小写。不得缩写、润色、改写、补字、删字或另拟更有传播感的标题。
3. 只有用户在普通内容卡审批之外单独明确授权改写标题，并批准具体候选标题后，才允许偏离来源标题；普通的“批准内容卡”不构成标题改写授权。输入是无标题 brief 时，使用用户给出的标题；缺少标题则停下来请求标题。
4. 选择一个白名单视觉隐喻表达核心关系。
5. 流程为 3～4 步，每步选择一个白名单 `icon_id` 并写清语义；封面默认不显示长标签。
6. 选择一个语义 `pose_id`，并用可观察动作写出 `pose_intent`。
7. 按完全相同的宽高比划分 `aspect_group`；相似但不相同的比例必须分组。
8. 说明主动省略的次要信息，避免把封面变成全文摘要。

## 输出

只输出 `references/formats.md` 中的 V3 内容卡。不得提前写 `cover-spec.json`、生图 prompt、SVG、任意颜色、像素坐标或文件路径。

提交后停在 `content-card-review`。用户明确批准后，才保存与内容卡 SHA-256 绑定的 Review，并写 V3 spec。
