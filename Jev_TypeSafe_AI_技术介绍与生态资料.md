# Jev（TypeSafe AI）技术介绍与生态资料

> Document Type: AI Agent Knowledge Base\
> Topic: Jev / System One Model / Decision Model\
> Last Updated: 2026-09

------------------------------------------------------------------------

# 1. 基本信息

## 项目名称

-   Name: Jev
-   Company: TypeSafe AI
-   Category:
    -   Decision Model
    -   System One Model
    -   AI Infrastructure Model

## 官方链接

-   Website: https://typesafe.ai/
-   Announcement:
    https://typesafe.ai/blog/introducing-system-one-models-and-jev
-   Documentation: https://docs.typesafe.ai/

------------------------------------------------------------------------

# 2. TypeSafe AI 公司背景

## 创始人

### Diogo Almeida

公开信息：

-   曾任 OpenAI 研究人员。
-   参与 ChatGPT 相关强化学习方向工作。
-   后创立 TypeSafe AI。

## 公司方向

TypeSafe AI 关注：

> 如何让 AI 成为软件系统中的可靠决策组件。

------------------------------------------------------------------------

# 3. Jev 是什么？

Jev 是 TypeSafe AI 推出的面向软件自动化的决策模型。

核心：

输入：

    Unstructured State
    +
    Decision Questions

输出：

    Typed Probabilistic Decisions

即：

将非结构化信息转换为软件可以直接使用的概率化判断。

------------------------------------------------------------------------

# 4. System One Model

TypeSafe 将 Jev 定义为：

System One Model

概念来源：

Daniel Kahneman：

-   System 1：快速、直觉式判断
-   System 2：慢速、深度推理

TypeSafe 的定位：

-   LLM：偏 System 2
-   Jev：偏 System 1

------------------------------------------------------------------------

# 5. Jev 与传统 LLM 区别

## Traditional LLM

目标：

生成语言。

流程：

    Input
     ↓
    LLM
     ↓
    Token generation
     ↓
    Text output
     ↓
    Parser

特点：

-   通用
-   可生成开放内容

------------------------------------------------------------------------

## Jev

目标：

输出决策。

流程：

    Input State
     ↓
    Jev
     ↓
    Typed Decision
     ↓
    Application

特点：

-   固定结构输出
-   软件直接调用
-   输出概率

------------------------------------------------------------------------

# 6. Jev 输出类型

## Choice

多分类选择。

Example:

    billing:0.91
    technical:0.06
    sales:0.03

------------------------------------------------------------------------

## Score

连续评分。

Example:

    risk:8.2

------------------------------------------------------------------------

## Noul

Yes / No 判断。

Example:

    yes:0.95
    no:0.05

------------------------------------------------------------------------

# 7. 核心技术概念

## Typed Decision Output

输出：

    Decision
    +
    Probability
    +
    Confidence

------------------------------------------------------------------------

## Parallel Sampling

传统 LLM：

    token1 → token2 → token3

Jev：

    Question A
    Question B
    Question C

    parallel output

------------------------------------------------------------------------

## RLCD

Reinforcement Learning for Calibrated Decisions。

目标：

提高概率校准：

    80% confidence
    ≈
    80% long-term accuracy

------------------------------------------------------------------------

# 8. 性能信息

官方公开：

Latency：

    70ms - 500ms

Pricing：

    $0.042 / 1M input tokens
    Output free

Benchmark：

TypeSafe 宣称：

    Up to 193.6x faster
    Up to 444.6x cheaper

说明：

这些数据来自 TypeSafe 自己的 benchmark，仍需要更多第三方验证。

------------------------------------------------------------------------

# 9. Hallucination 说明

Jev 可以避免：

    Invalid output hallucination

例如：

允许：

    billing
    sales
    technical

不会输出：

    banana

但是仍可能：

    判断错误

因此：

    No invalid output hallucination
    ≠
    No semantic error

------------------------------------------------------------------------

# 10. 应用场景

## Agent Router

根据需求选择：

-   Tool
-   Skill
-   MCP
-   API
-   Sub-agent

------------------------------------------------------------------------

## Customer Support

判断：

-   用户意图
-   风险
-   是否人工介入

------------------------------------------------------------------------

## Safety

判断：

-   是否危险操作
-   是否需要阻止

------------------------------------------------------------------------

## Document Processing

判断：

-   文档类型
-   风险
-   审核需求

------------------------------------------------------------------------

## Agent Evaluation

判断：

-   是否完成任务
-   是否 retry

------------------------------------------------------------------------

# 11. Agent Architecture 中的位置

可能架构：

    User Request

    ↓

    Fast Decision Layer
    (Jev)

    ↓

    Tool Router / Safety / Memory Selector

    ↓

    Reasoning LLM

    ↓

    Tool Execution

------------------------------------------------------------------------

# 12. 开源生态

## openjev

GitHub:

https://github.com/TheoLeeCJ/openjev

描述：

Can we run something like Jev on a 3090 at home?

特点：

-   Python
-   MIT License
-   社区实验项目

不是 TypeSafe 官方实现。

------------------------------------------------------------------------

## daseinlabs/open-jev

GitHub:

https://github.com/daseinlabs/open-jev

方向：

探索类似 Jev 的开源实现。

------------------------------------------------------------------------

# 13. 当前未知信息

已公开：

-   产品定位
-   API 形式
-   输出形式
-   应用方向
-   创始人背景

未公开：

-   完整模型架构
-   参数规模
-   Backbone
-   训练数据
-   完整论文
-   大规模第三方验证

------------------------------------------------------------------------

# 14. 核心总结

Jev 不是：

    更会聊天的 LLM

而是：

    面向软件系统的概率化决策模型

核心区别：

    LLM:
    Generate language

    Jev:
    Generate decisions

主要方向：

    让 Agent 在大量工具和能力中，
    快速判断下一步应该调用什么能力。
