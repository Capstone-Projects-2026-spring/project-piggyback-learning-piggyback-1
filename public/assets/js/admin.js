


        let expertDashboardLoaded = false;
        let childrenDashboardLoaded = false;
        let adminExperts = [];
        let adminAssignments = [];
        let adminChildren = [];
        let currentStep = 1;
        let currentVideoId = null;
        let generatedQuestions = [];
        let segmentCount = 0;
        let existingDownloads = [];
        let currentVideoMeta = null;
        let currentVideoHasFrames = false;
        const CHILD_ICON_EMOJI = {
            simba:       '🦁',
            nemo:        '🐠',
            walle:       '🤖',
            moana:       '👸',
            elsa:        '❄️',
            spiderman:   '🕷️',
            mickey:      '🐭',
            pooh:        '🧸',
            chase:       '🐾',
            spongebob:   '🧽',
            turtle:      '🐢',
            bluey:       '🦸',
            hellokitty:  '🐱',
            mlp:         '🧁',
            peppa:       '🌟',
            mario:       '🎮',
            dino:        '🦕',
        };
        const CHILD_ICON_NAME = {
            simba:       'Simba',
            nemo:        'Nemo & Dory',
            walle:       'WALL-E',
            moana:       'Moana',
            elsa:        'Elsa & Anna',
            spiderman:   'Spider-Man',
            mickey:      'Mickey Mouse',
            pooh:        'Winnie the Pooh',
            chase:       'Chase (PAW Patrol)',
            spongebob:   'SpongeBob',
            turtle:      'Ninja Turtles',
            bluey:       'Bluey & Bingo',
            hellokitty:  'Hello Kitty',
            mlp:         'My Little Pony',
            peppa:       'Peppa Pig',
            mario:       'Mario & Luigi',
            dino:        'Dino (Cocomelon)',
        };
        
        // Initialize
        document.addEventListener('DOMContentLoaded', function() {
            updateStepDisplay();
            bindEventListeners();
            initStepOneTabs();
            loadExistingDownloads();
            initAdminTabs();
        });
        
        function bindEventListeners() {
            // Download functionality
            document.getElementById('download-form').addEventListener('submit', handleDirectDownload);
            
            // Step navigation
            document.getElementById('next-step-btn').addEventListener('click', nextStep);
            document.getElementById('prev-step-btn').addEventListener('click', prevStep);
            
            // Frame extraction
            document.getElementById('extract-frames-btn').addEventListener('click', extractFrames);
            
            // Question generation
            document.getElementById('generate-questions-btn').addEventListener('click', generateQuestions);

            const existingSelect = document.getElementById('existing-download-select');
            if (existingSelect) {
                existingSelect.addEventListener('change', handleExistingDownloadChange);
            }
            const useExistingBtn = document.getElementById('use-existing-download-btn');
            if (useExistingBtn) {
                useExistingBtn.addEventListener('click', useExistingDownload);
            }
            const refreshExistingBtn = document.getElementById('refresh-existing-downloads-btn');
            if (refreshExistingBtn) {
                refreshExistingBtn.addEventListener('click', () => loadExistingDownloads(true));
            }

            //wire form submit + refresh button
            const createExpertForm = document.getElementById('create-expert-form');
            if (createExpertForm) {
                createExpertForm.addEventListener('submit', handleCreateExpert);
            }

            const refreshAssignmentsBtn = document.getElementById('refresh-assignments-btn');
            if (refreshAssignmentsBtn) {
                refreshAssignmentsBtn.addEventListener('click', () => loadExpertDashboard(true));
            }

            const createChildForm = document.getElementById('create-child-form');
            if (createChildForm) {
                createChildForm.addEventListener('submit', handleCreateChild);
            }

            const refreshChildrenBtn = document.getElementById('refresh-children-btn');
            if (refreshChildrenBtn) {
                refreshChildrenBtn.addEventListener('click', () => loadChildrenDashboard(true));
            }

            const childrenFilterExpert = document.getElementById('children-filter-expert');
            if (childrenFilterExpert) {
                childrenFilterExpert.addEventListener('change', () => loadChildrenDashboard(false));
            }

            const includeInactive = document.getElementById('children-include-inactive');
            if (includeInactive) {
                includeInactive.addEventListener('change', () => loadChildrenDashboard(false));
            }

        }
        
        function updateStepDisplay() {
            // Update progress indicators
            document.querySelectorAll('.step').forEach((step, index) => {
                const stepNum = index + 1;
                step.classList.remove('active', 'completed');
                if (stepNum < currentStep) {
                    step.classList.add('completed');
                } else if (stepNum === currentStep) {
                    step.classList.add('active');
                }
            });
            
            document.querySelectorAll('.step-label').forEach((label, index) => {
                const stepNum = index + 1;
                label.classList.remove('active', 'completed');
                if (stepNum < currentStep) {
                    label.classList.add('completed');
                } else if (stepNum === currentStep) {
                    label.classList.add('active');
                }
            });
            
            // Show/hide step content
            document.querySelectorAll('.step-content').forEach((content, index) => {
                content.classList.remove('active');
                if (index + 1 === currentStep) {
                    content.classList.add('active');
                }
            });
            
            // Update navigation buttons
            const prevBtn = document.getElementById('prev-step-btn');
            const nextBtn = document.getElementById('next-step-btn');
            
            prevBtn.style.display = currentStep > 1 ? 'block' : 'none';
            nextBtn.style.display = currentStep < 3 ? 'block' : 'none';
            
            // Update button states based on completion
            updateButtonStates();
        }
        
        function updateButtonStates() {
            const extractBtn = document.getElementById('extract-frames-btn');
            const generateBtn = document.getElementById('generate-questions-btn');
            
            if (extractBtn) {
                extractBtn.disabled = !currentVideoId;
            }
            
            if (generateBtn) {
                generateBtn.disabled = !(currentVideoId && currentVideoHasFrames);
            }

            updateVideoInfoPanel();
        }
        
        function nextStep() {
            if (currentStep < 3) {
                currentStep++;
                updateStepDisplay();
            }
        }
        
        function prevStep() {
            if (currentStep > 1) {
                currentStep--;
                updateStepDisplay();
            }
        }

        function formatHumanDuration(seconds) {
            if (seconds === undefined || seconds === null) {
                return null;
            }
            const total = Math.max(0, Math.round(Number(seconds) || 0));
            const hours = Math.floor(total / 3600);
            const minutes = Math.floor((total % 3600) / 60);
            const secs = total % 60;
            if (hours > 0) {
                return `${hours}h ${minutes}m`;
            }
            if (minutes > 0) {
                return `${minutes}m ${secs.toString().padStart(2, '0')}s`;
            }
            return `${secs}s`;
        }

        function initStepOneTabs() {
            const tabWrapper = document.querySelector('.step-tabs');
            if (!tabWrapper) return;
            const buttons = tabWrapper.querySelectorAll('.tab-button');
            const panels = tabWrapper.querySelectorAll('.tab-panel');
            buttons.forEach((button) => {
                button.addEventListener('click', () => {
                    const targetId = button.getAttribute('data-tab-target');
                    buttons.forEach((btn) => btn.classList.remove('active'));
                    button.classList.add('active');
                    panels.forEach((panel) => {
                        if (panel.id === targetId) {
                            panel.classList.add('active');
                        } else {
                            panel.classList.remove('active');
                        }
                    });
                });
            });
        }

        async function loadExistingDownloads(showToast = false) {
            const selectEl = document.getElementById('existing-download-select');
            const statusEl = document.getElementById('existing-download-status');
            const loadingEl = document.getElementById('existing-download-loading');
            if (!selectEl) return;

            if (loadingEl) {
                loadingEl.style.display = 'flex';
            }
            if (statusEl && !showToast) {
                statusEl.style.display = 'none';
            }

            try {
                const response = await fetch('/api/admin/videos?include_without_frames=true');
                const data = await response.json();
                if (!data.success) {
                    throw new Error(data.message || 'Unable to load downloads');
                }
                existingDownloads = data.videos || [];
                selectEl.innerHTML = '';
                const placeholder = document.createElement('option');
                placeholder.value = '';
                placeholder.textContent = existingDownloads.length
                    ? 'Select a downloaded video...'
                    : 'No downloaded videos found yet';
                placeholder.disabled = !existingDownloads.length;
                placeholder.selected = true;
                selectEl.appendChild(placeholder);

                existingDownloads.forEach((video) => {
                    const option = document.createElement('option');
                    const durationLabel = video.duration_formatted ? ` (${video.duration_formatted})` : '';
                    const framesLabel = video.has_frames ? ' • frames ready' : ' • frames missing';
                    option.value = video.video_id;
                    option.textContent = `${video.title || video.video_id}${durationLabel}${framesLabel}`;
                    selectEl.appendChild(option);
                });

                const useBtn = document.getElementById('use-existing-download-btn');
                if (useBtn) {
                    useBtn.disabled = true;
                }
                renderExistingDownloadInfo(null);

                if (statusEl) {
                    if (!existingDownloads.length || showToast) {
                        statusEl.style.display = 'block';
                        statusEl.className = 'status-message status-info';
                        statusEl.textContent = existingDownloads.length
                            ? 'Download list refreshed.'
                            : 'No downloads found yet. Use the direct URL option first.';
                    } else {
                        statusEl.style.display = 'none';
                    }
                }
            } catch (error) {
                if (statusEl) {
                    statusEl.style.display = 'block';
                    statusEl.className = 'status-message status-error';
                    statusEl.textContent = `Unable to load downloads: ${error.message}`;
                }
            } finally {
                if (loadingEl) {
                    loadingEl.style.display = 'none';
                }
            }
        }

        function handleExistingDownloadChange() {
            const selectEl = document.getElementById('existing-download-select');
            if (!selectEl) return;
            const selected = existingDownloads.find(video => video.video_id === selectEl.value);
            const useBtn = document.getElementById('use-existing-download-btn');
            if (useBtn) {
                useBtn.disabled = !selected;
            }
            renderExistingDownloadInfo(selected || null);
        }

        function renderExistingDownloadInfo(video) {
            const infoEl = document.getElementById('existing-download-info');
            if (!infoEl) return;
            if (!video) {
                infoEl.style.display = 'none';
                infoEl.innerHTML = '';
                return;
            }
            const framesBadge = video.has_frames ? 'badge badge-success' : 'badge badge-warning';
            const questionsBadge = video.has_questions ? 'badge badge-info' : 'badge badge-secondary';
            infoEl.innerHTML = `
                <div class="existing-video-title">${video.title || video.video_id}</div>
                <div class="existing-video-meta">
                    <span>ID: ${video.video_id}</span>
                    ${video.duration_formatted ? `<span>Duration: ${video.duration_formatted}</span>` : ''}
                </div>
                <div class="existing-video-flags">
                    <span class="${framesBadge}">${video.has_frames ? 'Frames ready' : 'Frames missing (run Step 2)'}</span>
                    <span class="${questionsBadge}">${video.has_questions ? 'Existing questions stored' : 'No saved questions yet'}</span>
                </div>
                ${video.frame_count ? `<div class="existing-video-meta">Frames extracted: ${video.frame_count}</div>` : ''}
            `;
            infoEl.style.display = 'block';
        }
        function initAdminTabs() {
            const tabButtons = document.querySelectorAll('.admin-tab');
            const sections = document.querySelectorAll('.admin-section');

                tabButtons.forEach((btn) => {
                    btn.addEventListener('click', async() => {
                        const targetId = btn.getAttribute('data-target');

                        tabButtons.forEach((b) => b.classList.remove('active'));
                        btn.classList.add('active');

                        sections.forEach((section) => {
                            section.classList.toggle('active', section.id === targetId);
                        });
                        // lazy-load experrt data only when that tab opens
                        if (targetId === 'assign-experts' && !expertDashboardLoaded){
                            await loadExpertDashboard(false);
                        }
                        if (targetId === 'assign-children' && !childrenDashboardLoaded) {
                            await loadChildrenDashboard(false);
                        }
                    });
                });
            }


        function useExistingDownload() {
            const selectEl = document.getElementById('existing-download-select');
            const statusEl = document.getElementById('existing-download-status');
            if (!selectEl) return;

            const video = existingDownloads.find(item => item.video_id === selectEl.value);
            if (!video) {
                if (statusEl) {
                    statusEl.style.display = 'block';
                    statusEl.className = 'status-message status-error';
                    statusEl.textContent = 'Please pick a video from the dropdown.';
                }
                return;
            }

            currentVideoId = video.video_id;
            currentVideoMeta = { ...video };
            currentVideoHasFrames = Boolean(video.has_frames);

            prepareQuestionsUiForNewVideo();
            updateButtonStates();

            if (statusEl) {
                statusEl.style.display = 'block';
                statusEl.className = 'status-message status-success';
                statusEl.textContent = currentVideoHasFrames
                    ? 'Selected video has frames. Jumping to question generation.'
                    : 'Video selected. Please extract frames in Step 2.';
            }

            currentStep = currentVideoHasFrames ? 3 : 2;
            updateStepDisplay();
        }

        function prepareQuestionsUiForNewVideo() {
            generatedQuestions = [];
            segmentCount = 0;

            const resultsTbody = document.getElementById('questions-results-tbody');
            if (resultsTbody) {
                resultsTbody.innerHTML = '';
            }
            const resultsWrapper = document.querySelector('.questions-results');
            if (resultsWrapper) {
                resultsWrapper.style.display = 'none';
            }
            const noResults = document.getElementById('questions-no-results');
            if (noResults) {
                noResults.style.display = 'block';
            }
            const generationDetails = document.getElementById('generation-details');
            if (generationDetails) {
                generationDetails.innerHTML = '';
            }
            const generationStatus = document.getElementById('generation-status');
            if (generationStatus) {
                generationStatus.style.display = 'none';
            }
        }

        function updateVideoInfoPanel() {
            const videoInfo = document.getElementById('video-info');
            const videoIdSpan = document.getElementById('current-video-id');
            if (!videoInfo || !videoIdSpan) return;

            if (!currentVideoId) {
                videoInfo.style.display = 'none';
                return;
            }

            videoInfo.style.display = 'block';
            if (currentVideoMeta && currentVideoMeta.title) {
                videoIdSpan.textContent = `${currentVideoMeta.title} (${currentVideoId})`;
            } else {
                videoIdSpan.textContent = currentVideoId;
            }

            const detailsEl = document.getElementById('current-video-details');
            if (detailsEl) {
                const detailParts = [];
                if (currentVideoMeta && currentVideoMeta.duration_formatted) {
                    detailParts.push(`Duration: ${currentVideoMeta.duration_formatted}`);
                } else if (currentVideoMeta && currentVideoMeta.duration_seconds) {
                    detailParts.push(`Duration: ${formatHumanDuration(currentVideoMeta.duration_seconds)}`);
                }
                if (currentVideoMeta && currentVideoMeta.frame_count) {
                    detailParts.push(`Frames: ${currentVideoMeta.frame_count}`);
                } else if (currentVideoHasFrames) {
                    detailParts.push('Frames detected');
                }
                detailsEl.textContent = detailParts.join(' • ');
            }

            const frameStatus = document.getElementById('current-video-frame-status');
            if (frameStatus) {
                frameStatus.textContent = currentVideoHasFrames ? 'Frames ready' : 'Frames needed';
                frameStatus.className = `badge ${currentVideoHasFrames ? 'badge-success' : 'badge-warning'}`;
            }

            const questionStatus = document.getElementById('current-video-questions-status');
            if (questionStatus) {
                const hasQuestions = Boolean(currentVideoMeta && currentVideoMeta.has_questions);
                questionStatus.textContent = hasQuestions
                    ? 'Existing questions will be overwritten'
                    : 'No saved questions yet';
                questionStatus.className = `badge ${hasQuestions ? 'badge-info' : 'badge-secondary'}`;
            }
        }
        
        async function handleDirectDownload(e) {
            e.preventDefault();
            const url = document.getElementById('youtube_url').value;
            await downloadVideo(url);
        }
        function setAdminPanelStatus(elementId, message, type = 'info') {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.className = `status-message status-${type}`;
    el.textContent = message;
    el.style.display = 'block';
}

