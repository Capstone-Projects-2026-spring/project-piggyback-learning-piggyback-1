---
sidebar_position: 4
---

# Features and Requirements

## Functional Requirements

- The application supports three parent-configured interaction modes:
  - **Flexible** - questions appear during the video and the child answers by voice, but an incorrect or skipped answer does not stop playback. A hint and the correct answer are shown so the child can learn and move on.
  - **Strict** - the video pauses at each question and the child must answer correctly before playback resumes. An incorrect answer rewinds the video to the relevant section so the child can re-watch and try again.
  - **Passive** - the video plays from start to finish with no questions or interruptions.
- The application generates questions for the child to answer based on the video content.
- The application allows the child to select a companion character - Blossom the Bunny, Pippa the Pig, or Ash the Alligator - each with a distinct personality that influences how questions and encouragement are presented.
- The application includes a rewind system that allows the child to return to the relevant part of the video associated with a question, helping them review the context before retrying.
- The application provides a report for parents to track their child's performance, quiz scores, retries, and watch time.
- Admins create and manage parent accounts. Parents create and manage their children's profiles and configure their interaction mode.
- Parents log in with a personal access code and can view reports for their linked children.
- Children log in with a parent-provided access code, pick their profile, choose a companion, and watch videos with interactive quizzes.

## Non-Functional Requirements

- **Usability:** The system shall be easy to use for first-time users, including clear voice input instructions.
- **Performance:** Quiz interactions and voice processing shall respond without noticeable delay.
- **Reliability:** The system shall consistently save user answers and scores, even if voice input must be retried.
- **Security:** User data shall be protected through authentication and secure storage practices.
- **Availability:** The system shall be accessible whenever the server is online.
