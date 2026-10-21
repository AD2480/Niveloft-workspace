# Flurry's AI: what we took from the research list, and what we didn't

*14 October 2026.* This release acts on the list of datasets, models and frameworks shared for
Flurry, and on its recommendation: start with a pretrained model connected to Niveloft's own task
and document APIs, add a natural voice, train deadline predictions separately on your own
completed-task history (public data only for first experiments), and fine-tune a language model
only for improvements you can measure.

The rules Flurry already kept still hold, and every piece below was built to them: keys stay on the
server; Flurry sees only what the person asking may see; it never approves, assigns, reschedules
or deletes anything; it never claims to have opened a link or file; *not in the records* is never
presented as a finding; and with no AI configured it says so instead of pretending.

## 21 October 2026: evidence, documents, corrections, streaming and the forecast trial

The next round, from the review of what Flurry most needed after the release below. Same rules.

- **Evidence you can open.** Every lookup in *How I found this* now links to the records it read:
  the task, the exact comment, the submission (version and date) or the review decision (approval
  or changes requested, by whom), and the document passage. The task page opens at that comment,
  submission or review and marks it. A link only shows records the reader may already open; the
  page itself checks again.
- **Approved project documents.** Members can add documents to a project (specifications, meeting
  notes, decisions: typed or pasted text, or a Markdown or text file read in the browser). Only the
  project's owners and managers approve one for Flurry; a draft is seen by its author and by owners
  and managers, and is never searched. Changing an approved document's text sends it back to draft.
  Documents are split into passages under their headings (about 900 characters each), and the new
  tool `search_documents` finds at most 5 passages by words (BM25 over candidates, no embeddings),
  only in the project being asked about. Flurry is told to say which document and section it used,
  and that a document records what was decided when it was approved while the tasks show what
  happened since. Passages reach the model inside `<record>` tags as data, like every record.
- **Corrections.** Under each answer, *Was this right?*: *Yes*, or *Something's wrong* with the kinds
  of mistake (from a fixed list: said something the records contradict, missed a record, treated
  missing information as a no, the wrong task, overstepped, unclear, slow, other) and, optionally,
  the right answer. Owners and managers see the project's corrections in its settings: totals, the
  kinds that recur, right and wrong per model, how many wrong answers came without looking anything
  up, the latest corrections, and **Download as eval cases** (JSON lines in the eval's shape, for a
  person to finish before adding to the eval). Nobody is named. Kept 180 days.
