# 露可丝封面 V3 质量 Rubric

机械校验只负责可证明事实。生图中的中文、露可丝身份和视觉接受度必须经过 AI 对照与用户人工 Review。

## 机械门禁

### 输入与来源

- 文章、内容卡、prompt、reference、raw artifact、master、calibration 和 Review 均使用 canonical path 与 SHA-256。
- 内容卡 Review 与当前内容卡 hash 匹配。
- 主风格 reference 与露可丝 identity reference 指向正式配置资产且 hash 匹配。
- raw 是本次登记的真实 PNG；登记前已运行 cover attempt guard。

### 母图与比例

- raw 与本组实际母图目标比例的相对误差不超过 renderer 配置。
- 普通组的 `master.png` 等于本组 `master_output_id` 的精确宽高；`shared-crop-core` 组等于 `semantic_core` 的精确宽高。
- raw 到 master 使用等比 `cover` 和居中裁切，`scale_x === scale_y`。
- 每个 aspect group 内的 outputs 具有完全相同宽高比。
- 不同比例不复用同一 master。
- 每组最多一次初始生成和一次定向修正。

### 最终输出

- 每个 PNG 的像素与 output `width × height` 完全一致。
- 同组尺寸派生使用单一缩放因子；禁止横向或纵向拉伸。
- output、artifact、crop overlay、visible preview、references、validation 和 contact sheet 全部存在且 hash 接线。
- 同一输入与批准 artifact 连续渲染两次得到相同 PNG SHA-256。

### 安全留边

- `evidence-safe-padding` 只使用与 output 平台和比例匹配的已批准 calibration。
- 完整普通封面全部位于 calibration 的 `visible_crop`。
- simulated-visible 的尺寸与 crop 像素框一致。
- 外围只来自 profile 纸张背景。
- 外围 `outer_border: false`、`decorations: false`、`semantic_content: false`。
- 内层封面的单一原边框可以保留。

### 共同裁切核心

- `shared-crop-core` 只使用 `user-approved-theoretical-crops`，不冒充截图 calibration。
- group 的 `master.png` 等于 `semantic_core.width × semantic_core.height`，raw 与 semantic core 比例漂移不超过配置。
- 2～4 个 display crops 均有正面积和正交集；标准 visible preview 等于交集像素尺寸。
- semantic core 使用 `fit: inside` 完整位于每个 display crop，禁止跨比例 `cover` 裁切和横纵拉伸。
- semantic core 顶部 12.5% 的样本通过纸张-only 检查；ink ratio 不超过 profile 阈值。
- 外围背景来自该样本的确定性镜像铺展，`outer_border`、`decorations` 和 `semantic_content` 均为 false。
- 每个 display crop 的实际预览存在，尺寸、crop、hash 与 output artifact 接线。
- 同一 master 与 spec 连续渲染两次得到相同上传图和预览 hash。

## AI 对照检查

- `title_expected` 与从 master 实际读到的 `title_observed` 逐行完全一致。
- 除逐字标题外，没有额外汉字、英文、数字、步骤标签、伪文字、签名、Logo 或水印。
- 标题只有一个层级簇，重点明确，手绘马克笔质感与主参考一致。
- 标题、露可丝、流程、纸张、箭头、边框和装饰属于同一视觉体系。
- 流程恰好 3～4 步，数量、顺序和语义与 spec 一致，不是矩形 PPT 卡片。
- 露可丝全部核心身份特征均逐项检查。
- pose 和 pose intent 可观察地成立；脸、手、手指和肢体自然。
- 人物通过朝向、手势或引导关系参与内容表达，不是孤立贴图。
- 画面保持暖米白、炭黑、珊瑚粉和少量青色，中等信息密度。
- 不出现企业蓝、白黄混排大标题、重阴影、Dashboard、糖果色、3D、玻璃、粒子、复杂 AI 场景或极简空旷。
- `defects` 必须为空才可提交完整封面 Review。

AI 检查是筛查，不是最终接受，也不是 OCR 机械证明。

## 人工 Review

1. `content-card-review`
   - 标题、重点、核心概念、流程、隐喻、姿势意图和尺寸分组准确。
2. `full-cover-review`
   - 逐字标题、额外文字、露可丝身份、脸、手、姿势、构图和手绘风格可接受。
3. `platform-calibration-review`
   - 截图对应的平台、surface、设备条件和可见范围准确。
4. `final-output-review`
   - 各尺寸成品、crop overlay、simulated-visible、安全留边后的传播效果和联系表可接受。

每个 Review 必须绑定当前 subject hash。任何人工门禁未批准时，状态保持 `WAITING_FOR_USER`。

## 两次独立质量要求

同一文章的正式质量验收需要两次独立完整生图。两次都分别执行固定 AI rubric 和人工 Review；不能批量生成多张后只挑最好的一张。测试 fixture 只验证管线，不能替代真实视觉验收。

## 定向修正规则

允许的完整封面缺陷类别：

- `title`
- `extra-text`
- `character-identity`
- `hand-or-pose`
- `flow-semantics`
- `composition`
- `profile-style`

初次生成后只允许针对一个明确类别修正一次。第二次仍失败时停止并报告，不无限重生。