async function loadExpertDashboard(showRefreshMessage = false) {
    const res = await fetch('/api/admin/videos/assignments');
    const data = await res.json();

    if (!res.ok || !data.success) {
        throw new Error(data.detail || data.message || 'Failed to load expert dashboard');
    }

    adminExperts = Array.isArray(data.experts) ? data.experts : [];
    adminAssignments = Array.isArray(data.assignments) ? data.assignments : [];
    expertDashboardLoaded = true;

    renderExpertTable();
    renderAssignmentTable();
    renderChildrenExpertOptions();

    if (showRefreshMessage) {
        setAdminPanelStatus('assignment-admin-status', 'Assignments refreshed.', 'success');
    }
}

function renderExpertTable() {
    const tbody = document.getElementById('expert-list-tbody');
    if (!tbody) return;

    const headingEl = document.getElementById('active-experts-heading');
    if (headingEl) headingEl.textContent = `Active Experts (${adminExperts.length})`;

    if (!adminExperts.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#9ca3af;padding:24px;">No experts yet.</td></tr>';
        return;
    }

    tbody.innerHTML = adminExperts.map((expert) => `
        <tr data-expert-id="${expert.expert_id}" data-active="${expert.is_active ? '1' : '0'}">
            <td class="admin-id-cell">${expert.expert_id}</td>
            <td><input type="text" class="admin-inline-input" data-role="name" value="${expert.display_name || ''}" /></td>
            <td><span class="admin-status-badge ${expert.is_active ? 'status-active' : 'status-inactive'}">${expert.is_active ? 'active' : 'inactive'}</span></td>
            <td><input type="password" class="admin-inline-input" data-role="password" placeholder="New password" /></td>
            <td class="admin-actions-cell">
                <button type="button" class="admin-action-btn" data-action="save-expert">💾 Save</button>
                <button type="button" class="admin-action-btn admin-action-danger" data-action="toggle-expert">${expert.is_active ? '👤 Deactivate' : '✅ Activate'}</button>
                <button type="button" class="admin-action-btn admin-action-remove" data-action="remove-expert">🗑 Remove</button>
            </td>
        </tr>
    `).join('');

    tbody.querySelectorAll('[data-action="save-expert"]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            const row = e.currentTarget.closest('tr');
            await handleSaveExpert(row);
        });
    });

    tbody.querySelectorAll('[data-action="toggle-expert"]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            const row = e.currentTarget.closest('tr');
            await handleToggleExpert(row);
        });
    });
    tbody.querySelectorAll('[data-action="remove-expert"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
        const row = e.currentTarget.closest('tr');
        await handleRemoveExpert(row);
    });
});
}

