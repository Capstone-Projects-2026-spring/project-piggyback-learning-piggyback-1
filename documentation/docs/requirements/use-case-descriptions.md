---
sidebar_position: 5
---

# Use-case descriptions

## Use Case 1 - Admin downloads a video and generates questions
*As an admin, I want to add a YouTube video to the system and generate quiz questions for it.*

1. The admin logs in using the admin password.
2. The admin pastes a YouTube video URL into the admin panel.
3. The system downloads the video and extracts frames.
4. The system uses AI to generate comprehension questions based on the video content.
5. The questions are saved and made available for parent review.

---

## Use Case 2 - Parent sets up their child's profile
*As a parent, I want to create a profile for my child and configure how they interact with quizzes.*

1. The parent logs in using their personal access code.
2. The parent navigates to the child management section.
3. The parent creates a child profile - entering the child's name, picking an icon, and selecting an interaction mode: strict, flexible, or passive.
4. The system saves the profile and the child is ready to use the app.

---

## Use Case 3 - Parent reviews and approves quiz questions
*As a parent, I want to review the AI-generated questions before my child sees them.*

1. The parent logs in and navigates to the question review section.
2. The parent selects a video to review.
3. The parent reads through each question, editing or removing any that are unclear or inaccurate.
4. The parent saves the final set of questions.
5. The questions are now available for the child during playback.

---

## Use Case 4 - Child logs in and picks a companion
*As a child, I want to log in and pick a friend to watch videos with me.*

1. The child opens the app and enters the access code provided by their parent.
2. The child sees their profile and selects it.
3. The child picks a companion character - Blossom the Bunny, Pippa the Pig, or Ash the Alligator.
4. The child is taken to the video library.

---

## Use Case 5 - Child watches a video and answers quiz questions
*As a child, I want to watch a video and answer questions using my voice.*

1. The child selects a video from the library.
2. The system loads the video with the interaction mode set by the parent.
3. The video plays and pauses at question timestamps.
4. The system displays a question and the companion prompts the child to answer.
5. The system records the child's voice, converts it to text, and evaluates the answer.
6. The companion gives feedback - correct, almost, or incorrect - based on the result.
7. The video resumes and continues to the next question.

**Alternate flow - strict mode:** The child must answer correctly before the video continues. If incorrect, the video rewinds to the relevant segment.

**Alternate flow - flexible mode:** The child answers but can press "Keep Going" if incorrect. The companion reveals the correct answer.

**Alternate flow - passive mode:** No questions are shown. The video plays straight through and only watch time is recorded.

---

## Use Case 6 - Child's voice is not recognized
*As a child, I want the app to let me retry if it didn't understand what I said.*

1. The system displays a question and starts recording.
2. The child speaks but the system cannot recognize the answer clearly.
3. The system prompts the child to try again.
4. The child speaks again and the system re-evaluates.

---

## Use Case 7 - Parent checks their child's report
*As a parent, I want to see how my child is doing so I can track their progress.*

1. The parent logs in using their personal access code.
2. The parent navigates to the report section and selects their child.
3. The parent clicks "Load Report."
4. The system displays the child's overall score, quiz attempts, retries, watch time, and recent sessions.
5. The parent uses the report to decide whether to adjust the child's interaction mode or review more questions.
