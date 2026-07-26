# 露可丝段落说明图 V1 运行流程

## 1. 输入与恢复

开始前确认：

- Git 根目录是 `lux-cover-generator`。
- 用户指定的段落真实存在；把聊天文本或文件中的指定段落原样保存为 `runs/lux-paragraph-graph/<run-id>/source.md`。
- 用户明确给出每个 output 的最终 width 和 height。
- output 为横图，比例 1.5～2.5，单边 256～4096。
- runtime、visual vocabulary、paragraph profile overlay、共享基础 profile、露可丝 manifest、主风格图和 identity reference 都可加载。

缺少段落或最终尺寸时返回 `BLOCKED_INPUT`，不要用示例内容或平台常见尺寸代替。

从 `rndflow skip/only` 或中间阶段恢复时，先检查依赖链中最早未满足的 Review。可以跳过无关阶段，不能跳过适用的人审门禁。

## 2. 内容抽象和路由

1. 计算 `source.md` SHA-256。
2. 使用 `prompt-templates/visual-plan.md` 保存真实 `visual-plan-prompt.md`。
3. 只从原文提取：
   - 对象；
   - 对象之间的主要关系；
   - 作者明确结论或推荐；
   - 为理解结论必须保留的证据；
   - 可以主动省略的细节。
4. 用户未指定图型时，按主要关系选择：
   - 顺序与推进 → `flow`
   - 时间与阶段 → `timeline`
   - 候选与推荐 → `decision-map`
   - 候选与客观对比 → `comparison`
   - 原理、组成与机制 → `concept-diagram`
5. 生成 `visual-card.md`，使用 `formats.md` 的固定字段。
6. 停在 `visual-card-review`。

路由是 AI 判断，不是关键词匹配。存在多个信号时，在卡片中写首选图型和理由，让用户决定。

## 3. Visual Card Review 与 Spec

用户批准后：

1. 写 `reviews/visual-card.json`，subject 绑定当前 `visual-card.md` 路径和 SHA-256。
2. 按已批准卡片写 `graph-spec.json`。
3. 运行 spec 校验；不能为了通过校验改变用户批准的语义。
4. 按完全相同宽高比划分 `aspect_group`。

卡片改变后旧 Review 立即失效；不得把聊天中的零散修改只写进 prompt。

## 4. Prompt 与 Reference

对每个 aspect group：

1. 创建 `aspect-groups/<group-id>/`。
2. 使用 `prompt-templates/paragraph-graph.md` 写本次真实 `prompt.md`。
3. 从 spec 唯一计算 required text，逐条写入 prompt。
4. 写 `references.json`：
   - `primary-style-authority` 指向共享主风格图；
   - `mandatory-identity-reference` 指向共享露可丝 IP；
   - 其他比例重构可以增加已经批准的 `approved-paragraph-master-reference`。
5. reference 使用项目相对路径和实际 SHA-256。

## 5. 完整母图生成与登记

生图前运行：

```bash
node skills/lux-paragraph-graph/scripts/guard-graph-attempt.mjs \
  --run <run-id> \
  --issue <group-id>
```

然后：

1. 完整读取宿主 `imagegen` Skill。
2. 使用内置 `image_gen` 和 prompt/reference 生成一张完整段落图。
3. 不得使用测试 fixture、本地绘图或聊天缩略图冒充 raw。
4. 用真实 artifact 运行：

   ```bash
   node skills/lux-paragraph-graph/scripts/register-master.mjs \
     --spec runs/lux-paragraph-graph/<run-id>/graph-spec.json \
     --aspect-group <group-id> \
     --source <真实 artifact>
   ```

登记脚本验证 attempt、prompt、reference、Visual Card Review、PNG、比例漂移和共享资产 hash；保存不可覆盖快照后更新当前 raw/master/artifact。

## 6. AI Review 与定向修正

对每个 master 保存 `ai-review.json`：

- expected text 来自 spec 唯一计算结果；
- observed text 与 expected text 逐条一致；
- unexpected text 为空；
- allowed symbols 与 spec 一致；
- observed symbols 只能是 allowed symbols 的子集；
- unexpected symbols 为空；
- 露可丝全部 identity traits 已检查；
- pose ID 和 pose intent 成立；
- visual type、元素顺序和推荐关系成立；
- paragraph profile 成立，无完整外框；
- defects 为空。

AI 检查通过后展示 master、raw、文字/符号合同和检查清单，停在 `full-graph-review`。用户批准后写与 master hash 绑定的 `user-review.json`。

每组最多两次。第二次只能修一个明确缺陷，并保持其余已接受内容；仍失败就停止。

## 7. 精确输出

全部 master 批准后运行：

```bash
node skills/lux-paragraph-graph/scripts/render.mjs \
  --spec runs/lux-paragraph-graph/<run-id>/graph-spec.json
node skills/lux-paragraph-graph/scripts/validate-run.mjs --run <run-id>
```

渲染器：

- 只从同组已批准 master 等比派生；
- 使用单一缩放因子；
- 输出精确 width × height；
- 不做跨比例裁切；
- 保存 output artifact、聚合 references、validation 和 contact sheet。

## 8. 最终 Review

展示全部 outputs、contact sheet 和 validation，停在 `final-output-review`。

用户批准后：

1. 写 `reviews/final-output.json`，subject 是当前 `references.json`。
2. 再运行 `validate-run.mjs`。
3. 只有命令返回 `human_status: accepted` 才进入 `COMPLETED_SCOPE`。

## 9. 错误路由

- 图型、元素、推荐或省略错误：回到 Visual Card。
- 文字、额外符号、身份、手、姿势、结构或风格错误：使用唯一一次定向修正。
- 单一比例构图错误：只重做该组。
- 尺寸、比例、hash 或拉伸错误：修代码并补测试，不重新生图。
- 最终效果不接受：保持 `WAITING_FOR_USER`，记录具体反馈。

## 10. 状态

- `WAITING_FOR_VISUAL_CARD_REVIEW`
- `WAITING_FOR_FULL_GRAPH_REVIEW`
- `WAITING_FOR_FINAL_OUTPUT_REVIEW`
- `COMPLETED_SCOPE`
- `BLOCKED`
- `FAILED`
