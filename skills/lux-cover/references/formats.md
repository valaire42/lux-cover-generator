# V3 内容、Review 与 Artifact 格式

所有 JSON 使用 UTF-8、两个空格缩进和末尾换行。运行路径必须是项目相对路径；用户 Review 必须绑定当前产物 SHA-256。

## 1. V3 内容卡

`runs/<run-id>/content-card.md`：

```markdown
# 封面内容卡：<run-id>

## 来源
- 文章：runs/<run-id>/article.md
- SHA-256：<hash>

## 标题
- 第 1 行：普通「让 」；强调「Skill」
- 第 2 行：普通「自己证明自己」

## 核心概念
- 摘要：让 Skill 用证据验证声称
- metaphor_id：evidence-loop

## 流程
1. claims — clipboard-check — 声称清单
2. review — human-review — 人工审阅
3. test — sandbox-test — 沙箱实测
4. verdict — evidence-verdict — 证据结论

## 露可丝
- identity_id：lux
- pose_id：pointing
- pose_intent：露可丝从右侧用食指指向证据结论

## 输出与比例组
- wide-191
  - cover-large — custom-landscape — 1200 × 628
  - cover-small — custom-landscape — 600 × 314

## 主动省略
- <封面未承载的信息及原因>

## Review
- 选项：批准 / 修改内容 / 停止
```

没有第二行标题时不写空行。比例相似但不完全相同的输出不能放在同组。

## 2. 通用人工 Review

内容卡、完整母图、calibration 和最终输出都使用相同 envelope：

```json
{
  "version": 1,
  "checkpoint": "content-card-review",
  "status": "approved",
  "subject": {
    "path": "runs/article-slug/content-card.md",
    "sha256": "64-char-lowercase-hex"
  },
  "reviewed_at": "2026-07-23T00:00:00.000Z",
  "notes": "用户明确批准当前内容卡"
}
```

允许的 checkpoint：

- `content-card-review`
- `full-cover-review`
- `platform-calibration-review`
- `final-output-review`

`status` 只有用户明确批准后才能写 `approved`。聊天沉默、机械通过或 AI 自评不能生成批准记录。subject 变化后旧 Review 返回 `STALE_REVIEW`。

固定位置：

- `reviews/content-card.json` → `content-card.md`
- `aspect-groups/<id>/user-review.json` → 当前 `master.png`
- `calibrations/<id>/review.json` → 当前 `calibration.json`
- `reviews/final-output.json` → 聚合 `references.json`

## 3. `cover-spec.json` V3

顶层字段固定为：

```json
{
  "version": 3,
  "run_id": "article-slug",
  "source": {
    "article_path": "runs/article-slug/article.md",
    "article_sha256": "64-char-lowercase-hex"
  },
  "profile_id": "lux-whiteboard",
  "title": {
    "lines": [
      {
        "segments": [
          { "text": "让 ", "emphasis": false },
          { "text": "Skill", "emphasis": true }
        ]
      },
      {
        "segments": [
          { "text": "自己证明自己", "emphasis": false }
        ]
      }
    ]
  },
  "core_concept": {
    "summary": "让 Skill 用证据验证声称",
    "metaphor_id": "evidence-loop"
  },
  "flow": {
    "items": [
      { "id": "claims", "icon_id": "clipboard-check", "meaning": "声称清单" },
      { "id": "review", "icon_id": "human-review", "meaning": "人工审阅" },
      { "id": "test", "icon_id": "sandbox-test", "meaning": "沙箱实测" },
      { "id": "verdict", "icon_id": "evidence-verdict", "meaning": "证据结论" }
    ]
  },
  "character": {
    "identity_id": "lux",
    "pose_id": "pointing",
    "pose_intent": "露可丝从右侧用食指指向证据结论"
  },
  "aspect_groups": [
    {
      "id": "wide-191",
      "master_output_id": "cover-large"
    }
  ],
  "outputs": [
    {
      "id": "cover-large",
      "platform_id": "custom-landscape",
      "width": 1200,
      "height": 628,
      "aspect_group_id": "wide-191",
      "adaptation": { "mode": "none" }
    },
    {
      "id": "cover-small",
      "platform_id": "custom-landscape",
      "width": 600,
      "height": 314,
      "aspect_group_id": "wide-191",
      "adaptation": {
        "mode": "evidence-safe-padding",
        "calibration_path": "runs/article-slug/calibrations/x-feed/calibration.json"
      }
    }
  ]
}
```

