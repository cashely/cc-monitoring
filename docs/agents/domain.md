# 领域文档

规定工程类 skills 在探查代码库时应如何消费本仓库的领域文档。

## 探查前先读

- 仓库根目录的 **`GLOSSARY.md`**；若存在 **`GLOSSARY-MAP.md`**，则它指向每个上下文各自的 `GLOSSARY.md`，阅读与主题相关的每一个
- **`docs/adr/`**：阅读与你即将工作的区域相关的 ADR。多上下文仓库中还要检查 `src/<context>/docs/adr/` 里上下文范围的决策

这些文件若不存在，**静默继续**。不要提示它们缺失，也不要建议预先创建。`/domain-modeling` skill（经由 `/grill-with-docs` 和 `/improve-codebase-architecture` 进入）会在术语或决策真正确定时按需创建。

## 文件结构

单上下文仓库（大多数仓库）：

```
/
├── GLOSSARY.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

多上下文仓库（根目录存在 `GLOSSARY-MAP.md`）：

```
/
├── GLOSSARY-MAP.md
├── docs/adr/                          ← 系统级决策
└── src/
    ├── ordering/
    │   ├── GLOSSARY.md
    │   └── docs/adr/                  ← 上下文专属决策
    └── billing/
        ├── GLOSSARY.md
        └── docs/adr/
```

## 使用 glossary 中的词汇

当你的输出需要命名某个领域概念时（issue 标题、重构提案、假设、测试名称），使用 `GLOSSARY.md` 中定义的术语，不要漂移到 glossary 明确避免的同义词。

如果你需要的概念还不在 glossary 中，这是一个信号：要么你在发明项目不使用的语言（重新考虑），要么确实存在缺口（记录下来留给 `/domain-modeling`）。

## 标记 ADR 冲突

如果你的输出与某个已有 ADR 矛盾，显式提出，而不是静默覆盖：

> _与 ADR-0007（event-sourced orders）冲突，但值得重新讨论，因为……_
