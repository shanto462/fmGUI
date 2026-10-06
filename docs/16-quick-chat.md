# Quick Chat (menu bar)

Quick Chat lets you ask the on-device model something from anywhere on your Mac, without switching to the main
window. It lives in the menu bar and floats above your other windows.

## Open it

- Click the **conversation icon** in the menu bar (two speech bubbles). Quick Chat opens near the top of the screen,
  like Spotlight, and the message box is ready for typing.
- Or right-click the icon and choose **Quick Chat**.

The menu bar icon stays while fmGUI runs. Closing the main window does **not** quit fmGUI: the window hides and Quick
Chat keeps working. Click the fmGUI icon in the Dock (or **Open fmGUI** in the menu bar menu) to bring the main window
back. To quit, choose **Quit fmGUI** in the menu bar menu or press ⌘Q.

## The two sizes

| Size | What you see | How you get there |
|------|--------------|-------------------|
| **Overlay** | The full quick chat: messages, tool steps, approvals and the message box. | Click the menu bar icon, or click the pill. |
| **Pill** (picture in picture) | A small bar in the bottom-right corner that stays on top. It shows a spinner while the model works, "Needs your approval" when a tool waits for you, or the start of the last reply. | Click anywhere outside the overlay, or press **Esc**. |

Both sizes stay on top of other windows and appear on every desktop (Space). Drag the overlay by its top bar, or the
pill by the grip on its right side.

## What it can do

Quick Chat uses the same engine as the Chat page:

- Every tool, MCP server and skill you turned on (see [Custom tools](13-custom-tools.md), [MCP servers](14-mcp-servers.md)
  and [Skills](15-skills.md)).
- Approvals: when a tool asks first, Quick Chat shows Allow once, Always allow and Deny. If you clicked away, the pill
  turns amber so you see that it waits for you.
- Images: attach them with the image button. While the file picker is open, the overlay does not shrink.

Each quick chat is saved like any other chat, so it also shows up in the **Chat** list of the main window. Click
**Open in fmGUI** (the window button in the Quick Chat bar) to continue it there.

## Start over

- **New chat** (the pen button, or ⌘N) starts an empty conversation and keeps the old one in the Chat list.
- **Close** (the × button) hides Quick Chat. If the model is still answering, the answer is stopped. The next time you
  open Quick Chat, it starts with an empty conversation.

## Before setup is done

Quick Chat needs the same things as the rest of the app: `fm`, the on-device model and the accepted license. If one of
them is missing, Quick Chat shows "Finish setup in fmGUI first." with a button that opens the Setup Guide in the main
window. See [Getting started](12-getting-started.md).

## Tips

- Keep quick questions short. The on-device model has a small context window (8,192 tokens on most Macs), and every
  enabled tool and skill uses part of it.
- For long work, use **Open in fmGUI**: the main Chat page has more room and the chat list.
- Only one copy of fmGUI runs at a time. Opening the app again just brings the running one to the front.
