/**
 * Dynamic Video Generator Frontend
 * Handles text input, loading animation, and HLS playback
 */

// Configuration
const API_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3001'
  : '';  // Same origin in production

const LOADING_STAGES = [
  { text: 'Analyzing text...', detail: 'Processing your input', progress: 20 },
  { text: 'Matching phrases...', detail: 'Finding available clips', progress: 40 },
  { text: 'Selecting clips...', detail: 'Randomizing selection', progress: 60 },
  { text: 'Assembling timeline...', detail: 'Creating unique sequence', progress: 80 },
  { text: 'Finalizing...', detail: 'Preparing playback', progress: 95 },
  { text: 'Ready!', detail: 'Loading player', progress: 100 }
];

const MIN_LOADING_TIME = 3000; // Minimum 3 seconds
const MAX_LOADING_TIME = 5000; // Maximum 5 seconds

// State
let currentSession = null;
let hls = null;
let loadingInterval = null;
let audioContext = null;
let analyser = null;
let animationId = null;

// Elements
const elements = {
  // Containers
  inputContainer: document.getElementById('input-container'),
  loadingContainer: document.getElementById('loading-container'),
  playerContainer: document.getElementById('player-container'),
  errorContainer: document.getElementById('error-container'),

  // Input
  generateBtn: document.getElementById('generate-btn'),

  // Loading
  loadingStatus: document.getElementById('loading-status'),
  loadingDetail: document.getElementById('loading-detail'),
  progressFill: document.getElementById('progress-fill'),

  // Player
  video: document.getElementById('video'),
  sessionId: document.getElementById('session-id'),
  videoStats: document.getElementById('video-stats'),
  generateAnother: document.getElementById('generate-another'),
  minimapProgress: document.getElementById('minimap-progress'),
  playPauseBtn: document.getElementById('play-pause-btn'),
  fullscreenBtn: document.getElementById('fullscreen-btn'),
  muteIndicator: document.getElementById('mute-indicator'),
  spectrogram: document.getElementById('spectrogram'),

  // About overlay
  aboutBtn: document.getElementById('about-btn'),
  aboutOverlay: document.getElementById('about-overlay'),
  aboutCloseBtn: document.getElementById('about-close-btn'),
  clipSourcesList: document.getElementById('clip-sources-list'),

  // Error
  errorMessage: document.getElementById('error-message'),
  tryAgain: document.getElementById('try-again')
};

/**
 * Show a specific container and hide others
 */
function showContainer(container) {
  const containers = ['inputContainer', 'loadingContainer', 'playerContainer', 'errorContainer'];

  containers.forEach(name => {
    if (elements[name]) {
      if (elements[name] === container) {
        elements[name].classList.add('active');
      } else {
        elements[name].classList.remove('active');
      }
    }
  });
}

/**
 * Animate loading sequence
 */
async function animateLoading() {
  const startTime = Date.now();
  const duration = MIN_LOADING_TIME + Math.random() * (MAX_LOADING_TIME - MIN_LOADING_TIME);

  return new Promise((resolve) => {
    let stageIndex = 0;

    loadingInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min((elapsed / duration) * 100, 100);

      // Find appropriate stage
      while (stageIndex < LOADING_STAGES.length - 1 &&
             progress >= LOADING_STAGES[stageIndex + 1].progress) {
        stageIndex++;
      }

      const stage = LOADING_STAGES[stageIndex];

      // Update UI
      elements.loadingStatus.textContent = stage.text;
      elements.loadingDetail.textContent = stage.detail;
      elements.progressFill.style.width = `${progress}%`;

      // Complete
      if (progress >= 100) {
        clearInterval(loadingInterval);
        loadingInterval = null;
        resolve();
      }
    }, 100);
  });
}

/**
 * Generate video (uses fixed text from server)
 */
