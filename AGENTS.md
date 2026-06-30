# Strong Rule

If a requested change would cause a file to become too large, mix unrelated responsibilities, or introduce hard-to-maintain code, the agent must first refactor the code into smaller, clearer modules instead of appending more code.

## Single-File Script Exception

This exception takes precedence over the file-size, function-size, code-organization, responsibility-separation, and modularization rules below.

- When the user requests a single-file script, keep the complete implementation in one directly runnable script file.
- This applies to C# file-based apps/scripts, Python, JavaScript/Node.js, PowerShell, shell scripts, and equivalent scripting formats.
- Do not create a project, package, module directory, helper source files, or other implementation files solely to satisfy line-count or modularization guidance.
- Do not split the script because it exceeds 300 lines, contains functions longer than 50 lines, or combines parsing, validation, processing, and output needed for the script's single purpose.
- Prefer local helper functions, classes, records, and sections within the same script when they improve readability.
- Follow this exception when the existing tool is a standalone script or the user asks for behavior matching another single-file script.
- Correctness, readability, testability, focused scope, and avoiding genuinely unrelated functionality still apply.

## Core Principles

- Write code that is simple, maintainable, readable, testable, and efficient.
- Prefer clear architecture over quick patches.
- Optimize for long-term maintainability, not only for passing the immediate task.
- Keep changes small, focused, and easy for a human reviewer to understand.
- Follow the existing project structure, naming conventions, and coding style.
- Do not introduce unnecessary abstractions, dependencies, or complexity.

## Code Organization

- Do not place large amounts of unrelated logic in a single file.
- If a file is becoming too large, split it into smaller modules with clear responsibilities.
- Each file should have one primary purpose.
- Separate concerns clearly:
  - UI or presentation logic
  - business/domain logic
  - data access
  - external service integration
  - configuration
  - validation
  - error handling
  - utilities
  - types/models
  - tests

# File Size and Function Size
Keep files small and focused.
Keep functions short and purpose-driven.
A function should usually do one thing.
Avoid functions longer than 50 lines unless clearly justified.
Extract helper functions when logic becomes hard to scan.
Avoid deeply nested control flow.
Prefer early returns over large nested blocks.

# Architecture
Keep business logic independent from frameworks when practical.
Place side effects at the edges of the system.
Keep core logic easy to test without requiring UI, network, filesystem, database, or platform APIs.
Use clear boundaries between modules.
Avoid circular dependencies.
Avoid global mutable state.
Prefer dependency injection or explicit parameters over hidden imports when it improves testability.
