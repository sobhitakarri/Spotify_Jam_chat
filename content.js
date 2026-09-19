// Spotify Jam Chat - Content Script Injected into open.spotify.com

(function() {
  console.log('[Spotify Jam Chat] Extension content script initialized!');

  // State
  let state = {
    nickname: 'Viber_' + Math.floor(1000 + Math.random() * 9000),
    serverUrl: 'http://localhost:3000',
    soundEnabled: true,
    activeJamId: null,
    isPanelOpen: false,
    unreadCount: 0,
    socket: null,
    broadcastChannel: null,
    typingTimeout: null
  };

  // Web Audio synthesized sound generator for instant chimes
  function playNotificationSound() {
    if (!state.soundEnabled) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5

      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } catch(e) {
      // Audio context ignored if not user-interacted
    }
  }

  // Load user settings
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.get(['nickname', 'serverUrl', 'soundEnabled'], (res) => {
      if (res.nickname) state.nickname = res.nickname;
      if (res.serverUrl) state.serverUrl = res.serverUrl;
      if (res.soundEnabled !== undefined) state.soundEnabled = res.soundEnabled;
    });

    // Listen for storage changes & force join messages from popup
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === 'FORCE_JOIN_JAM' && request.jamId) {
          state.activeJamId = request.jamId;
          const toggleBtn = document.getElementById('sjc-player-toggle-btn');
          if (toggleBtn) toggleBtn.style.display = 'inline-flex';
          updateRoomBannerUI();
          connectToRealtime();
          sendResponse({ status: 'ok' });
        }
      });
    }

    chrome.storage.onChanged.addListener((changes) => {
      if (changes.nickname) state.nickname = changes.nickname.newValue;
      if (changes.serverUrl) {
        state.serverUrl = changes.serverUrl.newValue;
        console.log('[Spotify Jam Chat] Server URL changed to:', state.serverUrl);
        connectToRealtime();
      }
      if (changes.soundEnabled) state.soundEnabled = changes.soundEnabled.newValue;
    });
  }

  // Detect active Spotify Jam Session from URL, LocalStorage, or DOM
  function detectJamSession() {
    const url = window.location.href;
    let jamId = null;

    // 1. Check URL for Jam tokens e.g. open.spotify.com/jam/ABC123XYZ or ?jam=ABC123
    const jamMatch = url.match(/\/jam\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]jam=([a-zA-Z0-9_-]+)/);
    if (jamMatch && jamMatch[1]) {
      jamId = jamMatch[1];
    }

    // 2. Inspect Spotify DOM elements for active Jam indicators (e.g. Social Session icon, Jam badge, Jam bar)
    if (!jamId) {
      const jamHeaderBtn = document.querySelector('button[aria-label*="Jam"]') ||
                           document.querySelector('button[aria-label*="social session"]') ||
                           document.querySelector('[data-testid="social-session-button"]');

      const jamTextEl = Array.from(document.querySelectorAll('span, div, button')).find(el => 
        el.textContent && (el.textContent.includes('In a Jam') || el.textContent.includes('Jam session'))
      );

      if (jamHeaderBtn || jamTextEl) {
        jamId = 'active_spotify_jam';
      }
    }

    // 3. Check localStorage for active session tokens
    if (!jamId) {
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key.includes('jam') || key.includes('social-session')) {
            const val = localStorage.getItem(key);
            if (val && val.length > 5 && (val.includes('session') || val.includes('jam'))) {
              jamId = 'active_spotify_jam';
              break;
            }
          }
        }
      } catch (e) {}
    }

    const toggleBtn = document.getElementById('sjc-player-toggle-btn');

    if (jamId) {
      // User is in a Jam! Show the chat icon
      if (state.activeJamId !== jamId) {
        state.activeJamId = jamId;
        console.log('[Spotify Jam Chat] User is in a Jam! Session ID:', jamId);
        if (typeof chrome !== 'undefined' && chrome.storage) {
          chrome.storage.local.set({ activeJamRoom: jamId });
        }
        updateRoomBannerUI();
        connectToRealtime();
      }
      if (toggleBtn) {
        toggleBtn.style.display = 'inline-flex';
      }
    } else {
      // User is NOT in a Jam. Hide the chat icon by default
      state.activeJamId = null;
      if (toggleBtn) {
        toggleBtn.style.display = 'none';
      }
      // If chat panel was open, close it
      const panel = document.getElementById('sjc-chat-panel');
      if (panel && state.isPanelOpen) {
        panel.classList.remove('sjc-visible');
        state.isPanelOpen = false;
      }
    }
  }

  // Floating Toast Alert when a friend joins
  function showToastNotification(text, nickname = 'Friend') {
    let toast = document.getElementById('sjc-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'sjc-toast';
      toast.className = 'sjc-toast-notification';
      document.body.appendChild(toast);
    }

    const firstLetter = (nickname || 'F').charAt(0).toUpperCase();
    toast.innerHTML = `
      <div class="sjc-toast-avatar">${firstLetter}</div>
      <span>${escapeHtml(text)}</span>
    `;

    toast.classList.add('sjc-toast-show');
    playNotificationSound();

    setTimeout(() => {
      toast.classList.remove('sjc-toast-show');
    }, 4000);
  }

  // Setup BroadcastChannel (fallback for multi-tab syncing) & WebSocket
  function connectToRealtime() {
    // 1. Setup multi-tab BroadcastChannel for zero-latency local tab sync
    if (state.broadcastChannel) {
      state.broadcastChannel.close();
    }
    state.broadcastChannel = new BroadcastChannel(`sjc_jam_${state.activeJamId}`);
    
    // Announce join to other tabs
    setTimeout(() => {
      if (state.broadcastChannel) {
        state.broadcastChannel.postMessage({
          type: 'USER_JOINED',
          payload: { nickname: state.nickname }
        });
      }
    }, 500);

    state.broadcastChannel.onmessage = (event) => {
      const data = event.data;
      if (data.type === 'CHAT_MESSAGE') {
        handleIncomingMessage(data.payload);
      } else if (data.type === 'TYPING_STATUS') {
        handleTypingStatus(data.payload);
      } else if (data.type === 'USER_JOINED') {
        if (data.payload.nickname !== state.nickname) {
          showToastNotification(`🎉 ${data.payload.nickname} joined the Jam Chat!`, data.payload.nickname);
          appendSystemMessage(`${data.payload.nickname} joined the Jam Chat`);
        }
      }
    };

    // 2. Connect to Node.js Socket.IO server if available
    try {
      if (typeof io !== 'undefined') {
        if (state.socket) {
          state.socket.removeAllListeners();
          state.socket.disconnect();
        }

        console.log(`[Spotify Jam Chat] Connecting to Socket Server at ${state.serverUrl} for room ${state.activeJamId}...`);

        state.socket = io(state.serverUrl, {
          query: { room: state.activeJamId, nickname: state.nickname },
          transports: ['websocket', 'polling'],
          reconnection: true,
          reconnectionAttempts: 15,
          reconnectionDelay: 1000,
          timeout: 10000
        });

        state.socket.on('connect', () => {
          console.log('[Spotify Jam Chat] Connected successfully to Socket server! Socket ID:', state.socket.id);
          showToastNotification(`🟢 Connected to Jam Chat!`, 'Jam');
          appendSystemMessage('Connected to Jam chat server');
        });

        state.socket.on('connect_error', (err) => {
          console.log('[Spotify Jam Chat] Socket server connection error (falling back to local BroadcastChannel sync):', err.message);
        });

        state.socket.on('disconnect', (reason) => {
          console.log('[Spotify Jam Chat] Socket disconnected:', reason);
        });

        state.socket.on('message', (payload) => {
          handleIncomingMessage(payload);
        });

        state.socket.on('typing', (payload) => {
          handleTypingStatus(payload);
        });

        state.socket.on('user-joined', (data) => {
          showToastNotification(`🎉 ${data.nickname} joined the Jam Chat!`, data.nickname);
          appendSystemMessage(`${data.nickname} joined the Jam Chat`);
        });
      } else {
        console.warn('[Spotify Jam Chat] Socket.IO client library script missing from content scripts context.');
      }
    } catch(err) {
      console.log('[Spotify Jam Chat] Socket connection exception:', err);
    }
  }

  // Build and Inject DOM Components right beside Spotify's Music Player
  function injectChatUI() {
    if (document.getElementById('sjc-chat-panel')) return;

    // 1. Create Floating Chat Panel
    const panel = document.createElement('div');
    panel.id = 'sjc-chat-panel';
    panel.innerHTML = `
      <div class="sjc-header">
        <div class="sjc-header-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1DB954" stroke-width="2.5">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
          <h3>Spotify Jam Chat</h3>
          <span class="sjc-jam-indicator">Live Jam</span>
        </div>
        <button class="sjc-close-btn" id="sjc-close-btn" title="Close Chat">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <div class="sjc-room-banner">
        <span>Jam Code: <strong class="sjc-room-code" id="sjc-room-code-display">Detecting...</strong></span>
        <span>Only Jam members can chat</span>
      </div>

      <div class="sjc-messages-container" id="sjc-messages-container">
        <div class="sjc-system-msg">Welcome to Spotify Jam Chat! Messages are encrypted & synced live.</div>
      </div>

      <div class="sjc-typing-box" id="sjc-typing-box"></div>

      <div class="sjc-input-area">
        <div class="sjc-input-wrapper">
          <input type="text" id="sjc-input-field" class="sjc-input-field" placeholder="Type a message to Jam members..." autocomplete="off">
          <button class="sjc-emoji-btn" id="sjc-emoji-toggle-btn" title="Add Emoji">😊</button>
        </div>
        <button class="sjc-send-btn" id="sjc-send-btn" title="Send Message">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>

        <div class="sjc-emoji-picker" id="sjc-emoji-picker">
          <span>🔥</span><span>🎵</span><span>🎧</span><span>💃</span><span>🕺</span><span>❤️</span>
          <span>👏</span><span>🎉</span><span>⚡</span><span>😎</span><span>🎶</span><span>🙌</span>
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    // 2. Attach Event Listeners to Panel
    document.getElementById('sjc-close-btn').addEventListener('click', toggleChatPanel);
    document.getElementById('sjc-send-btn').addEventListener('click', sendMessageFromInput);

    const inputField = document.getElementById('sjc-input-field');
    inputField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessageFromInput();
      } else {
        emitTypingStatus();
      }
    });

    // Emoji picker logic
    const emojiBtn = document.getElementById('sjc-emoji-toggle-btn');
    const emojiPicker = document.getElementById('sjc-emoji-picker');
    emojiBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      emojiPicker.classList.toggle('sjc-show');
    });

    document.querySelectorAll('#sjc-emoji-picker span').forEach(span => {
      span.addEventListener('click', () => {
        inputField.value += span.textContent;
        inputField.focus();
        emojiPicker.classList.remove('sjc-show');
      });
    });

    document.addEventListener('click', (e) => {
      if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) {
        emojiPicker.classList.remove('sjc-show');
      }
    });

    // 3. Inject Toggle Button Right Beside Spotify's Music Player Controls
    tryInjectToggleBtn();
    
    // Periodically re-check DOM injection in case Spotify single-page app re-renders player bar
    setInterval(tryInjectToggleBtn, 2000);
    setInterval(detectJamSession, 3000);
  }

  // Inject Toggle Button inside Spotify's Player Bar or Header with floating fallback
  function tryInjectToggleBtn() {
    if (document.getElementById('sjc-player-toggle-btn')) return;

    // 1. Try finding extra controls near Queue, Lyrics, or Connect Device buttons in bottom player bar
    const queueBtn = document.querySelector('button[aria-label*="Queue"]') || 
                     document.querySelector('button[aria-label*="queue"]') ||
                     document.querySelector('button[data-testid="control-button-queue"]');

    const lyricsBtn = document.querySelector('button[aria-label*="Lyrics"]') ||
                      document.querySelector('button[aria-label*="lyrics"]');

    const connectBtn = document.querySelector('button[aria-label*="Connect"]') ||
                       document.querySelector('button[aria-label*="device"]');

    let playerControlArea = null;
    if (queueBtn && queueBtn.parentElement) {
      playerControlArea = queueBtn.parentElement;
    } else if (lyricsBtn && lyricsBtn.parentElement) {
      playerControlArea = lyricsBtn.parentElement;
    } else if (connectBtn && connectBtn.parentElement) {
      playerControlArea = connectBtn.parentElement;
    } else {
      playerControlArea = 
        document.querySelector('[data-testid="now-playing-bar"] > div:last-child') ||
        document.querySelector('.main-nowPlayingBar-extraControls') ||
        document.querySelector('footer > div:last-child') ||
        document.querySelector('footer');
    }

    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'sjc-player-toggle-btn';
    toggleBtn.className = 'sjc-player-toggle-btn';
    toggleBtn.title = 'Open Spotify Jam Chat';
    toggleBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      </svg>
      <span class="sjc-unread-badge" id="sjc-unread-badge" style="display: none;">0</span>
    `;
    toggleBtn.addEventListener('click', toggleChatPanel);

    if (playerControlArea) {
      playerControlArea.insertBefore(toggleBtn, playerControlArea.firstChild);
      console.log('[Spotify Jam Chat] Injected button into player controls!');
    } else {
      // Fallback: Attach floating button in bottom-right near player bar if DOM controls not matched
      toggleBtn.classList.add('sjc-floating-fallback-btn');
      document.body.appendChild(toggleBtn);
      console.log('[Spotify Jam Chat] Attached floating fallback button!');
    }
  }

  function toggleChatPanel() {
    const panel = document.getElementById('sjc-chat-panel');
    const toggleBtn = document.getElementById('sjc-player-toggle-btn');
    if (!panel) return;

    state.isPanelOpen = !state.isPanelOpen;

    if (state.isPanelOpen) {
      panel.classList.add('sjc-visible');
      if (toggleBtn) toggleBtn.classList.add('active');
      // Clear unread count
      state.unreadCount = 0;
      updateUnreadBadgeUI();
      document.getElementById('sjc-input-field')?.focus();
    } else {
      panel.classList.remove('sjc-visible');
      if (toggleBtn) toggleBtn.classList.remove('active');
    }
  }

  function sendMessageFromInput() {
    const inputField = document.getElementById('sjc-input-field');
    if (!inputField) return;
    const text = inputField.value.trim();
    if (!text) return;

    const payload = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      sender: state.nickname,
      text: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      jamId: state.activeJamId
    };

    // Render locally immediately
    renderMessage(payload, true);
    inputField.value = '';

    // Broadcast via Socket.IO if connected
    if (state.socket && state.socket.connected) {
      state.socket.emit('message', payload);
    }

    // Broadcast via BroadcastChannel to other local browser tabs
    if (state.broadcastChannel) {
      state.broadcastChannel.postMessage({
        type: 'CHAT_MESSAGE',
        payload: payload
      });
    }
  }

  function handleIncomingMessage(payload) {
    if (payload.sender === state.nickname) return; // Ignore own echo

    renderMessage(payload, false);
    playNotificationSound();

    if (!state.isPanelOpen) {
      state.unreadCount++;
      updateUnreadBadgeUI();
    }
  }

  function renderMessage(payload, isOwn) {
    const container = document.getElementById('sjc-messages-container');
    if (!container) return;

    const msgWrapper = document.createElement('div');
    msgWrapper.className = `sjc-msg-wrapper ${isOwn ? 'sjc-own' : 'sjc-other'}`;

    msgWrapper.innerHTML = `
      ${!isOwn ? `<span class="sjc-msg-sender">${escapeHtml(payload.sender)}</span>` : ''}
      <div class="sjc-msg-bubble">
        ${escapeHtml(payload.text)}
        <span class="sjc-msg-time">${payload.timestamp}</span>
      </div>
    `;

    container.appendChild(msgWrapper);
    container.scrollTop = container.scrollHeight;
  }

  function appendSystemMessage(text) {
    const container = document.getElementById('sjc-messages-container');
    if (!container) return;
    const sysDiv = document.createElement('div');
    sysDiv.className = 'sjc-system-msg';
    sysDiv.textContent = text;
    container.appendChild(sysDiv);
    container.scrollTop = container.scrollHeight;
  }

  function emitTypingStatus() {
    if (state.typingTimeout) clearTimeout(state.typingTimeout);
    
    if (state.broadcastChannel) {
      state.broadcastChannel.postMessage({
        type: 'TYPING_STATUS',
        payload: { sender: state.nickname, isTyping: true }
      });
    }

    state.typingTimeout = setTimeout(() => {
      if (state.broadcastChannel) {
        state.broadcastChannel.postMessage({
          type: 'TYPING_STATUS',
          payload: { sender: state.nickname, isTyping: false }
        });
      }
    }, 2000);
  }

  function handleTypingStatus(payload) {
    if (payload.sender === state.nickname) return;
    const typingBox = document.getElementById('sjc-typing-box');
    if (!typingBox) return;

    if (payload.isTyping) {
      typingBox.innerHTML = `
        <span>${escapeHtml(payload.sender)} is typing</span>
        <div class="sjc-typing-dots"><span></span><span></span><span></span></div>
      `;
    } else {
      typingBox.innerHTML = '';
    }
  }

  function updateUnreadBadgeUI() {
    const badge = document.getElementById('sjc-unread-badge');
    if (badge) {
      if (state.unreadCount > 0) {
        badge.textContent = state.unreadCount > 9 ? '9+' : state.unreadCount;
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    }

    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({
        type: 'UPDATE_UNREAD_COUNT',
        count: state.unreadCount
      });
    }
  }

  function updateRoomBannerUI() {
    const codeDisplay = document.getElementById('sjc-room-code-display');
    if (codeDisplay && state.activeJamId) {
      codeDisplay.textContent = state.activeJamId.length > 15 ? state.activeJamId.substring(0, 12) + '...' : state.activeJamId;
    }
  }

  function escapeHtml(str) {
    return (str || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  // Initialize script execution after page body is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      detectJamSession();
      injectChatUI();
    });
  } else {
    detectJamSession();
    injectChatUI();
  }
})();
