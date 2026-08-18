---
name: solid-principles
description: SOLID principles (SRP, OCP, LSP, ISP, DIP) for reviewing and refactoring JavaScript/TypeScript code across React frontends and Node/Express backends, with violation signs, when-NOT-to-apply guidance, and before/after examples. Use when the user says "refactor this", "is this clean", "design feedback", "should I split this", "extract a port", "feels coupled", "too many responsibilities", "review architecture", "is this over-engineered", "DI", "dependency injection", or "adapter pattern", or pastes a class, module, hook, or component asking for structural feedback.
---

# SOLID Principles

Guidelines for reviewing and refactoring JavaScript/TypeScript code — across React frontends and Node/Express backends. The principles are language- and framework-agnostic; the examples use TypeScript so the interface/port contracts are explicit (in plain JS a port is a JSDoc `@typedef` or a duck-typed object).

## Single Responsibility Principle (SRP)

A module/class/function should have only one reason to change.

### Violation Signs

- Class or module handling multiple domains (e.g., user data + API calls + caching)
- Function with multiple `// Step X` comments doing unrelated things
- Hook managing unrelated state pieces
- File imports from many unrelated domains

### When NOT to Apply

Avoid over-splitting trivial logic. A simple utility function doing 2-3 closely related operations is fine.

→ See [srp.md](examples/srp.md) for before/after code.

---

## Open/Closed Principle (OCP)

Modules should be open for extension, closed for modification.

### Violation Signs

- Switch/if-else chains on type discriminators that grow with new features
- Modifying existing functions when adding new variants
- `type === 'X'` checks scattered across codebase
- Adding new feature requires touching many existing files

### When NOT to Apply

Don't create abstraction layers for 2-3 stable variants that rarely change. OCP adds indirection — apply when you genuinely expect extension.

→ See [ocp.md](examples/ocp.md) for before/after code.

---

## Liskov Substitution Principle (LSP)

Subtypes must be substitutable for their base types without altering correctness.

### Violation Signs

- Subclass throws exceptions the parent doesn't declare
- Overridden method ignores or reinterprets parent's parameters
- Consumer code checks `instanceof` before calling methods
- Subclass with empty/no-op method implementations

### When NOT to Apply

LSP applies to inheritance hierarchies. For simple data objects or composition-based designs, focus on interface contracts instead.

→ See [lsp.md](examples/lsp.md) for before/after code.

---

## Interface Segregation Principle (ISP)

Clients should not depend on interfaces they don't use.

### Violation Signs

- Implementing class has methods throwing `NotImplemented`
- Interface with 10+ methods where most implementers use only a few
- Props interface with many optional fields, most unused per component
- Mocking pain: test needs to mock methods unrelated to test case

### When NOT to Apply

Don't split interfaces that are naturally cohesive and always used together. 2-3 tightly coupled methods belong in one interface.

→ See [isp.md](examples/isp.md) for before/after code.

---

## Dependency Inversion Principle (DIP)

High-level modules should not depend on low-level modules. Both should depend on abstractions.

### Violation Signs

- Direct instantiation of dependencies (`new ConcreteService()`)
- Importing concrete implementations in domain/usecase layer
- Hard to test without real database/API/filesystem
- Framework imports in business logic

### When NOT to Apply

Don't abstract stable, unlikely-to-change utilities (e.g., date formatting). DIP adds indirection — apply for infrastructure boundaries (DB, API, storage, analytics).

→ See [dip.md](examples/dip.md) for before/after code — backend (Node/Express + Apollo) and frontend (React).

---

## Where each principle lives in a layered codebase

Whenever an app separates business logic from its I/O — a thin controller/resolver edge, a
service/use-case core, and DB/HTTP/queue adapters at the boundary — each SOLID principle has a
natural home. A formal hexagonal layout like `service-sla` (`src/core/domain/`,
`src/core/application/`, `src/adapters/`) is just one expression of this; the same mapping applies
to an ordinary Express service or a React app.

| Layer                   | Owns                                          | Primary SOLID anchor                       |
| ----------------------- | --------------------------------------------- | ------------------------------------------ |
| Domain / business rules | Entities, value objects, **port interfaces**  | SRP (one concept per module)               |
| Application / use cases | Logic orchestrating ports                     | DIP (depend on ports, never on adapters)   |
| Output adapters         | DB, HTTP, queue, clock, storage               | LSP (adapter must honor the port contract) |
| Input adapters          | Controllers, resolvers, components, consumers | ISP (one focused port per channel)         |

**Wiring DIP without a DI container.** This codebase uses no DI framework — and none is needed.
High-level code takes its ports as constructor arguments (or, in React, via props/Context); a
single **composition root** constructs the concrete adapters and passes them in. That root is the
only place an adapter is named by hand — everywhere else depends on the port. See
[dip.md](examples/dip.md).

---

## Review Checklist

| Principle | Quick Check                                                  |
| --------- | ------------------------------------------------------------ |
| **SRP**   | Does this module have multiple reasons to change?            |
| **OCP**   | Will adding a variant require modifying existing code?       |
| **LSP**   | Can all subtypes replace the base without breaking behavior? |
| **ISP**   | Are there unused methods or `NotImplemented` stubs?          |
| **DIP**   | Does business logic import concrete infrastructure?          |

### Refactoring Priority (typical, not universal)

Adapt to context. In greenfield hexagonal work, DIP first usually pays off. In legacy code, fix whichever violation blocks your current task — don't widen scope.

1. **DIP violations** — block testing; fix when adding tests or extracting business logic
2. **SRP violations** — cascading impact; fix when a module's scope drifts
3. **ISP violations** — testing/mocking pain; fix when an interface grows
4. **OCP violations** — refactor only when actually adding a new variant
5. **LSP violations** — fix when an inheritance hierarchy grows or breaks substitution
