    
    // ===============================
    // CONFIGURATION
    // ===============================
    const DEV_MODE = false; // set false to hide sidebar & toggle in production

    let THRESHOLDS = {
      phrase: { correct: 0.6, borderline: 0.5 },
      number: { correct: 0.7, borderline: 0.6 }
    };

    const TTS_DEFAULTS = {
      voice: "sage",
      speed: 0.9,
      format: "mp3"
    };
    const TTS_PREFETCH_AHEAD = 3;
    const TTS_CACHE_LIMIT = 12;

    const MIN_FEEDBACK_DISPLAY_MS = 1100;
    const LISTEN_RETRY_DELAY_MS = 1400;
    const MAX_LISTEN_RETRIES = 2;
    const SILENCE_THRESHOLD = 0.015;
    const SILENCE_DURATION_MS = 1400;
    const SPEECH_FRAMES_REQUIRED = 4;
    const MAX_LISTEN_DURATION_MS = 9000;
    const AMBIENT_SAMPLE_FRAMES = 20;
    const SILENCE_THRESHOLD_MULTIPLIER = 2.5;
    const VOICE_PRIORITY_PATTERNS = [
      /child/i,
      /kid/i,
      /young/i,
      /girl/i,
      /boy/i,
      /teen/i
    ];
    const ENGLISH_US_VOICE_PATTERN = /en\s*-?us/i;
    const VOICE_NAME_PREFERENCES = [
      /Jenny.*Neural/i,
      /Aria.*Neural/i,
      /Ana.*Neural/i,
      /Ava.*Neural/i,
      /Alyssa.*Neural/i,
      /Emma.*Neural/i,
      /Lia.*Neural/i,
      /Amber.*Neural/i,
      /Mia.*Neural/i,
      /Sara.*Neural/i,
      /Alloy/i,
      /Pippa/i,
      /Neural.*Child/i,
      /Natural.*Child/i,
      /Kid/i,
      /Children/i,
      /Young/i,
      /Girl/i,
      /Boy/i,
      /Google US English/i,
      /Google UK English Female/i,
      /Samantha/i
    ];
    const STORED_VOICE_KEY = "piggybackPreferredVoiceName";

    const SUCCESS_FEEDBACK = [
      "Good job!",
      "Amazing!",
      "Fantastic!",
      "Awesome work!",
      "You nailed it!"
    ];
    function getBorderlineFeedback() {
      const isStrict = document.body.dataset.interactionMode === 'strict';
      return isStrict ? "Almost! Let's watch it again." : "Almost! Let's keep going!";
    }
    
    function getRetryFeedback() { 
      const isStrict = document.body.dataset.interactionMode === 'strict';
      return isStrict ? "I think we missed it. Let's watch it again." : "That's not quite the answer, but it's okay! Let's keep going!";
    }
    const wrongAttempted = new Set();
    const retryCountMap = new Map();

    // ===============================
    // Global State
    // ===============================
    let segments = [];
    let asked = new Set();
    let checkInterval = null;
    let activeQuestion = false;
    let previousTime = 0;
    let maxAllowedTime = 0;
    let skipLockBypass = false;
    let totalQuestions = 0;
    let correctAnswers = 0;
    let libraryVideos = [];
    let questionUtterance = null;
    let questionSpeechCancelled = false;
    let feedbackUtterance = null;
    let currentListenAttempt = 0;
    let currentQuestionContext = null;
    let preferredSpeechVoice = null;
    let playerMode = "youtube";
    let localVideoElement = null;
    let currentVideoMeta = null;
    const END_SCREEN_BLOCK_SECONDS = 15;
    let ytPlayer = null;
    let ytApiPromise = null;
    let ytPlayerReady = false;

    function setQuestionOverlay(active) {
      if (!questionOverlay) return;
      const corner = document.getElementById('companion-corner');
      if (active) {
        questionOverlay.style.display = "block";
        requestAnimationFrame(() => {
          questionOverlay.style.opacity = "1";
        });
        if (corner) corner.style.display = 'none';
      } else {
        questionOverlay.style.opacity = "0";
        setTimeout(() => {
          if (questionOverlay.style.opacity === "0") {
            questionOverlay.style.display = "none";
          }
        }, 200);
        if (corner) corner.style.display = 'flex';
      }
    }

    function getStoredVoiceName() {
      if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
        return null;
      }
      try {
        const stored = window.localStorage.getItem(STORED_VOICE_KEY);
        return stored && stored.trim() ? stored.trim() : null;
      } catch (err) {
        console.warn("Unable to access stored voice:", err);
        return null;
      }
    }

    function storePreferredVoiceName(name) {
      if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
        return;
      }
      try {
        if (name && name.trim()) {
          window.localStorage.setItem(STORED_VOICE_KEY, name.trim());
        } else {
          window.localStorage.removeItem(STORED_VOICE_KEY);
        }
      } catch (err) {
        console.warn("Unable to persist preferred voice:", err);
      }
    }

    function selectPreferredVoiceFrom(voices) {
      if (!Array.isArray(voices) || voices.length === 0) {
        return null;
      }

      const storedName = getStoredVoiceName();
      if (storedName) {
        const storedMatch = voices.find(
          (voice) => voice?.name === storedName || voice?.voiceURI === storedName
        );
        if (storedMatch) {
          return storedMatch;
        }
      }

      for (const pattern of VOICE_NAME_PREFERENCES) {
        const match = voices.find(voice => pattern.test(`${voice?.name || ""} ${voice?.voiceURI || ""}`));
        if (match) {
          storePreferredVoiceName(match.name || match.voiceURI || "");
          return match;
        }
      }

      let bestVoice = null;
      let bestScore = -Infinity;
      voices.forEach((voice, index) => {
        const name = voice?.name || "";
        const lang = voice?.lang || "";
        const descriptor = `${name} ${lang}`;
        let score = 0;

        if (VOICE_PRIORITY_PATTERNS.some(pattern => pattern.test(descriptor))) {
          score += 100;
        }
        if (VOICE_NAME_PREFERENCES.some(pattern => pattern.test(descriptor))) {
          score += 80;
        }
        if (ENGLISH_US_VOICE_PATTERN.test(lang)) {
          score += 25;
        } else if (/en/i.test(lang)) {
          score += 10;
        }
        if (/(neural|natural|wavenet|premium|studio)/i.test(descriptor)) {
          score += 8;
        }
        if (voice.default) {
          score += 4;
        }
        if (/kid|child|young/i.test(descriptor)) {
          score += 6;
        }
        if (/female|girl|boy|soprano|alto/i.test(descriptor)) {
          score += 5;
        }
        score -= index * 0.05;

        if (score > bestScore) {
          bestScore = score;
          bestVoice = voice;
        }
      });
      if (bestVoice) {
        storePreferredVoiceName(bestVoice.name || bestVoice.voiceURI || "");
      }
      return bestVoice || voices[0];
    }

    function refreshPreferredVoice() {
      if (!("speechSynthesis" in window)) {
        return null;
      }
      const voices = window.speechSynthesis.getVoices();
      if (!voices || voices.length === 0) {
        return preferredSpeechVoice;
      }
      preferredSpeechVoice = selectPreferredVoiceFrom(voices);
      return preferredSpeechVoice;
    }

    function ensurePreferredVoice() {
      if (!("speechSynthesis" in window)) {
        return null;
      }
      if (preferredSpeechVoice) {
        return preferredSpeechVoice;
      }
      const voice = refreshPreferredVoice();
      if (voice) {
        return voice;
      }
      // Trigger async loading if voices are not ready yet.
      try {
        window.speechSynthesis.getVoices();
      } catch (err) {
        console.warn("Unable to prime speech voices:", err);
      }
      return preferredSpeechVoice;
    }

    if ("speechSynthesis" in window) {
      const synth = window.speechSynthesis;
      try {
        const handler = () => refreshPreferredVoice();
        if (typeof synth.addEventListener === "function") {
          synth.addEventListener("voiceschanged", handler);
        } else {
          synth.onvoiceschanged = handler;
        }
      } catch (err) {
        console.warn("Failed to attach voiceschanged listener:", err);
      }
      refreshPreferredVoice();
    }

    if (typeof window !== "undefined") {
      window.piggybackListVoices = () => {
        if (!("speechSynthesis" in window)) return [];
        return window.speechSynthesis.getVoices().map(v => ({
          name: v.name,
          lang: v.lang,
          default: v.default,
          voiceURI: v.voiceURI
        }));
      };
      window.piggybackSetPreferredVoice = (name) => {
        storePreferredVoiceName(name);
        refreshPreferredVoice();
      };
    }


    const videoContainer = document.getElementById("video-container");
    const fullscreenBtn = document.getElementById("custom-fullscreen-btn");
    const questionActionsEl = document.getElementById("question-actions");
    const retryAnswerBtn = document.getElementById("retry-answer-btn");
    const skipAnswerBtn = document.getElementById("skip-answer-btn");
    const questionOverlay = document.getElementById("question-overlay");
    const embedFallback = document.getElementById("embed-fallback");
    const useLocalVideoBtn = document.getElementById("use-local-video-btn");
    const ytEndBlocker = document.getElementById("yt-end-blocker");
    const ytPauseBlocker = document.getElementById("yt-pause-blocker");
    hideQuestionActions();
    const fullscreenAPI = {
      element() {
        return document.fullscreenElement
          || document.webkitFullscreenElement
          || document.mozFullScreenElement
          || document.msFullscreenElement
          || null;
      },
      request(el) {
        if (!el) return Promise.reject(new Error("No element for fullscreen"));
        if (el.requestFullscreen) return el.requestFullscreen();
        if (el.webkitRequestFullscreen) {
          el.webkitRequestFullscreen();
          return Promise.resolve();
        }
        if (el.mozRequestFullScreen) {
          el.mozRequestFullScreen();
          return Promise.resolve();
        }
        if (el.msRequestFullscreen) {
          el.msRequestFullscreen();
          return Promise.resolve();
        }
        return Promise.reject(new Error("Fullscreen API not supported"));
      },
      exit() {
        if (document.exitFullscreen) return document.exitFullscreen();
        if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
          return Promise.resolve();
        }
        if (document.mozCancelFullScreen) {
          document.mozCancelFullScreen();
          return Promise.resolve();
        }
        if (document.msExitFullscreen) {
          document.msExitFullscreen();
          return Promise.resolve();
        }
        return Promise.resolve();
      }
    };

    function showEmbedFallback(message) {
      if (!embedFallback) return;
      const textEl = embedFallback.querySelector("span");
      if (message && textEl) {
        textEl.textContent = message;
      }
      if (useLocalVideoBtn) {
        useLocalVideoBtn.disabled = !(currentVideoMeta && currentVideoMeta.local_path);
      }
      embedFallback.style.display = "flex";
    }

    function hideEmbedFallback() {
      if (!embedFallback) return;
      embedFallback.style.display = "none";
    }

    function clearLocalPlayer() {
      if (localVideoElement) {
        try {
          localVideoElement.pause();
        } catch (err) {
          console.warn("Failed to pause local video:", err);
        }
      }
      localVideoElement = null;
      const host = document.getElementById("player");
      if (host && host.querySelector("#local-player")) {
        host.innerHTML = "";
      }
    }

    function switchToLocalVideo() {
      if (!currentVideoMeta || !currentVideoMeta.local_path) {
        alert("No downloaded video available for this item.");
        return;
      }

      if (ytPlayer && typeof ytPlayer.destroy === "function") {
        ytPlayer.destroy();
        ytPlayer = null;
        ytPlayerReady = false;
      }

      hidePauseBlocker();
      playerMode = "local";
      const host = document.getElementById("player");
      if (!host) return;
      host.innerHTML = "";

      const video = document.createElement("video");
      video.id = "local-player";
      video.src = currentVideoMeta.local_path;
      video.controls = true;
      video.preload = "metadata";
      video.setAttribute("playsinline", "");
      video.setAttribute("controlslist", "nodownload noremoteplayback");
      video.addEventListener("play", () => {
        if (activeQuestion) {
          pauseVideo();
        }
      });
      video.addEventListener("ended", () => {
        if (typeof showFinalScore === "function" && typeof quizScore !== "undefined" && quizScore.total > 0) {
          showFinalScore();
        }
      });

      host.appendChild(video);
      localVideoElement = video;
      hideEmbedFallback();
      if (ytEndBlocker) {
        ytEndBlocker.style.display = "none";
      }
      playVideo();
    }

    function loadYouTubeApi() {
      if (window.YT && window.YT.Player) {
        return Promise.resolve();
      }
      if (ytApiPromise) {
        return ytApiPromise;
      }
      ytApiPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector('script[data-yt-iframe-api="true"]');
        if (existing) {
          if (window.YT && window.YT.Player) {
            resolve();
          } else {
            window.onYouTubeIframeAPIReady = () => resolve();
          }
          return;
        }
        const script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        script.async = true;
        script.dataset.ytIframeApi = "true";
        script.onerror = () => reject(new Error("Failed to load YouTube API"));
        window.onYouTubeIframeAPIReady = () => resolve();
        document.body.appendChild(script);
      });
      return ytApiPromise;
    }

    function getVideoId(url) {
      if (!url || typeof url !== "string") return null;
      const regExp = /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
      const match = url.match(regExp);
      return match && match[2] && match[2].length === 11 ? match[2] : null;
    }

    function resolveVideoId(video) {
      if (!video) return null;
      const raw = (video.video_id || video.youtube_url || video.url || "").trim();
      if (!raw) return null;
      if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;
      return getVideoId(raw);
    }

    function handlePlayerStateChange(event) {
      if (!event) return;
      if (event.data === YT.PlayerState.PLAYING) {
        hidePauseBlocker();
        // Reset companion back to watch mode
        const watcher = document.getElementById('companion-watcher');
        const talker = document.getElementById('companion-talker');
        const bubble = document.getElementById('companion-bubble');
        if (talker) talker.style.display = 'none';
        if (bubble) bubble.style.display = 'none';
        if (watcher && watcher.src) watcher.style.display = 'block';
        if (ytEndBlocker) {
          ytEndBlocker.style.display = "none";
        }
        if (activeQuestion) {
          ytPlayer?.pauseVideo();
        }
        // Start watch timer for passive users
        if (document.body.dataset.interactionMode === 'passive' && typeof quizScore !== 'undefined') {
            if (quizScore.watchStartTime === null) {
                quizScore.watchStartTime = Date.now();
            }
        }
      }
      if (event.data === YT.PlayerState.PAUSED) {
        if (!activeQuestion) {
          showPauseBlocker();
          if (typeof window.triggerCompanionTalk === 'function') window.triggerCompanionTalk();
        } else {
          hidePauseBlocker();
        }
        // Pause watch timer for passive users
        if (document.body.dataset.interactionMode === 'passive' && typeof quizScore !== 'undefined') {
            if (quizScore.watchStartTime !== null) {
                quizScore.watchAccumulatedMs = (quizScore.watchAccumulatedMs || 0) + (Date.now() - quizScore.watchStartTime);
                quizScore.watchStartTime = null;
            }
        }
      }
      if (event.data === YT.PlayerState.ENDED) {
        hidePauseBlocker();
        if (ytEndBlocker) {
            ytEndBlocker.style.display = "flex";
        }
        if (document.body.dataset.interactionMode === 'passive') {
            // Stop the timer before saving
            if (typeof quizScore !== 'undefined' && quizScore.watchStartTime !== null) {
                quizScore.watchAccumulatedMs = (quizScore.watchAccumulatedMs || 0) + (Date.now() - quizScore.watchStartTime);
                quizScore.watchStartTime = null;
            }
            if (typeof savePassiveWatchSession === 'function') {
                savePassiveWatchSession();
            }
        } else if (typeof showFinalScore === "function" && typeof quizScore !== "undefined" && quizScore.total > 0) {
            showFinalScore();
        }
      }
    }

    function updateEndscreenBlocker() {
      if (!ytEndBlocker) return;
      const duration = getPlayerDuration();
      if (!duration || duration <= 0) {
        ytEndBlocker.style.display = "none";
        return;
      }
      const remaining = duration - getPlayerTime();
      if (remaining <= END_SCREEN_BLOCK_SECONDS && remaining >= 0) {
        ytEndBlocker.style.display = "flex";
      } else if (remaining > END_SCREEN_BLOCK_SECONDS && ytEndBlocker.style.display !== "none") {
        ytEndBlocker.style.display = "none";
      }
    }

    function showPauseBlocker() {
      if (!ytPauseBlocker || playerMode !== "youtube" || activeQuestion) return;
      ytPauseBlocker.style.display = "flex";
    }

    function hidePauseBlocker() {
      if (!ytPauseBlocker) return;
      ytPauseBlocker.style.display = "none";
    }

    function handleEmbedError(event) {
      console.warn("YouTube embed error:", event?.data);
      showEmbedFallback("YouTube embed unavailable.");
    }

    async function ensureYouTubePlayer(videoId) {
      await loadYouTubeApi();
      playerMode = "youtube";
      hidePauseBlocker();
      clearLocalPlayer();
      if (ytEndBlocker) {
        ytEndBlocker.style.display = "none";
      }
      if (ytPlayer) {
        ytPlayer.loadVideoById(videoId);
        ytPlayerReady = true;
        return;
      }
      ytPlayer = new YT.Player("player", {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          controls: 1,
          fs: 0,
          disablekb: 1,
          iv_load_policy: 3,
          origin: window.location.origin
        },
        events: {
          onReady: () => {
            ytPlayerReady = true;
          },
          onStateChange: handlePlayerStateChange,
          onError: handleEmbedError
        }
      });
      await new Promise((resolve) => {
        const readyCheck = () => {
          if (ytPlayerReady) {
            resolve();
          } else {
            setTimeout(readyCheck, 50);
          }
        };
        readyCheck();
      });
    }

    function getPlayerTime() {
      if (playerMode === "local" && localVideoElement) {
        return Number(localVideoElement.currentTime) || 0;
      }
      if (!ytPlayer) return 0;
      try {
        return Number(ytPlayer.getCurrentTime()) || 0;
      } catch (err) {
        return 0;
      }
    }

    function setPlayerTime(seconds) {
      const safe = Math.max(0, Number(seconds) || 0);
      if (playerMode === "local" && localVideoElement) {
        localVideoElement.currentTime = safe;
        return;
      }
      if (!ytPlayer) return;
      ytPlayer.seekTo(safe, true);
    }

    function getPlayerDuration() {
      if (playerMode === "local" && localVideoElement) {
        return Number(localVideoElement.duration) || 0;
      }
      if (!ytPlayer) return 0;
      try {
        return Number(ytPlayer.getDuration()) || 0;
      } catch (err) {
        return 0;
      }
    }

    function playVideo() {
      hidePauseBlocker();
      if (playerMode === "local" && localVideoElement) {
        localVideoElement.play();
        return;
      }
      if (ytPlayer) {
        ytPlayer.playVideo();
      }
    }

    function pauseVideo() {
      if (playerMode === "local" && localVideoElement) {
        localVideoElement.pause();
        return;
      }
      if (ytPlayer) {
        ytPlayer.pauseVideo();
        if (!activeQuestion) {
          showPauseBlocker();
        }
      }
    }

    function hideQuestionActions(options = {}) {
      const { keepOverlay = false } = options;
      if (questionActionsEl) {
        questionActionsEl.style.display = "none";
      }
      if (retryAnswerBtn) {
        retryAnswerBtn.style.display = "none";
        retryAnswerBtn.disabled = false;
      }
      if (skipAnswerBtn) {
        skipAnswerBtn.style.display = "none";
        skipAnswerBtn.disabled = false;
      }
      if (!keepOverlay) {
        setQuestionOverlay(false);
      }
    }

    function showQuestionActions({ showRetry = true, showSkip = true } = {}) {
      if (!questionActionsEl) return;
      questionActionsEl.style.display = "flex";
      if (retryAnswerBtn) {
        retryAnswerBtn.style.display = showRetry ? "" : "none";
        retryAnswerBtn.disabled = false;
      }
      if (skipAnswerBtn) {
        skipAnswerBtn.style.display = showSkip ? "" : "none";
        skipAnswerBtn.disabled = false;
      }
      setQuestionOverlay(true);
    }

    function prepareManualRetry({ q, segStart, segEnd, message, color, showSkip = true }) {
      const feedbackEl = document.getElementById("feedback");
      if (message) {
        feedbackEl.innerText = message;
      }
      if (color) {
        feedbackEl.style.color = color;
      }
      currentQuestionContext = { q, segStart, segEnd };
      showQuestionActions({ showRetry: true, showSkip });
    }

    function updateFullscreenToggleState() {
      if (!fullscreenBtn) return;
      const active = fullscreenAPI.element() === videoContainer;
      fullscreenBtn.setAttribute("aria-pressed", active ? "true" : "false");
    }

    function toggleFullscreen() {
      const current = fullscreenAPI.element();
      if (current === videoContainer) {
        const exitResult = fullscreenAPI.exit();
        if (exitResult && typeof exitResult.then === "function") {
          exitResult.then(updateFullscreenToggleState).catch(err => console.warn("Exit fullscreen failed:", err));
        } else {
          setTimeout(updateFullscreenToggleState, 0);
        }
        return;
      }

      const requestResult = fullscreenAPI.request(videoContainer);
      if (requestResult && typeof requestResult.then === "function") {
        requestResult.then(updateFullscreenToggleState).catch(err => console.warn("Fullscreen request failed:", err));
      } else {
        setTimeout(updateFullscreenToggleState, 0);
      }
    }

    function handleFullscreenChange() {
      const current = fullscreenAPI.element();
      const isContainerFullscreen = current === videoContainer;
      document.body.classList.toggle("fullscreen-active", isContainerFullscreen);
      updateFullscreenToggleState();
    }

    ["fullscreenchange", "webkitfullscreenchange", "mozfullscreenchange", "MSFullscreenChange"]
      .forEach(evt => document.addEventListener(evt, handleFullscreenChange));

    if (retryAnswerBtn) {
      retryAnswerBtn.addEventListener("click", () => {
        if (!currentQuestionContext) return;
        hideQuestionActions();
        const feedbackEl = document.getElementById("feedback");
        feedbackEl.innerText = "Listening...";
        feedbackEl.style.color = "#384b87";
        currentListenAttempt = 0;
        startListening(
          currentQuestionContext.q,
          currentQuestionContext.segStart,
          currentQuestionContext.segEnd,
          0
        );
      });
    }

    if (skipAnswerBtn) {
      skipAnswerBtn.addEventListener("click", () => {
        const isStrictMode = document.body.dataset.interactionMode === "strict";
    
        // disable skipping in strict mode
        if (isStrictMode) return;
        hideQuestionActions();
    
        if (currentQuestionContext) {
          const quesSec = toSeconds(currentQuestionContext.q.ques_time);
          asked.add(quesSec);
          setPlayerTime(currentQuestionContext.segStart);
        }
        resumeVideo();
      });
    }

    if (useLocalVideoBtn) {
      useLocalVideoBtn.addEventListener("click", () => {
        switchToLocalVideo();
      });
    }

    if (ytEndBlocker) {
      ytEndBlocker.addEventListener("click", () => {
        setPlayerTime(0);
        playVideo();
        ytEndBlocker.style.display = "none";
      });
    }

    if (ytPauseBlocker) {
      ytPauseBlocker.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        if (activeQuestion) return;
        hidePauseBlocker();
        playVideo();
      });
    }

    fullscreenBtn?.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      toggleFullscreen();
    });

    videoContainer.addEventListener("dblclick", (evt) => {
      evt.preventDefault();
      toggleFullscreen();
    });

    videoContainer.addEventListener("contextmenu", (evt) => {
      evt.preventDefault();
    });

    document.addEventListener("keydown", (evt) => {
      const key = typeof evt.key === "string" ? evt.key.toLowerCase() : "";
      if (key === "f" && document.body.classList.contains("watching-video")) {
        evt.preventDefault();
        toggleFullscreen();
      }
    });

    // Prevent keyboard shortcuts (space, k, media keys) during questions
    document.addEventListener("keydown", (e) => {
      if (!activeQuestion) return;
      const k = e.key.toLowerCase();
      if (k === " " || k === "k" || k === "mediaplaypause") {
        e.preventDefault();
        e.stopPropagation();
      }
    }, { capture: true });

    const sidebar = document.getElementById("sidebar");
    const toggleBtn = document.getElementById("toggle-sidebar");
    const videoGrid = document.getElementById("video-grid");
    const backButton = document.getElementById("back-button");
    const searchInput = document.getElementById("kids-search");
    const searchButton = document.getElementById("kids-search-btn");

    // DEV mode visibility
    if (!DEV_MODE) {
      sidebar.classList.add("hidden");
      toggleBtn.classList.add("hidden");
    }

    // Sidebar toggle (single source of truth via .hidden class)
    toggleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      sidebar.classList.toggle("hidden");
    });

    function renderVideoGrid(videos) {
      videoGrid.innerHTML = "";
      if (!videos || !videos.length) {
        videoGrid.innerHTML = `<div class="video-empty">No videos found. Try a different search!</div>`;
        return;
      }

      videos.forEach(video => {
        const card = document.createElement("div");
        card.className = "video-card";
        const safeTitle = video.title || "Untitled Video";
        const durationLabel = video.duration && video.duration !== "00:00" ? video.duration : "";
        card.innerHTML = `
          <div class="thumb-wrapper">
            <img class="video-thumb" src="${video.thumbnail}" alt="${safeTitle}">
            ${durationLabel ? `<span class="video-duration">${durationLabel}</span>` : ""}
          </div>
          <div class="video-info">
            <p class="video-title">${safeTitle}</p>
          </div>
        `;
        card.onclick = () => startQuiz(video);
        card.setAttribute("tabindex", "0");
        card.addEventListener("keydown", (evt) => {
          if (evt.key === "Enter" || evt.key === " ") {
            evt.preventDefault();
            startQuiz(video);
          }
        });
        videoGrid.appendChild(card);
      });
    }

    function applyFilters() {
      if (!Array.isArray(libraryVideos)) return;
      const searchTerm = (searchInput?.value || "").trim().toLowerCase();
      let filtered = [...libraryVideos];
      if (searchTerm) {
        filtered = filtered.filter(video => (video.title || "").toLowerCase().includes(searchTerm));
      }
      renderVideoGrid(filtered);
    }

    searchInput?.addEventListener("input", () => applyFilters());

    searchInput?.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        applyFilters();
      }
    });

    searchButton?.addEventListener("click", () => {
      searchInput?.focus();
      applyFilters();
    });

    // ===============================
    // Load Videos for Library
    // ===============================
    async function loadConfig() {
      try {
        const res = await fetch("/api/config");
        const cfg = await res.json();
        if (cfg && cfg.thresholds) {
          THRESHOLDS = cfg.thresholds;
        }
      } catch (err) {
        console.error("[Warning] Failed to load config, using defaults.", err);
      }
    }

    async function loadVideos() {
      try {
        const res = await fetch("/api/kids_videos?nocache=" + Date.now());
        const data = await res.json();
        if (!data.success) throw new Error("API error");

        libraryVideos = Array.isArray(data.videos) ? data.videos : [];
        applyFilters();
      } catch (err) {
        console.error("[Error] loading kids_videos:", err);
        videoGrid.innerHTML = '<div class="video-empty">Oops! We couldn\'t load the videos right now.</div>';
      }
    }

    // ===============================
    // Start Quiz for Selected Video
    // ===============================
    async function startQuiz(video) {
      // Hide library, show quiz player
      videoGrid.style.display = "none";
      document.getElementById("player-container").style.display = "flex";
      backButton.style.display = "inline-flex";
      const switchBtn = document.getElementById('switch-companion-btn');
      if (switchBtn) switchBtn.style.display = 'none';
      window.scrollTo(0, 0);
      document.body.classList.add("watching-video");

      // Hide library companion greeter
      const libComp = document.getElementById('library-companion');
      if (libComp) libComp.style.display = 'none';

      // Slide companion corner in from bottom when video starts
      const corner = document.getElementById('companion-corner');
      if (corner) {
        corner.style.animation = 'none';
        corner.offsetHeight;
        corner.style.animation = 'slideUpIn 0.5s cubic-bezier(0.34,1.56,0.64,1) both';
      }

      // Auto-fullscreen (we're inside a click handler so gesture is valid)
      try {
        if (videoContainer && videoContainer.requestFullscreen) {
          videoContainer.requestFullscreen().catch(() => {});
        }
      } catch (_) {}
      currentVideoMeta = video;
      // Start watch tracking immediately for passive users
      if (document.body.dataset.interactionMode === 'passive') {
          if (typeof startQuizTracking === 'function') {
              startQuizTracking(video.video_id, 0);
          }
      }
      hideEmbedFallback();

      // Load YouTube video
      try {
        const resolvedId = resolveVideoId(video);
        if (!resolvedId) {
          showEmbedFallback("Invalid YouTube link. Use the downloaded video.");
          return;
        }
        await ensureYouTubePlayer(resolvedId);
        playVideo();
      } catch (err) {
        console.error("[Error] Failed to load YouTube player:", err);
        showEmbedFallback("YouTube embed failed.");
      }

      asked.clear();
      wrongAttempted.clear();
      retryCountMap.clear();
      previousTime = 0;
      maxAllowedTime = 0;
      skipLockBypass = false;

      // Load matching questions (pass companion so backend can return persona-specific questions)
      const _companion = (typeof loadState === 'function' ? loadState().companion : '') || '';
      fetch(`/api/final-questions/${encodeURIComponent(video.video_id)}?companion=${encodeURIComponent(_companion)}&nocache=${Date.now()}`)
        .then(res => res.json())
        .then(data => {
          if (!data.success) throw new Error(data.error || "Missing final questions");

          const entries = Array.isArray(data.segments) ? data.segments : [];
          segments = entries
            .map((seg, idx) => {
              const startSec = normalizeToSeconds(seg.segment_range_start);
              const endSec = normalizeToSeconds(seg.segment_range_end);
              const questionText = (seg.question || "").trim();
              const answerText = (seg.answer || "").trim();
              if (!questionText || !answerText) return null;
              const rawTrigger = endSec > 0 ? endSec : startSec;
              const triggerSec = Math.max(0, Math.round(rawTrigger));
              return {
                id: `segment_${idx + 1}`,
                index: idx,
                segment_start: startSec,
                segment_end: endSec,
                trigger_sec: triggerSec,
                ques_time: secondsToTimestamp(triggerSec),
                question: questionText,
                answer: answerText
              };
            })
            .filter(Boolean)
            .sort((a, b) => a.trigger_sec - b.trigger_sec);

          totalQuestions = segments.length;
          correctAnswers = 0;
          updateProgress();

          // Start score tracking now that we know the real question count
          if (typeof startQuizTracking === "function") {
            startQuizTracking(video.video_id, segments.length);
          }

          if (!segments.length) {
            throw new Error("No eligible questions found in final_questions.json");
          }

          lastPrefetchedIndex = -1;
          prefetchUpcomingQuestions(0);

          populateSidebar();
          startMonitoring();
        })
        .catch(err => {
          console.error("[Error] Failed to load questions:", err);
          alert("Oops! We couldn't find any questions for this video yet.");
          document.body.classList.remove("watching-video");
          document.getElementById("player-container").style.display = "none";
          videoGrid.style.display = "grid";
          backButton.style.display = "none";
        });
    }

    // ===============================
    // Monitor Video Playback
    // ===============================
    function startMonitoring() {
      clearInterval(checkInterval);
      checkInterval = setInterval(() => {
        let currentTime = Math.floor(getPlayerTime());
        updateEndscreenBlocker();

        // --- Skip-lock ---
        if (!skipLockBypass && currentTime > maxAllowedTime + 2) {
          console.warn("Skip attempt detected!");
          setPlayerTime(maxAllowedTime);
          return;
        }
        skipLockBypass = false;
        if (currentTime > maxAllowedTime) maxAllowedTime = currentTime;

        if (activeQuestion) {
          previousTime = currentTime;
          return;
        }

        // --- Question Triggers ---
        if (document.body.dataset.interactionMode === 'passive') {
          // Autosave every 60 seconds of watch time
          if (quizScore && quizScore.watchStartTime) {
            const elapsed = Math.floor((Date.now() - quizScore.watchStartTime) / 1000);
            if (elapsed > 0 && elapsed % 60 === 0 && typeof savePassiveWatchSession === 'function') {
              savePassiveWatchSession();
            }
          }
          previousTime = currentTime;
          return;
        }

        for (const segment of segments) {
          const segStart = segment.segment_start || 0;
          const segEnd = segment.segment_end && segment.segment_end > segStart
            ? segment.segment_end
            : segStart + 0.1;
          const trigger = segment.trigger_sec;

          if (previousTime < trigger && currentTime >= trigger && !asked.has(trigger)) {
            askQuestion(segment, segStart, segEnd);
            previousTime = currentTime;
            return;
          }
        }

        previousTime = currentTime;
      }, 700);
    }

    // ===============================
    // Speech Helpers
    // ===============================
    const ttsPlayback = {
      question: { audio: null, resolve: null, reject: null },
      feedback: { audio: null, resolve: null, reject: null }
    };
    const ttsCache = new Map();
    const ttsPending = new Map();
    let lastPrefetchedIndex = -1;

    function normalizeTtsKey(text) {
      return (text || "").trim();
    }

    function enforceTtsCacheLimit() {
      while (ttsCache.size > TTS_CACHE_LIMIT) {
        const oldestKey = ttsCache.keys().next().value;
        if (!oldestKey) break;
        ttsCache.delete(oldestKey);
      }
    }

    async function getTTSData(text) {
      const trimmed = (text || "").trim();
      if (!trimmed) {
        throw new Error("No text provided for TTS.");
      }
      const key = normalizeTtsKey(trimmed);
      if (ttsCache.has(key)) {
        return ttsCache.get(key);
      }
      if (ttsPending.has(key)) {
        return await ttsPending.get(key);
      }
      const pending = requestTTS(trimmed)
        .then(data => {
          ttsCache.set(key, data);
          enforceTtsCacheLimit();
          return data;
        })
        .finally(() => {
          ttsPending.delete(key);
        });
      ttsPending.set(key, pending);
      return await pending;
    }

    async function prefetchQuestionAudio(text) {
      const trimmed = (text || "").trim();
      if (!trimmed) return;
      try {
        await getTTSData(trimmed);
      } catch (err) {
        console.warn("Question audio prefetch failed:", err);
      }
    }

    function prefetchUpcomingQuestions(startIndex) {
      if (!Array.isArray(segments) || segments.length === 0) return;
      const start = Math.max(0, startIndex || 0);
      const end = Math.min(segments.length - 1, start + TTS_PREFETCH_AHEAD - 1);
      if (end <= lastPrefetchedIndex) return;
      const from = Math.max(start, lastPrefetchedIndex + 1);
      for (let i = from; i <= end; i++) {
        const text = segments[i]?.question;
        prefetchQuestionAudio(text);
      }
      lastPrefetchedIndex = Math.max(lastPrefetchedIndex, end);
    }

    function cleanupAudioChannel(channel) {
      const entry = ttsPlayback[channel];
      if (!entry) return;
      const audio = entry.audio;
      if (audio) {
        audio.onended = null;
        audio.onerror = null;
      }
      entry.audio = null;
      entry.resolve = null;
      entry.reject = null;
    }

    function stopAudioChannel(channel, options = {}) {
      const { markCancelled = false, markQuestionCancelledFlag = false } = options;
      const entry = ttsPlayback[channel];
      if (!entry || !entry.audio) {
        if (markQuestionCancelledFlag && channel === "question") {
          questionSpeechCancelled = true;
        }
        return;
      }
      const { audio, resolve } = entry;
      audio.onended = null;
      audio.onerror = null;
      try {
        audio.pause();
      } catch (err) {
        console.warn("Failed to pause audio:", err);
      }
      try {
        audio.src = "";
      } catch (err) {
        console.warn("Failed to reset audio source:", err);
      }
      cleanupAudioChannel(channel);
      if (markCancelled && typeof resolve === "function") {
        resolve({ cancelled: true });
      }
      if (markQuestionCancelledFlag && channel === "question") {
        questionSpeechCancelled = true;
      }
    }

    function stopSpeechSynthesisUtterances({ markQuestionCancelled = false } = {}) {
      if (markQuestionCancelled) {
        questionSpeechCancelled = true;
      }
      if ("speechSynthesis" in window) {
        try {
          window.speechSynthesis.cancel();
        } catch (err) {
          console.warn("Failed to cancel speech synthesis:", err);
        }
      }
      questionUtterance = null;
      feedbackUtterance = null;
    }

    async function requestTTS(text) {
      const trimmed = text?.trim();
      if (!trimmed) {
        throw new Error("No text provided for TTS.");
      }
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: trimmed,
          voice: TTS_DEFAULTS.voice,
          speed: TTS_DEFAULTS.speed,
          format: TTS_DEFAULTS.format
        })
      });
      let data = null;
      try {
        data = await res.json();
      } catch (err) {
        if (!res.ok) {
          throw new Error(`TTS request failed with status ${res.status}`);
        }
        throw new Error("TTS response was not valid JSON.");
      }
      if (!res.ok) {
        const message = data?.message || data?.detail || `status ${res.status}`;
        throw new Error(`TTS request failed: ${message}`);
      }
      if (!data?.success || !data?.audio) {
        throw new Error(data?.message || "TTS response missing audio.");
      }
      return {
        format: data.format || "mp3",
        audio: data.audio
      };
    }

    async function playTTSChannel(channel, text) {
      const { format, audio } = await getTTSData(text);
      const audioElement = new Audio(`data:audio/${format};base64,${audio}`);
      audioElement.preload = "auto";
      audioElement.crossOrigin = "anonymous";

      cleanupAudioChannel(channel);
      return new Promise((resolve, reject) => {
        ttsPlayback[channel].audio = audioElement;
        ttsPlayback[channel].resolve = resolve;
        ttsPlayback[channel].reject = reject;

        audioElement.onended = () => {
          cleanupAudioChannel(channel);
          resolve({ cancelled: false });
        };
        audioElement.onerror = (event) => {
          console.warn("Audio playback error:", event);
          cleanupAudioChannel(channel);
          reject(new Error("Audio playback failed."));
        };

        try {
          const playPromise = audioElement.play();
          if (playPromise && typeof playPromise.then === "function") {
            playPromise.catch(err => {
              cleanupAudioChannel(channel);
              reject(err);
            });
          }
        } catch (err) {
          cleanupAudioChannel(channel);
          reject(err);
        }
      });
    }

    function speakViaSpeechSynthesis(text, channel) {
      return new Promise((resolve) => {
        if (!("speechSynthesis" in window)) {
          resolve({ cancelled: false, error: true });
          return;
        }

        try {
          window.speechSynthesis.cancel();
        } catch (err) {
          console.warn("Failed to reset speech synthesis:", err);
        }

        const utterance = new SpeechSynthesisUtterance(text);
        const voice = ensurePreferredVoice();
        if (voice) {
          utterance.voice = voice;
          if (voice.lang) {
            utterance.lang = voice.lang;
          }
        } else {
          utterance.lang = "en-US";
        }

        const descriptor = voice ? `${voice.name || ""} ${voice.voiceURI || ""}` : "";
        const isLikelyMale = /male|man|boy/i.test(descriptor);
        const isLikelyKid = /kid|child|young/i.test(descriptor);
        const targetRate = channel === "question"
          ? (isLikelyKid ? 1.02 : 1.05)
          : (isLikelyKid ? 1.0 : 1.03);
        const targetPitch = channel === "question"
          ? (isLikelyMale ? 1.32 : 1.22)
          : (isLikelyMale ? 1.28 : 1.18);

        utterance.rate = targetRate;
        utterance.pitch = targetPitch;
        utterance.volume = 0.95;

        utterance.onend = () => {
          if (channel === "question") {
            const wasCancelled = questionSpeechCancelled;
            questionUtterance = null;
            questionSpeechCancelled = false;
            resolve({ cancelled: wasCancelled });
          } else {
            feedbackUtterance = null;
            resolve({ cancelled: false });
          }
        };

        utterance.onerror = (event) => {
          console.warn("Speech synthesis error:", event);
          if (channel === "question") {
            questionUtterance = null;
            resolve({ cancelled: questionSpeechCancelled, error: true });
          } else {
            feedbackUtterance = null;
            resolve({ cancelled: false, error: true });
          }
        };

        if (channel === "question") {
          questionUtterance = utterance;
        } else {
          feedbackUtterance = utterance;
        }

        try {
          window.speechSynthesis.speak(utterance);
        } catch (err) {
          console.warn("Unable to speak via speech synthesis:", err);
          if (channel === "question") {
            questionUtterance = null;
            resolve({ cancelled: questionSpeechCancelled, error: true });
          } else {
            feedbackUtterance = null;
            resolve({ cancelled: false, error: true });
          }
        }
      });
    }

    function cancelQuestionSpeech() {
      stopAudioChannel("question", { markCancelled: true, markQuestionCancelledFlag: true });
      stopAudioChannel("feedback", { markCancelled: true });
      stopSpeechSynthesisUtterances({ markQuestionCancelled: true });
    }

    async function speakQuestionText(text) {
      const trimmed = text?.trim();
      if (!trimmed) {
        return true;
      }

      stopAudioChannel("question", { markCancelled: true });
      stopSpeechSynthesisUtterances();
      questionSpeechCancelled = false;

      try {
        const result = await playTTSChannel("question", trimmed);
        return !result?.cancelled && !questionSpeechCancelled;
      } catch (err) {
        console.warn("OpenAI TTS failed for question speech:", err);
        const fallbackResult = await speakViaSpeechSynthesis(trimmed, "question");
        if (fallbackResult?.error) {
          return !questionSpeechCancelled;
        }
        return !fallbackResult?.cancelled;
      }
    }

    function tryRecordAnswer(question, answer, spoken, status, sim, questionType) {
      if (typeof recordAnswer === "function") {
        recordAnswer(question, answer, spoken, status, sim, questionType);
      }
    }

    function tryRecordRetry(question, spoken, sim) {
      if (typeof recordRetry === 'function') {
        recordRetry(question, spoken, sim);
      }
    }

    // ===============================
    // Feedback Helpers
    // ===============================
    function pickRandomCelebration() {
      if (!Array.isArray(SUCCESS_FEEDBACK) || SUCCESS_FEEDBACK.length === 0) {
        return "Great job!";
      }
      const index = Math.floor(Math.random() * SUCCESS_FEEDBACK.length);
      return SUCCESS_FEEDBACK[index];
    }

    function wait(ms) {
      return new Promise(resolve => setTimeout(resolve, Math.max(0, ms || 0)));
    }

    async function speakFeedbackText(text) {
      const trimmed = text?.trim();
      if (!trimmed) {
        return;
      }
      stopAudioChannel("feedback", { markCancelled: true });
      stopSpeechSynthesisUtterances();
      try {
        await playTTSChannel("feedback", trimmed);
      } catch (err) {
        console.warn("OpenAI TTS failed for feedback speech:", err);
        await speakViaSpeechSynthesis(trimmed, "feedback");
      }
    }

    async function deliverFeedback({ message, color, confetti: launchConfetti = false, minVisibleMs = MIN_FEEDBACK_DISPLAY_MS }) {
      const feedbackEl = document.getElementById("feedback");
      feedbackEl.innerText = message;
      feedbackEl.style.color = color;

      if (launchConfetti) {
        fireConfettiBurst();
      }

      const start = Date.now();
      await speakFeedbackText(message);

      const elapsed = Date.now() - start;
      if (elapsed < minVisibleMs) {
        await wait(minVisibleMs - elapsed);
      }
    }

    function fireConfettiBurst() {
      if (typeof confetti !== "function") {
        return;
      }

      const duration = 1500;
      const animationEnd = Date.now() + duration;
      const colors = ["#5aa9ff", "#ffd870", "#9cf077", "#ff6d85"];

      (function frame() {
        confetti({
          particleCount: 7,
          startVelocity: 35,
          spread: 60,
          ticks: 90,
          gravity: 0.9,
          scalar: 1.1,
          origin: { x: Math.random() * 0.6 + 0.2, y: Math.random() * 0.2 + 0.6 },
          colors
        });

        if (Date.now() < animationEnd) {
          requestAnimationFrame(frame);
        }
      })();
    }

    // ===============================
    // Asking + Answering Questions
    // ===============================
    function askQuestion(q, segStart, segEnd) {
      activeQuestion = true;
      lockVideoControls();
      pauseVideo();

      currentQuestionContext = { q, segStart, segEnd };
      currentListenAttempt = 0;
      hideQuestionActions();
      const currentIndex = segments.indexOf(q);
      if (currentIndex >= 0) {
        prefetchUpcomingQuestions(currentIndex + 1);
      }

      // Swap companion webm based on selected companion
      const _companion = (typeof loadState === 'function' ? loadState().companion : '') || 'pig';
      const _compVideo = document.getElementById('companion-video');
      const COMPANION_WEBMS = {
        pig:       '/assets/Pig_updated.webm',
        rabbit:    '/assets/Bunny_video.webm',
        alligator: '/assets/aligator_video.webm',
      };
      const _newSrc = COMPANION_WEBMS[_companion] || COMPANION_WEBMS['pig'];
      if (_compVideo.getAttribute('src') !== _newSrc) {
        _compVideo.src = _newSrc;
        _compVideo.load();
      }
      _compVideo.style.display = 'block';
      document.getElementById('companion-img').style.display = 'none';

      document.getElementById("question-box").style.display = "flex";
      document.getElementById("question").innerText = q.question;
      document.getElementById("timestamp").innerHTML =
        `Appears at <a onclick="seekWithBypass(${toSeconds(q.ques_time)})">${q.ques_time}</a>`;
      const feedbackEl = document.getElementById("feedback");
      feedbackEl.innerText = "Let me read the question for you...";
      feedbackEl.style.color = "#384b87";
      setQuestionOverlay(true);
      speakQuestionText(q.question)
        .then(shouldContinue => {
          if (!shouldContinue) {
            return;
          }
          feedbackEl.innerText = "Listening...";
          feedbackEl.style.color = "#384b87";
          startListening(q, segStart, segEnd, 0);
        })
        .catch(err => {
          console.warn("Unable to speak question via TTS:", err);
          feedbackEl.innerText = "Listening...";
          feedbackEl.style.color = "#384b87";
          startListening(q, segStart, segEnd, 0);
        });
    }

    // ===============================
    // Whisper Recording + Transcription
    // ===============================
    async function startListening(q, segStart, segEnd, attempt = 0) {
      const feedbackEl = document.getElementById("feedback");
      currentListenAttempt = attempt;
      currentQuestionContext = { q, segStart, segEnd };
      hideQuestionActions({ keepOverlay: true });

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 44100
          }
        });
      } catch (err) {
        console.error("Mic access denied or unavailable:", err);
        return handleListeningFailure(q, segStart, segEnd, attempt, {
          message: "I can't hear you. Please allow the microphone so we can answer together.",
          color: "#ef4444",
          autoRetry: false,
          showSkip: true
        });
      }

      let recorder;
      try {
        recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      } catch (err) {
        console.error("MediaRecorder setup failed:", err);
        stream.getTracks().forEach(track => track.stop());
        return handleListeningFailure(q, segStart, segEnd, attempt, {
          message: "Hmm, I couldn't start listening. Let's try again when you're ready.",
          color: "#ef4444",
          autoRetry: attempt < 1,
          showSkip: true
        });
      }

      let chunks = [];
      let audioContext = null;
      let analyser = null;
      let analyserData = null;
      let silenceMonitorId = null;
      let silenceStart = null;
      let recognizedSpeech = false;
      let speechFrameCount = 0;
      let adaptiveSilenceThreshold = SILENCE_THRESHOLD;
      let ambientSampleCount = 0;
      let ambientRmsTotal = 0;
      let stopRequested = false;
      let autoStopTimeout = null;

      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (AudioContextCtor) {
        try {
          audioContext = new AudioContextCtor();
          analyser = audioContext.createAnalyser();
          analyser.fftSize = 2048;
          analyser.smoothingTimeConstant = 0.8;
          analyserData = new Float32Array(analyser.fftSize);
          const sourceNode = audioContext.createMediaStreamSource(stream);
          sourceNode.connect(analyser);
        } catch (err) {
          console.warn("Silence detection unavailable:", err);
          audioContext = null;
          analyser = null;
          analyserData = null;
        }
      }

      const cancelSilenceMonitor = () => {
        if (silenceMonitorId) {
          cancelAnimationFrame(silenceMonitorId);
          silenceMonitorId = null;
        }
      };

      const cleanupAudioResources = async () => {
        cancelSilenceMonitor();
        if (audioContext && audioContext.state !== "closed") {
          try {
            await audioContext.close();
          } catch (err) {
            console.warn("Failed to close audio context:", err);
          }
        }
        audioContext = null;
        analyser = null;
        analyserData = null;
      };

      const requestStop = (reason) => {
        if (stopRequested) return;
        stopRequested = true;
        if (autoStopTimeout) {
          clearTimeout(autoStopTimeout);
          autoStopTimeout = null;
        }
        cancelSilenceMonitor();
        if (recorder && recorder.state === "recording") {
          console.log("Stopping recorder:", reason);
          try {
            recorder.stop();
          } catch (err) {
            console.warn("Recorder stop failed:", err);
          }
        }
      };

      // Monitor microphone volume to detect when the child stops speaking.
      const monitorSilence = () => {
        if (!analyser || stopRequested) return;

        analyser.getFloatTimeDomainData(analyserData);
        let sumSquares = 0;
        for (let i = 0; i < analyserData.length; i++) {
          const value = analyserData[i];
          sumSquares += value * value;
        }
        const rms = Math.sqrt(sumSquares / analyserData.length);

        if (!recognizedSpeech && ambientSampleCount < AMBIENT_SAMPLE_FRAMES) {
          ambientRmsTotal += rms;
          ambientSampleCount++;
          if (ambientSampleCount === AMBIENT_SAMPLE_FRAMES) {
            const avgRms = ambientRmsTotal / ambientSampleCount;
            adaptiveSilenceThreshold = Math.max(
              SILENCE_THRESHOLD,
              avgRms * SILENCE_THRESHOLD_MULTIPLIER
            );
          }
        }

        if (rms > adaptiveSilenceThreshold) {
          if (speechFrameCount < SPEECH_FRAMES_REQUIRED) {
            speechFrameCount++;
            if (speechFrameCount >= SPEECH_FRAMES_REQUIRED) {
              recognizedSpeech = true;
            }
          }
          silenceStart = null;
        } else {
          if (speechFrameCount > 0) {
            speechFrameCount = Math.max(0, speechFrameCount - 1);
          }
          if (recognizedSpeech) {
            if (silenceStart === null) {
              silenceStart = performance.now();
            } else if (performance.now() - silenceStart >= SILENCE_DURATION_MS) {
              console.log("Auto-stopping recorder after silence gap");
              requestStop("silence");
              return;
            }
          }
        }

        silenceMonitorId = requestAnimationFrame(monitorSilence);
      };

      const startSilenceMonitor = () => {
        if (!analyser) return;
        silenceStart = null;
        speechFrameCount = 0;
        recognizedSpeech = false;
        adaptiveSilenceThreshold = SILENCE_THRESHOLD;
        ambientSampleCount = 0;
        ambientRmsTotal = 0;
        cancelSilenceMonitor();
        silenceMonitorId = requestAnimationFrame(monitorSilence);
      };

      recorder.onstart = () => {
        feedbackEl.innerText = "Listening...";
        feedbackEl.style.color = "#384b87";
        stopRequested = false;
        if (audioContext && audioContext.state === "suspended") {
          audioContext.resume().catch(err => console.warn("Audio context resume failed:", err));
        }
        startSilenceMonitor();
        autoStopTimeout = setTimeout(() => {
          console.log("Auto-stopping recorder after max duration");
          requestStop("timeout");
        }, MAX_LISTEN_DURATION_MS);
      };

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        stopRequested = true;
        if (autoStopTimeout) {
          clearTimeout(autoStopTimeout);
          autoStopTimeout = null;
        }
        await cleanupAudioResources();
        stream.getTracks().forEach(track => track.stop());

        if (!chunks.length) {
          return handleListeningFailure(q, segStart, segEnd, attempt, {
            message: "I didn't hear anything, let's try again!",
            color: "#d97706",
            autoRetry: true,
            showSkip: true
          });
        }

        const blob = new Blob(chunks, { type: "audio/webm" });
        const formData = new FormData();
        formData.append("file", blob, "speech.webm");

        try {
          const res = await fetch("/api/transcribe", {
            method: "POST",
            body: formData
          });
          const data = await res.json();
          if (data.success && data.text.trim()) {
            feedbackEl.innerText = `You said: "${data.text.trim()}"`;
            feedbackEl.style.color = "#384b87";
            await processAnswer(data.text.trim().toLowerCase(), q, segStart, segEnd);
            return;
          } else {
            return handleListeningFailure(q, segStart, segEnd, attempt, {
              message: "I didn't hear anything, let's try again!",
              color: "#d97706",
              autoRetry: true,
              showSkip: true
            });
          }
        } catch (err) {
          console.error("[Error] Whisper error:", err);
          return handleListeningFailure(q, segStart, segEnd, attempt, {
            message: "Oops, I couldn't process that. Let's give it another try.",
            color: "#ef4444",
            autoRetry: attempt < 1,
            showSkip: true
          });
        }
      };

      try {
        recorder.start();
      } catch (err) {
        console.error("Failed to start recorder:", err);
        await cleanupAudioResources();
        stream.getTracks().forEach(track => track.stop());
        return handleListeningFailure(q, segStart, segEnd, attempt, {
          message: "Hmm, I couldn't start listening. Let's try again when you're ready.",
          color: "#ef4444",
          autoRetry: attempt < 1,
          showSkip: true
        });
      }
    }

    async function handleListeningFailure(q, segStart, segEnd, attempt, options = {}) {
      const {
        message,
        color = "#d97706",
        autoRetry = true,
        showSkip = true,
        delayMs = LISTEN_RETRY_DELAY_MS,
        fallbackMessage
      } = options;

      const feedbackEl = document.getElementById("feedback");
      if (message) {
        feedbackEl.innerText = message;
      }
      feedbackEl.style.color = color;

      currentQuestionContext = { q, segStart, segEnd };
      hideQuestionActions();
      const nextAttempt = attempt + 1;

      if (autoRetry && nextAttempt <= MAX_LISTEN_RETRIES) {
        await wait(delayMs);
        return startListening(q, segStart, segEnd, nextAttempt);
      }

      prepareManualRetry({
        q,
        segStart,
        segEnd,
        message: fallbackMessage || "",
        color,
        showSkip
      });
    }

    async function processAnswer(spoken, q, segStart, segEnd) {
      const quesSec = toSeconds(q.ques_time);
      const askedInSegment = Array.from(asked).filter(t => t >= segStart && t <= segEnd);

      console.log("Heard (final):", spoken, " | Expected:", q.answer);

      try {
        const response = await fetch("/api/check_answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expected: q.answer, user: spoken, question: q.question })
        });
        const data = await response.json();
        console.log("Local check response:", data);

        const sim = parseFloat(data.similarity || 0);
        let status = typeof data.status === "string" ? data.status.toLowerCase() : "";
        if (!status) {
          const t = data.is_numeric ? THRESHOLDS.number : THRESHOLDS.phrase;
          if (sim >= t.correct) {
            status = "correct";
          } else if (sim >= t.borderline) {
            status = "almost";
          } else {
            status = "wrong";
          }
        }

        // Read back the learner's answer before any feedback
        if (spoken && spoken.trim()) {
          await speakFeedbackText(`You said: ${spoken.trim()}`);
        }

        if (status === 'correct') {
          const celebrationMessage = pickRandomCelebration();
          asked.add(quesSec);
        
          if (!wrongAttempted.has(quesSec)) {
            // First attempt was correct — count it
            correctAnswers++;
            updateProgress();
            tryRecordAnswer(q.question, q.answer, spoken, "correct", sim, q.question_type);
            await deliverFeedback({
              message: celebrationMessage,
              color: "#22c55e",
              confetti: true,
              minVisibleMs: MIN_FEEDBACK_DISPLAY_MS + 200
            });
          } else {
            // Already counted as wrong on first attempt — this is a retry, track engagement only
            retryCountMap.set(quesSec, (retryCountMap.get(quesSec) || 0) + 1);
            tryRecordRetry(q.question, spoken, sim);
            if (typeof showQuickFeedback === 'function') {
              showQuickFeedback('correct');
            }
            await deliverFeedback({
              message: celebrationMessage,
              color: "#22c55e",
              confetti: true,
              minVisibleMs: MIN_FEEDBACK_DISPLAY_MS + 200
            });
          }

          await wait(200);
          resumeVideo();
          return;
        }

        const isStrictMode = document.body.dataset.interactionMode === "strict";

        const rewindTo = askedInSegment.length > 0
          ? Math.max(...askedInSegment) + 1
          : segStart;

// ----------------------
// ALMOST CASE
// ----------------------
        if (status === "almost") {
          const spokenTrimmed = (spoken || "").trim();
          const almostMessage = spokenTrimmed
            ? `${spokenTrimmed} is not quite the answer. Try again!`
            : getBorderlineFeedback();

          await deliverFeedback({
            message: almostMessage,
            color: "#d97706",
            minVisibleMs: MIN_FEEDBACK_DISPLAY_MS
          });
          
          if (!wrongAttempted.has(quesSec)) {
            wrongAttempted.add(quesSec);
            tryRecordAnswer(q.question, q.answer, spoken, "almost", sim, q.question_type);
          } else {
            retryCountMap.set(quesSec, (retryCountMap.get(quesSec) || 0) + 1);
            tryRecordRetry(q.question, spoken, sim);
          }

          if (isStrictMode) {
            setPlayerTime(rewindTo);
            asked.delete(quesSec);
          }

          await wait(200);
          resumeVideo();
          return;
        }

// ----------------------
// WRONG CASE
// ----------------------
        await deliverFeedback({
          message: getRetryFeedback(),
          color: "#ef4444",
          minVisibleMs: MIN_FEEDBACK_DISPLAY_MS
        });

        if (!wrongAttempted.has(quesSec)) {
          wrongAttempted.add(quesSec);
          tryRecordAnswer(q.question, q.answer, spoken, "wrong", sim, q.question_type);
        } else {
          retryCountMap.set(quesSec, (retryCountMap.get(quesSec) || 0) + 1);
          tryRecordRetry(q.question, spoken, sim);
        }
        if (isStrictMode) {
  // STRICT MODE = rewind and retry
          setPlayerTime(rewindTo);
  // allow question to trigger again
          asked.delete(quesSec);
        } else {
  // FLEXIBLE MODE = reveal the answer then continue
          await deliverFeedback({
            message: `The answer is ${q.answer}.`,
            color: "#384b87",
            minVisibleMs: MIN_FEEDBACK_DISPLAY_MS
          });
          asked.add(quesSec);
        }

        await wait(200);
        resumeVideo();
      } catch (err) {
        console.error("[Warning] Answer check failed - full error:", err, err?.stack);
        document.getElementById("feedback").innerText = "[Warning] Could not check answer.";
        setTimeout(resumeVideo, 1000);
      }
    }

    function resumeVideo() {
      activeQuestion = false;
      cancelQuestionSpeech();
      const box = document.getElementById("question-box");
      box.style.display = "none"; // hide overlay
      document.getElementById("feedback").innerText = ""; // clear feedback
      hideQuestionActions();
      currentQuestionContext = null;
      currentListenAttempt = 0;
      unlockVideoControls();          // unlock here
      playVideo();
    }

    // ===============================
    // Sidebar Helpers
    // ===============================
    function populateSidebar() {
      const list = document.getElementById("question-list");
      list.innerHTML = "";
      segments.forEach((segment, idx) => {
        const label = segment.id || `segment_${idx + 1}`;
        const li = document.createElement("li");
        li.innerHTML = `
        <strong>${label}</strong> -
        <a onclick="seekWithBypass(${segment.trigger_sec})">${segment.ques_time}</a>
        <br>${segment.question}
      `;
        list.appendChild(li);
      });
    }
    function seekWithBypass(seconds) {
      skipLockBypass = true;
      setPlayerTime(seconds);
    }

    // ===============================
    // Back Button
    // ===============================
    backButton.onclick = () => {
      if (document.body.dataset.interactionMode === 'passive') {
        if (typeof savePassiveWatchSession === 'function') {
          savePassiveWatchSession();
        }
      }
      pauseVideo();
      clearInterval(checkInterval);
      document.getElementById("player-container").style.display = "none";
      videoGrid.style.display = "grid";
      backButton.style.display = "none";
      const switchBtnBack = document.getElementById('switch-companion-btn');
      if (switchBtnBack) switchBtnBack.style.display = '';
      document.body.classList.remove("watching-video");
      hideEmbedFallback();
      hidePauseBlocker();
      currentVideoMeta = null;
    };

    // ===============================
    // Helpers
    // ===============================
    function normalizeToSeconds(value) {
      if (value === null || value === undefined) return 0;
      if (typeof value === "number" && !Number.isNaN(value)) return Math.max(0, value);
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return 0;
        if (trimmed.includes(":")) {
          const parts = trimmed.split(":").map(Number).filter(n => !Number.isNaN(n));
          if (parts.length === 3) return Math.max(0, parts[0] * 3600 + parts[1] * 60 + parts[2]);
          if (parts.length === 2) return Math.max(0, parts[0] * 60 + parts[1]);
          if (parts.length === 1) return Math.max(0, parts[0]);
        }
        const numeric = parseFloat(trimmed);
        if (!Number.isNaN(numeric)) return Math.max(0, numeric);
      }
      return 0;
    }

    function secondsToTimestamp(sec) {
      if (!sec || !Number.isFinite(sec)) return "00:00";
      const total = Math.max(0, Math.round(sec));
      const minutes = Math.floor(total / 60);
      const seconds = total % 60;
      return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
    }

    function toSeconds(timeStr) {
      if (typeof timeStr === "number") return normalizeToSeconds(timeStr);
      if (!timeStr) return 0;
      const parts = timeStr.split(":").map(Number);
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      return Number(timeStr) || 0;
    }

    function updateProgress() {
      // Progress display removed; keep counts for potential analytics.
    }

    function lockVideoControls() {
      const blocker = document.getElementById("blocker");
      blocker.style.display = "block";
      pauseVideo();                   // ensure paused
    }

    function unlockVideoControls() {
      const blocker = document.getElementById("blocker");
      blocker.style.display = "none";
    }



    // Expose scoped loader for the learner flow state machine.
    // Called from children.html after companion selection with a real child_id.
    // Stops video playback — called by back button when leaving the library/player screen
    window.__stopVideo = function() {
        if (ytPlayer && typeof ytPlayer.pauseVideo === 'function') {
            ytPlayer.pauseVideo();
        }
    };

    window.__loadScopedVideos = async function(childId) {
        try {
            const res = await fetch(`/api/learners/children/${encodeURIComponent(childId)}/videos`);
            const data = await res.json();
            libraryVideos = Array.isArray(data.videos) ? data.videos : [];
            applyFilters();
        } catch (err) {
            console.error('[Error] loading scoped videos:', err);
            videoGrid.innerHTML = '<div class="video-empty">Couldn\'t load videos right now.</div>';
        }
    };

    

    // Init
    loadConfig();
    // Only auto-load all videos if NOT in the learner flow (which uses scoped videos per child)
    if (!sessionStorage.getItem('learnerFlowState')) {
        loadVideos();
    }