严格规则：

- 拒绝未知与缺失字段。
- ID 为小写字母、数字和连字符，最长 64 字符。
- 标题 1～2 行，每行 1～4 个非空片段，至少一个重点片段。
- 流程 3～4 步，ID 唯一；icon 与 metaphor 只能来自 renderer 白名单。
- output 1～6 个；单边 256～4096；比例 1.5～2.5；总像素不超过配置。
- 同组 output 通过整数交叉乘法得到完全相同宽高比。
- group 的 `master_output_id` 必须引用本组 output。
- `pose_id` 是语义；人物姿势由完整封面生成过程实现，不绑定透明 pose variant。
- adaptation 只允许 `none`、`evidence-safe-padding` 或 `shared-crop-core`。
- calibration 路径必须等于 `runs/<run-id>/calibrations/<id>/calibration.json`。

### 3.1 `shared-crop-core`

同一张 16:10 上传图需要兼容理论 4:3 与 16:9 中心裁切时：

```json
{
  "aspect_groups": [
    {
      "id": "bilibili-shared",
      "master_output_id": "bilibili-upload",
      "semantic_core": {
        "width": 1500,
        "height": 1000
      }
    }
  ],
  "outputs": [
    {
      "id": "bilibili-upload",
      "platform_id": "bilibili-landscape",
      "width": 1920,
      "height": 1200,
      "aspect_group_id": "bilibili-shared",
      "adaptation": {
        "mode": "shared-crop-core",
        "basis": "user-approved-theoretical-crops",
        "visible_crops": [
          {
            "id": "center-4x3",
            "left": 0.08333333333333333,
            "top": 0,
            "right": 0.9166666666666666,
            "bottom": 1
          },
          {
            "id": "center-16x9",
            "left": 0,
            "top": 0.05,
            "right": 1,
            "bottom": 0.95
          }
        ]
      }
    }
  ]
}
```

严格规则：

- `visible_crops` 为 2～4 个唯一小写 hyphen ID。
- 每个 normalized crop 位于 `[0,1]`、有正面积，全部 crop 有正交集。
- `basis` 只能是 `user-approved-theoretical-crops`。
- 使用该 mode 的 group 必须声明 `semantic_core`；声明后的全部组内 outputs 都使用该 mode。
- semantic core 与 outputs 分别遵守 V3 尺寸、比例和像素限制。
- 同组 outputs 仍使用完全相同的上传比例；semantic core 可以使用不同的生图比例。
- 理论 crop 不是 calibration，不能声明平台已实测保证。

## 4. 完整母图 references

`aspect-groups/<group-id>/references.json`：

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

可选 role 为 `approved-master-cover-reference`。所有 reference 必须位于项目内且 hash 匹配；身份和主风格 role 必须指向正式配置资产。

登记时把每次 prompt、references、raw、master 和 artifact 保存到 `aspect-groups/<id>/attempts/attempt-<n>/`。同一 attempt 目录禁止覆盖；组根目录只表示当前候选。

## 5. AI 完整封面检查

`aspect-groups/<group-id>/ai-review.json`：