function renderAssignmentTable() {
    const tbody = document.getElementById('assignment-list-tbody');
    if (!tbody) return;

    if (!adminAssignments.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#9ca3af;padding:24px;">No downloaded videos found.</td></tr>';
        return;
    }

    const expertOptions = adminExperts
        .map((expert) => `<option value="${expert.expert_id}">${expert.display_name} (${expert.expert_id})${expert.is_active ? '' : ' [inactive]'}</option>`)
        .join('');

    tbody.innerHTML = adminAssignments.map((row) => {
    const assignedCount = (row.assigned_experts || []).length;
    const chips = (row.assigned_experts || []).map((e) => `
        <span class="admin-chip">
            ${e.expert_name || e.expert_id}
            <button type="button" class="admin-chip-remove"
                data-action="remove-assignment"
                data-video-id="${row.video_id}"
                data-expert-id="${e.expert_id}">×</button>
        </span>
    `).join('');

    return `
        <tr data-video-id="${row.video_id}">
            <td class="admin-video-title">${row.title || '—'}</td>
            <td class="admin-id-cell">${row.video_id}</td>
            <td>${assignedCount > 0
                ? `<details><summary class="admin-expert-count">👁 ${assignedCount} expert(s)</summary><div class="admin-chips">${chips}</div></details>`
                : '<span style="color:#9ca3af;">Unassigned</span>'
            }</td>
            <td>
                <select class="admin-inline-select" data-role="assignment-expert">
                    <option value="">-- select expert --</option>
                    ${expertOptions}
                </select>
            </td>
            <td class="admin-actions-cell">
                <button type="button" class="btn-create btn-create-sm" data-action="add-assignment">+ Add</button>
            </td>
        </tr>
    `;
}).join('');

// Add assignment
    tbody.querySelectorAll('[data-action="add-assignment"]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            const row = e.currentTarget.closest('tr');
            await handleAddAssignment(row);
        });
    });

    // Remove assignment
    tbody.querySelectorAll('[data-action="remove-assignment"]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            const videoId = e.currentTarget.dataset.videoId;
            const expertId = e.currentTarget.dataset.expertId;
            await handleRemoveAssignment(videoId, expertId);
        });
    });

}