async function generateVideo() {
  // Show loading
  showContainer(elements.loadingContainer);
  elements.progressFill.style.width = '0%';

  // Start loading animation
  const loadingPromise = animateLoading();

  try {
    // Call API (no text needed - server uses fixed text)
    const response = await fetch(`${API_URL}/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const data = await response.json();

    // Store session
    currentSession = data;

    // Wait for minimum loading time
    await loadingPromise;

    // Small delay before showing player
    await new Promise(resolve => setTimeout(resolve, 300));

    // Load video
    loadVideo(data.playlistUrl, data.sessionId, data.stats);

  } catch (error) {
    console.error('Generation failed:', error);

    // Clear loading
    if (loadingInterval) {
      clearInterval(loadingInterval);
      loadingInterval = null;
    }

    showError(`Failed to generate video: ${error.message}`);
  }
}

/**
 * Load and play HLS video
 */
function loadVideo(playlistUrl, sessionId, stats) {
  // Update session info (if element exists)
  if (elements.sessionId) {
    elements.sessionId.textContent = sessionId;
  }

  // Update stats (if element exists)
  if (stats && elements.videoStats) {
    elements.videoStats.innerHTML = `
      <div class="stat">
        <span class="stat-label">Total Clips:</span>
        <span class="stat-value">${stats.totalClips}</span>
      </div>
      <div class="stat">
        <span class="stat-label">Phrase Clips:</span>
        <span class="stat-value">${stats.phraseClips}</span>
      </div>
      <div class="stat">
        <span class="stat-label">Static Clips:</span>
        <span class="stat-value">${stats.staticClips}</span>
      </div>
      <div class="stat">
        <span class="stat-label">Duration:</span>
        <span class="stat-value">${stats.totalDuration.toFixed(1)}s</span>
      </div>
    `;
  }

  // Destroy previous HLS instance if exists
  if (hls) {
    hls.destroy();
    hls = null;
  }

  // Full URL for playlist
  const fullPlaylistUrl = `${API_URL}${playlistUrl}`;

  // Load video with HLS.js
  if (Hls.isSupported()) {
    hls = new Hls({
      enableWorker: true,
      backBufferLength: 30,        // Reduce back buffer to save memory
      maxBufferLength: 60,          // Increase forward buffer for smoother playback
      maxMaxBufferLength: 120,      // Allow more buffer when bandwidth allows
      maxBufferSize: 60*1000*1000,  // 60MB buffer size
      maxBufferHole: 0.5,           // Allow small gaps in buffer
      lowBufferWatchdogPeriod: 0.5, // Check buffer more frequently
      highBufferWatchdogPeriod: 3,  // Check buffer health
      nudgeOffset: 0.1,             // Small nudge for sync
      nudgeMaxRetry: 10,            // Retry nudging
      maxFragLookUpTolerance: 0.25, // Tolerance for fragment lookup
      enableCEA708Captions: false,  // Disable captions processing
      stretchShortVideoTrack: false,
      progressive: true,             // Enable progressive loading
      lowLatencyMode: false,         // We're not doing live streaming
      testBandwidth: false,          // No bandwidth testing needed for local
      fpsDroppedMonitoringPeriod: 5000,
      fpsDroppedMonitoringThreshold: 0.2,
      appendErrorMaxRetry: 3,
      startFragPrefetch: true,       // Prefetch next fragment
      manifestLoadingTimeOut: 10000,
      manifestLoadingMaxRetry: 4,
      manifestLoadingRetryDelay: 500,
      manifestLoadingMaxRetryTimeout: 64000,
      levelLoadingTimeOut: 10000,
      levelLoadingMaxRetry: 4,
      levelLoadingRetryDelay: 500,
      levelLoadingMaxRetryTimeout: 64000,
      fragLoadingTimeOut: 20000,
      fragLoadingMaxRetry: 6,
      fragLoadingRetryDelay: 500,
      fragLoadingMaxRetryTimeout: 64000,
      startLevel: -1,               // Auto start level
      autoStartLoad: true,          // Start loading immediately
      maxLoadingDelay: 4,           // Max loading delay
      minAutoBitrate: 0,
      emeEnabled: false,
      widevineLicenseUrl: undefined,
      licenseXhrSetup: undefined,
      capLevelOnFPSDrop: false,
      capLevelToPlayerSize: false,
      ignoreDevicePixelRatio: false
    });

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      console.log('HLS manifest loaded');
      // Try to autoplay (may be blocked by browser)
      elements.video.play().catch(e => {
        console.log('Autoplay blocked - user needs to click play');
      });
    });

    hls.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        console.error('Fatal HLS error:', data);
        switch(data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            console.log('Attempting to recover from network error');
            hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            console.log('Attempting to recover from media error');
            hls.recoverMediaError();
            break;
          default:
            showError('Failed to load video');
            break;
        }
      }
    });

    hls.loadSource(fullPlaylistUrl);
    hls.attachMedia(elements.video);

  } else if (elements.video.canPlayType('application/vnd.apple.mpegurl')) {
    // Native HLS support (Safari)
    elements.video.src = fullPlaylistUrl;
    elements.video.addEventListener('loadedmetadata', () => {
      elements.video.play().catch(e => {
        console.log('Autoplay blocked');
      });
    });
  } else {
    showError('HLS is not supported in your browser');
    return;
  }

  // Show player
  showContainer(elements.playerContainer);

  // Setup spectrogram visualization
  setupSpectrogram();

  // Update minimap progress line as video plays
  const minimapContainer = document.querySelector('.minimap-container');

  if (elements.minimapProgress && minimapContainer) {
    // Update progress line position
    elements.video.addEventListener('timeupdate', () => {
      if (elements.video.duration > 0) {
        const progress = elements.video.currentTime / elements.video.duration;
        const containerHeight = minimapContainer.clientHeight;
        const padding = 20; // Top/bottom padding to align with text content
        const topPosition = padding + (progress * (containerHeight - padding * 2));
        elements.minimapProgress.style.top = `${topPosition}px`;
      }
    });

    // Make minimap clickable for seeking
    let isSeeking = false;

    const seekToPosition = (e) => {
      const rect = minimapContainer.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const containerHeight = minimapContainer.clientHeight;
      const padding = 20; // Top/bottom padding to align with text content

      // Calculate progress (0 to 1)
      let progress = (y - padding) / (containerHeight - padding * 2);
      progress = Math.max(0, Math.min(1, progress)); // Clamp between 0 and 1

      // Seek video
      if (elements.video.duration > 0) {
        elements.video.currentTime = progress * elements.video.duration;
      }
    };

    minimapContainer.addEventListener('mousedown', (e) => {
      isSeeking = true;
      seekToPosition(e);
      e.preventDefault();
    });

    minimapContainer.addEventListener('mousemove', (e) => {
      if (isSeeking) {
        seekToPosition(e);
      }
    });

    const stopSeeking = () => {
      isSeeking = false;
    };

    minimapContainer.addEventListener('mouseup', stopSeeking);
    minimapContainer.addEventListener('mouseleave', stopSeeking);
    document.addEventListener('mouseup', stopSeeking);
  }
}

/**
 * Show error message
 */
function showError(message) {
  elements.errorMessage.textContent = message;
  showContainer(elements.errorContainer);
}

/**
 * Reset to input screen
 */
function reset() {
  // Clear state
  currentSession = null;

  // Destroy HLS
  if (hls) {
    hls.destroy();
    hls = null;
  }

  // Reset video
  elements.video.pause();
  elements.video.src = '';

  // Show input
  showContainer(elements.inputContainer);
}

// Event Listeners

// Landing page - click to generate video
const landingClickable = document.getElementById('landing-clickable');
if (landingClickable) {
  landingClickable.addEventListener('click', () => {
    generateVideo();
  });
}

// Generate another button
elements.generateAnother.addEventListener('click', reset);

// Try again button
elements.tryAgain.addEventListener('click', reset);

// Custom video controls
if (elements.playPauseBtn) {
  elements.playPauseBtn.addEventListener('click', () => {
    if (elements.video.paused) {
      elements.video.play();
    } else {
      elements.video.pause();
    }
  });

  // Update play/pause icon
  elements.video.addEventListener('play', () => {
    elements.playPauseBtn.querySelector('.play-icon').style.display = 'none';
    elements.playPauseBtn.querySelector('.pause-icon').style.display = 'block';
  });

  elements.video.addEventListener('pause', () => {
    elements.playPauseBtn.querySelector('.play-icon').style.display = 'block';
    elements.playPauseBtn.querySelector('.pause-icon').style.display = 'none';
  });

  // Click video to toggle mute (like reference UI)
  elements.video.addEventListener('click', () => {
    elements.video.muted = !elements.video.muted;
  });

  // Spacebar to play/pause
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.target === document.body) {
      e.preventDefault();
      if (elements.video.paused) {
        elements.video.play();
      } else {
        elements.video.pause();
      }
    }
  });
}

if (elements.fullscreenBtn) {
  elements.fullscreenBtn.addEventListener('click', () => {
    const playerContainer = document.querySelector('.player-with-minimap');
    if (!document.fullscreenElement) {
      // Fullscreen the container (includes video + minimap)
      if (playerContainer.requestFullscreen) {
        playerContainer.requestFullscreen();
      } else if (playerContainer.webkitRequestFullscreen) {
        playerContainer.webkitRequestFullscreen();
      } else if (playerContainer.mozRequestFullScreen) {
        playerContainer.mozRequestFullScreen();
      } else if (playerContainer.msRequestFullscreen) {
        playerContainer.msRequestFullscreen();
      }
    } else {
      // Exit fullscreen
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      }
    }
  });
}

// Mute indicator handling
if (elements.muteIndicator && elements.video) {
  // Update indicator visibility based on mute state
  const updateMuteIndicator = () => {
    if (elements.muteIndicator) {
      elements.muteIndicator.style.display = elements.video.muted ? 'block' : 'none';
    }
  };

  // Listen for volume changes
  elements.video.addEventListener('volumechange', updateMuteIndicator);

  // Show mute indicator when video starts playing (since it starts muted)
  elements.video.addEventListener('play', updateMuteIndicator, { once: true });

  // Click mute indicator to toggle mute
  elements.muteIndicator.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent event from bubbling to video element
    elements.video.muted = !elements.video.muted;
  });

  // M key to toggle mute
  document.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M') {
      elements.video.muted = !elements.video.muted;
    }
  });
}

// Spectrogram visualization
function setupSpectrogram() {
  if (!elements.spectrogram || !elements.video) return;

  const canvas = elements.spectrogram;
  const ctx = canvas.getContext('2d');

  // Setup audio context and analyser
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContext.createMediaElementSource(elements.video);
      analyser = audioContext.createAnalyser();

      analyser.fftSize = 256; // Match reference implementation
      analyser.smoothingTimeConstant = 0.8;

      source.connect(analyser);
      analyser.connect(audioContext.destination);
    }

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
      animationId = requestAnimationFrame(draw);

      if (!analyser || !ctx) return;

      analyser.getByteFrequencyData(dataArray);

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Always draw bars (even when muted, they'll just be minimal)
      const barWidth = (canvas.width / bufferLength) * 2;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * canvas.height;
        const x = i * barWidth;

        // Create gradient for each bar (red → pink → blue)
        const gradient = ctx.createLinearGradient(0, 0, 0, barHeight || 1);
        gradient.addColorStop(0, '#ff0000');
        gradient.addColorStop(0.5, '#ff99cc');
        gradient.addColorStop(1, '#0000ff');

        ctx.fillStyle = gradient;
        ctx.fillRect(x, 0, barWidth, barHeight);
      }
    }

    // Start drawing when video plays
    const startDrawing = () => {
      if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
      }
      if (!animationId) {
        draw();
      }
    };

    elements.video.addEventListener('play', startDrawing);

    // Stop drawing when video pauses
    elements.video.addEventListener('pause', () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }
    });

  } catch (error) {
    console.log('Audio context setup failed:', error);
  }
}

// Initialize spectrogram after video starts playing (to ensure video source is loaded)
// This will be called from loadVideo() function

// About overlay functionality
function openAboutOverlay() {
  if (elements.aboutOverlay) {
    elements.aboutOverlay.classList.add('active');
    // Pause video when opening about
    if (elements.video && !elements.video.paused) {
      elements.video.pause();
    }
    // Populate clip sources if we have a session
    populateClipSources();
  }
}

function closeAboutOverlay() {
  if (elements.aboutOverlay) {
    elements.aboutOverlay.classList.remove('active');
  }
}

/**
 * Extract identifier from clip filename
 * Filename format: NETWORK_DATE_TIME_Show_Title_start_end_phrase.ts
 * Example: CSPAN2_20180819_170000_Michael_Chertoff_Exploding_Data_1234_1294_phrase.ts
 * We need to extract the identifier (everything before the timestamp numbers and phrase)
 */
function extractIdentifierFromFilename(filename) {
  // Remove .ts extension
  let name = filename.replace(/\.ts$/, '');

  // Filename format: NETWORK_DATE_TIME_Title_Words_startFrame_endFrame_phrase
  // We need everything up to the last three underscore-separated parts (start_end_phrase)

  // Split by underscore
  const parts = name.split('_');

  // Need at least 4 parts: network, date, time, and something after
  if (parts.length < 4) {
    return null;
  }

  // The last part is the phrase word, and the two before that are frame numbers
  // Remove the last 3 parts (startFrame, endFrame, phrase)
  const identifierParts = parts.slice(0, -3);

  // Reconstruct the identifier
  return identifierParts.join('_');
}

/**
 * Populate the clip sources list from current session
 */
async function populateClipSources() {
  if (!elements.clipSourcesList || !currentSession) {
    return;
  }

  const sessionId = currentSession.sessionId;

  try {
    // Fetch session details to get the script with all clips
    const response = await fetch(`${API_URL}/session/${sessionId}`);
    if (!response.ok) {
      throw new Error('Failed to fetch session details');
    }

    const sessionData = await response.json();
    const script = sessionData.script || [];

    // Extract unique identifiers from phrase clips
    const identifiers = new Set();

    script.forEach(clip => {
      if (clip.type === 'phrase' && clip.filename) {
        const identifier = extractIdentifierFromFilename(clip.filename);
        if (identifier) {
          identifiers.add(identifier);
        }
      }
    });

    // Build the clip sources list
    if (identifiers.size === 0) {
      elements.clipSourcesList.innerHTML = '<p class="loading-sources">No external clips in this generation.</p>';
      return;
    }

    // Create links for each unique identifier
    const links = Array.from(identifiers).map(identifier => {
      const url = `https://archive.org/details/${identifier}`;
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="clip-source-link">${identifier}</a>`;
    });

    elements.clipSourcesList.innerHTML = links.join('');

  } catch (error) {
    console.error('Failed to load clip sources:', error);
    elements.clipSourcesList.innerHTML = '<p class="loading-sources">Unable to load clip sources.</p>';
  }
}

// About button event listeners
if (elements.aboutBtn) {
  elements.aboutBtn.addEventListener('click', openAboutOverlay);
}

if (elements.aboutCloseBtn) {
  elements.aboutCloseBtn.addEventListener('click', closeAboutOverlay);
}

// Close about overlay when clicking outside content
if (elements.aboutOverlay) {
  elements.aboutOverlay.addEventListener('click', (e) => {
    if (e.target === elements.aboutOverlay) {
      closeAboutOverlay();
    }
  });
}

// Close about overlay with Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && elements.aboutOverlay && elements.aboutOverlay.classList.contains('active')) {
    closeAboutOverlay();
  }
});

// Initialize
console.log('Lives of Infamous Men - Video Generator initialized');
console.log('API URL:', API_URL);
console.log('Uses fixed text with session-based randomization');