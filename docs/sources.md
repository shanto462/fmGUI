# Sources

## On this Mac (primary source)

Most facts in these docs come from running the real tool on macOS 27.0.1 (build 26A434), Apple M4 Pro, on 2026-10-06:

- `/usr/bin/fm`, every `fm <command> --help`, and real commands
- `man fm` (`/usr/share/man/man1/fm.1`, dated June 8, 2026)
- `fm serve` over TCP and a Unix socket, probed with curl, Python httpx and Node 22 fetch
- Strings in the `fm` binary (error messages, prompts, limits)
- `/Library/Preferences/com.apple.fm.plist` (license record)
- The macOS 27.0 SDK in Xcode: `FoundationModels.framework/.../arm64e-apple-macos.swiftinterface`, `_Vision_FoundationModels`, `_CoreSpotlight_FoundationModels`, `_FoundationModels_AppKit`
- Small Swift scripts run with `swift` (context size, token count, usage, PCC availability)

## Apple

- WWDC26 session 334, "Build AI-powered scripts with the fm CLI and Python SDK": https://developer.apple.com/videos/play/wwdc2026/334/
- WWDC26 session 241, "What's new in the Foundation Models framework": https://developer.apple.com/videos/play/wwdc2026/241/
- Foundation Models documentation: https://developer.apple.com/documentation/foundationmodels
- Python SDK source: https://github.com/apple/python-apple-fm-sdk
- Python SDK on PyPI: https://pypi.org/project/apple-fm-sdk/
- Developer Forums thread 842813 (using `fm serve` from a distributed app): https://developer.apple.com/forums/thread/842813
- macOS Software License Agreements: https://www.apple.com/legal/sla/
- Apple Developer Program License Agreement: https://developer.apple.com/support/terms/apple-developer-program-license-agreement/
- Private Cloud Compute for developers: https://developer.apple.com/private-cloud-compute/

## Articles and posts

- clews.id.au, TIL post about the `fm` CLI in macOS 27: https://clews.id.au/til/macos-27-ships-an-on-device-llm-cli-called-fm/
- modelfit.io, blog post about the `fm` CLI: https://modelfit.io/blog/macos-27-fm-cli-local-model-terminal/
- Mac Install Guide, page about the `fm` command: https://mac.install.guide/terminal/fm-command
- Ivan Magda, post about Foundation Models changes at WWDC26: https://ivanmagda.dev/posts/wwdc26-foundation-models-year-two/
- ChatForest builder's log on `fm`, the Python SDK and `fm serve`: https://chatforest.com/builders-log/apple-fm-cli-python-sdk-fm-serve-openai-compatible-psotu-wwdc-2026/
- apfel issue 510 (macOS 27 features, 4,096 vs 8,192 context, ToolCallingMode notes): https://github.com/Arthur-Ficial/apfel/issues/510

## Projects (see [Ecosystem](09-ecosystem.md))

- https://github.com/Arthur-Ficial/apfel
- https://github.com/Arthur-Ficial/apfel-gui
- https://github.com/Techopolis/afm-Server
- https://github.com/Techopolis/AFM-Studio
- https://github.com/nedpark/FoundationStudio
- https://github.com/phimage/PrivateChat
- https://github.com/Dimillian/FoundationChat
- https://github.com/hgiefers/afm-chat
- https://github.com/katspaugh/foundation
- https://github.com/Subhajit-Roy-Partho/fmToOpenAI
- https://github.com/k-velorum/fm-server-go
- https://github.com/tariqwest/fm-access-PCC
- https://github.com/awesomeroy-cloud/apple-fm-audit
- https://github.com/schnaitter/pifm
- https://github.com/adstastic/pi-apple-fm
