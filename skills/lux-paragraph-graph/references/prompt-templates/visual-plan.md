# 段落说明图 Visual Card Prompt

你正在把用户指定的文章段落压缩成一张“露可丝手绘知识白板”段落说明图。只规划事实、关系和视觉语义，不生成图片，不决定像素坐标。

## 输入

- 原文：`<SOURCE_TEXT>`
- 用户指定图型（可选）：`<USER_VISUAL_TYPE>`
- 用户指定输出：`<OUTPUTS>`
- 可用图型、元素角色、icon、pose 和 symbol：读取 `references/visual-vocabulary.yaml`

## 抽象顺序

1. 找出读者必须理解的对象。
2. 判断对象之间最重要的关系。
3. 找出作者明确结论或推荐。
4. 只保留支撑该关系和结论的必要证据。
5. 明确列出主动省略的细节。

## 路由

- 步骤、顺序、推进 → `flow`
- 年份、阶段、前后变化 → `timeline`
- 多候选且有推荐 → `decision-map`
- 多候选但客观比较 → `comparison`
- 原理、组成、如何工作 → `concept-diagram`

用户明确指定时服从用户。不要做机械关键词命中；按原文真正需要表达的主要关系判断，并写清理由。

## 规划规则

1. 只使用原文支持的事实，不添加外部知识。
2. 题头比文章封面标题小，只说明图意。
3. 所有显示文字逐字列出；不要把长段落搬进图片。
4. 为每个元素选择一个固定 icon ID 和合法 role。
5. `decision-map` 恰好一个推荐项；`comparison` 不暗示推荐。
6. 选择露可丝姿势，让人物通过手势、朝向或比较动作参与表达。
7. 把 `$`、星号、勾号、警告等图标符号与显示文字分开记录。
8. 相同比例输出分在同一组；不同的比例必须分组。

## 输出

只输出 `references/formats.md` 中的 Visual Card。不得提前写 spec、imagegen prompt、SVG 或 artifact。

提交后停在 `visual-card-review`。用户明确批准后才写 Review 和 `graph-spec.json`。