async function handleCreateExpert(event) {
    event.preventDefault();

    const expert_id = document.getElementById('new-expert-id').value.trim();
    const display_name = document.getElementById('new-expert-name').value.trim();
    const password = document.getElementById('new-expert-password').value;

    const res = await fetch('/api/admin/experts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expert_id, display_name, password })
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
        throw new Error(data.detail || data.message || 'Failed to create expert');
    }

    event.target.reset();
    setAdminPanelStatus('expert-admin-status', 'Expert created.', 'success');
    await loadExpertDashboard(false);
}

    async function handleSaveExpert(row) {
        const expertId = row.dataset.expertId;
        const displayName = row.querySelector('[data-role="name"]').value.trim();
        const password = row.querySelector('[data-role="password"]').value;

        const payload = { display_name: displayName, is_active: row.dataset.active === '1' };
        if (password) payload.password = password;

        const res = await fetch(`/api/admin/experts/${encodeURIComponent(expertId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
            throw new Error(data.detail || data.message || 'Failed to update expert');
        }

        setAdminPanelStatus('expert-admin-status', 'Expert updated.', 'success');
        await loadExpertDashboard(false);
    }

    async function handleToggleExpert(row) {
        const expertId = row.dataset.expertId;
        const isActive = row.dataset.active === '1';

        let res;
        if (isActive) {
            res = await fetch(`/api/admin/experts/${encodeURIComponent(expertId)}/deactivate`, { method: 'POST' });
        } else {
            res = await fetch(`/api/admin/experts/${encodeURIComponent(expertId)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_active: true })
            });
        }

        const data = await res.json();
        if (!res.ok || !data.success) {
            throw new Error(data.detail || data.message || 'Failed to toggle expert');
        }

        setAdminPanelStatus('expert-admin-status', isActive ? 'Expert deactivated.' : 'Expert activated.', 'success');
        await loadExpertDashboard(false);
    }
    async function handleRemoveExpert(row) {
        const expertId = row.dataset.expertId;
        if (!confirm(`Permanently remove expert "${expertId}"? This cannot be undone.`)) return;
        try {
            const resp = await fetch(`/api/admin/experts/${encodeURIComponent(expertId)}`, { method: 'DELETE' });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || !data.success) {
                throw new Error(data.detail || data.message || 'Failed to remove expert.');
            }

            // Reload from backend so experts table, assignment table, and child expert dropdowns stay in sync.
            await loadExpertDashboard(false);
            if (childrenDashboardLoaded) {
                await loadChildrenDashboard(false);
            }
            setAdminPanelStatus('expert-admin-status', `Expert "${expertId}" deleted.`, 'success');
        } catch (error) {
            setAdminPanelStatus('expert-admin-status', error.message || 'Failed to remove expert.', 'error');
        }
    }
    async function handleAddAssignment(row) {
    const videoId = row.dataset.videoId;
    const select = row.querySelector('select[data-role="assignment-expert"]');
    const expertId = select ? select.value : '';
    if (!expertId) { alert('Select an expert first.'); return; }

    const res = await fetch('/api/admin/videos/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: videoId, expert_id: expertId, op: 'add' })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.detail || 'Failed to add assignment');
    await loadExpertDashboard(false);
}

async function handleRemoveAssignment(videoId, expertId) {
    const res = await fetch('/api/admin/videos/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: videoId, expert_id: expertId, op: 'remove' })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.detail || 'Failed to remove assignment');
    await loadExpertDashboard(false);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function iconLabel(iconKey) {
    const key = String(iconKey || '').trim().toLowerCase();
    const emoji = CHILD_ICON_EMOJI[key] || '👤';
    const name = CHILD_ICON_NAME[key] || (key ? `${key.charAt(0).toUpperCase()}${key.slice(1)}` : 'Unknown');
    return `${emoji} ${name}`;
}

function renderChildrenExpertOptions() {
    const createSelect = document.getElementById('child-expert-select');
    const filterSelect = document.getElementById('children-filter-expert');
    const experts = Array.isArray(adminExperts) ? adminExperts : [];

    if (createSelect) {
        const current = createSelect.value || '';
        createSelect.innerHTML = `
            <option value="">Select expert...</option>
            ${experts.map((expert) => `
                <option value="${expert.expert_id}">
                    ${escapeHtml(expert.display_name || expert.expert_id)} (${expert.expert_id})${expert.is_active ? '' : ' [inactive]'}
                </option>
            `).join('')}
        `;
        if (current && experts.some((expert) => expert.expert_id === current)) {
            createSelect.value = current;
        }
    }

    if (filterSelect) {
        const current = filterSelect.value || '';
        filterSelect.innerHTML = `
            <option value="">All experts</option>
            ${experts.map((expert) => `
                <option value="${expert.expert_id}">
                    ${escapeHtml(expert.display_name || expert.expert_id)} (${expert.expert_id})
                </option>
            `).join('')}
        `;
        if (current && experts.some((expert) => expert.expert_id === current)) {
            filterSelect.value = current;
        }
    }
}

async function loadChildrenDashboard(showRefreshMessage = false) {
    try {
        const filterSelect = document.getElementById('children-filter-expert');
        const includeInactive = document.getElementById('children-include-inactive');
        const params = new URLSearchParams();

        if (filterSelect && filterSelect.value) {
            params.set('expert_id', filterSelect.value);
        }
        if (includeInactive && includeInactive.checked) {
            params.set('include_inactive', 'true');
        }

        const query = params.toString();
        const res = await fetch(`/api/admin/children${query ? `?${query}` : ''}`);
        const data = await res.json();
        if (!res.ok || !data.success) {
            throw new Error(data.detail || data.message || 'Failed to load children dashboard');
        }

        adminChildren = Array.isArray(data.children) ? data.children : [];
        if (Array.isArray(data.experts) && data.experts.length) {
            adminExperts = data.experts;
        }
        childrenDashboardLoaded = true;
        renderChildrenExpertOptions();
        renderChildrenTable();

        if (showRefreshMessage) {
            setAdminPanelStatus('child-admin-status', 'Children list refreshed.', 'success');
        }
    } catch (error) {
        setAdminPanelStatus('child-admin-status', error.message || 'Failed to load children dashboard', 'error');
        const tbody = document.getElementById('child-list-tbody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="7">Unable to load children right now.</td></tr>';
        }
    }
}

function renderChildrenTable() {
    const tbody = document.getElementById('child-list-tbody');
    if (!tbody) return;

    const dirHeading = document.getElementById('children-dir-heading');
    if (dirHeading) dirHeading.textContent = `Children Directory (${adminChildren.length})`;

    if (!adminChildren.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#9ca3af;padding:24px;">No children found for this filter.</td></tr>';
        return;
    }

    const expertLinkOptions = (adminExperts || []).map((expert) => `
        <option value="${expert.expert_id}">
            ${escapeHtml(expert.display_name || expert.expert_id)} (${expert.expert_id})${expert.is_active ? '' : ' [inactive]'}
        </option>
    `).join('');

    tbody.innerHTML = adminChildren.map((child) => `
        <tr data-child-id="${child.child_id}" data-active="${child.is_active ? '1' : '0'}">
            <td><span class="admin-child-id">${child.child_id}</span></td>
            <td>
                ${child.expert_id
                    ? escapeHtml(child.expert_name || child.expert_id)
                    : `<select class="admin-inline-select" data-role="child-link-expert">
                        <option value="">Select expert...</option>
                        ${expertLinkOptions}
                    </select>`
                }
            </td>
            <td><input type="text" class="admin-inline-input" data-role="child-first-name" value="${escapeHtml(child.first_name || '')}" /></td>
            <td><input type="text" class="admin-inline-input" data-role="child-last-name" value="${escapeHtml(child.last_name || '')}" /></td>
            <td>
                <select class="admin-inline-select" data-role="child-icon-key">
                    ${Object.keys(CHILD_ICON_EMOJI).map((icon) => `
                        <option value="${icon}" ${icon === child.icon_key ? 'selected' : ''}>
                            ${iconLabel(icon)}
                        </option>
                    `).join('')}
                </select>
            </td>
            <td>
                <select class="admin-inline-select" data-role="child-interaction-mode">
                    <option value="flexible" ${child.interaction_mode === 'flexible' ? 'selected' : ''}>Flexible</option>
                    <option value="strict" ${child.interaction_mode === 'strict' ? 'selected' : ''}>Strict</option>
                    <option value="passive" ${child.interaction_mode === 'passive' ? 'selected' : ''}>Passive</option>
                </select>
            </td>
            <td><span class="admin-status-badge ${child.is_active ? 'status-active' : 'status-inactive'}">${child.is_active ? 'active' : 'inactive'}</span></td>
            <td class="admin-actions-cell">
                <button type="button" class="admin-action-btn" data-action="save-child">💾 Save</button>
                ${child.expert_id
                    ? '<button type="button" class="admin-action-btn admin-action-unlink" data-action="unlink-child">🔗 Unlink</button>'
                    : '<button type="button" class="admin-action-btn admin-action-link" data-action="link-child">🔗 Link</button>'
                }
                <button type="button" class="admin-action-btn admin-action-danger" data-action="toggle-child">
                    ${child.is_active ? '👤 Deactivate' : '✅ Activate'}
                </button>
                <button type="button" class="admin-action-btn admin-action-remove" data-action="delete-child">🗑 Remove</button>
            </td>
        </tr>
    `).join('');

    tbody.querySelectorAll('[data-action="save-child"]').forEach((btn) => {
        btn.addEventListener('click', async (event) => {
            const row = event.currentTarget.closest('tr');
            await handleSaveChild(row);
        });
    });

    tbody.querySelectorAll('[data-action="toggle-child"]').forEach((btn) => {
        btn.addEventListener('click', async (event) => {
            const row = event.currentTarget.closest('tr');
            await handleToggleChild(row);
        });
    });

    tbody.querySelectorAll('[data-action="unlink-child"]').forEach((btn) => {
        btn.addEventListener('click', async (event) => {
            const row = event.currentTarget.closest('tr');
            await handleUnlinkChild(row);
        });
    });

    tbody.querySelectorAll('[data-action="link-child"]').forEach((btn) => {
        btn.addEventListener('click', async (event) => {
            const row = event.currentTarget.closest('tr');
            await handleLinkChild(row);
        });
    });

    tbody.querySelectorAll('[data-action="delete-child"]').forEach((btn) => {
        btn.addEventListener('click', async (event) => {
            const row = event.currentTarget.closest('tr');
            await handleDeleteChild(row);
        });
    });
}

async function handleDeleteChild(row) {
    const childId = row.dataset.childId;
    if (!confirm(`Permanently remove child "${childId}"? This cannot be undone.`)) return;
    try {
        const resp = await fetch(`/api/admin/children/${encodeURIComponent(childId)}`, { method: 'DELETE' });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.success) {
            throw new Error(data.detail || data.message || 'Failed to remove child.');
        }
        row.remove();
        await loadChildrenDashboard(false);
        setAdminPanelStatus('child-admin-status', `Child "${childId}" deleted.`, 'success');
    } catch (error) {
        setAdminPanelStatus('child-admin-status', error.message || 'Failed to remove child.', 'error');
    }
}

function childMatchesCurrentFilters(child) {
    const filterExpert = (document.getElementById('children-filter-expert')?.value || '').trim().toLowerCase();
    const includeInactive = Boolean(document.getElementById('children-include-inactive')?.checked);
    const childExpert = String(child?.expert_id || '').trim().toLowerCase();

    if (filterExpert && childExpert !== filterExpert) {
        return false;
    }
    if (!includeInactive && !child?.is_active) {
        return false;
    }
    return true;
}

function applyUpdatedChildToUi(updatedChild) {
    if (!updatedChild || !updatedChild.child_id) return;
    const index = adminChildren.findIndex((item) => item.child_id === updatedChild.child_id);
    if (index === -1) return;

    if (childMatchesCurrentFilters(updatedChild)) {
        adminChildren[index] = updatedChild;
    } else {
        adminChildren.splice(index, 1);
    }
    renderChildrenTable();
}

async function handleCreateChild(event) {
    event.preventDefault();
    try {
        const expert_id = (document.getElementById('child-expert-select')?.value || '').trim();
        const first_name = (document.getElementById('child-first-name')?.value || '').trim();
        const last_name = (document.getElementById('child-last-name')?.value || '').trim();
        const icon_key = (document.getElementById('child-icon-key')?.value || '').trim().toLowerCase();
        const interaction_mode = (document.getElementById('child-interaction-mode')?.value || 'flexible').trim().toLowerCase();

        const res = await fetch('/api/admin/children', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expert_id, first_name, last_name, icon_key, interaction_mode }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            throw new Error(data.detail || data.message || 'Failed to create child');
        }

        event.target.reset();
        setAdminPanelStatus('child-admin-status', `Created child ${data.child.child_id}.`, 'success');
        await loadChildrenDashboard(false);
    } catch (error) {
        setAdminPanelStatus('child-admin-status', error.message || 'Failed to create child', 'error');
    }
}

async function handleSaveChild(row) {
    const childId = row?.dataset?.childId;
    if (!childId) return;
    try {
        const payload = {
            first_name: (row.querySelector('[data-role="child-first-name"]')?.value || '').trim(),
            last_name: (row.querySelector('[data-role="child-last-name"]')?.value || '').trim(),
            icon_key: (row.querySelector('[data-role="child-icon-key"]')?.value || '').trim().toLowerCase(),
            interaction_mode: (row.querySelector('[data-role="child-interaction-mode"]')?.value || 'flexible').trim().toLowerCase(),
            is_active: row.dataset.active === '1',
        };
        const linkSelect = row.querySelector('[data-role="child-link-expert"]');
        if (linkSelect) {
            const selectedExpert = (linkSelect.value || '').trim();
            if (selectedExpert) {
                payload.expert_id = selectedExpert;
            }
        }

        const res = await fetch(`/api/admin/children/${encodeURIComponent(childId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            throw new Error(data.detail || data.message || 'Failed to update child');
        }

        setAdminPanelStatus('child-admin-status', `Updated child ${childId}.`, 'success');
        if (data.child) {
            applyUpdatedChildToUi(data.child);
        } else {
            await loadChildrenDashboard(false);
        }
    } catch (error) {
        setAdminPanelStatus('child-admin-status', error.message || 'Failed to update child', 'error');
    }
}

async function handleToggleChild(row) {
    const childId = row?.dataset?.childId;
    if (!childId) return;
    const isActive = row.dataset.active === '1';
    try {
        let res;
        if (isActive) {
            res = await fetch(`/api/admin/children/${encodeURIComponent(childId)}/deactivate`, { method: 'POST' });
        } else {
            res = await fetch(`/api/admin/children/${encodeURIComponent(childId)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_active: true }),
            });
        }

        const data = await res.json();
        if (!res.ok || !data.success) {
            throw new Error(data.detail || data.message || 'Failed to toggle child');
        }

        setAdminPanelStatus(
            'child-admin-status',
            isActive ? `Deactivated child ${childId}.` : `Activated child ${childId}.`,
            'success'
        );
        if (data.child) {
            applyUpdatedChildToUi(data.child);
        } else {
            await loadChildrenDashboard(false);
        }
    } catch (error) {
        setAdminPanelStatus('child-admin-status', error.message || 'Failed to toggle child', 'error');
    }
}

