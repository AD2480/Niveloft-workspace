# Product direction: what we take from Notion, Teams, Obsidian and Linear

Written 14 October 2026, for the release that adds linked writing, mentions, backlinks, the catch-up on Today and the keyboard layer.

## The job Niveloft does

**See what will finish, when, and what's in the way.** Niveloft is for small software and student teams who share work and reviews. Everything in it serves the three questions a team asks about delivery, and it holds itself to three rules:

- **Nothing is done until someone approves it.** Work moves to Done only through a submission with evidence, checked against acceptance criteria written before the work started, by someone other than the person who did it. Every version and every review decision is kept.
- **Dates are forecasts, not promises.** Finish dates are windows (*likely 22–28 Oct*) with the chance of the deadline and what they assume, computed from the records and the dependencies.
- **The assistant never acts on its own.** Flurry explains and drafts; it never approves work, assigns people, moves deadlines, or claims to have read a file it couldn't open.

None of the four tools below is built around those rules, and that's the difference to keep. The lessons below are about the everyday writing, finding and returning around the work, where those tools were better than we were.

## The delivery journey (21 October 2026)

The review on 20 October named the strongest direction: a complete delivery workflow, from *when will this finish?* to *what do we do about what's in the way?*, measured as it's used. This release builds it, in this order on the Delivery page:

1. **The outlook:** the likely finish, its window and the chance of the deadline.
2. **Why the date moved:** the finish now against a week, two weeks or a month ago, split into scope, blocked work, owners and progress by replaying the records, with the review waits behind it.
3. **The blocker:** the one task holding the riskiest milestone up, chosen by fixed rules; **its evidence** (state, what it waits on and holds up, the latest submission, decision and comment, each a link) and **what it costs** the finish.
4. **Ways forward:** the responses that fit (decide the review, ask a reviewer, cut scope, move it to someone with room, take it, ask the owner), each with the same forecast, so the differences are the response's alone.
5. **Preview, then confirm:** the exact change, and who may make it. Nothing happens until a person confirms it through the normal endpoints; estimates and owners can be undone. Flurry points the way and never makes the change.

**How it's measured.** Each step is counted (shown, evidence opened, ways forward opened, previewed, confirmed, dismissed) with the kind of blocker and of response, and nothing about people, tasks or text. Owners and managers see the counts on the page. What to watch once real teams use it: how often a blocker that's looked at gets its ways forward opened, how many previews end in a confirmation, and which responses get confirmed for which kinds of blocker. What the counts can't say is whether the response helped: that shows in the records afterwards (did the review get decided, did the date come back?), and *Why the date moved* is where to read it. No outcome is claimed for a team that hasn't used it yet.

**Around it:** Flurry's answers link to the records they read, can be stopped while they're written, and can be corrected (*Was this right?*), so a wrong answer becomes a test case instead of a shrug; approved project documents give Flurry the decisions the tasks don't record; and a trained forecast model can be tried beside Niveloft's forecast, on the team's own new work, before anyone switches.

## What each tool does well, and what we take

