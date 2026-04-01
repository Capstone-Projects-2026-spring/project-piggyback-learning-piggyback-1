
        async function switchExpert() {
            await fetch('/api/expert/logout', { method: 'POST' });
            window.location.href = '/';
        }

        let currentVideoId = null;
        let videoElement = null;
        let ytPlayer = null;
        let ytPlayerReady = false;
        let ytApiPromise = null;
        let ytTimeUpdateTimer = null;
        let playerMode = 'youtube';
        let localVideoElement = null;
        let currentVideoUrl = null;
        let currentSegments = [];
        let currentSegmentIndex = 0;
        let isVideoPaused = false;
        let autoAdvanceEnabled = true;
        let currentStep = 1;
        let maxAvailableStep = 1;
        let availableVideos = [];
        let currentVideoLabel = '';
        const presetVideoId = (document.body.dataset.selectedVideoId || '').trim() || null;
        let initialVideoLoadAttempted = false;
        let isLoadingVideo = false;
        let expertQuestions = {};
        let expertSaveInProgress = false;
        let pendingSegmentIndices = [];
        let llmQuestionEdits = {}; // Store ranking/trash decisions for LLM questions
                 let manualQuestionTimestamp = null; // Store timestamp for manual questions
        const REVIEW_TOLERANCE_BEFORE = 0.25;

        let llmModalState = {
            open: false,
            segmentKey: null,
            segmentIndex: null,
            questions: [],
            rankingOrder: [],
            trashOrder: [],
            openQuestionKey: null,
            draggingKey: null,
            dragSource: null,
            step: 1,
            editingKey: null,
            triageComment: '',
            rankingComment: ''
        };
        let modalPlaybackLockCount = 0;
        let modalPlaybackWasPlaying = false;

        let llmModalResolve = null;
        const qsFullscreenState = {
            container: null,
            modals: []
        };
        let personaVariantsCache = {};

        function getFullscreenElement() {
            return document.fullscreenElement ||
                document.webkitFullscreenElement ||
                document.msFullscreenElement ||
                null;
        }

        function getRequestFullscreenFn(element) {
            if (!element) {
                return null;
            }
            return element.requestFullscreen ||
                element.webkitRequestFullscreen ||
                element.msRequestFullscreen ||
                null;
        }

        function trackModalElement(id, fullscreenSelector = null) {
            const el = document.getElementById(id);
            if (!el) {
                return;
            }

            const alreadyTracked = qsFullscreenState.modals.some(item => item.el === el);
            if (alreadyTracked) {
                return;
            }

            qsFullscreenState.modals.push({
                el,
                parent: el.parentNode,
                nextSibling: el.nextSibling,
                fullscreenSelector
            });
        }

        function moveModalsToContainer(container) {
            if (!container) {
                return;
            }
            qsFullscreenState.modals.forEach(item => {
                const { el, fullscreenSelector } = item;
                if (!el) {
                    return;
                }
                const target = fullscreenSelector
                    ? container.querySelector(fullscreenSelector) || container
                    : container;
                if (target && el.parentNode !== target) {
                    target.appendChild(el);
                }
            });
        }

        function restoreModalsToOriginal() {
            qsFullscreenState.modals.forEach(item => {
                const { el, parent, nextSibling } = item;
                if (!el || !parent) {
                    return;
                }

                if (nextSibling && nextSibling.parentNode === parent) {
                    parent.insertBefore(el, nextSibling);
                } else {
                    parent.appendChild(el);
                }
            });
        }

        function handleFullscreenChange() {
            const current = getFullscreenElement();
            const container = qsFullscreenState.container || document.querySelector('.video-section');
            qsFullscreenState.container = container;

            if (videoElement && current === videoElement && container && container !== videoElement) {
                const request = getRequestFullscreenFn(container);
                if (typeof request === 'function') {
                    request.call(container);
                }
                return;
            }

            const isContainerFullscreen = current && container && current === container;

            document.body.classList.toggle('qs-fullscreen', Boolean(isContainerFullscreen));

            if (container) {
                container.classList.toggle('qs-fullscreen-active', Boolean(isContainerFullscreen));
            }

            if (videoElement) {
                videoElement.classList.toggle('qs-fullscreen-video', Boolean(isContainerFullscreen));
            }

            if (isContainerFullscreen) {
                moveModalsToContainer(container);
            } else {
                restoreModalsToOriginal();
            }
        }

        function initFullscreenSupport() {
            qsFullscreenState.container = document.querySelector('.video-section');
            trackModalElement('pause-overlay', '.video-container');
            trackModalElement('add-question-modal');
            trackModalElement('llm-review-modal');

            ['fullscreenchange', 'webkitfullscreenchange', 'msfullscreenchange'].forEach(eventName => {
                document.addEventListener(eventName, handleFullscreenChange);
            });

            handleFullscreenChange();
        }


        function acquireModalPlaybackLock() {
            if (!hasActivePlayer()) {
                return;
            }

            if (modalPlaybackLockCount === 0) {
                modalPlaybackWasPlaying = !isPlaybackPaused();
            }

            modalPlaybackLockCount += 1;
            pauseVideo();
        }

        function releaseModalPlaybackLock(options = {}) {
            const resume = options && typeof options.resume === 'boolean' ? options.resume : false;

            if (!hasActivePlayer()) {
                modalPlaybackLockCount = Math.max(0, modalPlaybackLockCount - 1);
                modalPlaybackWasPlaying = false;
                return;
            }

            if (modalPlaybackLockCount > 0) {
                modalPlaybackLockCount -= 1;
            }

            if (modalPlaybackLockCount === 0) {
                if (resume && modalPlaybackWasPlaying) {
                    playVideo();
                }
                modalPlaybackWasPlaying = false;
            }
        }

        function isVideoPlaybackLocked() {
            return modalPlaybackLockCount > 0;
        }

        // Initialize
        document.addEventListener('DOMContentLoaded', async function() {
            initFullscreenSupport();
            initStepNavigation();
            await loadVideoList();
            if (presetVideoId && !initialVideoLoadAttempted) {
                initialVideoLoadAttempted = true;
                const presetMeta = findVideoById(presetVideoId);
                if (presetMeta) {
                    await loadVideo(presetMeta.id, presetMeta.title);
                } else {
                    showStatus(`Selected video "${presetVideoId}" not found in downloads.`, 'error');
                }
            }
            resetReviewPanel();
            updateReviewButtonState();

            const expertForm = document.getElementById('expert-question-form');
            if (expertForm) {
                expertForm.addEventListener('submit', handleExpertQuestionSubmit);
            }

            const skipButton = document.getElementById('expert-skip-button');
            if (skipButton) {
                skipButton.addEventListener('click', handleExpertSkip);
            }
            
            // Manual question form handler
            const manualForm = document.getElementById('manual-question-form');
            if (manualForm) {
                manualForm.addEventListener('submit', handleManualQuestionSubmit);
            }

            const manualButton = document.getElementById('add-manual-question-btn');
            if (manualButton) {
                manualButton.addEventListener('click', openAddQuestionModal);
            }

            const localVideoBtn = document.getElementById('use-local-video-btn');
            if (localVideoBtn) {
                localVideoBtn.addEventListener('click', switchToLocalVideo);
            }
            updateLocalFallbackButtonState();

            const llmNextButton = document.getElementById('llm-step-next-btn');
            if (llmNextButton) {
                llmNextButton.addEventListener('click', handleLLMStepNext);
            }

            const llmBackButton = document.getElementById('llm-step-back-btn');
            if (llmBackButton) {
                llmBackButton.addEventListener('click', handleLLMStepBack);
            }

            const llmSubmitButton = document.getElementById('llm-review-submit-btn');
            if (llmSubmitButton) {
                llmSubmitButton.addEventListener('click', handleLLMModalSubmit);
            }

            const llmTriageCommentInput = document.getElementById('llm-triage-comment');
            if (llmTriageCommentInput) {
                llmTriageCommentInput.addEventListener('input', () => {
                    llmModalState.triageComment = llmTriageCommentInput.value;
                });
            }

            const llmRankingCommentInput = document.getElementById('llm-ranking-comment');
            if (llmRankingCommentInput) {
                llmRankingCommentInput.addEventListener('input', () => {
                    llmModalState.rankingComment = llmRankingCommentInput.value;
                });
            }

        });
        
        function initStepNavigation() {
            const stepElements = document.querySelectorAll('.step');
            stepElements.forEach(stepEl => {
                stepEl.addEventListener('click', () => {
                    const targetStep = Number(stepEl.dataset.step);
                    if (targetStep <= maxAvailableStep) {
                        showStep(targetStep);
                    }
                });
            });
            updateStepAccess();
            showStep(currentStep);
        }

        function updateStepAccess() {
            document.querySelectorAll('.step').forEach(stepEl => {
                const stepNumber = Number(stepEl.dataset.step);
                stepEl.classList.toggle('step-disabled', stepNumber > maxAvailableStep);
            });
        }

        function showStep(step) {
            // Pause video if leaving step 2
            if (currentStep === 2 && step !== 2 && hasActivePlayer()) {
                pauseVideo();
            }
            
            currentStep = step;
            document.querySelectorAll('.step').forEach(stepEl => {
                const stepNumber = Number(stepEl.dataset.step);
                stepEl.classList.toggle('active', stepNumber === step);
                stepEl.classList.toggle('completed', stepNumber < step);
            });
            document.querySelectorAll('.step-content').forEach(contentEl => {
                const stepNumber = Number(contentEl.dataset.step);
                contentEl.classList.toggle('active', stepNumber === step);
            });
            
            // Resume video if returning to step 2 and it was playing before
            if (step === 2 && hasActivePlayer() && !isVideoPaused) {
                // Only resume if we're not in a pause overlay
                const pauseOverlay = document.getElementById('pause-overlay');
                if (!pauseOverlay || !pauseOverlay.classList.contains('active')) {
                    playVideo();
                }
            }
        }

        function unlockStep(step) {
            if (step > maxAvailableStep) {
                maxAvailableStep = step;
            }
            updateStepAccess();
            showStep(step);
        }

        function findVideoById(videoId) {
            if (!videoId) {
                return null;
            }
            return availableVideos.find(video => video.id === videoId) || null;
        }

        function renderVideoList() {
            const list = document.getElementById('video-card-list');
            if (!list) {
                return;
            }

            list.innerHTML = '';

            if (!availableVideos.length) {
                list.innerHTML = '<div class="video-list-empty">No downloaded videos found yet.</div>';
                return;
            }

            availableVideos.forEach(video => {
                const card = document.createElement('button');
                card.type = 'button';
                card.className = 'video-card';
                card.dataset.videoId = video.id;

                if (video.id === currentVideoId) {
                    card.classList.add('selected');
                }

                const durationText = video.duration ? formatDuration(video.duration) : '0:00';
                const baseLabel = video.title || video.id;
                const subtitle = video.id;
                const fileCount = typeof video.fileCount === 'number' ? video.fileCount : 0;
                const questionCount = typeof video.questionCount === 'number' ? video.questionCount : null;
                const questionText = questionCount !== null ? `Questions: ${questionCount}` : 'Questions: N/A';
                const rawThumbnail = typeof video.thumbnail === 'string' ? video.thumbnail.trim() : '';
                const thumbnailUrl = rawThumbnail;
                const hasThumbnail = thumbnailUrl.length > 0;
                const placeholderInitial = baseLabel ? baseLabel.trim().charAt(0).toUpperCase() : 'V';
                const showDurationBadge = durationText && durationText !== '0:00';

                card.innerHTML = `
                    <div class="video-card-thumb">
                        ${hasThumbnail
                            ? `<img class="video-card-thumb-image" src="${thumbnailUrl}" alt="${baseLabel}">`
                            : `<div class="video-card-thumb-placeholder">${placeholderInitial}</div>`}
                        ${showDurationBadge ? `<span class="video-card-duration-badge">${durationText}</span>` : ''}
                    </div>
                    <div class="video-card-details">
                        <div class="video-card-title">${baseLabel}</div>
                        <div class="video-card-subtitle">${subtitle}</div>
                        <div class="video-card-meta">
                            <span>Duration: ${durationText}</span>
                            <span>Files: ${fileCount}</span>
                            <span>${questionText}</span>
                        </div>
                        <!-- Link to re-edit finalized questions for this video -->
                        <a href="/expert/edit/${video.id}"
                           onclick="event.stopPropagation()"
                           style="display:inline-block;margin-top:6px;font-size:.8rem;color:#2563eb;text-decoration:none;background:#eff6ff;border:1px solid #bfdbfe;padding:3px 10px;border-radius:4px">
                           ✏ Change Questions
                        </a>
                    </div>
                `;

                card.addEventListener('click', () => handleVideoSelection(video.id));
                card.classList.remove('loading');
                list.appendChild(card);
            });

            if (currentVideoId) {
                setVideoCardState(currentVideoId, 'selected');
            }
        }

        function setVideoCardState(videoId, state) {
            const cards = document.querySelectorAll('.video-card');
            cards.forEach(card => {
                const isTarget = card.dataset.videoId === videoId;

                if (state === 'loading') {
                    card.classList.remove('selected');
                    if (isTarget) {
                        card.classList.add('loading');
                        card.disabled = true;
                    } else {
                        card.classList.remove('loading');
                        card.disabled = false;
                    }
                } else if (state === 'selected') {
                    card.classList.remove('loading');
                    card.disabled = false;
                    card.classList.toggle('selected', isTarget);
                } else if (state === 'idle') {
                    card.classList.remove('loading');
                    card.disabled = false;
                    if (isTarget) {
                        card.classList.remove('selected');
                    }
                }
            });
        }

        function normalizeSegmentValue(value) {
            const num = Number(value);
            if (Number.isNaN(num)) {
                return 0;
            }
            return Number(num.toFixed(3));
        }

        function normalizeQuestionType(value) {
            if (!value) {
                return '';
            }
            return String(value).toLowerCase();
        }

        function getExpertQuestionTypeLabel(value) {
            const labels = {
                character: 'Character',
                setting: 'Setting',
                feeling: 'Feeling',
                action: 'Action',
                causal: 'Causal',
                outcome: 'Outcome',
                prediction: 'Prediction'
            };

            const normalized = normalizeQuestionType(value);
            return labels[normalized] || (value ? String(value) : 'Unknown');
        }

        function getExpertQuestionTypeClass(value) {
            const classes = {
                character: 'question-chip--character',
                setting: 'question-chip--setting',
                feeling: 'question-chip--feeling',
                action: 'question-chip--action',
                causal: 'question-chip--causal',
                outcome: 'question-chip--outcome',
                prediction: 'question-chip--prediction'
            };

            const normalized = normalizeQuestionType(value);
            return classes[normalized] || 'question-chip--default';
        }

        function getSegmentKey(segment) {
            if (!segment) {
                return '';
            }
            const start = normalizeSegmentValue(segment.start);
            const end = normalizeSegmentValue(segment.end);
            return `${start}-${end}`;
        }

        function getExpertQuestionForSegment(segment) {
            const key = getSegmentKey(segment);
            if (!key) {
                return null;
            }
            return expertQuestions[key] || null;
        }

        function setExpertQuestionForSegment(segment, data) {
            const key = getSegmentKey(segment);
            if (!key) {
                return;
            }

            if (!data) {
                delete expertQuestions[key];
                return;
            }

            const normalized = { ...data };

            if (normalized.skip_reason && !normalized.skipReason) {
                normalized.skipReason = normalized.skip_reason;
            }
            delete normalized.skip_reason;

            if (!normalized.updatedAt && normalized.updated_at) {
                normalized.updatedAt = normalized.updated_at;
            }
            delete normalized.updated_at;

            normalized.skipped = Boolean(normalized.skipped);

            if (normalized.skipped) {
                normalized.questionType = '';
                normalized.question = normalized.question || '';
                normalized.answer = normalized.answer || '';
                normalized.skipReason = normalized.skipReason ? String(normalized.skipReason) : '';
            } else {
                const typeValue = normalized.questionType || normalized.question_type || '';
                normalized.questionType = normalizeQuestionType(typeValue);
                normalized.skipReason = '';
            }

            delete normalized.question_type;

            expertQuestions[key] = normalized;
        }

        function hasExpertDecision(segment) {
            const entry = getExpertQuestionForSegment(segment);
            if (!entry) {
                return false;
            }

            if (entry.skipped) {
                return true;
            }

            return Boolean(entry.question && entry.answer);
        }

        function renderExpertInfoMessage(container, message) {
            if (!container) {
                return;
            }

            const wrapper = document.createElement('div');
            wrapper.className = 'question-item';

            const textEl = document.createElement('div');
            textEl.className = 'answer-text';
            textEl.style.textAlign = 'center';
            textEl.textContent = message;

            wrapper.appendChild(textEl);
            container.appendChild(wrapper);
        }

        function updateExpertQuestionsPanel(segment = null) {
            const container = document.getElementById('expert-questions');
            if (!container) {
                return;
            }

            container.innerHTML = '';

            const createField = (labelText, valueText, valueClass) => {
                const field = document.createElement('div');
                field.className = 'question-field';

                const labelEl = document.createElement('div');
                labelEl.className = 'question-field-label';
                labelEl.textContent = labelText;
                field.appendChild(labelEl);

                const valueEl = document.createElement('div');
                valueEl.className = valueClass;
                valueEl.textContent = valueText || '';
                field.appendChild(valueEl);

                return field;
            };

            if (currentSegments && currentSegments.length > 0) {
                let hasAnyQuestions = false;

                currentSegments.forEach((seg, index) => {
                    const entry = getExpertQuestionForSegment(seg);
                    if (!entry) {
                        return;
                    }

                    hasAnyQuestions = true;

                    const card = document.createElement('div');
                    card.className = 'question-item';

                    if (segment && seg === segment) {
                        card.classList.add('is-active');
                    }

                    const header = document.createElement('div');
                    header.className = 'question-item-header';

                    const chip = document.createElement('span');
                    if (entry.skipped) {
                        card.classList.add('is-skipped');
                        chip.className = 'question-chip question-chip--skipped';
                        chip.textContent = 'Skipped';
                    } else {
                        const chipClass = getExpertQuestionTypeClass(entry.questionType);
                        chip.className = `question-chip ${chipClass}`;
                        chip.textContent = getExpertQuestionTypeLabel(entry.questionType);
                    }
                    header.appendChild(chip);

                    const meta = document.createElement('div');
                    meta.className = 'question-meta';
                    meta.textContent = `Segment ${index + 1} | ${formatTime(seg.start)} - ${formatTime(seg.end)}`;
                    header.appendChild(meta);

                    card.appendChild(header);

                    if (entry.skipped) {
                        card.appendChild(createField('Status', 'Segment marked as skipped.', 'question-text'));

                        if (entry.skipReason) {
                            card.appendChild(createField('Skip reason', entry.skipReason, 'answer-text'));
                        }
                    } else {
                        card.appendChild(createField('Question', entry.question || '', 'question-text'));
                        card.appendChild(createField('Model answer', entry.answer || '', 'answer-text'));
                    }

                    container.appendChild(card);
                });

                Object.entries(expertQuestions).forEach(([key, entry]) => {
                    if (!entry || !entry.isManual) {
                        return;
                    }

                    hasAnyQuestions = true;

                    const card = document.createElement('div');
                    card.className = 'question-item is-manual';

                    const header = document.createElement('div');
                    header.className = 'question-item-header';

                    const chip = document.createElement('span');
                    const chipClass = getExpertQuestionTypeClass(entry.questionType);
                    chip.className = `question-chip ${chipClass}`;
                    const manualTypeLabel = getExpertQuestionTypeLabel(entry.questionType);
                    chip.textContent = manualTypeLabel === 'Unknown' ? 'Manual' : manualTypeLabel;
                    if (manualTypeLabel === 'Unknown') {
                        chip.classList.add('question-chip--manual');
                    }
                    header.appendChild(chip);

                    const meta = document.createElement('div');
                    meta.className = 'question-meta';
                    const manualTime = formatTime(entry.timestamp || entry.segmentStart || entry.segmentEnd || 0);
                    meta.textContent = `Manual entry @ ${manualTime}`;
                    header.appendChild(meta);

                    card.appendChild(header);
                    card.appendChild(createField('Question', entry.question || '', 'question-text'));
                    card.appendChild(createField('Model answer', entry.answer || '', 'answer-text'));

                    container.appendChild(card);
                });

                if (!hasAnyQuestions) {
                    renderExpertInfoMessage(container, 'No expert questions saved yet. Play the video to add questions at each segment when the review pauses.');
                }
            } else {
                renderExpertInfoMessage(container, 'Select a video to begin adding expert questions.');
            }
        }

        function findNextIncompleteSegmentIndex(startIndex = 0) {
            if (!currentSegments || currentSegments.length === 0) {
                return 0;
            }

            for (let index = Math.max(0, startIndex); index < currentSegments.length; index++) {
                if (!hasExpertDecision(currentSegments[index])) {
                    return index;
                }
            }

            return currentSegments.length;
        }

        function setExpertFormFeedback(message, type = 'error') {
            const feedback = document.getElementById('expert-form-feedback');
            if (!feedback) {
                return;
            }

            feedback.textContent = message || '';
            feedback.classList.remove('success');

            if (message && type === 'success') {
                feedback.classList.add('success');
            }
        }

        function toggleExpertFormState(disabled) {
            const form = document.getElementById('expert-question-form');
            if (!form) {
                return;
            }

            Array.from(form.elements).forEach(element => {
                if (!element) {
                    return;
                }

                if (element.id === 'expert-skip-button') {
                    element.disabled = disabled;
                    return;
                }

                element.disabled = disabled;
            });
        }

        function resetExpertForm() {
            const form = document.getElementById('expert-question-form');
            if (form) {
                form.reset();
            }

            setExpertFormFeedback('');
            expertSaveInProgress = false;
            toggleExpertFormState(false);
        }

        function populateExpertForm(segment) {
            const typeSelect = document.getElementById('expert-question-type');
            const questionInput = document.getElementById('expert-question-text');
            const answerInput = document.getElementById('expert-answer-text');

            const existing = getExpertQuestionForSegment(segment);

            if (existing) {
                if (existing.skipped) {
                    if (typeSelect) {
                        typeSelect.value = '';
                    }
                    if (questionInput) {
                        questionInput.value = '';
                    }
                    if (answerInput) {
                        answerInput.value = '';
                    }
                    setExpertFormFeedback('This segment is marked as skipped. Add a question to replace it or skip again.');
                } else {
                    if (typeSelect) {
                        typeSelect.value = normalizeQuestionType(existing.questionType);
                    }
                    if (questionInput) {
                        questionInput.value = existing.question || '';
                    }
                    if (answerInput) {
                        answerInput.value = existing.answer || '';
                    }
                    setExpertFormFeedback('Existing question loaded for this segment.', 'success');
                }
            } else {
                if (typeSelect) {
                    typeSelect.value = '';
                }
                if (questionInput) {
                    questionInput.value = '';
                }
                if (answerInput) {
                    answerInput.value = '';
                }
                setExpertFormFeedback('');
            }

            expertSaveInProgress = false;
            toggleExpertFormState(false);
        }

        async function handleVideoSelection(videoId) {
            if (!videoId || isLoadingVideo) {
                return;
            }

            const video = findVideoById(videoId);
            if (!video) {
                return;
            }
            // If not already assigned to me, claim it first
            if (!video.assigned_to_me) {
                const res = await fetch(`/api/expert/videos/${videoId}/claim`, { method: 'POST' });
                if (!res.ok) {
                    alert('Could not access this video.');
                    return;
                }
            }

            await loadVideo(video.id, video.title);
        }

        async function handleExpertQuestionSubmit(event) {
            event.preventDefault();

            if (expertSaveInProgress) {
                return;
            }

            if (!currentVideoId) {
                setExpertFormFeedback('Select a video before saving questions.');
                return;
            }

            const segment = currentSegments[currentSegmentIndex];
            if (!segment) {
                setExpertFormFeedback('No segment selected.');
                return;
            }

            const typeSelect = document.getElementById('expert-question-type');
            const questionInput = document.getElementById('expert-question-text');
            const answerInput = document.getElementById('expert-answer-text');

            const questionType = normalizeQuestionType(typeSelect ? typeSelect.value.trim() : '');
            const question = questionInput ? questionInput.value.trim() : '';
            const answer = answerInput ? answerInput.value.trim() : '';

            // Strict validation - all fields must be filled
            if (!questionType || questionType === '') {
                setExpertFormFeedback('Please select a question type.');
                typeSelect.focus();
                return;
            }

            if (getExpertQuestionTypeLabel(questionType) === 'Unknown') {
                setExpertFormFeedback('Please select a valid question type.');
                typeSelect.focus();
                return;
            }

            if (!question || question === '') {
                setExpertFormFeedback('Please enter a question. This field is required.');
                questionInput.focus();
                return;
            }

            if (!answer || answer === '') {
                setExpertFormFeedback('Please enter an answer. This field is required.');
                answerInput.focus();
                return;
            }

            expertSaveInProgress = true;
            toggleExpertFormState(true);
            setExpertFormFeedback('Saving question...', 'success');

            const payload = {
                videoId: currentVideoId,
                segmentStart: segment.start,
                segmentEnd: segment.end,
                timestamp: segment.end,
                questionType,
                question,
                answer
            };

            try {
                const response = await fetch('/api/expert-questions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const data = await response.json();

                if (!response.ok || !data.success) {
                    const errorMessage = data && data.message ? data.message : 'Failed to save question.';
                    throw new Error(errorMessage);
                }

                setExpertQuestionForSegment(segment, {
                    videoId: currentVideoId,
                    segmentStart: segment.start,
                    segmentEnd: segment.end,
                    timestamp: segment.end,
                    questionType,
                    question,
                    answer,
                    skipReason: '',
                    updatedAt: data.updatedAt || new Date().toISOString()
                });

                updateExpertQuestionsPanel(segment);
                await showLLMReviewForSegment(segment, currentSegmentIndex);
            } catch (error) {
                console.error('Failed to save expert question:', error);
                setExpertFormFeedback(error.message || 'Failed to save question.');
            } finally {
                expertSaveInProgress = false;
                toggleExpertFormState(false);
            }
        }

        async function handleExpertSkip(event) {
            if (event) {
                event.preventDefault();
            }

            if (expertSaveInProgress) {
                return;
            }

            if (!currentVideoId) {
                setExpertFormFeedback('Select a video before skipping segments.');
                return;
            }

            const segment = currentSegments[currentSegmentIndex];
            if (!segment) {
                setExpertFormFeedback('No segment selected.');
                return;
            }

            expertSaveInProgress = true;
            toggleExpertFormState(true);
            setExpertFormFeedback('Marking segment as skipped...', 'success');

            const payload = {
                videoId: currentVideoId,
                segmentStart: segment.start,
                segmentEnd: segment.end,
                timestamp: segment.end,
                skipped: true
            };

            try {
                const response = await fetch('/api/expert-questions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const data = await response.json();

                if (!response.ok || !data.success) {
                    const errorMessage = data && data.message ? data.message : 'Failed to skip segment.';
                    throw new Error(errorMessage);
                }

                const record = {
                    videoId: currentVideoId,
                    segmentStart: segment.start,
                    segmentEnd: segment.end,
                    timestamp: segment.end,
                    skipped: true,
                    skipReason: '',
                    updatedAt: data.updatedAt || new Date().toISOString()
                };

                setExpertQuestionForSegment(segment, record);
                updateExpertQuestionsPanel(segment);
                await showLLMReviewForSegment(segment, currentSegmentIndex);
            } catch (error) {
                console.error('Failed to skip segment:', error);
                setExpertFormFeedback(error.message || 'Failed to skip segment.');
            } finally {
                expertSaveInProgress = false;
                toggleExpertFormState(false);
            }
        }



        async function showLLMReviewForSegment(segment, segmentIndex) {
            llmModalResolve = null;

            if (!segment || !currentVideoId) {

                hidePauseOverlay();

                releaseModalPlaybackLock({ resume: false });

                approveAndContinue();

                if (typeof llmModalResolve === 'function') {

                    llmModalResolve();

                    llmModalResolve = null;

                }

                return;

            }



            const questions = await resolveSegmentQuestions(segment);



            if (!questions || Object.keys(questions).length === 0) {

                hidePauseOverlay();

                releaseModalPlaybackLock({ resume: false });

                approveAndContinue();

                if (typeof llmModalResolve === 'function') {

                    llmModalResolve();

                    llmModalResolve = null;

                }

                return;

            }



            const segmentKey = getSegmentKey(segment);



            if (!llmQuestionEdits[currentVideoId]) {

                llmQuestionEdits[currentVideoId] = {};

            }



            const entries = [];

            Object.entries(questions).forEach(([type, data]) => {

                const questionKey = `${segmentKey}_${type}`;

                const edits = llmQuestionEdits[currentVideoId][questionKey] || {};



                entries.push({

                    questionKey,

                    type,

                    question: data.q || '',

                    answer: data.a || '',

                    trashed: Boolean(edits.trashed),

                    modified: Boolean(edits.modified),

                    timestamp: edits.timestamp || null

                });

            });



            if (!entries.length) {

                hidePauseOverlay();

                releaseModalPlaybackLock({ resume: false });

                approveAndContinue();

                if (typeof llmModalResolve === 'function') {

                    llmModalResolve();

                    llmModalResolve = null;

                }

                return;

            }



            const rankingInfo = llmQuestionEdits[currentVideoId][`${segmentKey}_ranking`] || {};

            const validKeys = entries.map(entry => entry.questionKey);



            const rankingOrder = Array.isArray(rankingInfo.order)

                ? rankingInfo.order.filter(key => {

                    if (!validKeys.includes(key)) {

                        return false;

                    }

                    const entry = entries.find(item => item.questionKey === key);

                    return entry ? !entry.trashed : true;

                })

                : [];



            entries.forEach(entry => {

                if (!entry.trashed && !rankingOrder.includes(entry.questionKey)) {

                    rankingOrder.push(entry.questionKey);

                }

            });



            const trashOrder = [];

            if (Array.isArray(rankingInfo.trashed)) {

                rankingInfo.trashed.forEach(key => {

                    if (validKeys.includes(key) && !trashOrder.includes(key)) {

                        trashOrder.push(key);

                    }

                });

            }

            entries.forEach(entry => {

                if (entry.trashed && !trashOrder.includes(entry.questionKey)) {

                    trashOrder.push(entry.questionKey);

                }

            });



            llmModalState.open = true;

            llmModalState.segmentKey = segmentKey;

            llmModalState.segmentIndex = segmentIndex;

            llmModalState.questions = entries;

            llmModalState.rankingOrder = rankingOrder;

            llmModalState.trashOrder = trashOrder;

            llmModalState.openQuestionKey = rankingOrder[0] || trashOrder[0] || null;

            llmModalState.draggingKey = null;

            llmModalState.dragSource = null;

            llmModalState.step = 1;

            llmModalState.editingKey = null;

            llmModalState.triageComment = typeof rankingInfo.triageComment === 'string' ? rankingInfo.triageComment : '';

            const savedRankingComment = typeof rankingInfo.rankingComment === 'string'

                ? rankingInfo.rankingComment

                : (typeof rankingInfo.comment === 'string' ? rankingInfo.comment : '');

            llmModalState.rankingComment = savedRankingComment;



            const segmentLabel = document.getElementById('llm-modal-segment-label');

            if (segmentLabel) {

                segmentLabel.textContent = `Segment ${segmentIndex + 1} (${formatTime(segment.start)} - ${formatTime(segment.end)})`;

            }



            const triageCommentInput = document.getElementById('llm-triage-comment');

            if (triageCommentInput) {

                triageCommentInput.value = llmModalState.triageComment || '';

            }



            const rankingCommentInput = document.getElementById('llm-ranking-comment');

            if (rankingCommentInput) {

                rankingCommentInput.value = llmModalState.rankingComment || '';

            }



            const feedback = document.getElementById('llm-modal-feedback');

            if (feedback) {

                feedback.textContent = '';

            }



            hidePauseOverlay();

            acquireModalPlaybackLock();

            setLLMStep(1);



            const modal = document.getElementById('llm-review-modal');

            if (modal) {

                modal.classList.add('active');

            }



            return new Promise(resolve => {

                llmModalResolve = resolve;

            });

        }



        function clearLLMModalState() {

            llmModalState.open = false;

            llmModalState.segmentKey = null;

            llmModalState.segmentIndex = null;

            llmModalState.questions = [];

            llmModalState.rankingOrder = [];

            llmModalState.trashOrder = [];

            llmModalState.openQuestionKey = null;

            llmModalState.draggingKey = null;

            llmModalState.dragSource = null;

            llmModalState.step = 1;

            llmModalState.editingKey = null;

            llmModalState.triageComment = '';

            llmModalState.rankingComment = '';

        }



        function closeLLMReviewModal() {

            const modal = document.getElementById('llm-review-modal');

            if (modal) {

                modal.classList.remove('active');

            }



            const triageCommentInput = document.getElementById('llm-triage-comment');

            if (triageCommentInput) {

                triageCommentInput.value = '';

            }



            const rankingCommentInput = document.getElementById('llm-ranking-comment');

            if (rankingCommentInput) {

                rankingCommentInput.value = '';

            }



            const feedback = document.getElementById('llm-modal-feedback');

            if (feedback) {

                feedback.textContent = '';

            }



            const dropzone = document.getElementById('llm-trash-dropzone');

            if (dropzone) {

                dropzone.classList.remove('drag-over');

            }



            clearLLMModalState();

        }



        function setLLMStep(step) {

            llmModalState.step = step;

            llmModalState.editingKey = null;



            const title = document.getElementById('llm-modal-step-title');

            if (title) {

                const titles = {

                    1: 'Review AI Questions',

                    2: 'Rank AI Questions'

                };

                title.textContent = titles[step] || 'Review AI Questions';

            }



            document.querySelectorAll('.llm-step-content').forEach(content => {

                content.classList.toggle('active', content.id === `llm-step-${step}`);

            });



            if (step === 1) {

                renderLLMStepOne();

                const triageCommentInput = document.getElementById('llm-triage-comment');

                if (triageCommentInput) {

                    triageCommentInput.value = llmModalState.triageComment || '';

                }

            } else if (step === 2) {

                renderLLMStepTwo();

                const rankingCommentInput = document.getElementById('llm-ranking-comment');

                if (rankingCommentInput) {

                    rankingCommentInput.value = llmModalState.rankingComment || '';

                }
            }

        }



        function renderLLMStepOne() {

            const triageList = document.getElementById('llm-triage-list');

            const triageEmpty = document.getElementById('llm-triage-empty');

            const trashList = document.getElementById('llm-triage-trash-list');

            const trashEmpty = document.getElementById('llm-triage-trash-empty');



            if (!triageList || !trashList) {

                return;

            }



            triageList.innerHTML = '';

            trashList.innerHTML = '';



            const activeKeys = llmModalState.rankingOrder || [];

            const trashKeys = llmModalState.trashOrder || [];



            activeKeys.forEach((key, index) => {

                const item = createLLMTriageItem(key, index);

                if (item) {

                    triageList.appendChild(item);

                }

            });



            trashKeys.forEach((key, index) => {

                const item = createLLMListItem(key, index, 'trash');

                if (item) {

                    trashList.appendChild(item);

                }

            });



            if (triageEmpty) {

                triageEmpty.style.display = activeKeys.length ? 'none' : 'block';

            }



            if (trashEmpty) {

                trashEmpty.style.display = trashKeys.length ? 'none' : 'block';

            }

        }



        function createLLMTriageItem(questionKey, index) {

            const entry = getLLMEntry(questionKey);

            if (!entry || entry.trashed) {

                return null;

            }



            const item = document.createElement('li');

            item.className = 'llm-triage-item';

            item.dataset.questionKey = questionKey;

            item.dataset.index = String(index);



            const textWrapper = document.createElement('div');

            textWrapper.className = 'llm-item-text';



            const typeEl = document.createElement('div');

            typeEl.className = 'llm-item-type';

            typeEl.textContent = entry.type;

            textWrapper.appendChild(typeEl);



            const questionEl = document.createElement('div');

            questionEl.className = 'llm-item-question';

            questionEl.textContent = entry.question || '(empty question)';

            textWrapper.appendChild(questionEl);



            item.appendChild(textWrapper);



            const actions = document.createElement('div');

            actions.className = 'llm-triage-actions';



            const trashButton = document.createElement('button');
            trashButton.type = 'button';
            trashButton.className = 'llm-action-icon';
            trashButton.title = 'Mark as Inappropriate';
            trashButton.setAttribute('aria-label', 'Mark as Inappropriate');
            trashButton.innerHTML = `
                <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                    <path d="M7.5 2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1h4a.75.75 0 0 1 0 1.5h-.82l-1.08 12.11A2.25 2.25 0 0 1 12.37 18H7.63a2.25 2.25 0 0 1-2.23-2.39L4.32 3.5H3.5a.75.75 0 0 1 0-1.5h4Zm1.56 0h1.88a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.38.5Zm4.48 2H6.46l1.03 11.5a.75.75 0 0 0 .74.68h4.74a.75.75 0 0 0 .74-.68L13.54 4Z"/>
                </svg>
            `;
            trashButton.addEventListener('click', () => moveLLMQuestionToTrash(questionKey));

            actions.appendChild(trashButton);



            item.appendChild(actions);



            return item;

        }



        function attachLLMListListeners() {

            const rankingList = document.getElementById('llm-ranking-list');

            const trashDropzone = document.getElementById('llm-trash-dropzone');

            const trashList = document.getElementById('llm-ranking-trash-list');



            if (rankingList && rankingList.dataset.listenersAttached !== 'true') {

                rankingList.addEventListener('dragover', handleLLMRankingDragOver);

                rankingList.addEventListener('drop', handleLLMRankingDrop);

                rankingList.dataset.listenersAttached = 'true';

            }



            if (trashDropzone && trashDropzone.dataset.listenersAttached !== 'true') {

                trashDropzone.addEventListener('dragover', handleLLMTrashDragOver);

                trashDropzone.addEventListener('dragleave', handleLLMTrashDragLeave);

                trashDropzone.addEventListener('drop', handleLLMTrashDrop);

                trashDropzone.dataset.listenersAttached = 'true';

            }



            if (trashList && trashList.dataset.listenersAttached !== 'true') {

                trashList.addEventListener('dragover', handleLLMTrashDragOver);

                trashList.addEventListener('dragleave', handleLLMTrashDragLeave);

                trashList.addEventListener('drop', handleLLMTrashDrop);

                trashList.dataset.listenersAttached = 'true';

            }

        }



        function createLLMListItem(questionKey, index, listType) {

            const entry = getLLMEntry(questionKey);

            if (!entry) {

                return null;

            }



            const item = document.createElement('li');

            item.className = listType === 'ranking' ? 'llm-ranking-item' : 'llm-trash-item';

            item.dataset.questionKey = questionKey;

            item.dataset.list = listType;

            item.draggable = listType === 'ranking';

            if (item.draggable) {

                item.addEventListener('dragstart', handleLLMDragStart);

                item.addEventListener('dragend', handleLLMDragEnd);

            }



            if (listType === 'ranking') {

                const badge = document.createElement('span');

                badge.className = 'llm-rank-badge';

                badge.textContent = String(index + 1);

                item.appendChild(badge);

            }



            const textWrapper = document.createElement('div');

            textWrapper.className = 'llm-item-text';



            const typeEl = document.createElement('div');

            typeEl.className = 'llm-item-type';

            typeEl.textContent = entry.type;

            textWrapper.appendChild(typeEl);



            const questionEl = document.createElement('div');

            questionEl.className = 'llm-item-question';

            questionEl.textContent = entry.question || '(empty question)';

            textWrapper.appendChild(questionEl);



            item.appendChild(textWrapper);



            if (listType === 'trash') {

                const restoreButton = document.createElement('button');

                restoreButton.type = 'button';

                restoreButton.className = 'btn btn-light btn-sm';

                restoreButton.textContent = 'Restore';

                restoreButton.addEventListener('click', () => moveLLMQuestionToRanking(questionKey));

                item.appendChild(restoreButton);

            }



            return item;

        }



        function handleLLMDragStart(event) {

            const key = event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset.questionKey : null;

            if (!key) {

                return;

            }



            llmModalState.draggingKey = key;

            const parentList = event.currentTarget.closest('.llm-trash-list');

            llmModalState.dragSource = parentList ? 'trash' : 'ranking';

            if (event.dataTransfer) {

                event.dataTransfer.effectAllowed = 'move';

                event.dataTransfer.setData('text/plain', key);

            }



            event.currentTarget.classList.add('dragging');

        }



        function handleLLMDragEnd(event) {

            if (event.currentTarget) {

                event.currentTarget.classList.remove('dragging');

            }

            llmModalState.draggingKey = null;

            llmModalState.dragSource = null;

        }



        function handleLLMRankingDragOver(event) {

            event.preventDefault();

        }



        function handleLLMRankingDrop(event) {

            event.preventDefault();

            const draggedKey = llmModalState.draggingKey || (event.dataTransfer && event.dataTransfer.getData('text/plain'));

            if (!draggedKey) {

                return;

            }



            const list = document.getElementById('llm-ranking-list');

            const index = getLLMDropIndex(list, event.clientY);

            moveLLMQuestionToRanking(draggedKey, index);

            llmModalState.draggingKey = null;

            llmModalState.dragSource = null;

        }



        function handleLLMTrashDragOver(event) {

            event.preventDefault();

            const dropzone = document.getElementById('llm-trash-dropzone');

            if (dropzone) {

                dropzone.classList.add('drag-over');

            }

        }



        function handleLLMTrashDragLeave() {

            const dropzone = document.getElementById('llm-trash-dropzone');

            if (dropzone) {

                dropzone.classList.remove('drag-over');

            }

        }



        function handleLLMTrashDrop(event) {

            event.preventDefault();

            const draggedKey = llmModalState.draggingKey || (event.dataTransfer && event.dataTransfer.getData('text/plain'));

            if (!draggedKey) {

                return;

            }



            moveLLMQuestionToTrash(draggedKey);

            llmModalState.draggingKey = null;

            llmModalState.dragSource = null;

            const dropzone = document.getElementById('llm-trash-dropzone');

            if (dropzone) {

                dropzone.classList.remove('drag-over');

            }

        }



        function getLLMDropIndex(list, clientY) {

            if (!list) {

                return 0;

            }



            const items = Array.from(list.querySelectorAll('li')).filter(item => !item.classList.contains('dragging'));

            for (let index = 0; index < items.length; index++) {

                const rect = items[index].getBoundingClientRect();

                if (clientY < rect.top + rect.height / 2) {

                    return index;

                }

            }

            return items.length;

        }



        function moveLLMQuestionToRanking(questionKey, position) {

            if (!questionKey) {

                return;

            }



            const validKeys = llmModalState.questions.map(entry => entry.questionKey);

            if (!validKeys.includes(questionKey)) {

                return;

            }



            llmModalState.trashOrder = (llmModalState.trashOrder || []).filter(key => key !== questionKey);

            let order = (llmModalState.rankingOrder || []).filter(key => key !== questionKey);



            if (typeof position === 'number' && position >= 0 && position <= order.length) {

                order.splice(position, 0, questionKey);

            } else {

                order.push(questionKey);

            }



            llmModalState.rankingOrder = order;



            const entry = getLLMEntry(questionKey);

            if (entry) {

                entry.trashed = false;

            }



            persistLLMModalTrashState(questionKey, false);

            renderLLMStepOne();

            renderLLMStepTwo();



            if (llmModalState.step === 3) {

                renderLLMAccordion();

            }

        }



        function moveLLMQuestionToTrash(questionKey) {

            if (!questionKey) {

                return;

            }



            const validKeys = llmModalState.questions.map(entry => entry.questionKey);

            if (!validKeys.includes(questionKey)) {

                return;

            }



            llmModalState.rankingOrder = (llmModalState.rankingOrder || []).filter(key => key !== questionKey);

            if (!llmModalState.trashOrder.includes(questionKey)) {

                llmModalState.trashOrder.push(questionKey);

            }



            const entry = getLLMEntry(questionKey);

            if (entry) {

                entry.trashed = true;

            }



            if (llmModalState.editingKey === questionKey) {

                llmModalState.editingKey = null;

            }



            if (llmModalState.openQuestionKey === questionKey) {

                llmModalState.openQuestionKey = llmModalState.rankingOrder[0] || llmModalState.trashOrder[0] || null;

            }



            persistLLMModalTrashState(questionKey, true);

            renderLLMStepOne();

            renderLLMStepTwo();



            if (llmModalState.step === 3) {

                renderLLMAccordion();

            }

        }



        function renderLLMStepTwo() {

            const rankingList = document.getElementById('llm-ranking-list');

            const trashList = document.getElementById('llm-ranking-trash-list');

            const rankingEmpty = document.getElementById('llm-ranking-empty');

            const trashEmpty = document.getElementById('llm-ranking-trash-empty');



            if (!rankingList || !trashList) {

                return;

            }



            rankingList.innerHTML = '';

            trashList.innerHTML = '';



            const rankingKeys = llmModalState.rankingOrder || [];

            const trashKeys = llmModalState.trashOrder || [];



            rankingKeys.forEach((key, index) => {

                const item = createLLMListItem(key, index, 'ranking');

                if (item) {

                    rankingList.appendChild(item);

                }

            });



            trashKeys.forEach((key, index) => {

                const item = createLLMListItem(key, index, 'trash');

                if (item) {

                    trashList.appendChild(item);

                }

            });



            if (rankingEmpty) {

                rankingEmpty.style.display = rankingKeys.length ? 'none' : 'block';

            }



            if (trashEmpty) {

                trashEmpty.style.display = trashKeys.length ? 'none' : 'block';

            }



            attachLLMListListeners();

        }



        function renderLLMAccordion() {

            const accordion = document.getElementById('llm-accordion-list');

            if (!accordion) {

                return;

            }



            accordion.innerHTML = '';



            const combinedOrder = getCombinedLLMOrder();

            if (!combinedOrder.length) {

                const empty = document.createElement('div');

                empty.className = 'llm-empty-state';

                empty.textContent = 'No AI-generated questions are available for this segment.';

                accordion.appendChild(empty);

                return;

            }



            if (!combinedOrder.includes(llmModalState.openQuestionKey)) {

                llmModalState.openQuestionKey = combinedOrder[0];

            }



            combinedOrder.forEach(questionKey => {

                const entry = getLLMEntry(questionKey);

                if (!entry) {

                    return;

                }



                const item = document.createElement('div');
                item.className = 'llm-review-card';

                if (llmModalState.openQuestionKey === questionKey) {
                    item.classList.add('open');
                }

                if (entry.trashed) {
                    item.classList.add('trashed');
                }

                if (!entry.trashed) {
                    item.addEventListener('click', event => {
                        if (event.target.closest('button')) {
                            return;
                        }
                        llmModalState.openQuestionKey = questionKey;
                        renderLLMAccordion();
                    });
                }

                const questionBlock = document.createElement('div');
                questionBlock.className = 'llm-review-block llm-review-question';

                const questionTop = document.createElement('div');
                questionTop.className = 'llm-review-top';

                const typeLabel = document.createElement('span');
                typeLabel.className = 'llm-review-label';
                typeLabel.textContent = entry.type;
                questionTop.appendChild(typeLabel);

                const statusContainer = document.createElement('div');
                statusContainer.className = 'llm-review-status';
                if (entry.trashed) {
                    const trashedBadge = document.createElement('span');
                    trashedBadge.className = 'llm-badge trashed';
                    trashedBadge.textContent = 'Trashed';
                    statusContainer.appendChild(trashedBadge);
                }
                questionTop.appendChild(statusContainer);

                questionBlock.appendChild(questionTop);

                const questionText = document.createElement('div');
                questionText.className = 'llm-review-text';
                questionText.textContent = entry.question || '(empty question)';
                questionBlock.appendChild(questionText);

                item.appendChild(questionBlock);

                const answerBlock = document.createElement('div');
                answerBlock.className = 'llm-review-block llm-review-answer';

                const answerLabel = document.createElement('span');
                answerLabel.className = 'llm-review-label';
                answerLabel.textContent = 'Answer';
                answerBlock.appendChild(answerLabel);

                const answerText = document.createElement('div');
                answerText.className = 'llm-review-text';
                if (entry.answer) {
                    answerText.textContent = entry.answer;
                } else {
                    answerText.innerHTML = '<span class="llm-answer-empty">(empty answer)</span>';
                }
                answerBlock.appendChild(answerText);

                item.appendChild(answerBlock);

                const actions = document.createElement('div');
                actions.className = 'llm-review-actions';

                if (entry.trashed) {
                    const restoreButton = document.createElement('button');
                    restoreButton.type = 'button';
                    restoreButton.className = 'btn btn-light btn-sm';
                    restoreButton.textContent = 'Restore';
                    restoreButton.addEventListener('click', () => moveLLMQuestionToRanking(questionKey));
                    actions.appendChild(restoreButton);
                }
                if (actions.children.length) {
                    item.appendChild(actions);
                }

                accordion.appendChild(item);

            });

        }



        function getLLMEntry(questionKey) {

            return llmModalState.questions.find(entry => entry.questionKey === questionKey) || null;

        }



        function startLLMModalEdit(questionKey) {

            const entry = getLLMEntry(questionKey);

            if (!entry || entry.trashed) {

                return;

            }



            llmModalState.openQuestionKey = questionKey;

            llmModalState.editingKey = questionKey;

            renderLLMAccordion();

        }



        function cancelLLMModalEdit() {

            llmModalState.editingKey = null;

            renderLLMAccordion();

        }



        function persistLLMModalQuestionEdit(questionKey, updates) {

            if (!currentVideoId || !questionKey) {

                return;

            }



            if (!llmQuestionEdits[currentVideoId]) {

                llmQuestionEdits[currentVideoId] = {};

            }



            if (!llmQuestionEdits[currentVideoId][questionKey]) {

                llmQuestionEdits[currentVideoId][questionKey] = {};

            }



            const target = llmQuestionEdits[currentVideoId][questionKey];

            if (updates.question !== undefined) {

                target.question = updates.question;

            }

            if (updates.answer !== undefined) {

                target.answer = updates.answer;

            }

            if (updates.trashed !== undefined) {

                target.trashed = updates.trashed;

            }

            target.modified = true;

            target.timestamp = new Date().toISOString();

        }



        function persistLLMModalTrashState(questionKey, trashed) {

            persistLLMModalQuestionEdit(questionKey, { trashed });

        }



        function saveLLMModalQuestion(questionKey, editWrapper) {

            const entry = getLLMEntry(questionKey);

            if (!entry) {

                return;

            }



            const questionField = editWrapper.querySelector('textarea[data-role="question"]');

            const answerField = editWrapper.querySelector('textarea[data-role="answer"]');



            const updatedQuestion = questionField ? questionField.value.trim() : '';

            const updatedAnswer = answerField ? answerField.value.trim() : '';



            entry.question = updatedQuestion;

            entry.answer = updatedAnswer;

            entry.modified = true;

            entry.timestamp = new Date().toISOString();



            persistLLMModalQuestionEdit(questionKey, {

                question: updatedQuestion,

                answer: updatedAnswer

            });



            llmModalState.editingKey = null;



            const feedback = document.getElementById('llm-modal-feedback');

            if (feedback) {

                feedback.textContent = 'Saved edits.';

                setTimeout(() => {

                    if (feedback.textContent === 'Saved edits.') {

                        feedback.textContent = '';

                    }

                }, 1500);

            }



            renderLLMAccordion();

            renderLLMStepOne();

        }



        function getCombinedLLMOrder() {

            const seen = new Set();

            const combined = [];



            (llmModalState.rankingOrder || []).forEach(key => {

                if (!seen.has(key)) {

                    combined.push(key);

                    seen.add(key);

                }

            });



            (llmModalState.trashOrder || []).forEach(key => {

                if (!seen.has(key)) {

                    combined.push(key);

                    seen.add(key);

                }

            });



            llmModalState.questions.forEach(entry => {

                if (!seen.has(entry.questionKey)) {

                    combined.push(entry.questionKey);

                    seen.add(entry.questionKey);

                }

            });



            return combined;

        }



        function handleLLMStepNext() {

            if (!llmModalState.open) {

                return;

            }



            const feedback = document.getElementById('llm-modal-feedback');

            if (feedback) {

                feedback.textContent = '';

            }



            if (llmModalState.step === 1) {

                const triageCommentInput = document.getElementById('llm-triage-comment');

                const comment = triageCommentInput ? triageCommentInput.value.trim() : '';

                llmModalState.triageComment = comment;

                setLLMStep(2);

                return;

            }



            if (llmModalState.step === 2) {

                const rankingCommentInput = document.getElementById('llm-ranking-comment');

                const comment = rankingCommentInput ? rankingCommentInput.value.trim() : '';

                llmModalState.rankingComment = comment;

                handleLLMModalSubmit();

                return;

            }

        }



        function handleLLMStepBack() {

            if (!llmModalState.open) {

                return;

            }



            const feedback = document.getElementById('llm-modal-feedback');

            if (feedback) {

                feedback.textContent = '';

            }



            if (llmModalState.step === 2) {

                setLLMStep(1);

                return;

            }




        }



        function handleLLMModalSubmit() {

            if (!llmModalState.open || !currentVideoId || !llmModalState.segmentKey) {

                closeLLMReviewModal();

                releaseModalPlaybackLock({ resume: false });

                approveAndContinue();

                if (typeof llmModalResolve === 'function') {

                    llmModalResolve();

                    llmModalResolve = null;

                }

                return;

            }



            if (llmModalState.step === 1) {

                setLLMStep(2);

                return;

            }



            const rankingCommentInput = document.getElementById('llm-ranking-comment');

            const rankingComment = rankingCommentInput ? rankingCommentInput.value.trim() : (llmModalState.rankingComment || '').trim();

            llmModalState.rankingComment = rankingComment;



            const triageComment = (llmModalState.triageComment || '').trim();



            const validKeys = llmModalState.questions.map(entry => entry.questionKey);

            const rankingOrder = (llmModalState.rankingOrder || []).filter(key => validKeys.includes(key));

            const trashOrder = (llmModalState.trashOrder || []).filter(key => validKeys.includes(key));



            if (!llmQuestionEdits[currentVideoId]) {

                llmQuestionEdits[currentVideoId] = {};

            }



            llmQuestionEdits[currentVideoId][`${llmModalState.segmentKey}_ranking`] = {

                order: rankingOrder,

                trashed: trashOrder,

                triageComment,

                rankingComment,

                comment: rankingComment,

                updatedAt: new Date().toISOString()

            };



            closeLLMReviewModal();

            releaseModalPlaybackLock({ resume: false });

            renderReviewQuestions();

            approveAndContinue();



            if (typeof llmModalResolve === 'function') {

                llmModalResolve();

                llmModalResolve = null;

            }

        }



        function getSelectedVideoLabel() {
            if (currentVideoLabel) {
                return currentVideoLabel;
            }
            const select = document.getElementById('video-select');
            if (select && select.selectedIndex >= 0) {
                const option = select.options[select.selectedIndex];
                if (option) {
                    return option.textContent;
                }
            }
            return currentVideoId || '';
        }

        function resetReviewPanel() {
            const reviewVideo = document.getElementById('review-video-id');
            const reviewSegments = document.getElementById('review-total-segments');
            const reviewList = document.getElementById('review-questions-list');

            if (reviewVideo) {
                reviewVideo.textContent = currentVideoId ? getSelectedVideoLabel() : 'Not selected';
            }

            if (reviewSegments) {
                reviewSegments.textContent = currentSegments && currentSegments.length ? currentSegments.length : '0';
            }

            if (reviewList) {
                if (currentVideoId) {
                    reviewList.innerHTML = '<div class="review-placeholder">Choose "Review Questions" to generate a full summary.</div>';
                } else {
                    reviewList.innerHTML = '<div class="review-placeholder">Select a video on Step 1 to begin.</div>';
                }
            }

            const progressText = document.getElementById('progress-text');
            if (progressText) {
                progressText.textContent = currentVideoId ? 'Loading segments...' : 'Select a video to begin';
            }

            const progressSubtext = document.getElementById('progress-subtext');
            if (progressSubtext) {
                progressSubtext.textContent = currentVideoId ? 'Preparing segment details...' : 'Segment progress will appear here.';
            }

            const progressFill = document.getElementById('progress-fill');
            if (progressFill) {
                progressFill.style.width = '0%';
            }

            const progressChip = document.getElementById('progress-chip');
            if (progressChip) {
                progressChip.textContent = '0%';
            }

            const segmentInfo = document.getElementById('segment-info');
            if (segmentInfo) {
                segmentInfo.style.display = 'none';
            }

            const segmentIndex = document.getElementById('segment-index-pill');
            if (segmentIndex) {
                segmentIndex.textContent = 'Segment 1';
            }

            const segmentTime = document.getElementById('segment-time');
            if (segmentTime) {
                segmentTime.textContent = '00:00 - 00:00';
            }

            const segmentDuration = document.getElementById('segment-duration');
            if (segmentDuration) {
                segmentDuration.textContent = '0s';
            }

            const segmentNextPause = document.getElementById('segment-next-pause');
            if (segmentNextPause) {
                segmentNextPause.textContent = '00:00';
            }

            updateManualQuestionButtonState();
        }

        function updateManualQuestionButtonState() {
            const manualButton = document.getElementById('add-manual-question-btn');
            if (!manualButton) {
                return;
            }

            const enable = Boolean(currentVideoId && hasActivePlayer());
            manualButton.disabled = !enable || isVideoPlaybackLocked();
        }

        function updateReviewButtonState() {
            const reviewButton = document.getElementById('review-button');
            if (reviewButton) {
                reviewButton.disabled = !(currentSegments && currentSegments.length > 0);
            }
        }

        async function handleReviewQuestions() {
            if (!currentVideoId) {
                showStatus('Select a video before reviewing questions.', 'info');
                return;
            }

            if (!currentSegments || currentSegments.length === 0) {
                showStatus('No question segments available to review yet.', 'info');
                return;
            }

            unlockStep(3);
            await renderReviewQuestions();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        async function renderReviewQuestions() {
            const reviewVideo    = document.getElementById('review-video-id');
            const reviewSegments = document.getElementById('review-total-segments');
            const reviewList     = document.getElementById('review-questions-list');
            const charBtn        = document.getElementById('btn-characterize');
            const editPageBtn    = document.getElementById('btn-open-edit-page');
            if (!reviewList) return;

            if (reviewVideo)    reviewVideo.textContent    = getSelectedVideoLabel() || 'Not selected';
            if (reviewSegments) reviewSegments.textContent = currentSegments.length.toString();

            if (!currentSegments || currentSegments.length === 0) {
                reviewList.innerHTML = '<div class="review-placeholder">No question segments available for this video.</div>';
                if (charBtn)  charBtn.disabled  = false;
                if (editPageBtn) editPageBtn.disabled = false;
                return;
            }

            reviewList.innerHTML = '';

            try {

            // Pre-load saved persona variants and winners from server
            try {
                const pvRes = await fetch(`/api/expert/video/${currentVideoId}/persona-variants`);
                if (pvRes.ok) {
                    const pvData = await pvRes.json();
                    const savedSegments = (pvData.data && pvData.data.segments) || pvData.segments || {};
                    for (const [segKey, segData] of Object.entries(savedSegments)) {
                        // Match by numeric start/end to handle different key formats (e.g. "0-59" vs "00000-00059")
                        const [startStr, endStr] = segKey.split('-');
                        const segStart = parseInt(startStr, 10);
                        const segEnd   = parseInt(endStr,   10);
                        const seg = currentSegments.find(s => Number(s.start) === segStart && Number(s.end) === segEnd);
                        if (seg) {
                            if (segData.persona_winners) seg.persona_winners = segData.persona_winners;
                            if (segData.persona_variants) {
                                personaVariantsCache[`${currentVideoId}_${getSegmentKey(seg)}`] = segData.persona_variants;
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn('Could not pre-load persona variants:', e);
            }

            // Render each segment with its raw AI questions (or persona columns if characterized)
            for (let index = 0; index < currentSegments.length; index++) {
                const segment    = currentSegments[index];
                const segmentKey = getSegmentKey(segment);
                const questions  = await resolveSegmentQuestions(segment);
                const cacheKey   = `${currentVideoId}_${segmentKey}`;
                const hasVariants = !!personaVariantsCache[cacheKey];

                const segmentBlock = document.createElement('div');
                segmentBlock.className = 'review-segment-block';
                segmentBlock.dataset.segmentKey = segmentKey;

                // Collapsible header
                const headerBar = document.createElement('div');
                headerBar.className = 'segment-header-bar' + (index === 0 ? ' open' : '');
                headerBar.innerHTML = `
                    <div>
                        <span class="segment-index-label">Segment ${index + 1}</span>
                        <span class="segment-time-label" style="margin-left:10px;opacity:.85;font-size:.9rem">${formatTime(segment.start)} - ${formatTime(segment.end)}</span>
                    </div>
                    <span class="segment-header-chevron">${index === 0 ? '&#9650;' : '&#9660;'}</span>
                `;

                const questionList = document.createElement('div');
                questionList.className = 'review-question-list';
                if (index > 0) questionList.style.display = 'none';

                headerBar.addEventListener('click', () => {
                    const isOpen = questionList.style.display !== 'none';
                    questionList.style.display = isOpen ? 'none' : 'block';
                    headerBar.querySelector('.segment-header-chevron').innerHTML = isOpen ? '&#9660;' : '&#9650;';
                    headerBar.classList.toggle('open', !isOpen);
                });

                if (hasVariants) {
                    // Show 3 persona columns with winner badges
                    const personaWinners = segment.persona_winners || {};
                    const variants = personaVariantsCache[cacheKey];
                    const personaConfigs = {
                        bunny:     { colClass: 'bunny-column',     emoji: '🐰', name: 'Bunny' },
                        alligator: { colClass: 'alligator-column', emoji: '🐊', name: 'Alligator' },
                        pig:       { colClass: 'pig-column',       emoji: '🐷', name: 'Pig' }
                    };

                    const grid = document.createElement('div');
                    grid.className = 'review-persona-grid';
                    grid.id = `persona-grid-${segmentKey}`;

                    Object.entries(personaConfigs).forEach(([persona, cfg]) => {
                        const col = document.createElement('div');
                        col.className = `review-persona-col ${cfg.colClass}`;
                        col.id = `persona-col-${segmentKey}-${persona}`;

                        const colHeader = document.createElement('div');
                        colHeader.className = 'review-persona-col-header';
                        colHeader.innerHTML = `<span class="review-persona-emoji">${cfg.emoji}</span><span class="review-persona-name">${cfg.name}</span>`;
                        col.appendChild(colHeader);

                        grid.appendChild(col);
                    });

                    questionList.appendChild(grid);
                    segmentBlock.appendChild(headerBar);
                    segmentBlock.appendChild(questionList);
                    reviewList.appendChild(segmentBlock);

                    renderPersonaColumns(segmentKey, variants, personaWinners);
                } else {
                    // Show raw AI questions
                    if (questions && Object.keys(questions).length > 0) {
                        Object.entries(questions).forEach(([type, data]) => {
                            if (!data || typeof data !== 'object') return;
                            const card = document.createElement('div');
                            card.className = 'review-q-card';
                            card.innerHTML = `
                                <span class="review-type-badge">${type}</span>
                                <div class="review-question-label">QUESTION</div>
                                <div class="review-question-text">${data.q || ''}</div>
                                <div class="review-answer-label">ANSWER</div>
                                <div class="review-answer-text">${data.a || ''}</div>
                            `;
                            questionList.appendChild(card);
                        });
                    } else {
                        questionList.innerHTML = '<div class="no-question-placeholder">No AI questions for this segment.</div>';
                    }

                    segmentBlock.appendChild(headerBar);
                    segmentBlock.appendChild(questionList);
                    reviewList.appendChild(segmentBlock);
                }
            }

            } catch (renderErr) {
                console.warn('renderReviewQuestions error:', renderErr);
            } finally {
                if (charBtn)     charBtn.disabled     = false;
                if (editPageBtn) editPageBtn.disabled = false;
            }
        }

        async function characterizeAllQuestions() {
            const btn       = document.getElementById('btn-characterize');
            const statusEl  = document.getElementById('characterize-status');
            const editPageBtn = document.getElementById('btn-open-edit-page');
            btn.disabled    = true;
            btn.textContent = '✨ Characterizing...';
            statusEl.textContent = '';

            let successCount = 0;

            for (let index = 0; index < currentSegments.length; index++) {
                const segment    = currentSegments[index];
                const segmentKey = getSegmentKey(segment);
                const questions  = await resolveSegmentQuestions(segment);

                if (!questions || !Object.keys(questions).length) continue;

                statusEl.textContent = `Generating segment ${index + 1} of ${currentSegments.length}...`;

                try {
                    const res = await fetch('/api/expert/questions/persona-variants', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ questions, best_question: segment.result?.best_question || null })
                    });
                    const data = await res.json();
                    if (data.success && data.variants) {
                        personaVariantsCache[`${currentVideoId}_${segmentKey}`] = data.variants;
                        // Save to server
                        await fetch(`/api/expert/video/${currentVideoId}/persona-variants`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ segments: { [segmentKey]: { persona_variants: data.variants } } })
                        });
                        successCount++;
                    }
                } catch (e) {
                    console.warn(`Segment ${index + 1} characterization failed:`, e);
                }
            }

            btn.disabled    = false;
            btn.textContent = '🔄 Characterize';

            if (successCount > 0) {
                statusEl.textContent = `✅ Done! ${successCount} segment(s) characterized.`;
                statusEl.style.color = '#16a34a';
                if (editPageBtn) {
                    editPageBtn.disabled = false;
                    editPageBtn.style.animation = 'pulse 0.6s ease 2';
                }
                // Re-render so persona columns appear immediately, then restore status
                await renderReviewQuestions();
                if (statusEl) {
                    statusEl.textContent = `✅ Done! ${successCount} segment(s) characterized.`;
                    statusEl.style.color = '#16a34a';
                }
            } else {
                statusEl.textContent = 'No questions could be characterized.';
                statusEl.style.color = '#dc2626';
            }
        }

        function renderPersonaColumns(segmentKey, variants, personaWinners) {
            const winners = personaWinners || {};
            const personas = ['bunny', 'alligator', 'pig'];
            personas.forEach(persona => {
                const col = document.getElementById(`persona-col-${segmentKey}-${persona}`);
                if (!col) return;

                const personaQuestions = variants[persona] || {};
                const winnerType = winners[persona];

                if (winnerType && personaQuestions[winnerType]) {
                    const displayData = personaQuestions[winnerType];
                    const card = document.createElement('div');
                    card.className = 'review-winner-inner-card';
                    card.innerHTML = `
                        <div class="review-winner-badges">
                            <span class="review-type-badge">${winnerType}</span>
                            <span class="review-kids-badge">⭐ Kids will see this one</span>
                        </div>
                        <div class="review-question-label">QUESTION</div>
                        <div class="review-q-box">${displayData.q || ''}</div>
                        <div class="review-answer-label">ANSWER</div>
                        <div class="review-a-box">${displayData.a || ''}</div>
                        <a class="review-regenerate-link" href="/expert/edit/${currentVideoId}">🔄 Regenerate with AI</a>
                    `;
                    col.appendChild(card);
                } else {
                    const placeholder = document.createElement('div');
                    placeholder.className = 'review-no-selection';
                    placeholder.textContent = 'No question selected for kids';
                    col.appendChild(placeholder);
                }
            });
        }

        function openEditPage() {
            if (!currentVideoId) return;
            window.location.href = `/expert/edit/${currentVideoId}`;
        }

        function toggleAccordion(index) {
            const headers = document.querySelectorAll('.accordion-header');
            const contents = document.querySelectorAll('.accordion-content');
            
            headers.forEach((header, i) => {
                if (i === index) {
                    header.classList.toggle('active');
                    contents[i].classList.toggle('active');
                } else {
                    header.classList.remove('active');
                    contents[i].classList.remove('active');
                }
            });
        }

        function toggleEditMode(questionKey, editMode) {
            const questionDiv = document.getElementById(`question-${questionKey}`);
            if (!questionDiv) return;
            
            if (editMode) {
                questionDiv.classList.remove('collapsed');
                questionDiv.classList.add('editing');
                
                // Focus on the question textarea
                const questionTextarea = document.getElementById(`edit-question-${questionKey}`);
                if (questionTextarea) {
                    questionTextarea.focus();
                }
            } else {
                questionDiv.classList.add('collapsed');
                questionDiv.classList.remove('editing');
            }
        }
        
        function saveEditAndClose(questionKey) {
            const questionTextarea = document.getElementById(`edit-question-${questionKey}`);
            const answerTextarea = document.getElementById(`edit-answer-${questionKey}`);
            
            if (questionTextarea && answerTextarea) {
                saveLLMQuestionEdit(questionKey, 'question', questionTextarea.value);
                saveLLMQuestionEdit(questionKey, 'answer', answerTextarea.value);
                
                // Update the preview text
                const questionDiv = document.getElementById(`question-${questionKey}`);
                if (questionDiv) {
                    const previewQuestion = questionDiv.querySelector('.question-preview');
                    const previewAnswer = questionDiv.querySelector('.answer-preview');
                    
                    if (previewQuestion) previewQuestion.textContent = questionTextarea.value;
                    if (previewAnswer) previewAnswer.textContent = answerTextarea.value;
                }
            }
            
            toggleEditMode(questionKey, false);
        }
        
        function saveLLMQuestionEdit(questionKey, field, value) {
            if (!llmQuestionEdits[currentVideoId]) {
                llmQuestionEdits[currentVideoId] = {};
            }
            
            if (!llmQuestionEdits[currentVideoId][questionKey]) {
                llmQuestionEdits[currentVideoId][questionKey] = {};
            }
            
            llmQuestionEdits[currentVideoId][questionKey][field] = value;
            llmQuestionEdits[currentVideoId][questionKey].modified = true;
            llmQuestionEdits[currentVideoId][questionKey].timestamp = new Date().toISOString();
        }

        function trashLLMQuestion(questionKey) {
            if (!llmQuestionEdits[currentVideoId]) {
                llmQuestionEdits[currentVideoId] = {};
            }
            
            if (!llmQuestionEdits[currentVideoId][questionKey]) {
                llmQuestionEdits[currentVideoId][questionKey] = {};
            }
            
            llmQuestionEdits[currentVideoId][questionKey].trashed = true;
            llmQuestionEdits[currentVideoId][questionKey].timestamp = new Date().toISOString();
            
            // Re-render to update UI
            renderReviewQuestions();
        }

        function restoreLLMQuestion(questionKey) {
            if (llmQuestionEdits[currentVideoId] && llmQuestionEdits[currentVideoId][questionKey]) {
                llmQuestionEdits[currentVideoId][questionKey].trashed = false;
                llmQuestionEdits[currentVideoId][questionKey].timestamp = new Date().toISOString();
            }
            
            // Re-render to update UI
            renderReviewQuestions();
        }

        function setExpertBestQuestion(segmentKey, questionKey) {
            if (!llmQuestionEdits[currentVideoId]) {
                llmQuestionEdits[currentVideoId] = {};
            }
            
            // Store the expert's best question selection
            if (questionKey) {
                llmQuestionEdits[currentVideoId][`${segmentKey}_expertBest`] = questionKey;
            } else {
                delete llmQuestionEdits[currentVideoId][`${segmentKey}_expertBest`];
            }
            
            // Re-render to update UI
            renderReviewQuestions();
        }

        async function saveAllLLMEdits(silent = false) {
            if (!currentVideoId) {
                if (!silent) showStatus('No video selected', 'error');
                return;
            }

            // Ensure all segments are approved            // Build final JSON payload
            const finalQuestions = {
                videoId: currentVideoId,
                timestamp: new Date().toISOString(),
                segments: []
            };

            for (let index = 0; index < currentSegments.length; index++) {
                const segment = currentSegments[index];
                const segmentKey = getSegmentKey(segment);

                const segmentData = {
                    segmentIndex: index,
                    start: segment.start,
                    end: segment.end,
                    aiQuestions: [],
                    aiOriginalBest: null,
                    approved: true
                };

                const questions = await resolveSegmentQuestions(segment);
                if (questions) {
                    if (segment.result && segment.result.best_question) {
                        segmentData.aiOriginalBest = segment.result.best_question;
                    }

                    // Get ranking info
                    const rankingInfo = llmQuestionEdits[currentVideoId] && 
                                    llmQuestionEdits[currentVideoId][`${segmentKey}_ranking`];

                    Object.entries(questions).forEach(([type, data]) => {
                        const questionKey = `${segmentKey}_${type}`;
                        const edits = (llmQuestionEdits[currentVideoId] &&
                                    llmQuestionEdits[currentVideoId][questionKey]) || {};

                        // Determine ranking
                        let ranking = 0;
                        if (rankingInfo && rankingInfo.order) {
                            const rankIndex = rankingInfo.order.indexOf(questionKey);
                            if (rankIndex !== -1) {
                                ranking = rankIndex + 1; // 1-based ranking
                            }
                        }
                        
                        // If trashed, ranking is 0
                        if (edits.trashed || (rankingInfo && rankingInfo.trashed && 
                            rankingInfo.trashed.includes(questionKey))) {
                            ranking = 0;
                        }

                        const questionData = {
                            type,
                            question: data.q || '',
                            answer: data.a || '',
                            trashed: edits.trashed || false,
                            modified: edits.modified || false,
                            ranking: ranking // Add ranking here
                        };

                        if (edits.timestamp) {
                            questionData.lastModified = edits.timestamp;
                        }

                        segmentData.aiQuestions.push(questionData);
                    });

                    // Add ranking comment if exists
                    if (rankingInfo) {
                        if (rankingInfo.triageComment) {
                            segmentData.triageComment = rankingInfo.triageComment;
                        }
                        const resolvedRankingComment = rankingInfo.rankingComment || rankingInfo.comment;
                        if (resolvedRankingComment) {
                            segmentData.rankingComment = resolvedRankingComment;
                        }
                    }
                }

                // Include persona variants (character questions) from cache
                const cacheKey = `${currentVideoId}_${segmentKey}`;
                if (personaVariantsCache[cacheKey]) {
                    segmentData.persona_variants = personaVariantsCache[cacheKey];
                }

                finalQuestions.segments.push(segmentData);
            }

            try {
                // Use the new dedicated endpoint
                const response = await fetch('/api/save-final-questions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        videoId: currentVideoId,
                        data: finalQuestions
                    })
                });

                const result = await response.json();

                if (response.ok && result.success) {
                    localStorage.setItem(`final_questions_${currentVideoId}`, JSON.stringify(finalQuestions));
                    if (!silent) {
                        showStatus('Thank you! Final questions saved successfully.', 'success');
                        console.log('Saved to:', result.filepath);
                        setTimeout(() => { window.location.href = '/'; }, 400);
                    }
                } else {
                    throw new Error(result.message || 'Server save failed');
                }
            } catch (error) {
                console.error('Error saving final questions:', error);
                localStorage.setItem(`final_questions_${currentVideoId}`, JSON.stringify(finalQuestions));
                if (!silent) showStatus('Saved to browser storage. Error: ' + error.message, 'warning');
            }
        }

        // Load saved edits when video is loaded
        function loadLLMEdits(videoId) {
            const savedEdits = localStorage.getItem(`llm_edits_${videoId}`);
            if (savedEdits) {
                llmQuestionEdits[videoId] = JSON.parse(savedEdits);
            } else {
                llmQuestionEdits[videoId] = {};
            }
        }

        function ensureSegmentResultObject(segment) {
            if (!segment) {
                return;
            }

            if (!segment.result) {
                segment.result = {};
                return;
            }

            if (typeof segment.result === 'string') {
                try {
                    segment.result = JSON.parse(segment.result);
                } catch (error) {
                    segment.result = {};
                }
            }
        }

        async function resolveSegmentQuestions(segment) {
            if (!segment) {
                return null;
            }

            ensureSegmentResultObject(segment);

            if (segment.result && segment.result.questions) {
                return segment.result.questions;
            }

            // Questions are stored in a single per-video file: {videoId}.json
            try {
                const response = await fetch(`/downloads/${currentVideoId}/questions/${currentVideoId}.json`);
                if (response.ok) {
                    const data = await response.json();
                    const segKey = getSegmentKey(segment);
                    const matchedSeg = (data.segments || []).find(s => getSegmentKey(s) === segKey);
                    if (matchedSeg && matchedSeg.result) {
                        ensureSegmentResultObject(segment);
                        if (matchedSeg.result.questions) {
                            segment.result.questions = matchedSeg.result.questions;
                        }
                        if (matchedSeg.result.best_question && !segment.result.best_question) {
                            segment.result.best_question = matchedSeg.result.best_question;
                        }
                        return segment.result.questions || null;
                    }
                }
            } catch (error) {
                console.warn('Unable to resolve questions for segment', error);
            }

            return null;
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
                const tag = document.createElement('script');
                tag.src = 'https://www.youtube.com/iframe_api';
                tag.async = true;
                tag.dataset.ytIframeApi = 'true';
                tag.onerror = () => reject(new Error('Failed to load YouTube API'));
                window.onYouTubeIframeAPIReady = () => resolve();
                document.head.appendChild(tag);
            });
            return ytApiPromise;
        }

        function hasActivePlayer() {
            return (playerMode === 'youtube' && ytPlayer) || (playerMode === 'local' && localVideoElement);
        }

        function updateLocalFallbackButtonState() {
            const btn = document.getElementById('use-local-video-btn');
            if (!btn) {
                return;
            }
            btn.disabled = !(currentVideoUrl && currentVideoUrl.length > 0);
        }

        function clearLocalPlayer() {
            if (localVideoElement) {
                try {
                    localVideoElement.pause();
                    localVideoElement.removeAttribute('src');
                    localVideoElement.load();
                } catch (err) {
                    console.warn('Failed to reset local player:', err);
                }
            }
            localVideoElement = null;
        }

        function switchToLocalVideo() {
            if (!currentVideoUrl) {
                showStatus('No downloaded video available for this selection.', 'warning');
                return;
            }

            stopVideoTimePolling();

            if (ytPlayer && typeof ytPlayer.destroy === 'function') {
                ytPlayer.destroy();
                ytPlayer = null;
                ytPlayerReady = false;
            }

            playerMode = 'local';

            const container = document.getElementById('video-container');
            if (!container) {
                return;
            }

            container.innerHTML = '';

            const video = document.createElement('video');
            video.id = 'local-player';
            video.className = 'video-player';
            video.controls = true;
            video.preload = 'metadata';
            video.src = currentVideoUrl;
            video.setAttribute('playsinline', '');

            video.addEventListener('timeupdate', onVideoTimeUpdate);
            video.addEventListener('loadedmetadata', onVideoLoaded);
            video.addEventListener('play', onVideoPlay);
            video.addEventListener('pause', onVideoPause);

            container.appendChild(video);

            localVideoElement = video;
            videoElement = video;
            updateManualQuestionButtonState();
            updateTimeDisplay();
        }

        function startVideoTimePolling() {
            stopVideoTimePolling();
            ytTimeUpdateTimer = setInterval(() => {
                onVideoTimeUpdate();
            }, 250);
        }

        function stopVideoTimePolling() {
            if (ytTimeUpdateTimer) {
                clearInterval(ytTimeUpdateTimer);
                ytTimeUpdateTimer = null;
            }
        }

        function handlePlayerStateChange(event) {
            if (playerMode !== 'youtube') return;
            if (!event) return;
            if (event.data === YT.PlayerState.PLAYING) {
                onVideoPlay();
                startVideoTimePolling();
                return;
            }

            if (event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.ENDED) {
                onVideoPause();
                stopVideoTimePolling();
            }
        }

        function handleEmbedError(event) {
            console.warn('YouTube embed error:', event?.data);
            showStatus('YouTube embed unavailable. Use the downloaded video instead.', 'warning');
            updateLocalFallbackButtonState();
        }

        async function ensureYouTubePlayer(videoId) {
            await loadYouTubeApi();
            playerMode = 'youtube';
            clearLocalPlayer();
            updateLocalFallbackButtonState();

            const existingHost = document.getElementById('youtube-player');
            if (ytPlayer && !existingHost && typeof ytPlayer.destroy === 'function') {
                ytPlayer.destroy();
                ytPlayer = null;
                ytPlayerReady = false;
            }

            if (ytPlayer) {
                ytPlayer.loadVideoById(videoId);
                ytPlayerReady = true;
                return;
            }

            const playerHost = document.createElement('div');
            playerHost.id = 'youtube-player';
            playerHost.className = 'video-player';

            const container = document.getElementById('video-container');
            if (container) {
                container.innerHTML = '';
                container.appendChild(playerHost);
            }

            videoElement = playerHost;
            ytPlayerReady = false;

            ytPlayer = new YT.Player('youtube-player', {
                videoId,
                playerVars: {
                    rel: 0,
                    modestbranding: 1,
                    playsinline: 1,
                    controls: 1,
                    fs: 0,
                    disablekb: 1
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

        function getVideoCurrentTime() {
            if (playerMode === 'local' && localVideoElement) {
                return Number(localVideoElement.currentTime) || 0;
            }
            if (!ytPlayer) return 0;
            try {
                return Number(ytPlayer.getCurrentTime()) || 0;
            } catch (err) {
                return 0;
            }
        }

        function setVideoCurrentTime(seconds) {
            const safe = Math.max(0, Number(seconds) || 0);
            if (playerMode === 'local' && localVideoElement) {
                localVideoElement.currentTime = safe;
                return;
            }
            if (!ytPlayer) return;
            ytPlayer.seekTo(safe, true);
        }

        function getVideoDuration() {
            if (playerMode === 'local' && localVideoElement) {
                return Number(localVideoElement.duration) || 0;
            }
            if (!ytPlayer) return 0;
            try {
                return Number(ytPlayer.getDuration()) || 0;
            } catch (err) {
                return 0;
            }
        }

        function isPlaybackPaused() {
            if (playerMode === 'local' && localVideoElement) {
                return localVideoElement.paused;
            }
            if (!ytPlayer || typeof ytPlayer.getPlayerState !== 'function') {
                return true;
            }
            const state = ytPlayer.getPlayerState();
            return state !== YT.PlayerState.PLAYING && state !== YT.PlayerState.BUFFERING;
        }

        function playVideo() {
            if (playerMode === 'local' && localVideoElement) {
                localVideoElement.play();
                return;
            }
            if (ytPlayer) {
                ytPlayer.playVideo();
            }
        }

        function pauseVideo() {
            if (playerMode === 'local' && localVideoElement) {
                localVideoElement.pause();
                return;
            }
            if (ytPlayer) {
                ytPlayer.pauseVideo();
            }
        }

        async function loadVideoList() {
            const list = document.getElementById('video-card-list');
            if (list) {
                list.innerHTML = '<div class="video-list-empty">Loading videos...</div>';
            }

            try {
                const response = await fetch('/api/expert/videos');
                const data = await response.json();

                if (data.success && Array.isArray(data.videos)) {
                    availableVideos = data.videos;

                    if (currentVideoId && !findVideoById(currentVideoId)) {
                        currentVideoId = null;
                        currentVideoLabel = '';
                        currentSegments = [];
                        currentSegmentIndex = 0;
                        resetReviewPanel();
                        updateReviewButtonState();
                    }

                    renderVideoList();
                } else {
                    availableVideos = [];
                    renderVideoList();
                }
            } catch (error) {
                availableVideos = [];
                renderVideoList();
            }
        }

        async function loadVideo(videoIdParam = null, labelOverride = null) {
            let videoId = videoIdParam;
            let displayLabel = labelOverride;

            if (!videoId) {
                const select = document.getElementById('video-select');
                if (select) {
                    videoId = select.value;
                    if (select.selectedIndex >= 0) {
                        const option = select.options[select.selectedIndex];
                        displayLabel = option ? option.textContent : null;
                    }
                }
            }

            if (!videoId) {
                showStatus('Choose a video to begin reviewing.', 'info');
                return;
            }

            const videoMeta = findVideoById(videoId);
            const resolvedVideoId = videoMeta ? videoMeta.id : videoId;
            currentVideoUrl = videoMeta && videoMeta.videoUrl ? videoMeta.videoUrl : null;
            updateLocalFallbackButtonState();

            if (!displayLabel) {
                if (videoMeta) {
                    const baseLabel = videoMeta.title || videoMeta.id;
                    const durationLabel = videoMeta.duration ? formatDuration(videoMeta.duration) : '';
                    displayLabel = durationLabel ? `${baseLabel} (${durationLabel})` : baseLabel;
                } else {
                    displayLabel = videoId;
                }
            }

            currentVideoId = videoId;
            currentVideoLabel = displayLabel;
            currentSegments = [];
            currentSegmentIndex = 0;
            autoAdvanceEnabled = true;
            expertQuestions = {};
            pendingSegmentIndices = [];
            isLoadingVideo = true;
            
            // Load any saved LLM edits for this video
            loadLLMEdits(videoId);

            setVideoCardState(videoId, 'loading');

            maxAvailableStep = 1;
            updateStepAccess();
            showStep(1);

            resetReviewPanel();
            updateReviewButtonState();

            const timeline = document.getElementById('timeline-annotations');
            if (timeline) {
                timeline.style.display = 'none';
                timeline.innerHTML = '';
            }

            const overlay = document.getElementById('pause-overlay');
            if (overlay) {
                overlay.classList.remove('active');
            }
            resetExpertForm();

            const segmentInfo = document.getElementById('segment-info');
            if (segmentInfo) {
                segmentInfo.style.display = 'none';
            }

            const approveSection = document.getElementById('approve-section');
            if (approveSection) {
                approveSection.style.display = 'none';
            }

            const expertPanel = document.getElementById('expert-questions');
            if (expertPanel) {
                expertPanel.innerHTML = '';
                renderExpertInfoMessage(expertPanel, 'Loading video...');
            }

            const progressText = document.getElementById('progress-text');
            if (progressText) {
                progressText.textContent = 'Loading segments...';
            }

            const progressSubtext = document.getElementById('progress-subtext');
            if (progressSubtext) {
                progressSubtext.textContent = 'Loading segment details...';
            }

            const progressFill = document.getElementById('progress-fill');
            if (progressFill) {
                progressFill.style.width = '0%';
            }

            const progressChip = document.getElementById('progress-chip');
            if (progressChip) {
                progressChip.textContent = '0%';
            }

            let loadSucceeded = false;

            try {
                await loadVideoPlayer(resolvedVideoId);
                await loadSegments(videoId);
                await loadExpertQuestionFiles(videoId);

                currentSegmentIndex = findNextIncompleteSegmentIndex(0);
                updateTimelinePausePoints();
                const nextSegment = currentSegments[currentSegmentIndex] || null;
                updateExpertQuestionsPanel(nextSegment);

                loadSucceeded = true;
            } catch (error) {
                const container = document.getElementById('video-container');
                if (container) {
                    container.innerHTML = '<div class="video-loading">Unable to load this video.</div>';
                }
            } finally {
                resetReviewPanel();
                updateReviewButtonState();
                updateProgress();
                if (loadSucceeded) {
                    unlockStep(2);
                }
                isLoadingVideo = false;
                setVideoCardState(videoId, loadSucceeded ? 'selected' : 'idle');
            }
        }

        async function loadVideoPlayer(videoId) {
            const container = document.getElementById('video-container');
            if (!container) {
                return;
            }

            stopVideoTimePolling();
            await ensureYouTubePlayer(videoId);
            if (!videoElement) {
                videoElement = document.getElementById('youtube-player');
            }

            updateManualQuestionButtonState();

            const timeline = document.getElementById('timeline-annotations');
            if (timeline) {
                timeline.style.display = 'block';
            }

            onVideoLoaded();
        }
        
        async function loadSegments(videoId) {
            try {
                // Try multiple approaches to find question files
                await loadFromQuestionFiles(videoId);
            } catch (error) {
                console.error('Failed to load segments:', error);
                currentSegments = [];
                showStatus('Failed to load question segments', 'error');
            }

            createTimelinePausePoints();
        }

        async function loadExpertQuestionFiles(videoId) {
            expertQuestions = {};

            if (!videoId) {
                return;
            }

            try {
                const response = await fetch(`/api/expert-questions/${videoId}`);
                if (!response.ok) {
                    return;
                }

                const data = await response.json();
                if (!data || !data.success || !Array.isArray(data.questions)) {
                    return;
                }

                data.questions.forEach(entry => {
                    if (!entry) {
                        return;
                    }

                    const segmentStart = entry.segment_start ?? entry.segmentStart ?? 0;
                    const segmentEnd = entry.segment_end ?? entry.segmentEnd ?? 0;

                    const normalized = {
                        videoId: data.video_id || data.videoId || videoId,
                        segmentStart,
                        segmentEnd,
                        timestamp: entry.timestamp ?? segmentEnd,
                        questionType: normalizeQuestionType(entry.question_type ?? entry.questionType),
                        question: entry.question || '',
                        answer: entry.answer || '',
                        updatedAt: entry.updated_at ?? entry.updatedAt ?? null
                    };

                    const isSkipped = Boolean(entry.skipped ?? entry.skip);
                    normalized.skipped = isSkipped;
                    normalized.skipReason = entry.skip_reason ?? entry.skipReason ?? '';

                    setExpertQuestionForSegment({ start: segmentStart, end: segmentEnd }, normalized);
                });
            } catch (error) {
                console.warn('Unable to load expert questions for video', videoId, error);
            }
        }

        
        async function loadFromQuestionFiles(videoId) {
            try {
                // Simple approach - look for video_id.json file
                const filename = `${videoId}.json`;
                
                const response = await fetch(`/downloads/${videoId}/questions/${filename}`);
                
                if (response.ok) {
                    const data = await response.json();
                    console.log(`Successfully loaded data from ${filename}:`, data);
                    
                    // Check for segments array
                    if (data.segments && Array.isArray(data.segments) && data.segments.length > 0) {
                        currentSegments = data.segments;
                        console.log('Successfully loaded segments:', currentSegments);
                        return;
                    } else {
                        console.log(`File ${filename} doesn't have segments array or it's empty`);
                    }
                } else {
                    console.log(`Failed to fetch ${filename}: ${response.status}`);
                }
                
                // If video_id.json not found, try individual question files
                console.log('No video_id.json file found, trying individual files');
                await loadFromIndividualQuestionFiles(videoId);
                
            } catch (error) {
                console.error('Error in loadFromQuestionFiles:', error);
                currentSegments = [];
            }
        }
        
        async function loadFromIndividualQuestionFiles(videoId) {
            try {
                // Try to find individual question files like questions_00000-00060.json
                const segments = [];
                
                // Try common time intervals
                const commonIntervals = [
                    { start: 0, end: 59 },
                    { start: 60, end: 119 }, 
                    { start: 120, end: 179 },
                    { start: 180, end: 239 },
                    { start: 240, end: 299 },
                    { start: 300, end: 359 }
                ];
                
                for (const interval of commonIntervals) {
                    const filename = `questions_${String(interval.start).padStart(5, '0')}-${String(interval.end).padStart(5, '0')}.json`;
                    try {
                        const response = await fetch(`/downloads/${videoId}/questions/${filename}`);
                        if (response.ok) {
                            const data = await response.json();
                            segments.push({
                                start: interval.start,
                                end: interval.end,
                                result: data
                            });
                        }
                    } catch (e) {
                        continue;
                    }
                }
                
                if (segments.length > 0) {
                    currentSegments = segments;
                    return;
                }
                
                // Final fallback - no questions found
                currentSegments = [];
                
            } catch (error) {
                console.error('Error loading individual question files:', error);
                currentSegments = [];
            }
        }
        
        function onVideoLoaded() {
            updateTimeDisplay();
            createTimelinePausePoints();

            if (hasActivePlayer()) {
                playVideo();
            }

            const segmentInfo = document.getElementById('segment-info');
            if (segmentInfo) {
                segmentInfo.style.display = 'none';
            }

            const approveSection = document.getElementById('approve-section');
            if (approveSection) {
                approveSection.style.display = 'none';
            }

            const expertPanel = document.getElementById('expert-questions');
            if (expertPanel) {
                expertPanel.innerHTML = '';
                renderExpertInfoMessage(expertPanel, 'Video playing... Expert review will pause at segment endpoints.');
            }
        }
        
        function onVideoTimeUpdate() {
            updateTimeDisplay();
            checkForPausePoints();
        }
        
        function onVideoPlay() {
            document.getElementById('play-pause-btn').textContent = 'Pause';
            isVideoPaused = false;
        }
        
        function onVideoPause() {
            document.getElementById('play-pause-btn').textContent = 'Play';
            isVideoPaused = true;
        }
        
        function checkForPausePoints() {
            if (!hasActivePlayer() || !autoAdvanceEnabled || currentSegments.length === 0) return;

            const currentTime = getVideoCurrentTime();
            const overlayActive = document.getElementById('pause-overlay').classList.contains('active');

            for (let index = 0; index < currentSegments.length; index++) {
                const segment = currentSegments[index];
                if (!segment || hasExpertDecision(segment)) {
                    continue;
                }

                const endTime = Number(segment.end ?? 0);
                if (!Number.isFinite(endTime) || endTime <= 0) {
                    continue;
                }

                if (currentTime >= (endTime - REVIEW_TOLERANCE_BEFORE)) {
                    if (!pendingSegmentIndices.includes(index)) {
                        pendingSegmentIndices.push(index);
                        pendingSegmentIndices.sort((a, b) => a - b);
                    }
                }

                if (currentTime < (endTime - REVIEW_TOLERANCE_BEFORE)) {
                    break;
                }
            }

            if (!overlayActive && pendingSegmentIndices.length > 0) {
                const nextIndex = pendingSegmentIndices.shift();
                pauseForReview(nextIndex);
            }
        }
        
        
        function pauseForReview(targetIndex = currentSegmentIndex) {
            if (!hasActivePlayer() || targetIndex < 0 || targetIndex >= currentSegments.length) {
                return;
            }

            currentSegmentIndex = targetIndex;

            const currentSegment = currentSegments[currentSegmentIndex];
            if (!currentSegment) {
                return;
            }

            pauseVideo();
            const targetTime = Number(currentSegment.end ?? getVideoCurrentTime());
            if (!Number.isNaN(targetTime) && targetTime >= 0) {
                const duration = getVideoDuration() || targetTime;
                setVideoCurrentTime(Math.min(targetTime, duration));
            }

            autoAdvanceEnabled = false;

            showPauseOverlay(currentSegment);
            loadCurrentSegmentData();
            updateTimelinePausePoints();
            updateProgress();
        }

        
        function loadCurrentSegmentData() {
            const segment = currentSegments[currentSegmentIndex];
            if (!segment) {
                updateExpertQuestionsPanel(null);
                return;
            }

            const segmentInfo = document.getElementById('segment-info');
            if (segmentInfo) {
                segmentInfo.style.display = 'block';
            }

            const timeText = `${formatTime(segment.start)} - ${formatTime(segment.end)}`;
            const duration = Math.max(0, segment.end - segment.start);

            const timeEl = document.getElementById('segment-time');
            if (timeEl) {
                timeEl.textContent = timeText;
            }

            const segmentIndexEl = document.getElementById('segment-index-pill');
            if (segmentIndexEl) {
                segmentIndexEl.textContent = `Segment ${currentSegmentIndex + 1}`;
            }

            const durationEl = document.getElementById('segment-duration');
            if (durationEl) {
                durationEl.textContent = formatDuration(duration);
            }

            const nextPauseEl = document.getElementById('segment-next-pause');
            if (nextPauseEl) {
                nextPauseEl.textContent = formatTime(segment.end);
            }

            loadAIQuestionsForSegment(segment);

            const approveSection = document.getElementById('approve-section');
            if (approveSection) {
                approveSection.style.display = 'block';
            }

            updateManualQuestionButtonState();
        }
        
        async function loadAIQuestionsForSegment(segment) {
            updateExpertQuestionsPanel(segment);
        }
        
        function createTimelinePausePoints() {
            const timelineContainer = document.getElementById('timeline-annotations');
            timelineContainer.innerHTML = '';

            if (!hasActivePlayer() || currentSegments.length === 0) return;

            const videoDuration = getVideoDuration() || 600;

            currentSegments.forEach((segment, index) => {
                const pausePoint = document.createElement('div');
                pausePoint.className = 'timeline-pause-point';
                pausePoint.id = `timeline-point-${index}`;

                const leftPercent = (segment.end / videoDuration) * 100;
                pausePoint.style.left = leftPercent + '%';

                if (hasExpertDecision(segment)) {
                    pausePoint.classList.add('completed');
                } else if (index === currentSegmentIndex) {
                    pausePoint.classList.add('current');
                }

                pausePoint.title = `Segment ${index + 1}: ${formatTime(segment.start)}`;

                timelineContainer.appendChild(pausePoint);
            });
        }
        
        function updateTimelinePausePoints() {
            currentSegments.forEach((segment, index) => {
                const pausePoint = document.getElementById(`timeline-point-${index}`);
                if (!pausePoint) return;

                pausePoint.classList.remove('completed', 'current');

                if (hasExpertDecision(segment)) {
                    pausePoint.classList.add('completed');
                } else if (index === currentSegmentIndex) {
                    pausePoint.classList.add('current');
                }
            });
        }
        
        function approveAndContinue(message = null, statusType = 'success') {
            const currentSegment = currentSegments[currentSegmentIndex];

            if (currentSegment && !hasExpertDecision(currentSegment)) {
                const warning = 'Please add an expert question or mark the segment as skipped before continuing.';
                setExpertFormFeedback(warning);
                return;
            }

            clearCurrentQuestions();
            hidePauseOverlay();

            const segmentInfo = document.getElementById('segment-info');
            if (segmentInfo) {
                segmentInfo.style.display = 'none';
            }

            const approveSection = document.getElementById('approve-section');
            if (approveSection) {
                approveSection.style.display = 'none';
            }

            pendingSegmentIndices = pendingSegmentIndices.filter(index => index !== currentSegmentIndex);

            const processedIndex = currentSegmentIndex;
            const nextQueuedIndex = pendingSegmentIndices.length > 0 ? pendingSegmentIndices.shift() : null;

            if (nextQueuedIndex !== null && nextQueuedIndex !== undefined) {
                pauseForReview(nextQueuedIndex);
                return;
            }

            const nextIndex = findNextIncompleteSegmentIndex(processedIndex + 1);
            currentSegmentIndex = nextIndex;

            updateTimelinePausePoints();
            updateProgress();

            if (nextIndex >= currentSegments.length) {
                autoAdvanceEnabled = false;
                updateExpertQuestionsPanel(null);
                return;
            }

            autoAdvanceEnabled = true;

            const nextSegment = currentSegments[currentSegmentIndex] || null;
            updateExpertQuestionsPanel(nextSegment);

            if (hasActivePlayer() && nextSegment) {
                const nextStart = Number(nextSegment.start ?? 0);
                if (!Number.isNaN(nextStart) && nextStart >= 0) {
                    setVideoCurrentTime(Math.max(nextStart, 0));
                }
                playVideo();
            }
        }
        
        function clearCurrentQuestions() {
            const container = document.getElementById('expert-questions');
            if (!container) {
                return;
            }

            container.innerHTML = '';
            renderExpertInfoMessage(container, 'Continuing playback...');
        }
        
        function skipSegment() {
            return handleExpertSkip();
        }
        
        function showPauseOverlay(segment) {
            const overlay = document.getElementById('pause-overlay');
            if (!overlay) {
                return;
            }

            const segmentNumberEl = document.getElementById('expert-segment-number');
            if (segmentNumberEl) {
                segmentNumberEl.textContent = (currentSegmentIndex + 1).toString();
            }

            const segmentTimeEl = document.getElementById('expert-segment-time');
            if (segmentTimeEl) {
                segmentTimeEl.textContent = `${formatTime(segment.start)} - ${formatTime(segment.end)}`;
            }

            const pauseTimestampEl = document.getElementById('expert-pause-timestamp');
            if (pauseTimestampEl) {
                pauseTimestampEl.textContent = formatTime(segment.end);
            }

            populateExpertForm(segment);

            overlay.classList.add('active');
        }

        function hidePauseOverlay() {
            const overlay = document.getElementById('pause-overlay');
            if (overlay) {
                overlay.classList.remove('active');
            }
            resetExpertForm();
        }
        
        function togglePlayPause() {
            if (!hasActivePlayer()) return;
            
            if (isPlaybackPaused()) {
                playVideo();
            } else {
                pauseVideo();
            }
        }
        
        function jumpToSegment(direction) {
            const newIndex = currentSegmentIndex + direction;

            if (newIndex >= 0 && newIndex < currentSegments.length) {
                currentSegmentIndex = newIndex;

                const segment = currentSegments[currentSegmentIndex];
                if (hasActivePlayer() && segment) {
                    const nextStart = Number(segment.start ?? 0);
                    setVideoCurrentTime(Math.max(nextStart, 0));
                }

                autoAdvanceEnabled = true;
                hidePauseOverlay();
                updateProgress();
                updateTimelinePausePoints();
                updateExpertQuestionsPanel(currentSegments[currentSegmentIndex]);
            }
        }

        
        function seekVideo(seconds) {
            if (!hasActivePlayer()) return;
            setVideoCurrentTime(getVideoCurrentTime() + seconds);
        }
        
        function updateTimeDisplay() {
            if (!hasActivePlayer()) return;
            
            const current = formatTime(getVideoCurrentTime());
            const duration = formatTime(getVideoDuration() || 0);
            document.getElementById('time-display').textContent = `${current} / ${duration}`;
        }
        
        function updateProgress() {
            const progressText = document.getElementById('progress-text');
            const progressFill = document.getElementById('progress-fill');
            const progressSubtext = document.getElementById('progress-subtext');
            const progressChip = document.getElementById('progress-chip');

            if (!progressText || !progressFill) {
                return;
            }

            if (!currentSegments.length) {
                progressText.textContent = 'No segments available';
                if (progressSubtext) {
                    progressSubtext.textContent = 'Select a video to load segment data.';
                }
                if (progressChip) {
                    progressChip.textContent = '0%';
                }
                progressFill.style.width = '0%';
                return;
            }

            const total = currentSegments.length;
            const completed = currentSegments.reduce((count, segment) => count + (hasExpertDecision(segment) ? 1 : 0), 0);

            if (completed >= total) {
                progressText.textContent = `All ${total} segments reviewed`;
            } else {
                progressText.textContent = completed === 0
                    ? `Start with segment 1 of ${total}`
                    : `Segment ${completed + 1} of ${total} ready for review`;
            }

            const percent = Math.min(100, Math.max(0, (completed / total) * 100));
            progressFill.style.width = `${percent}%`;

            if (progressChip) {
                progressChip.textContent = `${Math.round(percent)}%`;
            }

            if (progressSubtext) {
                progressSubtext.textContent = `Reviewed ${completed} of ${total} segments`;
            }
        }

        function showStatus(message, type) {
            const containers = [
                document.getElementById('global-status-messages'),
                document.getElementById('status-messages')
            ].filter(Boolean);

            if (containers.length === 0) {
                return;
            }

            containers.forEach(container => {
                const statusDiv = document.createElement('div');
                statusDiv.className = `status-message status-${type}`;
                statusDiv.textContent = message;
                container.appendChild(statusDiv);

                setTimeout(() => {
                    if (statusDiv.parentNode) {
                        statusDiv.parentNode.removeChild(statusDiv);
                    }
                }, 5000);
            });
        }
        
        function openAddQuestionModal() {
            if (!hasActivePlayer() || !currentVideoId) {
                return;
            }
            if (!videoElement) {
                return;
            }

            // Pause the video and remember its state
            const wasPlaying = !isPlaybackPaused();
            pauseVideo();
            
            // Store whether video was playing before modal opened
            videoElement.dataset.wasPlaying = wasPlaying ? 'true' : 'false';
            
            // Store the current timestamp
            manualQuestionTimestamp = getVideoCurrentTime();
            
            // Update modal display
            const modal = document.getElementById('add-question-modal');
            const timestampInput = document.getElementById('manual-timestamp');
            
            if (timestampInput) {
                // Set the input value in time format (MM:SS or HH:MM:SS)
                timestampInput.value = formatSecondsToTimeString(manualQuestionTimestamp);
                
                // Add event listener for timestamp changes
                timestampInput.oninput = function() {
                    // Validate and update timestamp as user types
                    const seconds = parseTimeToSeconds(this.value);
                    manualQuestionTimestamp = seconds;
                };
            }
            
            // Reset form
            const form = document.getElementById('manual-question-form');
            if (form) {
                form.reset();
                // Restore the timestamp after reset
                if (timestampInput) {
                    timestampInput.value = formatSecondsToTimeString(manualQuestionTimestamp);
                }
            }
            
            // Clear feedback
            const feedback = document.getElementById('manual-form-feedback');
            if (feedback) {
                feedback.textContent = '';
            }
            
            // Show modal
            if (modal) {
                modal.classList.add('active');
            }
        }
        
        function closeAddQuestionModal() {
            const modal = document.getElementById('add-question-modal');
            if (modal) {
                modal.classList.remove('active');
            }
            
            // Resume video if it was playing before modal opened
            if (videoElement && videoElement.dataset.wasPlaying === 'true') {
                playVideo();
                delete videoElement.dataset.wasPlaying;
            }
            
            // Clear the stored timestamp
            manualQuestionTimestamp = null;
        }
        
        async function handleManualQuestionSubmit(event) {
            event.preventDefault();
            
            if (expertSaveInProgress) {
                return;
            }
            
            if (!currentVideoId) {
                setManualFormFeedback('Invalid state. Please try again.');
                return;
            }
            
            const timestampInput = document.getElementById('manual-timestamp');
            const typeSelect = document.getElementById('manual-question-type');
            const questionInput = document.getElementById('manual-question-text');
            const answerInput = document.getElementById('manual-answer-text');
            
            // Parse the timestamp from the time format input
            const timestampStr = timestampInput ? timestampInput.value.trim() : '';
            const timestamp = parseTimeToSeconds(timestampStr);
            
            const questionType = normalizeQuestionType(typeSelect ? typeSelect.value.trim() : '');
            const question = questionInput ? questionInput.value.trim() : '';
            const answer = answerInput ? answerInput.value.trim() : '';
            
            // Validate timestamp format
            if (!timestampStr || timestampStr === '') {
                setManualFormFeedback('Please enter a timestamp (e.g., 6:06 or 1:30:45).');
                timestampInput.focus();
                return;
            }
            
            // Validate timestamp is a valid time format
            if (!timestampStr.match(/^(?:(?:([0-9]+):)?([0-5]?[0-9]):)?([0-5]?[0-9])$/)) {
                setManualFormFeedback('Please enter a valid time format (MM:SS or HH:MM:SS).');
                timestampInput.focus();
                return;
            }
            
            // Validate timestamp is within video duration
            const videoDuration = getVideoDuration();
            if (timestamp < 0 || (videoDuration && timestamp > videoDuration)) {
                setManualFormFeedback(`Please enter a timestamp within the video duration (0:00 - ${formatSecondsToTimeString(videoDuration || 0)}).`);
                timestampInput.focus();
                return;
            }
            
            // Validate all fields are filled
            if (!questionType || questionType === '') {
                setManualFormFeedback('Please select a question type.');
                typeSelect.focus();
                return;
            }
            
            if (!question || question === '') {
                setManualFormFeedback('Please enter a question.');
                questionInput.focus();
                return;
            }
            
            if (!answer || answer === '') {
                setManualFormFeedback('Please enter an answer.');
                answerInput.focus();
                return;
            }
            
            expertSaveInProgress = true;
            toggleManualFormState(true);
            setManualFormFeedback('Saving question...', 'success');
            
            // For manual questions, segmentStart and segmentEnd are the same as timestamp
            const segmentStart = timestamp;
            const segmentEnd = timestamp;
            
            const payload = {
                videoId: currentVideoId,
                segmentStart: segmentStart,
                segmentEnd: segmentEnd,
                timestamp: timestamp,
                questionType,
                question,
                answer,
                isManual: true // Flag to indicate this is a manually added question
            };
            
            try {
                const response = await fetch('/api/expert-questions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                
                const data = await response.json();
                
                if (!response.ok || !data.success) {
                    const errorMessage = data && data.message ? data.message : 'Failed to save question.';
                    throw new Error(errorMessage);
                }
                
                // Create a virtual segment for display
                const manualSegment = {
                    start: segmentStart,
                    end: segmentEnd,
                    isManual: true
                };
                
                setExpertQuestionForSegment(manualSegment, {
                    videoId: currentVideoId,
                    segmentStart: segmentStart,
                    segmentEnd: segmentEnd,
                    timestamp: timestamp,
                    questionType,
                    question,
                    answer,
                    isManual: true,
                    skipReason: '',
                    updatedAt: data.updatedAt || new Date().toISOString()
                });
                
                // Refresh the expert questions panel
                updateExpertQuestionsPanel(currentSegments[currentSegmentIndex]);
                
                closeAddQuestionModal();
                
            } catch (error) {
                console.error('Failed to save manual question:', error);
                setManualFormFeedback(error.message || 'Failed to save question.');
            } finally {
                expertSaveInProgress = false;
                toggleManualFormState(false);
            }
        }
        
        function setManualFormFeedback(message, type = 'error') {
            const feedback = document.getElementById('manual-form-feedback');
            if (!feedback) {
                return;
            }
            
            feedback.textContent = message || '';
            feedback.classList.remove('success');
            
            if (message && type === 'success') {
                feedback.classList.add('success');
            }
        }
        
        function toggleManualFormState(disabled) {
            const form = document.getElementById('manual-question-form');
            if (!form) {
                return;
            }
            
            Array.from(form.elements).forEach(element => {
                if (element.tagName === 'BUTTON' && element.type === 'button') {
                    // Don't disable the cancel button
                    return;
                }
                element.disabled = disabled;
            });
        }

        function formatTime(seconds) {
            if (!seconds || isNaN(seconds)) return '00:00';
            
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        
        function formatDuration(seconds) {
            if (!seconds) return '0:00';
            
            const hours = Math.floor(seconds / 3600);
            const mins = Math.floor((seconds % 3600) / 60);
            const secs = Math.floor(seconds % 60);
            
            if (hours > 0) {
                return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            } else {
                return `${mins}:${secs.toString().padStart(2, '0')}`;
            }
        }
        
        // Helper function to parse time string (MM:SS or HH:MM:SS) to seconds
        function parseTimeToSeconds(timeStr) {
            if (!timeStr) return 0;
            
            // Clean the input
            timeStr = timeStr.trim();
            
            // Match formats like: 6:06, 06:06, 1:06:06
            const parts = timeStr.split(':').map(part => parseInt(part, 10) || 0);
            
            if (parts.length === 1) {
                // Just seconds
                return parts[0];
            } else if (parts.length === 2) {
                // MM:SS
                return parts[0] * 60 + parts[1];
            } else if (parts.length === 3) {
                // HH:MM:SS
                return parts[0] * 3600 + parts[1] * 60 + parts[2];
            }
            
            return 0;
        }
        
        // Helper function to format seconds to time string for display
        function formatSecondsToTimeString(seconds) {
            if (!seconds || isNaN(seconds)) return '0:00';
            
            seconds = Math.floor(seconds);
            const hours = Math.floor(seconds / 3600);
            const mins = Math.floor((seconds % 3600) / 60);
            const secs = Math.floor(seconds % 60);
            
            if (hours > 0) {
                return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            } else {
                return `${mins}:${secs.toString().padStart(2, '0')}`;
            }
        }
        function renderQuestion(question) {

    if (!question) {
        return `<div class="question-empty">No question available</div>`;
    }

    return `
        <div class="editable-question">

            <div class="question-type-label">
                ${question.type || ""}
            </div>

            <div class="question-preview">
                ${question.text || question.question || ""}
            </div>

            <div class="answer-preview">
                ${question.answer || ""}
            </div>

        </div>
    `;
}
    
