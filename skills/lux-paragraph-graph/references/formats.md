# 段落说明图格式

所有 JSON 使用 UTF-8、两个空格缩进和末尾换行。运行路径必须是项目相对路径；人工 Review 必须绑定当前 subject SHA-256。

## 1. Visual Card

`runs/lux-paragraph-graph/<run-id>/visual-card.md`：

```markdown
# 段落图 Visual Card：<run-id>

## 来源
- 路径：runs/lux-paragraph-graph/<run-id>/source.md
- SHA-256：<hash>

## 路由
- visual_type：decision-map
- 理由：多个候选、适用人群和作者明确推荐

## 传播目标
- <一句话>

## 题头
- <逐字题头>

## 元素
1. <id> — <role> — <icon_id>
   - 主文字：<逐字文字>
   - 辅助文字：<0～2 条逐字文字>

## 主要关系
- <元素之间的关系>

## 推荐
- 对象：<decision-map 的推荐元素；其他类型为无>
- 理由：<推荐理由；其他类型为无>

## 露可丝
- identity_id：lux
- pose_id：pointing
- pose_intent：<可观察动作>
- target_element_id：<元素 ID 或无>

## 允许符号
- <symbol_id；没有则写无>

## 主动省略
- <省略内容及原因>

## 输出与比例组
- <group-id>
  - <output-id> — <width> × <height>

## Review
- 选项：批准 / 修改 / 停止
```

## 2. 通用人工 Review

```json
{
  "version": 1,
  "checkpoint": "visual-card-review",
  "status": "approved",
  "subject": {
    "path": "runs/lux-paragraph-graph/run-id/visual-card.md",
    "sha256": "64-char-lowercase-hex"
  },
  "reviewed_at": "2026-07-24T00:00:00.000Z",
  "notes": "用户明确批准当前 Visual Card"
}
```

允许 checkpoint：

- `visual-card-review`
- `full-graph-review`
- `final-output-review`

固定位置：

- `reviews/visual-card.json` → `visual-card.md`
- `aspect-groups/<id>/user-review.json` → 当前 `master.png`
- `reviews/final-output.json` → 当前聚合 `references.json`

## 3. `graph-spec.json`

顶层字段固定为：

```text
version, run_id, source, visual_card, profile_id, plan, character, aspect_groups, outputs
```

`plan`：

```text
visual_type, title, communication_goal, relationship_summary,
elements, recommendation_reason, allowed_symbols, active_omissions
```

每个 element：

```text
id, primary_text, secondary_texts, icon_id, role
```

每个 output：

```text
id, width, height, aspect_group_id
```

规定文字按以下顺序唯一计算：

1. `plan.title`
2. 每个 element 的 `primary_text`
3. 紧随该 element 的全部 `secondary_texts`

露可丝没有固有文字；所有可见文字均必须进入规定文字。

## 4. Aspect Group References

```json
{
  "version": 1,
  "generator": "built-in-image_gen",
  "references": [
    {
      "role": "primary-style-authority",
      "path": "skills/lux-cover/assets/style-references/whiteboard-primary.png",
      "sha256": "64-char-lowercase-hex"
    },
    {
      "role": "mandatory-identity-reference",
      "path": "skills/lux-cover/assets/ip/lux.png",
      "sha256": "64-char-lowercase-hex"
    }
  ]
}
```

可选 role：`approved-paragraph-master-reference`。它必须指向同一正式运行根下已经通过 `full-graph-review` 的 master。

## 5. AI Review

```json
{
  "version": 1,
  "status": "passed",
  "expected_text": ["云端 ComfyUI 怎么选？", "RunComfy", "开箱即用"],
  "observed_text": ["云端 ComfyUI 怎么选？", "RunComfy", "开箱即用"],
  "text_exact": true,
  "unexpected_text": [],
  "allowed_symbols": ["currency-dollar", "star"],
  "observed_symbols": ["currency-dollar", "star"],
  "unexpected_symbols": [],
  "identity": {
    "status": "passed",
    "checked_traits": ["tousled-dark-brown-bob"]
  },
  "pose": {
    "status": "passed",
    "pose_id": "pointing",
    "intent_observed": true
  },
  "structure": {
    "status": "passed",
    "visual_type": "decision-map",
    "element_ids": ["runcomfy"],
    "recommended_element_id": "runcomfy"
  },
  "style": {
    "status": "passed",
    "profile_id": "lux-whiteboard-paragraph",
    "paragraph_hierarchy_observed": true,
    "no_full_outer_border": true
  },
  "defects": []
}
```

正式 `checked_traits` 必须包含共享 manifest 中的全部 traits；示例只展示字段形状。

## 6. 聚合 Validation

```json
{
  "version": 1,
  "status": "mechanically-passed",
  "human_status": "pending-final-output-review",
  "run_id": "run-id",
  "outputs": [
    {
      "output_id": "inline-1600x900",
      "aspect_group_id": "wide-169",
      "width": 1600,
      "height": 900,
      "sha256": "64-char-lowercase-hex",
      "transform": {
        "scale_x": 1,
        "scale_y": 1,
        "direct_stretch": false
      },
      "mechanical_status": "passed",
      "human_status": "pending"
    }
  ]
}
```

`render.mjs` 只写机械状态。`validate-run.mjs` 找到与当前 `references.json` hash 匹配的最终 Review 后，才返回 `human_status: accepted`。
