# The Foundation Models framework in 2026

`fm` is built on Apple's **Foundation Models** Swift framework. If you write Swift, you can use the framework directly and get more than `fm` offers (real tool calling, typed structured output, Private Cloud Compute).

Main sources:

- WWDC26 session 241, "What's new in the Foundation Models framework": https://developer.apple.com/videos/play/wwdc2026/241/
- WWDC26 session 334, "Build AI-powered scripts with the fm CLI and Python SDK": https://developer.apple.com/videos/play/wwdc2026/334/
- Documentation: https://developer.apple.com/documentation/foundationmodels

Marks used on this page:

- **(SDK)**: the API name was found in the macOS 27.0 SDK on this Mac (`FoundationModels.swiftinterface` in Xcode).
- **(run)**: it was also run on this Mac.
- **(unverified)**: from the session page or community posts only.

## A tested example (run)

```swift
import Foundation
import FoundationModels

let model = SystemLanguageModel.default
guard case .available = model.availability else {
    print("Model not available:", model.availability)
    exit(1)
}
print("Context size:", model.contextSize)
print("Prompt tokens:", try await model.tokenCount(for: Prompt("Hello world")))

let session = LanguageModelSession(instructions: "Be brief.")
let response = try await session.respond(to: "Name one planet.")
print("Answer:", response.content)
print("Session usage: in", session.usage.input.totalTokenCount, "out", session.usage.output.totalTokenCount)

@Generable struct Person {
    var name: String
    var age: Int
}
let person = try await session.respond(to: "Ada Lovelace is 36.", generating: Person.self)
print("Person:", person.content.name, person.content.age)
```

Run it with `swift hello.swift`. Real output:

```text
Context size: 8192
Prompt tokens: 3
Answer: Earth
Session usage: in 63 out 3
Person: Ada Lovelace 36
```

## What is new in 2026

### Context and token counting

- `SystemLanguageModel.contextSize` (SDK, run): **8192** on this Mac. Read it at runtime, it can differ between Macs.
- `tokenCount(for:)` (SDK, run): counts a prompt, instructions, tools, a schema, or transcript entries. Same tokenizer as `fm count-tokens` (both give 3 for "Hello world").
- `LanguageModelSession.usage` and usage on responses (SDK, run): `usage.input.totalTokenCount`, `usage.input.cachedTokenCount`, `usage.output.totalTokenCount`, `usage.output.reasoningTokenCount`. These are the source of the `usage` object in `fm serve`.

### Images

- Prompts can include images (SDK): `Transcript.ImageAttachment` can be made from `CGImage`, `CIImage`, `CVPixelBuffer` or a file URL, and from `NSImage` in the AppKit overlay. `fm respond --image` and image parts in `fm serve` use this.

### Errors

- New `LanguageModelError` (SDK) with cases: `contextSizeExceeded` (has `contextSize` and `tokenCount`), `rateLimited`, `guardrailViolation`, `refusal`, `unsupportedCapability`, `unsupportedTranscriptContent`, `unsupportedGenerationGuide`, `unsupportedLanguageOrLocale`, `timeout`.
- The whole old `LanguageModelSession.GenerationError` enum is deprecated in 27.0. For example `exceededContextWindowSize` → use `LanguageModelError.contextSizeExceeded`, and the old guardrail case → use `guardrailViolation` (SDK).
- `LanguageModelSession.Error` (SDK): `concurrentRequests`, `transcriptMutationWhileResponding`. One session handles one request at a time.
- The `fm serve` messages map to these: "An unsupported generation guide was used." is `unsupportedGenerationGuide`, "The session's transcript exceeded the model's context size." is `contextSizeExceeded`.

### Generation options

`GenerationOptions` (SDK):

- `sampling`: `.greedy`, `.random(top:seed:)`, `.random(probabilityThreshold:seed:)`. This is what `fm respond -g` and the `seed` field use.
- `temperature`, `maximumResponseTokens`. `fm serve` most likely maps `temperature` and `max_completion_tokens` to these (the behavior matches, the code was not seen).
- **New:** `toolCallingMode`: `.allowed`, `.required`, `.disallowed`. On 27.0.1, `.required` gives "unsupported generation guide" errors through `fm serve` (tested) and in apfel's tests (unverified).

