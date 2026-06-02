1. 核心禁令 (Hard Constraints)
这些是绝对不能违反的规则，违反即视为任务失败。
NO MONOLITHS（禁止单体文件）: 严禁将整个应用逻辑写入单个文件。
行数限制: 任何单个文件不得超过 300-500 行（具体数值可根据项目调整）。超过此限制必须进行拆分。
功能隔离: 业务逻辑、数据模型、API 接口、UI 组件必须分离在不同文件中。
NO COPY-PASTE PROGRAMMING（禁止复制粘贴）: 如果发现重复代码块（超过 10 行），必须抽象为函数、类或模块。
NO SILENT FAILURES（禁止静默失败）: 禁止使用裸 try/catch吞掉错误。必须记录日志或向上抛出。
2. 架构与设计强制标准 (Architecture & Design)
Agent 在写第一行代码前，必须先思考这些。
模块化优先 (Modularity First):
遵循 Single Responsibility Principle (SRP)。每个文件/类只做一件事。
使用 Dependency Injection (依赖注入)​ 而非硬编码依赖，便于测试和替换。
分层架构 (Layered Architecture):
Interface Layer: 处理 HTTP/RPC 请求，参数校验。
Application Layer: 协调用例，不包含核心业务规则。
Domain Layer: 核心业务逻辑，纯逻辑，无框架依赖。
Infrastructure Layer: 数据库、缓存、外部 API 调用。
Contract First (契约优先):
在编写实现之前，先定义 Interfaces/Traits/Types。
确保调用方仅依赖于抽象，不依赖于具体实现。