```json
{
  "version": 1,
  "status": "passed",
  "title_expected": ["让 Skill", "自己证明自己"],
  "title_observed": ["让 Skill", "自己证明自己"],
  "title_exact": true,
  "extra_text": [],
  "identity": {
    "status": "passed",
    "checked_traits": [
      "tousled-dark-brown-bob",
      "golden-feather-hair-ornament",
      "amber-gold-eyes",
      "forest-green-gold-trimmed-vest",
      "white-stand-collar-wide-sleeve-outfit",
      "round-gold-leaf-medallion",
      "green-sash-with-gold-hourglass-charm"
    ]
  },
  "pose": {
    "status": "passed",
    "pose_id": "pointing",
    "intent_observed": true
  },
  "flow": {
    "status": "passed",
    "item_ids": ["claims", "review", "test", "verdict"]
  },
  "style": {
    "status": "passed",
    "profile_id": "lux-whiteboard"
  },
  "defects": []
}
```

任何失败项、标题差异、额外文字、缺失身份 trait 或非空 defects 都不能进入 `full-cover-review` 的批准路径。

## 6. 平台 calibration

`calibrations/<id>/calibration.json`：

```json
{
  "version": 1,
  "id": "bilibili-desktop-upload-preview",
  "platform_id": "bilibili-landscape",
  "surface_id": "desktop-upload-preview",
  "source": {
    "path": "runs/article-slug/calibrations/bilibili-desktop-upload-preview/source.png",
    "sha256": "64-char-lowercase-hex",
    "width": 1600,
    "height": 900
  },
  "sample_upload": {
    "width": 1200,
    "height": 628
  },
  "visible_crop": {
    "left": 0.08,
    "top": 0.10,
    "right": 0.92,
    "bottom": 0.90
  },
  "basis": "visual-analysis-of-user-platform-screenshot",
  "notes": "只适用于记录的平台 surface 与设备条件"
}
```

source 必须是同目录的 `source.png`，hash 与像素匹配；sample upload 与引用 output 比例必须完全一致；normalized crop 位于 `[0,1]` 且有正面积。`review.json` 批准前不能用于安全留边。

## 7. V3 validation

`validation.json`：

```json
{
  "version": 3,
  "status": "mechanically-passed",
  "human_status": "pending-final-output-review",
  "run_id": "article-slug",
  "outputs": [
    {
      "output_id": "cover-large",
      "platform_id": "custom-landscape",
      "aspect_group_id": "wide-191",
      "width": 1200,
      "height": 628,
      "sha256": "64-char-lowercase-hex",
      "adaptation_mode": "none",
      "transform": {
        "scale_x": 1,
        "scale_y": 1,
        "direct_stretch": false
      },
      "visible_crop": {},
      "inserted_cover": {},
      "outer_background": null,
      "mechanical_status": "passed",
      "human_status": "pending"
    }
  ]
}
```

`render-v3.mjs` 只写机械状态。`validate-v3-run.mjs` 找到与当前 `references.json` hash 匹配的最终 Review 后，才在命令结果中返回 `human_status: accepted`。

`shared-crop-core` output artifact 额外包含：

```json
{
  "adaptation_mode": "shared-crop-core",
  "crop_basis": "user-approved-theoretical-crops",
  "visible_crop": {
    "x": 160,
    "y": 60,
    "width": 1600,
    "height": 1080
  },
  "visible_crops": [
    { "id": "center-4x3", "x": 160, "y": 0, "width": 1600, "height": 1200 },
    { "id": "center-16x9", "x": 0, "y": 60, "width": 1920, "height": 1080 }
  ],
  "background_sample": {
    "crop": { "x": 0, "y": 0, "width": 1500, "height": 125 },
    "sha256": "64-char-lowercase-hex",
    "ink_ratio": 0,
    "max_ink_ratio": 0.01
  },
  "previews": {
    "display_crops": [
      {
        "id": "center-4x3",
        "crop": { "x": 160, "y": 0, "width": 1600, "height": 1200 },
        "path": "runs/article-slug/previews/bilibili-upload-visible-center-4x3.png",
        "sha256": "64-char-lowercase-hex"
      }
    ]
  }
}
```

标准 `previews/<output-id>-visible.png` 保存全部裁切的共同交集；每个 display crop 另存一个实际裁切预览。
