---
sidebar_position: 4
---

# Features and Requirements

## Functional Requirements

- The application supports three parent-configured interaction modes that control how a child engages with quiz questions during video playback:
  - **Flexible** - the video pauses at each question timestamp, the child answers by voice, and playback resumes regardless of whether the answer is correct. If the answer is incorrect or skipped, the companion reveals the correct answer before continuing.
  - **Strict** - the video pauses at each question timestamp and the child must answer correctly before playback resumes. An incorrect answer rewinds the video to the start of the segment where the question content was covered, and the question is asked again.
  - **Passive** - the video plays from start to finish with no questions, pauses, or interruptions. Only watch time is recorded.

- The application generates quiz questions automatically from video content. Questions are generated per video segment using extracted frames and subtitles sent to an AI provider (OpenAI, Anthropic, or Gemini). The segment interval defaults to 60 seconds but the admin can configure it to any interval (e.g. 30 seconds) before generating questions for a video. Each segment produces questions across categories including character, setting, feeling, action, cause, outcome, and prediction.

- The application presents one question per video segment at the timestamp where that segment ends. Questions are displayed on screen and read aloud by the companion character.

- The child answers each question by speaking aloud. The application records the child's voice, transcribes it to text, and evaluates it using fuzzy text matching. A response is marked correct, almost correct, or incorrect. Borderline answers are escalated to an AI provider for a final judgment.

- The application includes three selectable companion characters - Blossom the Bunny, Pippa the Pig, and Ash the Alligator. Each companion delivers questions and feedback using a distinct voice provided by Hume AI. The companion speaks the question aloud, reads back the child's answer, and delivers feedback based on whether the answer was correct, almost correct, or incorrect.

- When a child answers incorrectly in Strict mode, the video rewinds to the start of the segment associated with that question (the segment start timestamp stored in the question metadata), so the child can re-watch the relevant content before retrying.

- The application provides a progress report for parents that includes: overall quiz score as a percentage, total number of quiz attempts, total number of retries, total watch time in minutes, scores broken down by question category, and a list of recent quiz sessions with per-session results.

- Admins can perform the following actions on parent accounts: create, view, update, and delete. Parents can perform the following actions on child profiles: create, view, update (name, icon, interaction mode), and deactivate.

- Parents log in using a personal access code (maximum 5 characters) set by the admin or by the parent themselves. Children log in by entering their parent's access code, then selecting their profile from the list of children linked to that parent.

- Parents can review, edit, and remove AI-generated questions for a video before those questions are shown to their child. Questions only become active for a child after the parent saves the final question set.

- The admin can download a YouTube video by URL, extract frames at one frame per second, and trigger AI question generation for that video. All three steps must be completed before a video becomes available for parent review.

---

## Non-Functional Requirements

- **Usability:** First-time users shall be able to complete a quiz session without external guidance. Voice input instructions shall be displayed on screen before each recording prompt.
- **Performance:** The application shall return an answer evaluation result within 5 seconds of the child finishing speaking.
- **Reliability:** Every completed quiz attempt shall be saved to the child's result file. A failed or retried voice input shall not result in a lost or duplicate quiz record.
- **Security:** Admin access requires a password set via environment variable. Parent access requires a hashed access code stored in the database. No plaintext passwords are stored except for the parent's custom login code used for quick lookup.
- **Availability:** The application shall be accessible to all users whenever the server is running. No scheduled downtime is required.
