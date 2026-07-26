# 露可丝段落说明图 V1 质量 Rubric

机械校验只负责可证明事实。图片中的文字、露可丝身份、关系表达和审美必须经过 AI 对照与用户 Review。

## 机械门禁

- source、Visual Card、Review、prompt、references、raw、master 和 outputs 使用 canonical path 与 SHA-256。
- Visual Card Review 与当前卡片 hash 匹配。
- 主风格和 identity reference 指向共享正式资产且 hash 匹配。
- raw 是本次登记的真实 PNG；登记前已运行 attempt guard。
- 每个 aspect group 最多一次初始生成和一次定向修正。
- raw 到 master 使用等比 cover 和单一缩放因子。
- 每组 outputs 具有完全相同宽高比。
- 不同比例不复用同一 master。
- 每个最终 PNG 精确匹配用户指定 width × height。
- master 到 output 使用单一缩放因子；禁止横向或纵向拉伸。
- 同一批准 master 连续渲染两次得到相同 output SHA-256。
- artifact、references、validation 和 contact sheet 全部存在且 hash 接线。

## AI 对照检查

- `expected_text` 等于从当前 spec 唯一计算的规定文字。
- `observed_text` 与 expected text 逐条完全一致。
- `unexpected_text` 为空。
- `allowed_symbols` 与 spec 一致。
- `observed_symbols` 只包含允许符号；`unexpected_symbols` 为空。
- 露可丝全部核心 identity traits 逐项检查。
- pose ID 和 pose intent 可观察地成立；脸、手、手指和肢体自然。
- visual type、元素数量、顺序、角色和主要关系符合 spec。
- `decision-map` 的唯一推荐项正确；`comparison` 没有暗示推荐。
- 小题头不抢文章层级；人物约占 18%～24%，参与说明但不主导。
- 暖米白、炭黑、珊瑚粉和少量青色属于同一手绘体系。
- 没有完整外边框、PPT 框、Dashboard、表格、企业蓝、3D、玻璃、粒子、糖果色或大面积空白。
- `defects` 为空。

AI 检查是筛查，不是 OCR 机械证明，也不是最终接受。

## 人工 Review

1. `visual-card-review`
   - 图型、路由理由、题头、元素、关系、推荐、姿势、允许符号、主动省略和尺寸组准确。
2. `full-graph-review`
   - 逐字文字、额外文字/符号、露可丝身份、脸、手、姿势、关系构图和风格可接受。
3. `final-output-review`
   - 所有精确尺寸成品和 contact sheet 可接受。

每个 Review 必须绑定当前 subject hash。任何人审未批准时保持 `WAITING_FOR_USER`。

## 定向修正

允许缺陷类别：

- `text`
- `extra-text`
- `unexpected-symbol`
- `character-identity`
- `hand-or-pose`
- `structure`
- `composition`
- `profile-style`

初次生成后只针对一个类别修正一次；第二次仍失败时停止。
