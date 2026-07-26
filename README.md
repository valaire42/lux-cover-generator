# Lux Cover Generator

一套面向 Codex 的文章视觉生成 Skills，用来制作带露可丝个人 IP 的横向文章封面和段内说明图。

这个项目不把整张图片交给一次性的自由生成，也不试图用代码模拟所有手绘细节。它采用：

- AI 从文章中提取结构化视觉计划；
- 内置 `image_gen` 根据正式风格图和人物参考生成完整画面；
- Node.js 脚本登记真实 artifact，并确定性保证精确像素、等比缩放和输出验证；
- 人工确认内容方向、完整图片和最终输出。

## 包含的 Skills

### `lux-cover`

根据文章或 brief 生成横向文章封面。

主要能力：

- 从文章生成标题、核心视觉隐喻、3～4 个流程步骤和露可丝动作意图；
- 使用“手绘知识白板风”与露可丝身份参考生成完整封面；
- 按不同宽高比分别生成母图，同一比例下等比派生多个精确尺寸；
- 根据用户提供的平台裁切截图校准安全区；
- 在安全区外围只补暖米白纸张背景，不制造第二层外框；
- 保存 Prompt、Reference、Raw、Master、裁切预览和验证报告。

人工门禁：

1. 内容卡确认；
2. 完整封面确认；
3. 可选的平台裁切校准确认；
4. 最终输出确认。

### `lux-paragraph-graph`

把文章段落转成横向手绘说明图。

支持的关系图型：

- `flow`：步骤、顺序和推进；
- `timeline`：时间、阶段和前后变化；
- `decision-map`：多个候选及明确推荐；
- `comparison`：多个候选的客观比较；
- `concept-diagram`：原理、组成和工作机制。

它会先生成 Visual Card，明确图型、题头、元素、关系、露可丝姿势、允许符号和主动省略内容；人工确认后才进入生图。

人工门禁：

1. Visual Card 确认；
2. 完整说明图确认；
3. 最终输出确认。

## 视觉方向

默认视觉 Profile 是“露可丝手绘知识白板风”：

- 暖米白纸张；
- 炭黑色粗糙马克笔；
- 珊瑚粉主强调色；
- 少量青色辅助；
- 手绘箭头、圆圈、下划线和涂抹；
- 中等信息密度；
- 露可丝作为参与内容表达的讲解者；
- 不使用企业蓝 PPT、Dashboard 卡片、玻璃拟态、光滑 3D 或完整外围边框。

正式人物和风格素材位于：

```text
skills/lux-cover/assets/ip/
skills/lux-cover/assets/style-references/
```

当前正式人物素材是露可丝透明 PNG；复用这套工作流时，只能使用自己拥有使用权的 IP，并同步更新身份 manifest、Prompt 和相关 Profile。

## 项目结构

```text
.
├── skills/
│   ├── lux-cover/
│   │   ├── SKILL.md
│   │   ├── agents/
│   │   ├── assets/
│   │   ├── references/
│   │   └── scripts/
│   └── lux-paragraph-graph/
│       ├── SKILL.md
│       ├── agents/
│       ├── assets/
│       ├── references/
│       └── scripts/
├── .agents/skills/
├── .claude/skills/
├── package.json
└── README.md
```

`skills/<name>/` 是唯一正式来源；`.agents/skills/` 和 `.claude/skills/` 只包含指向正式目录的发现软链接，不维护多份 Skill 文本。

运行产生的文章、Prompt、Review、Raw、Master、预览和验证报告保存在 `runs/`，该目录不会提交到 Git。

## 环境要求

- Codex，并且可以使用内置 `image_gen`；
- Node.js `>= 20.9.0`；
- npm。

安装确定性图片处理依赖：

```bash
npm install
```

检查两个 Skills 的文件完整性、脚本语法、配置接线、素材 hash 和软链接：

```bash
npm run build
```

## 使用方式

在 Codex 中打开本项目，直接用自然语言调用 Skill。

生成文章封面：

```text
使用 lux-cover，根据这篇文章生成一张 1920 × 1080 的文章封面。
```

生成段内流程图：

```text
使用 lux-paragraph-graph，把下面这段内容生成一张 1600 × 900 的 flow 说明图。
```

Skill 会在适用的人工 Review 位置暂停。回复“批准”后才会继续下一阶段；机械检查和 AI 自检不会替代人的最终接受。

## 在其他项目中调用

本仓库内部已经提供 Codex 与 Claude 的项目级发现软链接。如果希望从另一个项目调用，可以在目标项目中建立指向本仓库正式 Skill 目录的软链接，例如：

```bash
mkdir -p .agents/skills
ln -s /absolute/path/to/lux-cover-generator/skills/lux-cover \
  .agents/skills/lux-cover
ln -s /absolute/path/to/lux-cover-generator/skills/lux-paragraph-graph \
  .agents/skills/lux-paragraph-graph
```

这样仍然只需要维护本仓库中的一份 Skill 文本。

## 当前边界

- 只支持横图，宽高比范围为 `1.5～2.5`；
- 用户必须明确提供最终宽度和高度；
- 不同宽高比必须分别生成母图，不能通过强行裁切或拉伸复用；
- 不自动发布内容；
- 不自动扫描或写回文章 Markdown；
- 不把人工 Review 静默视为批准；
- 单个宽高比组最多生成两次，第二次只能针对一个明确缺陷修正。