`ContextOptions` (SDK): `includeSchemaInPrompt`, and `reasoningLevel` with `.light`, `.moderate`, `.deep`, `.custom(String)`. Reasoning is for models that support it (Private Cloud Compute). The `system` model rejects `reasoning_effort` in `fm serve`.

### Private Cloud Compute model

- `PrivateCloudComputeLanguageModel` (SDK, run): a larger model that runs on Apple's Private Cloud Compute servers.
- On this Mac: `availability` is `available` and `contextSize` is **32768** (run). No request was sent to it.
- It has `quotaUsage` (below limit / limit reached, with a reset date) and errors `networkFailure`, `quotaLimitReached`, `serviceUnavailable` (SDK).
- `fm` 27.0.1 does **not** expose it: `-m pcc` is rejected. WWDC26 session 334 shows `--model pcc` and `/model` in `fm chat` (unverified). Community reports say PCC in `fm serve` only unlocks when it runs in a foreground Terminal (unverified).
- Apple points to "Private Cloud Compute eligibility requirements" for apps that want to use it: https://developer.apple.com/private-cloud-compute/

### Any model behind one API

- New `LanguageModel` protocol (SDK). `SystemLanguageModel` and `PrivateCloudComputeLanguageModel` both conform. `LanguageModelSession(model:tools:instructions:)` accepts any `LanguageModel`.
- `LanguageModelCapabilities` (SDK) describes what a model can do (for example `toolCalling`).
- Session 241 mentions open-source `CoreAILanguageModel` and `MLXLanguageModel` implementations for other local models, and an open-source core of the framework that runs on Linux (unverified, not in the SDK).

### Built-in tools

- `OCRTool` and `BarcodeReaderTool` (SDK) in the `_Vision_FoundationModels` overlay. These are the tools behind `fm --tool ocr` and `--tool barcode`.
- Spotlight search for local RAG (SDK): the `_CoreSpotlight_FoundationModels` overlay has `CoreSpotlightSource`, `FileSource` and `SearchSource`. `fm` does not expose it.

### Dynamic profiles

- `LanguageModelSession.DynamicProfile` (SDK): a declarative way to switch instructions, tools, model and options during a session, with modifiers such as `.temperature()`, `.samplingMode()`, `.maximumResponseTokens()`, `.reasoningLevel()` and `.toolCallingMode()`. Also `DynamicInstructions` builders.

### Guardrails and use cases

- `SystemLanguageModel.Guardrails` (SDK): `.default` and `.permissiveContentTransformations`. Same as `fm respond --guardrails`.
- `SystemLanguageModel.UseCase` (SDK): `.general` and `.contentTagging`. Same as `fm respond --use-case`.
- Availability reasons (SDK): `deviceNotEligible`, `appleIntelligenceNotEnabled`, `modelNotReady`. These match the `fm available` messages.

### Removed

- Custom adapters (`SystemLanguageModel.Adapter`, LoRA) are deprecated in 26.4 and **obsoleted in 27.0** (SDK).

### Evaluations

- Session 241 announces an **Evaluations** framework to measure the quality of AI features (unverified). It was not found as a framework in the macOS 27.0 SDK on this Mac.

## Python SDK

Apple also released `apple-fm-sdk` for Python, which mirrors the Swift API (sessions, streaming, `@generable`, tools, images). See [Python and clients](08-python-and-clients.md).

## fm vs the framework

| Feature | `fm` CLI / `fm serve` | Swift framework |
|---------|-----------------------|-----------------|
| On-device model | Yes | Yes |
| Private Cloud Compute | No (27.0.1) | Yes |
| Custom tools | No (use a JSON router) | Yes (`Tool` protocol) |
| Built-in OCR and barcode tools | Yes | Yes |
| Spotlight RAG | No | Yes |
| Typed structured output | JSON schema only | `@Generable` types |
| Images | Yes (files, data URLs) | Yes |
| Token counting | Yes (images broken) | Yes |
| Usage numbers | Yes | Yes |
| Language | Any (CLI or HTTP) | Swift (and Python SDK) |
