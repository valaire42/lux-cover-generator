# 完整段落说明图 Imagegen Prompt 模板

本模板用于每个 aspect group 的真实 `prompt.md`。不得把尖括号占位符原样传给图片模型。

## 任务

Use case: `infographic-diagram`

Create one complete inline explanatory image for a Chinese article at exact aspect ratio `<TARGET_WIDTH>:<TARGET_HEIGHT>`. This is not an article cover. Recompose for this ratio; do not stretch, crop, or extend another ratio.

## 输入图片角色

- `primary-style-authority`：暖米白纸张、炭黑粗糙马克笔、珊瑚粉强调、少量青色、手绘箭头/圆圈和中等信息密度的权威。
- `mandatory-identity-reference`：露可丝的脸、琥珀金眼睛、凌乱深棕短发、金色羽状发饰、墨绿色金边短背心、白色立领宽袖套装、圆形金色叶片徽章，以及腰侧绿色饰带与金色沙漏挂件的权威。
- `approved-paragraph-master-reference`（可选）：同一段落另一比例的已批准母图。只继承内容关系和视觉语言，不直接裁切或拉伸。

## 语义事实源

- visual type：`<VISUAL_TYPE>`
- 传播目标：`<COMMUNICATION_GOAL>`
- 主要关系：`<RELATIONSHIP_SUMMARY>`
- 元素和顺序：`<ELEMENTS>`
- 推荐理由：`<RECOMMENDATION_REASON_OR_NONE>`
- 主动省略：`<ACTIVE_OMISSIONS>`

按图型构图：

- `flow`：连续路线与清楚推进箭头。
- `timeline`：时间轨道、阶段点与前后变化。
- `decision-map`：从选择入口分叉，用珊瑚粉圈选唯一推荐项。
- `comparison`：平衡并列或对照，不使用推荐星，不做表格或卡片墙。
- `concept-diagram`：中心概念与部件、原因或机制的连接。

## 精确文字合同

以下每个字符串必须逐字出现一次：

```text
<REQUIRED_TEXT_VERBATIM>
```

- 保持每个汉字、英文大小写、空格、数字和标点。
- 除上述规定文字外，不出现其他汉字、英文、数字、伪文字、Logo、签名或水印。

允许作为图标语义出现的符号：

```text
<ALLOWED_SYMBOLS_OR_NONE>
```

允许符号不是额外标签；只在对应图标内部克制出现。未列出的文字型符号不要出现。

## 露可丝

- pose ID：`<POSE_ID>`
- pose intent：`<POSE_INTENT>`
- target element：`<TARGET_ELEMENT_OR_NONE>`
- 露可丝位于右侧或适合关系表达的位置，占画布宽度约 18%～24%。
- 她通过手势、朝向或比较动作参与内容，但不是唯一视觉主体。
- 保持凌乱深棕短发、金色羽状发饰、琥珀金眼睛、墨绿色金边短背心、白色立领宽袖套装、圆形金色叶片徽章，以及腰侧绿色饰带与金色沙漏挂件。
- 手、手指和肢体自然；无重复手、额外手指或融合肢体。

## 风格

- 暖米白纤维纸张、炭黑粗糙马克笔、珊瑚粉主强调、极少量浅青。
- 小题头，中等信息密度，约 75%～85% 视觉填充。
- 使用不规则重复线、箭头、圆圈、下划线、涂抹和少量笔记装饰。
- 不画完整外边框。
- 题头、元素、图标、露可丝和装饰属于同一套手绘语言。

## 禁止

禁止企业蓝渐变、封面式超大标题、PPT 流程框、Dashboard、比较表格、矩形卡片墙、重阴影、玻璃拟态、发光粒子、光滑 3D、糖果色、石油绿/橙棕主色、复杂 AI 大脑/机器人/未来城市场景、大面积空白和额外文字。

## 定向修正

初次生成后只允许再修正一次。修正 prompt 必须写明一个具体缺陷、需要改变的内容和全部必须保持不变的已接受部分。
