---
sidebar_position: 5
---

# Class Diagrams

## Backend Services

```mermaid
classDiagram
    class QuestionGenerationService {
        -modelName: string
        -provider: string

        +generateQuestions(transcript, frames)
        +buildSegments(duration, interval)
        +validateJSON(response)
        +retryOnFailure()
    }

    class ReportService {
        +getChildReportScoped(childId, mode)
        +loadAttempts(childId)
        +computeTopCategories(attempts)
        +getVideoTitle(videoId)
    }

    class ChildrenService {
        +createChild(expertId, firstName, lastName, iconKey)
        +getChild(childId)
        +listChildren(expertId)
        +updateChild(childId, fields)
        +deactivateChild(childId)
        +deleteChild(childId)
        +generateChildId()
    }

    class ExpertAuthService {
        +createExpert(expertId, displayName, password)
        +deleteExpert(expertId)
        +hashPassword(password)
        +verifyPassword(password, hash)
        +addVideoAssignment(videoId, expertId)
        +removeVideoAssignment(videoId, expertId)
        +canExpertAccessVideo(expertId, videoId)
    }

    class SQLiteStore {
        -dbPath: string

        +initDB()
        +getConn()
    }

    class VideoProcessor {
        -videoPath: string
        -frameDirectory: string

        +downloadVideo(url)
        +extractFrames()
        +extractTranscript()
    }

    class AnswerEvaluator {
        +checkAnswer(expected, user, question)
        +normalizeText(text)
        +fuzzyMatch(a, b)
    }

    QuestionGenerationService o-- VideoProcessor : uses
    ReportService *-- SQLiteStore : owns
    ChildrenService *-- SQLiteStore : owns
    ExpertAuthService *-- SQLiteStore : owns
    AnswerEvaluator --> ReportService : feeds into
```

The backend is organized into focused service modules. `ChildrenService` and `ExpertAuthService` handle all user and access management. `ReportService` computes per-child progress reports from quiz result files. `AnswerEvaluator` scores voice answers using fuzzy matching and text normalization.

---

## Data Models

```mermaid
classDiagram
    class Child {
        -childId: string
        -firstName: string
        -lastName: string
        -iconKey: string
        -interactionMode: string
        -expertId: string
        -parentId: string
        -isActive: boolean
    }

    class Parent {
        -parentId: string
        -displayName: string
        -loginCodeHash: string
        -loginCode: string
        -isActive: boolean
    }

    class Expert {
        -expertId: string
        -displayName: string
        -passwordHash: string
    }

    class Question {
        -text: string
        -questionType: string
        -timestamp: float
        -correctAnswer: string
    }

    class QuizAttempt {
        -childId: string
        -videoId: string
        -interactionMode: string
        -percentage: float
        -totalRetries: int
        -watchMinutes: float
        -details: List
    }

    Expert "1" *-- "many" Child : manages
    Parent "1" o-- "many" Child : linked to
    Child "1" *-- "many" QuizAttempt : owns
    QuizAttempt *-- Question : contains
```

---

## Frontend Interfaces

```mermaid
classDiagram
    class KidsUI {
        -currentChild: Child
        -selectedCompanion: string

        +displayVideoLibrary()
        +playVideo(videoId)
        +submitVoiceAnswer(answer)
        +rewindVideo(timestamp)
        +keepGoing()
    }

    class CompanionSelector {
        -companions: List

        +displayCompanions()
        +selectCompanion(name)
        +playHelloAudio()
        +swapToWaveImage()
    }

    class QuizPlayer {
        -interactionMode: string
        -currentQuestion: Question

        +pauseAtTimestamp()
        +showQuestion()
        +recordVoice()
        +showFeedback(status)
        +resumeVideo()
    }

    class ParentUI {
        -currentChild: Child

        +reviewQuestions(videoId)
        +editQuestion(question)
        +saveQuestions()
        +loadReport(childId)
        +updateLoginCode(code)
    }

    class AdminUI {
        +downloadVideo(url)
        +generateQuestions(videoId)
        +createParent()
        +manageChildren()
    }

    class ReportUI {
        +displayOverallScore(score)
        +displayStatCards(stats)
        +displayCategoryScores(cats)
        +displayRecentSessions(sessions)
    }

    KidsUI *-- CompanionSelector : owns
    KidsUI *-- QuizPlayer : owns
    ParentUI *-- ReportUI : owns
```

The frontend is split by user role. `KidsUI` handles the child experience including companion selection and quiz playback. `ParentUI` covers question review and report viewing. `AdminUI` manages video processing and account management.

---

## External Services

```mermaid
classDiagram
    class OpenAIService {
        -apiKey: string

        +generateQuestions(prompt, frames)
        +checkAnswer(expected, user)
        +textToSpeech(text, voice)
    }

    class AnthropicService {
        -apiKey: string

        +generateQuestions(prompt, frames)
    }

    class GeminiService {
        -apiKey: string

        +generateQuestions(prompt, frames)
    }

    class HumeAIService {
        -apiKey: string
        -voiceIds: dict

        +getCompanionVoice(companion)
        +streamVoiceLine(text)
    }

    class YTDLPService {
        +downloadVideo(url)
        +extractMetadata(url)
        +extractSubtitles(url)
    }

    class FFmpegService {
        +remuxVideo(inputPath)
        +processAudio(file)
    }

    OpenAIService o-- QuestionGenerationService : used by
    AnthropicService o-- QuestionGenerationService : used by
    GeminiService o-- QuestionGenerationService : used by
    HumeAIService o-- CompanionSelector : used by
    YTDLPService *-- VideoProcessor : owned by
    FFmpegService o-- VideoProcessor : used by
```

All three AI providers (OpenAI, Anthropic, Gemini) are supported for question generation. Hume AI powers the companion character voices. yt-dlp and FFmpeg handle video downloading and processing.