- **Answers as they're written, and Stop.** The server's answer now streams: each lookup appears as
  it's made, then the answer's words as the model writes them (picked out of its JSON as it arrives,
  and replaced by the checked answer at the end). **Stop** ends it at once: the browser aborts the
  request and tells the server, which closes the provider's stream so it stops generating (in the
  sandbox, about 0.1 s, with the connection closed about 0.2 s later). What the provider used until
  then still counts against the limits; a question stopped before anything was sent costs nothing.
  Every provider stream has an idle limit and a total limit (OpenAI-compatible 120/240 s, Anthropic
  90/180 s, Ollama 180/300 s). Without the stream (an older server, a signed-out tab), the same
  question is asked the ordinary way. The AI in Chrome is stopped through its own prompt call (not tried here with Chrome's real model).
  Questions being answered are tracked by each server in memory, so with several servers the stop
  request may reach one that isn't answering the question; the closed connection still stops it a
  few words later, or within 15 seconds when nothing is being written (the stream's keep-alive).
- **Better context for big projects.** When a project has more than 250 tasks, the question's
  context lists the tasks the question or the conversation names by key first, then those whose
  titles share its words, then open work (in review, in progress, overdue, holding work up), then
  the most recently changed, and says the list is partial. Before, it was simply the first 250 by
  number.
- **The eval:** 26 Niveloft cases now (two about documents: quoting a passage with its source, and
  saying a document doesn't cover something). The xLAM data was checked record by record on the
  real download (58,369 of 60,000 can be scored) and a fixed 200-record sample is kept as ids and
  the file's hash only (`ml/eval_cases/xlam-sample.json`).
- **The forecast model trial** (not Flurry, but the same evidence-first rule): a model the `ml/`
  kit trained and recommended runs beside Niveloft's forecast on the Delivery page, never instead of
  it, and the server records both forecasts and the outcome. See [`ml/README.md`](../ml/README.md#after-a-model-wins-the-trial).

Code: `EvidenceLinks.tsx`, `DocumentService`, `DocumentSearch`, `DocumentText`, the
`search_documents` tool in `ProjectTools`, `AiFeedbackService`, `AskStreams`, `StreamedHttp`,
`AnswerStream`, each client's `stream`, `ToolLoop`'s listener, `ContextRanking`, and on the browser
`askStream.ts`, `answerEvents.ts`, `AnswerInProgress.tsx`, `AnswerFeedback.tsx` and
`FlurryCorrections.tsx`. Endpoints: `POST /api/projects/{id}/ai/ask/stream`,
`DELETE /api/projects/{id}/ai/ask/{requestId}`, `/api/projects/{id}/documents`,
`/api/projects/{id}/ai/feedback` (and `/cases.jsonl`). Migrations V11 (documents) and V12
(corrections).

**What ran here:** the streaming clients against local stand-ins for each provider over real HTTP
(text before the reply ends, tool calls put back together, a stop ending the request within a second
and closing the connection, an idle provider timing out), the answer's words picked out however the
reply is split, the tool loop's events and stopping, the documents, corrections and journey SQL on
H2 after the real migrations, and in the browser against a stand-in server: lookups and words while
it works, Stop (the server told, the stream closed), the plain fallback, a correction under an
answer, and the corrections card with its download. **Not run here:** a real model streaming (the
formats were written from the providers' documentation as known before this release), and
`./mvnw verify`.

## What changed

### A pretrained model, connected to Niveloft's records

Flurry can now **look things up while it answers** (function calling), when the server's AI model
supports it. Before, it answered from a summary of the project: tasks, owners, dates, dependencies
and status changes. Now it can also read what people wrote.

| Tool | What it returns |
| --- | --- |
| `find_tasks` | Tasks matching words, a status, an owner or "late", in key order (at most 15) |
| `get_task` | One task: description, acceptance criteria, checklist, what it waits on and holds up, submissions with their review decisions (evidence named, never opened), the latest comments |
| `get_comments` | A task's comments, oldest first (at most 30) |
| `find_mentions` | Where else in the project a task is named |
| `recent_activity` | What was recorded in the last 1–30 days, for the project or one task |
| `search_documents` | Passages of the project's approved documents matching words, best first (at most 5), each with its document and section (added 21 October) |
| `propose_create_task` | Suggests a new task. Nothing is created: the person sees it as a card and confirms |
| `propose_start_task` | Suggests starting a task. Same: a card to confirm |

- **The tools only read the project being asked about.** A task key from another project gets "there
  is no task … in this project; don't guess". Every member of the project can already see
  everything the tools return. Each lookup runs in its own short read-only transaction.
- **There is no tool that approves, assigns, reschedules or deletes.** A test checks the catalogue
  never gains one. The two proposal tools go through the same validation as suggestions in a written
  answer, and at most three are kept.
- **What people wrote stays data.** It's wrapped in `<record>` tags with `<`, `>` and `&` escaped, so a
  description can't close its tag and pose as instructions.
- **Bounded:** at most 6 lookups per question (`AI_MAX_LOOKUPS`, 1–10) and 5 rounds with the model;
  calls past the limit are answered "not looked up" so the conversation stays valid, and the answer
  then says it had to stop looking.
- **Every answer shows how it was found.** *How I found this* lists each lookup in order, with a mark
  for what it found: filled when it found records, an empty ring when the records show nothing (with
  the reminder that this isn't proof it didn't happen), and a broken ring when a lookup couldn't be
  done, which is *unknown*, never *no*. An answer from the summary alone says so.
- **Where it works:** the OpenAI chat-completions format (OpenAI, Groq, Google Gemini, OpenRouter, and
  vLLM or LM Studio serving open models such as Qwen3 or xLAM), Ollama's own API (for local models
  that take tools, such as Qwen3), and Anthropic's Messages API. A model whose service refuses
  tools (with an error about tools) is remembered until the server restarts, and Flurry answers
  from the summary as before, at no extra cost. Any other refusal stays an ordinary failure, so it
  can't switch tools off.
- **Spending:** a question still counts once against the person's hourly limit; each round with the
  model counts against the server's daily request cap and its tokens against the monthly cap.

Code: `backend/src/main/resources/ai/tools.json` (the catalogue), `ToolChat`, `ToolLoop`,
`ProjectTools`, the three clients, and `AiService.askProject`. Settings: `AI_TOOLS` (`auto`, or
`off`) and `AI_MAX_LOOKUPS`.

### A natural voice

*Read answers aloud* can use **ElevenLabs** text-to-speech. The browser sends the answer's text to
Niveloft's server, which asks ElevenLabs with its own key and returns the audio; the key never
reaches the browser. If it isn't set up, fails, or is over its budget, the browser's own voice
reads the answer, and the panel says why in one line.

- Settings: `VOICE_PROVIDER=elevenlabs`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`,
  `ELEVENLABS_MODEL` (default `eleven_multilingual_v2`), `VOICE_MAX_CHARACTERS_PER_DAY` (the whole
  server's budget, default 20,000; 0 for none). 60 requests per person per hour.
- What's sent: only the answer's text, up to about 1,200 characters (cut at a sentence), with its
  formatting marks removed. Failed requests don't count against anyone's limit.
- **Privacy:** the policy now names ElevenLabs as a provider when this is on, and the panel's voice
  settings say the text goes to ElevenLabs through the server. Speech recognition is unchanged: it's
  still the browser's own.

Code: `VoiceService`, `POST /api/ai/speech`, `frontend/src/features/assistant/voice.ts`.

### Deadline predictions trained on your own history

A project's owners and managers can download its **task history** (*Project settings → Forecast
training data*, or `GET /api/projects/{id}/export/task-history.csv`): dates, estimates, priorities,
dependencies and counts, with people as p1, p2 … and nothing anyone wrote. The **forecast kit**
in [`ml/`](../ml/README.md) trains models on it and tests them against Niveloft's current forecast
on later work, and recommends one only when it's measurably and reliably better. It also runs first
experiments on the public datasets, within their licences.

### Measuring before any fine-tuning

The **tool-calling eval** in [`ml/`](../ml/README.md#3-measuring-a-model-on-flurrys-tools) runs
26 Niveloft cases (24 at first) against any OpenAI-compatible API, with Flurry's real instructions and tools,
and can score a sample of the xLAM data. It's how to choose between models (a hosted one, Qwen3 on
your own server, an xLAM model) and the gate for fine-tuning: no fine-tuning without a measured gap.

## Every item on the list

| Item | What we did | Why |
| --- | --- | --- |
| **OpenAI function calling** | Adopted: the format Flurry's tools use with OpenAI-compatible services | The most widely supported format: OpenAI, Groq, Gemini, OpenRouter, vLLM and LM Studio all accept it |
| **Qwen3** | Supported, not bundled: through Ollama (its own tool format) or vLLM (OpenAI format) | Open weights that take tools, for a team that wants to self-host. Measure it with the eval first |
| **Salesforce xLAM models** | Supported through vLLM's OpenAI-compatible server; not bundled | Action-oriented models. Check the chosen model's licence separately: it isn't the dataset's |
| **CopilotKit** | Not adopted | Its React components work with its own runtime, which would be a second server beside Spring, and its chat panel would replace Flurry's, which already carries Niveloft's rules (scope, confirm cards, honest states, voice). Flurry's tools are plain server code, so a CopilotKit front end could call the same endpoints later if a team wants it |
| **LiveKit Agents** | Not adopted | Real-time voice conversation needs a LiveKit server (or LiveKit Cloud) and a separate agent process. Flurry's voice is push-to-talk with the browser's recognition, and now a natural voice for answers; a LiveKit agent could call the same API with a person's token later |
| **ElevenLabs** | Text-to-speech adopted for *Read answers aloud*; ElevenLabs Agents not adopted | Speech only sends the answer's text. A hosted agent with a knowledge base would hold project data outside Niveloft's permission checks |
| **Botpress** | Not adopted | Another assistant platform; Flurry already exists inside the app with its rules |
| **Apache Jira Issues** | `ml`: `public jira`, through a column mapping, then the same comparison as your own data | Issue history for duration experiments. Its licence wasn't checked here |
| **Project Management Risk Raw** | `ml`: `public tabular --classify` | Project-level risk classification. Its licence wasn't checked here |
| **Multilingual Customer Support Tickets** | `ml`: `public tickets` (text classification), and a model trained on it is never saved | The creator's current Hugging Face release is CC-BY-NC-4.0: don't assume it permits commercial training |
| **xLAM Function Calling 60K** | `ml`: scored samples in the eval, and a converter to training conversations | CC-BY-4.0, and its access conditions must be accepted on Hugging Face. Measurement first; training only if a gap shows |
| **Desharnais effort notebook** | `ml`: `public effort` (models against the function-point regression) | The notebook is a reference: confirm its input CSV is available |
| **scikit-learn** | The kit's baselines and default models | Strong, well-understood baselines that run anywhere |
| **XGBoost** | Optional in the kit (`--with xgboost`) | Not installed or run in this repository's checks |
| **AutoGluon Tabular** | Optional in the kit (`--with autogluon`, time-limited) | Not installed or run in this repository's checks |
| **Hugging Face PEFT, TRL SFTTrainer** | Not run. The eval and the training-data converter prepare for them | Fine-tuning is reserved for gaps the eval measures, as recommended |
| **pgvector** | Not adopted | Niveloft's database is MySQL, and pgvector is a PostgreSQL extension. Flurry's lookups find tasks by words, keys and filters, which fits team-sized projects |
| **Sentence Transformers** | Not adopted | Embeddings would need a Python service beside the server, or a model run inside Java, and a vector index. Worth it when word search stops finding what people mean; the eval would show that |

## What ran here, and what to run yourself

Ran here, in the sandbox:
- The backend compiled with `javac` 21 against the real library sources, tests included: 0 errors.
  The new logic also ran as plain Java against real Jackson: the tool loop, every provider's wire
  format, the tools over in-memory records (scope, record tags, proposals, refusals, failures), the
  three clients over HTTP against local stand-ins for OpenAI-compatible, Ollama and Anthropic
  services, the voice against a local stand-in for ElevenLabs (audio, key header, budgets, refunds),
  and the task-history file.
- The frontend type check, unit tests and the mock API's tests; a browser suite against the live
  build with a stand-in server (the lookups list in light and dark, server voice played from a blob
  under the site's content security policy, and the fallback to the browser's voice with the
  reason shown).
- The `ml/` tests: the history file, leakage-free features, the replay test and the decision rule on
  synthetic data, the public adapters on made-up files, and the eval against stand-in models.

Not run here, and worth running:
- `./mvnw verify` (the Spring tests, including new ones for the tools, the voice, the export's roles
  and the instructions copy).
- A real model with tools: Qwen3 in Ollama or vLLM, and a hosted one, through the app and through
  `python -m niveloft_ml tools`.
- ElevenLabs with a real key and voice. Its API format was written from its public documentation as
  known before this release (the documentation site couldn't be reached from the sandbox) and tested
  against a stand-in.
- The forecast kit on your own exported history, and the public datasets themselves.