| Tool | What it does well | What we take | What we leave |
| --- | --- | --- | --- |
| **Notion** | Typing @ and a page name makes a link, and the page it points to lists its backlinks; you only see backlinks from pages you can open ([Notion help](https://www.notion.com/help/create-links-and-backlinks)). A page is a document with its properties above the text. Notion 3.2 adds a People Directory and an agent that works on your workspace ([release notes](https://www.notion.com/releases/2026-01-20)). | Task keys in any text become links with a preview, and each task lists where it's mentioned, from your projects only. The task page reads as a document: its properties beside it, the description as its body. | The blank page and building your own databases: Niveloft has one shape of work, on purpose. An agent that edits your work. |
| **Microsoft Teams** | The Activity feed filters to @mentions and has an *Unread only* toggle; each kind of notification has its own symbol ([Microsoft support](https://support.microsoft.com/en-us/office/explore-the-activity-feed-in-microsoft-teams-91c635a1-644a-4c60-9c98-233db3e13a56)). | @mentions that notify, a Mentions tab beside Unread in the inbox, and a symbol for each kind of notification. A catch-up on Today: what others did since you were last here. | Chat channels and meetings. Teams already have somewhere to talk; Niveloft is the record of the work, and comments stay attached to the task they're about. |
| **Obsidian** | Backlinks in two parts: linked mentions, and unlinked mentions found by matching a note's name ([Obsidian help](https://obsidian.md/help/plugins/backlinks)). Keyboard-first, with a command palette. 1.12 adds a command-line interface ([changelog](https://obsidian.md/changelog/2026-02-10-desktop-v1.12.0/)). | Linked mentions, checked exactly. Keys and shortcuts for everything you do daily. | Unlinked mentions: matching names in free text would claim links nobody made. The plugin store: every plugin is a new place for data to leak from. |
| **Linear** | The inbox is calm and fast; in September 2026 it gained a Priority tab that separates what needs attention from what can wait. Keyboard sequences (G, then a letter). Loops and the coding agent now act on issues, documents and the inbox ([changelog](https://linear.app/changelog)). | G-then-letter sequences, J and K through lists, C for a new task, and a sheet of them all on ?. An inbox grouped by day, with quiet rows and actions that appear when you point at a row. | Agents and Loops that change work on their own. Our rule stands: nothing is approved, assigned or rescheduled without a person doing it. |

## What this release adds

**Linked writing** (`frontend/src/lib/richText.ts`, `components/RichText.tsx`, `features/refs/`)
- Descriptions, comments, review feedback and submission notes understand light formatting (bold, italic, code, lists, checklists, quotes, links), drawn from a parsed tree and never as HTML.
- A task key such as ONB-9 becomes a link with its status glyph; pointing at it shows the task (status, owner, due date, how late) without leaving the page. Keys you can't open stay plain text.
- Writing a comment or a description, @ suggests the project's people and # suggests its tasks, picked with the arrow keys and Enter (only those two places notify the people you mention, so only they offer it). ⌘/Ctrl B, I and E wrap bold, italic and code; ⌘/Ctrl Enter sends a comment. Comments have a preview.

**Mentions and backlinks** (`backend/.../service/TextRefs.java`, `MentionNotifier.java`, `BacklinkService.java`)
- @mentioning a project member in a comment or a description notifies them once, with the words around the mention and a link to the exact comment. People outside the project are never told; an edit only tells the people it adds; the writer is never told about their own words; a mention inside code doesn't count.
- *Mentioned in* on each task lists the other tasks whose description or comments name it, with the words around it, only from projects you belong to. The rules for what counts as a key or a mention are the same in the browser and on the server, and tested on both sides with the same cases.

**The inbox** (`pages/InboxPage.tsx`)
- Grouped by day, with compact rows: the unread dot in its own column, the sentence with its task key, and the quoted words of a comment or mention set apart. Tabs for All, Unread, Mentions, Assignments, Reviews, Submissions and Invitations. Actions appear over the row's end when you point at it, or in a menu on touch screens.

**The task page** (`pages/project/TaskDetailPage.tsx`, `components/ui/Card.tsx`)
- One document instead of six stacked cards: where it stands and the one next step; the description as the body; then what done means, what's in the way, the review record, *Mentioned in*, and the discussion. The properties sit beside it on wide screens (as values that become controls when you point at them) and right under its head on narrow ones and in the board's side panel. Empty sections are a line of text, not an illustration.

**Since you were last here** (`service/CatchUpService.java`, `features/dashboard/CatchUp.tsx`)
- Today opens with what other people did in your projects since you last left it, counted from the activity records (*3 submitted for review, 2 new tasks and 5 comments*) with the latest few. Your own actions don't count; counting stops two weeks back. It's kept on the server, so it's the same on every device.

**The keyboard layer** (`features/keyboard/`)
- G then T, M, I, P, C, R or S goes to Today, My work, Inbox, Projects, Calendar, Reports or Settings; in a project, G then O, B, L or D goes to its Overview, Board, List or Delivery. C opens New task in a project. J and K move through the rows of a list, Enter opens one. ? shows them all; the command palette shows each page's sequence beside it.

**Status and priority glyphs** (`components/glyphs.tsx`)
- A task's status is a small gauge that fills as it moves (empty, a third, two thirds, full with a tick), with a red pip when it's late. Priority is three bars, filled one to three, and a red tile for urgent. They replace the generic circle and arrow icons everywhere a status or priority is shown.

## How it avoids looking assembled from a kit

- **One shape per idea.** The status gauge fills in the same order as the snowpack's layers; nothing else in the product is coloured for decoration.
- **Documents read as documents.** No card around every section; spacing and a heading do that job. Empty states inside a document are a sentence.
- **Controls only when needed.** Properties are values until you point at them; inbox actions appear over the row you're on.
- **Words do one job each.** Sentence case everywhere; commas and colons, not middle dots; times as *yesterday at 18:00*, not timestamps.

## Limits, said plainly

- **Backlinks are found by search.** The server narrows candidates with a text search over descriptions and comments in your projects, then checks each match exactly. That is fine for team-sized projects; a large installation would want a references table filled when text is saved.
- **Mentions resolve by name.** A mention is @ and a member's full name, or a first name only one member has. Two members with the same full name can't be told apart; renaming someone doesn't update old text.
- **No unlinked mentions,** by design (see Obsidian above).
- **The catch-up counts what was recorded.** Edits that aren't logged as activity (a typo fixed in a comment) don't appear. Leaving Today marks it seen; so does *Got it*.
- **Shortcuts use letters, not key positions,** so they follow your keyboard layout. They're off while you type in a field or a dialog is open.

## Candidates, not built

- **The outcome of a confirmed response,** shown later beside it: whether the review was decided, and how the likely finish moved afterwards.
- **Search by meaning for documents,** if the corrections show word search missing what people ask about.
- **A Needs-you tab in the inbox** like Linear's Priority inbox, fed by the attention rules Today already has.
- **Written project updates:** a short weekly update a person writes, with the record's facts (approved, late, moved) filled in for them to edit. Never sent by the assistant on its own.
- **A references table** for backlinks, if projects grow past what search handles comfortably.

## Sources

- [Notion help: links and backlinks](https://www.notion.com/help/create-links-and-backlinks)
- [Notion 3.2 release notes, 20 January 2026](https://www.notion.com/releases/2026-01-20)
- [Microsoft support: Explore the Activity feed in Microsoft Teams](https://support.microsoft.com/en-us/office/explore-the-activity-feed-in-microsoft-teams-91c635a1-644a-4c60-9c98-233db3e13a56)
- [Obsidian help: Backlinks](https://obsidian.md/help/plugins/backlinks)
- [Obsidian 1.12.0 changelog, 10 February 2026](https://obsidian.md/changelog/2026-02-10-desktop-v1.12.0/)
- [Linear changelog](https://linear.app/changelog)
