# Host financial completion message is distinct and optional

The framework distinguishes mandatory device-specific physical finalization from project-specific host posting milestones: XFS `cashInEnd` is CIM Physical Commit, while a Host Financial Completion Message is an optional second host phase used only when the operation-frozen Host Posting Protocol requires it. Authorization-only and authorization-then-completion regions therefore share normalized posting facts without forcing a universal host commit or allowing financial outcomes to be inferred from physical custody.