async function handleUnlinkChild(row) {
    const childId = row?.dataset?.childId;
    if (!childId) return;
    if (!confirm(`Unlink child ${childId} from expert?`)) return;
    try {
        const res = await fetch(`/api/admin/children/${encodeURIComponent(childId)}/unlink`, {
            method: 'POST',
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            throw new Error(data.detail || data.message || 'Failed to unlink child');
        }
        setAdminPanelStatus('child-admin-status', `Child ${childId} unlinked.`, 'success');
        if (data.child) {
            applyUpdatedChildToUi(data.child);
        } else {
            await loadChildrenDashboard(false);
        }
    } catch (error) {
        setAdminPanelStatus('child-admin-status', error.message || 'Failed to unlink child', 'error');
    }
}

async function handleLinkChild(row) {
    const childId = row?.dataset?.childId;
    if (!childId) return;
    const expertId = (row.querySelector('[data-role="child-link-expert"]')?.value || '').trim();
    if (!expertId) {
        setAdminPanelStatus('child-admin-status', 'Pick an expert first.', 'error');
        return;
    }
    try {
        const res = await fetch(`/api/admin/children/${encodeURIComponent(childId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expert_id: expertId }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            throw new Error(data.detail || data.message || 'Failed to link child');
        }
        setAdminPanelStatus('child-admin-status', `Child ${childId} linked to ${expertId}.`, 'success');
        if (data.child) {
            applyUpdatedChildToUi(data.child);
        } else {
            await loadChildrenDashboard(false);
        }
    } catch (error) {
        setAdminPanelStatus('child-admin-status', error.message || 'Failed to link child', 'error');
    }
}
        async function downloadVideo(url) {
            showLoading('download-loading', true);
            document.getElementById('download-result').style.display = 'block';
            const progressInterval = simulateDownloadProgress();
            
            try {
                const formData = new FormData();
                formData.append('url', url);
                
                const response = await fetch('/api/download', {
                    method: 'POST',
                    body: formData
                });
                
                const data = await response.json();
                clearInterval(progressInterval);
                showDownloadProgress(true, 100, { speed: 'Complete', eta: '0s' });
                
                setTimeout(() => {
                    showDownloadProgress(false);
                    
                    if (data.success) {
                        currentVideoId = data.video_id;
                        currentVideoMeta = {
                            video_id: data.video_id,
                            title: data.title || data.video_id,
                            duration_seconds: data.duration,
                            duration_formatted: data.duration ? formatHumanDuration(data.duration) : null,
                            has_frames: false,
                            has_questions: false
                        };
                        currentVideoHasFrames = false;
                        prepareQuestionsUiForNewVideo();
                        showStatus('download-status', 'Video downloaded successfully!', 'success', 'download-result');
                        updateButtonStates();
                        loadExistingDownloads(true);
                        setTimeout(() => { nextStep(); }, 1500);
                    } else {
                        showStatus('download-status', data.message || 'Download failed. Please try again.', 'error', 'download-result');
                    }
                }, 1000);
                
            } catch (error) {
                clearInterval(progressInterval);
                showDownloadProgress(false);
                showStatus('download-status', 'Download error: ' + error.message, 'error', 'download-result');
            } finally {
                showLoading('download-loading', false);
            }
        }
        
        async function extractFrames() {
            if (!currentVideoId) return;
            
            showLoading('extraction-loading', true);
            
            try {
                const response = await fetch(`/api/frames/${currentVideoId}`, {
                    method: 'POST'
                });
                
                const data = await response.json();
                
                if (data.success) {
                    showStatus('extraction-status', 'Frames extracted successfully!', 'success', 'extraction-result');
                    const detailsDiv = document.getElementById('extraction-details');
                    detailsDiv.innerHTML = createExtractionDetails(data);
                    currentVideoHasFrames = true;
                    currentVideoMeta = currentVideoMeta || { video_id: currentVideoId };
                    currentVideoMeta.has_frames = true;
                    currentVideoMeta.frame_count = data.count;
                    currentVideoMeta.frames_dir = data.output_dir;
                    updateButtonStates();
                    loadExistingDownloads(true);
                    setTimeout(() => { nextStep(); }, 2500);
                } else {
                    showStatus('extraction-status', data.message || 'Frame extraction failed. Please try again.', 'error', 'extraction-result');
                }
            } catch (error) {
                showStatus('extraction-status', 'Extraction error: ' + error.message, 'error', 'extraction-result');
            } finally {
                showLoading('extraction-loading', false);
            }
        }
        
        function createExtractionDetails(data) {
            const { count = 0, files = [], video_id, output_dir } = data;
            
            return `
                <div class="extraction-details">
                    <div class="extraction-stats">
                        <div class="stat-item">
                            <span class="stat-value">${count}</span>
                            <div class="stat-label">Frames Extracted</div>
                        </div>
                        <div class="stat-item">
                            <span class="stat-value">${files.length}</span>
                            <div class="stat-label">Files Generated</div>
                        </div>
                        <div class="stat-item">
                            <span class="stat-value">${Math.round(count / 60)}m</span>
                            <div class="stat-label">Video Duration</div>
                        </div>
                    </div>
                    
                    ${output_dir ? `
                        <div style="background: #e3f2fd; padding: 15px; border-radius: 8px; margin: 15px 0;">
                            <strong>Output Folder:</strong> <a href="${output_dir}" target="_blank" style="color: #007bff; text-decoration: none;">${output_dir}</a>
                        </div>
                    ` : ''}
                    
                    <div style="margin-top: 20px; padding: 15px; background: #d4edda; border-radius: 8px; border: 1px solid #c3e6cb;">
                        <strong style="color: #155724;">Next Step:</strong> 
                        <span style="color: #155724;">Now that frames are extracted, you can generate comprehension questions!</span>
                    </div>
                </div>
            `;
        }
        
        async function generateQuestions() {
            if (!currentVideoId) {
                showStatus('generation-status', 'Select or download a video first.', 'error', 'generation-result');
                return;
            }

            if (!currentVideoHasFrames) {
                showStatus('generation-status', 'Frames not found. Please extract frames in Step 2.', 'error', 'generation-result');
                return;
            }
            
            const startSeconds = document.getElementById('start_seconds').value;
            const intervalSeconds = document.getElementById('interval_seconds').value;
            const fullDuration = document.getElementById('full_duration').checked;
            
            showLoading('generation-loading', true);
            
            // Reset questions
            segmentCount = 0;
            generatedQuestions = [];
            const resultsTbody = document.getElementById('questions-results-tbody');
            resultsTbody.innerHTML = '';
            document.querySelector('.questions-results').style.display = 'none';
            
            // Use WebSocket for real-time updates
            const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + `/ws/questions/${currentVideoId}`;
            const ws = new WebSocket(wsUrl);
            const questionProvider = document.getElementById('question_provider').value;
            
            //backend provide per request.
           
            ws.onopen = () => {
                ws.send(JSON.stringify({
                 start_seconds: parseInt(startSeconds),
                 interval_seconds: parseInt(intervalSeconds),
                 full_duration: fullDuration,
                provider: questionProvider
                }));
            };
            
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                
                if (data.type === 'status') {
                    showStatus('generation-status', data.message, 'info', 'generation-result');
                } else if (data.type === 'segment_result') {
                    segmentCount++;
                    
                    // Store in memory for later submission
                    generatedQuestions.push({
                        start: data.start,
                        end: data.end,
                        result: data.result
                    });
                    
                    if (data.result && data.result.questions) {
                        addQuestionToTable(data.start, data.end, data.result.questions, data.result.best_question, null);
                    } else {
                        addQuestionToTable(data.start, data.end, null, null, data.result || null);
                    }
                    
                    updateQuestionsStats();
                    
                } else if (data.type === 'done') {
                    showStatus('generation-status', 'Questions generated! Review and submit below.', 'success', 'generation-result');
                    showLoading('generation-loading', false);
                    
                    // Show submit button instead of auto-saving
                    const detailsDiv = document.getElementById('generation-details');
                    detailsDiv.innerHTML = `
                        <div style="margin-top: 20px; padding: 20px; background: #f8f9fa; border-radius: 8px; border: 1px solid #dee2e6;">
                            <h4 style="color: #495057; margin-bottom: 15px;">Ready to Submit</h4>
                            <p style="color: #6c757d; margin-bottom: 20px;">Review the generated questions above. Submitting will overwrite any previously saved JSON for this video.</p>
                            <div style="display: flex; gap: 15px; flex-wrap: wrap;">
                                <button class="btn btn-success" onclick="submitQuestions(event)">Submit & Save Questions</button>
                            </div>
                        </div>
                    `;
                    
                } else if (data.type === 'error') {
                    showStatus('generation-status', 'Generation failed: ' + data.message, 'error', 'generation-result');
                    showLoading('generation-loading', false);
                }
            };
            
            ws.onerror = () => {
                showStatus('generation-status', 'Connection error. Please try again.', 'error', 'generation-result');
                showLoading('generation-loading', false);
            };
        }
        
        async function submitQuestions(evt) {
            if (!currentVideoId || generatedQuestions.length === 0) {
                alert('No questions to submit');
                return;
            }

            const submitButton = evt ? evt.target : null;
            if (submitButton) {
                submitButton.disabled = true;
                submitButton.textContent = 'Submitting...';
            }

            try {
                const payload = {
                    video_id: currentVideoId,
                    questions: generatedQuestions
                };

                const response = await fetch('/api/submit-questions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const result = await response.json();
                if (!result.success) {
                    throw new Error(result.message || 'Submission failed');
                }

                const previouslySaved = Boolean(currentVideoMeta && currentVideoMeta.has_questions);
                const videoTitle = result.video_title || currentVideoMeta?.title || currentVideoId;

                if (!currentVideoMeta) {
                    currentVideoMeta = { video_id: currentVideoId };
                }
                currentVideoMeta.has_questions = true;
                currentVideoMeta.question_file = result.file_url;
                updateVideoInfoPanel();
                await loadExistingDownloads(true);

                const overwriteNote = previouslySaved ? ' (existing file overwritten)' : '';
                showStatus(
                    'generation-status',
                    `Questions saved as "${videoTitle}"${overwriteNote}.`,
                    'success',
                    'generation-result'
                );

                const detailsDiv = document.getElementById('generation-details');
                if (detailsDiv) {
                    detailsDiv.innerHTML = `
                        <div style="margin-top: 20px; padding: 20px; background: #d4edda; border-radius: 8px; border: 1px solid #c3e6cb;">
                            <h4 style="color: #155724; margin-bottom: 15px;">Questions Submitted Successfully!</h4>
                            <p style="color: #155724; margin-bottom: 10px;">Video: <strong>${videoTitle}</strong></p>
                            <p style="color: #155724; margin-bottom: 20px;">Your questions have been saved${previouslySaved ? ' and replaced the prior file' : ''}.</p>
                            <div style="display: flex; gap: 15px; flex-wrap: wrap;">
                                <a href="${result.file_url}" class="btn btn-success" download>Download Questions JSON</a>
                                <a href="/expert-preview?video=${currentVideoId}" class="btn btn-outline" target="_blank">Expert Preview</a>
                            </div>
                        </div>
                    `;
                }
            } catch (error) {
                showStatus('generation-status', 'Submission failed: ' + error.message, 'error', 'generation-result');
            } finally {
                if (submitButton) {
                    submitButton.disabled = false;
                    submitButton.textContent = 'Submit & Save Questions';
                }
            }
        }

            
            
        
        
        
        
        function addQuestionToTable(start, end, questions, bestQuestion, details = null) {
            const timeRange = formatTimeRange(start, end);
            const segmentKey = `${start}-${end}`;
            
            document.querySelector('.questions-results').style.display = 'block';
            document.getElementById('questions-no-results').style.display = 'none';
            
            const resultsTbody = document.getElementById('questions-results-tbody');
            
            const existingRows = resultsTbody.querySelectorAll(`[data-segment="${segmentKey}"]`);
            existingRows.forEach(row => row.remove());
            
            if (!questions || typeof questions !== 'object') {
                if (details && details.error) {
                    console.warn('Segment generation issue', { start, end, details });
                }

                const reasonLabels = {
                    frames_dir_missing: 'Frames folder missing',
                    frame_data_csv_missing: 'frame_data.csv missing',
                    no_frames_in_range: 'No frames in this time range',
                    missing_frame_files: 'Frame images missing',
                    csv_parse_error: 'Could not read frame_data.csv',
                    frames_present: 'Frames present, model/API issue',
                    invalid_json: 'Model returned non-JSON',
                    missing_questions: 'JSON missing questions',
                    generation_returned_none: 'Model call failed'
                };

                const frameReason = details && details.frame_debug ? details.frame_debug.reason : null;
                const errorReason = details && details.error ? details.error.reason : null;

                let message = 'No questions generated';
                if (frameReason && frameReason !== 'frames_present') {
                    message = reasonLabels[frameReason] || message;
                } else if (errorReason) {
                    message = reasonLabels[errorReason] || message;
                } else if (frameReason === 'frames_present') {
                    message = reasonLabels.frames_present;
                }

                const detailParts = [];
                if (details && details.frame_debug) {
                    if (details.frame_debug.frames_in_range !== undefined) {
                        detailParts.push(`${details.frame_debug.frames_in_range} frames in range`);
                    }
                    if (details.frame_debug.min_timestamp !== undefined && details.frame_debug.max_timestamp !== undefined) {
                        detailParts.push(`available ${details.frame_debug.min_timestamp}-${details.frame_debug.max_timestamp}s`);
                    }
                }
                const detailText = detailParts.length ? `<div class="error-detail">${detailParts.join(' / ')}</div>` : '';

                const row = document.createElement('tr');
                row.setAttribute('data-segment', segmentKey);
                row.innerHTML = `
                    <td><span class="time-range">${timeRange}</span></td>
                    <td>-</td>
                    <td class="status-error">${message}${detailText}</td>
                    <td>-</td>
                    <td><span class="status-error">Error</span></td>
                `;
                resultsTbody.appendChild(row);
                return;
            }

            const categories = ['character', 'setting', 'feeling', 'action', 'causal', 'outcome', 'prediction'];
            let firstRow = true;
            
            categories.forEach(category => {
                const questionData = questions[category];
                if (questionData && questionData.q) {
                    const row = document.createElement('tr');
                    row.setAttribute('data-segment', segmentKey);
                    
                    const isBestQuestion = bestQuestion && 
                        (bestQuestion === questionData.q || bestQuestion.includes(questionData.q));
                    
                    row.innerHTML = `
                        <td>${firstRow ? `<span class="time-range">${timeRange}</span>` : ''}</td>
                        <td>
                            <span class="question-category">${category}</span>
                            ${isBestQuestion ? '<span class="best-question-marker">BEST</span>' : ''}
                        </td>
                        <td class="question-text">${questionData.q}</td>
                        <td class="answer-text">${questionData.a || 'No answer provided'}</td>
                        <td><span class="status-completed">✓</span></td>
                    `;
                    resultsTbody.appendChild(row);
                    firstRow = false;
                }
            });
            
            if (firstRow) {
                const row = document.createElement('tr');
                row.setAttribute('data-segment', segmentKey);
                row.innerHTML = `
                    <td><span class="time-range">${timeRange}</span></td>
                    <td>-</td>
                    <td class="status-error">No valid questions found</td>
                    <td>-</td>
                    <td><span class="status-error">Error</span></td>
                `;
                resultsTbody.appendChild(row);
            }
        }
        
        function formatTimeRange(start, end) {
            const formatTime = (seconds) => {
                const mins = Math.floor(seconds / 60);
                const secs = seconds % 60;
                return `${mins}:${secs.toString().padStart(2, '0')}`;
            };
            return `${formatTime(start)}-${formatTime(end)}`;
        }
        
        function updateQuestionsStats() {
            if (segmentCount > 0) {
                document.getElementById('questions-no-results').style.display = 'none';
            }
        }
        
        function showDownloadProgress(show, progress = 0, details = {}) {
            const progressDiv = document.getElementById('download-progress');
            const progressBar = document.getElementById('progress-bar');
            const progressText = document.getElementById('progress-text');
            const progressDetails = document.getElementById('progress-details');
            
            if (show) {
                progressDiv.style.display = 'block';
                progressBar.style.width = progress + '%';
                progressText.textContent = `${Math.round(progress)}% Complete`;
                
                if (details.speed && details.eta) {
                    progressDetails.innerHTML = `
                        <span>Speed: ${details.speed}</span>
                        <span>ETA: ${details.eta}</span>
                    `;
                }
            } else {
                progressDiv.style.display = 'none';
                progressBar.style.width = '0%';
            }
        }
        
        function simulateDownloadProgress() {
            let progress = 0;
            showDownloadProgress(true, 0);
            
            const interval = setInterval(() => {
                progress += Math.random() * 8 + 2; // Progress between 2-10% per step
                if (progress > 95) progress = 95;
                
                const speed = (Math.random() * 3 + 2).toFixed(1) + ' MB/s';
                const eta = Math.ceil((100 - progress) / 8) + 's';
                
                showDownloadProgress(true, progress, { speed, eta });
                
                if (progress >= 95) {
                    clearInterval(interval);
                }
            }, 800); // Slower updates for better visibility
            
            return interval;
        }
        
        function showLoading(elementId, show) {
            const element = document.getElementById(elementId);
            element.style.display = show ? 'block' : 'none';
        }
        
        function showStatus(elementId, message, type, containerId = null) {
            const element = document.getElementById(elementId);
            element.className = `status-message status-${type}`;
            element.textContent = message;
            element.style.display = 'block';
            
            if (containerId) {
                document.getElementById(containerId).style.display = 'block';
            }
        }
