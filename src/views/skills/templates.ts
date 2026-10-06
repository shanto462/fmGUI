// Starter templates for the "New skill" wizard.

export const SKILL_NAME_RE = /^[a-z0-9-]{1,64}$/;

/** Warn when a skill body is bigger than this (the context is only a few thousand tokens). */
export const LARGE_SKILL_TOKENS = 1500;

export const toSkillName = (text: string) =>
  text
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 64);

export interface SkillTemplate {
  id: string;
  title: string;
  summary: string;
  name: string;
  description: string;
  body: string;
}

export const SKILL_TEMPLATES: SkillTemplate[] = [
  {
    id: "email",
    title: "Email writer",
    summary: "Rules for short, polite emails.",
    name: "email-writer",
    description: "Use when the user asks to write or reply to an email. Writes short, polite and clear emails.",
    body: `# Email writer

Write emails that are short, polite and clear.

## Rules
- Start with a friendly greeting, for example "Hi Ada,".
- Put the main point in the first two sentences.
- Keep it under 120 words unless the user asks for more.
- Use simple words. No jargon.
- If you need something from the reader, ask for it clearly, with a date if there is one.
- End with a short thank-you and a sign-off, for example "Best regards,".

## Format
Return only the email: first a subject line ("Subject: ..."), then the body.
`,
  },
  {
    id: "meeting",
    title: "Meeting notes",
    summary: "Turn notes into a summary and action items.",
    name: "meeting-notes",
    description:
      "Use when the user pastes meeting notes or a transcript. Turns them into a short summary and a list of action items.",
    body: `# Meeting notes

Turn raw meeting notes into a clean summary.

## Output
1. **Summary**: 3 to 5 bullet points with the main decisions and facts.
2. **Action items**: a checklist. Each item has an owner, and a due date if the notes give one.
   - [ ] Owner: task (due date)
3. **Open questions**: anything that was not decided.

## Rules
- Do not invent names, dates or numbers. If the owner is unknown, write "Owner: unknown".
- Keep the wording neutral and short.
`,
  },
  {
    id: "eli10",
    title: "Explain like I am 10",
    summary: "Simple words, one example, three key points.",
    name: "explain-like-10",
    description: 'Use when the user asks for a simple explanation, or says "explain like I am 10".',
    body: `# Explain like I am 10

Explain the topic so a 10-year-old can follow it.

## Rules
- Use short sentences and everyday words.
- Start with one sentence that gives the big idea.
- Use one comparison to daily life, for example a kitchen, a school or a game.
- Give at most 3 key points.
- If you must use a hard word, explain it right away.
- End with one fun fact or a simple question to check understanding.
`,
  },
];
