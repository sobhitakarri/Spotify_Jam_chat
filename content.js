// Spotify Jam Chat - Content Script Injected into open.spotify.com

(function() {
  console.log('[Spotify Jam Chat] Extension content script initializing...');

  // State
  let state = {
    nickname: 'Spotify User',
    serverUrl: 'https://spotify-jam-chat-2ude.onrender.com',
    activeJamId: null,
    isPanelOpen: false,
    unreadCount: 0,
    onlineCount: 1,
    socket: null,
    broadcastChannel: null,
    typingTimeout: null
  };

  // Synthesize soft chime sound
  function playNotificationSound() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);

      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } catch(e) {}
  }

  // 1. Auto-Extract Official Spotify Display Name from DOM & LocalStorage
  function extractSpotifyUsername() {
    let name = null;

    // Strategy A: DOM Selectors for Spotify User Profile
    const selectors = [
      '[data-testid="user-widget-link"]',
      '[data-testid="user-widget-dropdown-button"]',
      'button[data-testid="user-widget-link"] span',
      'button[aria-label*="Profile" i]',
      'button[aria-label*="profile" i]',
      'figure[data-testid="user-widget-avatar"]',
      'header figure'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        // Check text content or parent element text
        let txt = el.textContent || el.getAttribute('aria-label') || el.parentElement?.textContent || '';
        txt = txt.replace(/^Profile:\s*/i, '').replace(/profile/i, '').replace(/account/i, '').trim();
        if (txt && txt.length >= 2 && !txt.toLowerCase().includes('spotify') && !txt.toLowerCase().includes('install')) {
          name = txt;
          break;
        }
      }
    }

    // Strategy B: Check aria-labels of all top header buttons
    if (!name) {
      const headerBtns = document.querySelectorAll('header button, [role="banner"] button');
      for (const btn of headerBtns) {
        const aria = btn.getAttribute('aria-label') || '';
        if (aria && !aria.includes('Notification') && !aria.includes('Install') && !aria.includes('Jam') && !aria.includes('Search') && !aria.includes('Home')) {
          const clean = aria.replace(/^Profile:\s*/i, '').replace(/profile/i, '').trim();
          if (clean && clean.length >= 2) {
            name = clean;
            break;
          }
        }
      }
    }

    // Strategy C: Search localStorage for cached Spotify user profile object
    if (!name) {
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key.includes('user') || key.includes('profile') || key.includes('session')) {
            const val = localStorage.getItem(key);
            if (val && val.includes('display_name')) {
              const match = val.match(/"display_name"\s*:\s*"([^"]+)"/);
              if (match && match[1]) {
                name = match[1];
                break;
              }
            }
          }
        }
      } catch (e) {}
    }

    if (name && name !== state.nickname) {
      state.nickname = name;
      console.log('[Spotify Jam Chat] Successfully extracted Spotify Display Name:', name);
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.set({ spotifyUsername: name });
      }
    }
  }

  // Load storage settings & restore active Jam session
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.get(['serverUrl', 'spotifyUsername', 'activeJamRoom'], (res) => {
      if (res.serverUrl) state.serverUrl = res.serverUrl;
      if (res.spotifyUsername) state.nickname = res.spotifyUsername;
      if (res.activeJamRoom) {
        state.activeJamId = res.activeJamRoom;
        console.log('[Spotify Jam Chat] Restored active Jam room from storage:', res.activeJamRoom);
      } else {
        state.activeJamId = 'spotify_jam_session';
      }
      detectJamSession();
    });

    chrome.storage.onChanged.addListener((changes) => {
      if (changes.serverUrl) {
        state.serverUrl = changes.serverUrl.newValue;
        console.log('[Spotify Jam Chat] Server URL updated:', state.serverUrl);
        connectToRealtime();
      }
      if (changes.spotifyUsername) {
        state.nickname = changes.spotifyUsername.newValue;
      }
      if (changes.activeJamRoom) {
        state.activeJamId = changes.activeJamRoom.newValue;
        detectJamSession();
      }
    });

    // Listen for force join from popup
    if (chrome.runtime) {
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === 'FORCE_JOIN_JAM' && request.jamId) {
          state.activeJamId = request.jamId;
          chrome.storage.local.set({ activeJamRoom: request.jamId });
          const toggleBtn = document.getElementById('sjc-player-toggle-btn');
          if (toggleBtn) toggleBtn.style.display = 'inline-flex';
          updateRoomBannerUI();
          connectToRealtime();
          sendResponse({ status: 'ok' });
        }
      });
    }
  }

  // 2. Auto-Detect Active Spotify Jam Session Token
  function detectJamSession() {
    extractSpotifyUsername();

    const url = window.location.href;
    let jamId = null;

    // Check URL for Jam parameters
    const jamMatch = url.match(/\/jam\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]jam=([a-zA-Z0-9_-]+)/);
    if (jamMatch && jamMatch[1]) {
      jamId = jamMatch[1];
    }

    // Inspect Spotify DOM elements for active Jam indicators
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

    // Fallback to active room stored in state
    if (!jamId && state.activeJamId) {
      jamId = state.activeJamId;
    }

    if (!jamId) {
      jamId = 'spotify_jam_session';
    }

    state.activeJamId = jamId;
    const toggleBtn = document.getElementById('sjc-player-toggle-btn');
    if (toggleBtn) {
      toggleBtn.style.display = 'inline-flex';
    }

    if (state.activeJamId && (!state.socket || !state.socket.connected)) {
      connectToRealtime();
    }
  }

  // Toast notification
  function showToastNotification(text, nickname = 'Jam') {
    let toast = document.getElementById('sjc-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'sjc-toast';
      toast.className = 'sjc-toast-notification';
      document.body.appendChild(toast);
    }

    const firstLetter = (nickname || 'J').charAt(0).toUpperCase();
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

  // 3. Connect to Real-time Socket Server
  function connectToRealtime() {
    if (!state.activeJamId) return;

    // Multi-tab BroadcastChannel fallback
    if (state.broadcastChannel) state.broadcastChannel.close();
    state.broadcastChannel = new BroadcastChannel(`sjc_jam_${state.activeJamId}`);

    state.broadcastChannel.onmessage = (event) => {
      const data = event.data;
      if (data.type === 'CHAT_MESSAGE') handleIncomingMessage(data.payload);
      if (data.type === 'TYPING_STATUS') handleTypingStatus(data.payload);
      if (data.type === 'READ_ACK') updateMessageTickToRead(data.payload.msgId);
    };

    // Socket.IO WSS Connection to Render Server
    try {
      if (typeof io !== 'undefined') {
        if (state.socket) {
          state.socket.removeAllListeners();
          state.socket.disconnect();
        }

        console.log(`[Spotify Jam Chat] Connecting to Cloud Relay Server: ${state.serverUrl}...`);

        state.socket = io(state.serverUrl, {
          query: { room: state.activeJamId, nickname: state.nickname },
          transports: ['websocket', 'polling'],
          reconnection: true,
          reconnectionAttempts: 20,
          reconnectionDelay: 1000
        });

        state.socket.on('connect', () => {
          console.log('[Spotify Jam Chat] Connected to Cloud Server! Socket ID:', state.socket.id);
          showToastNotification('🟢 Connected to Jam Chat cloud server!', 'Cloud');
        });

        state.socket.on('room-presence', (presenceData) => {
          console.log('[Spotify Jam Chat] Presence update:', presenceData);
          state.onlineCount = presenceData.onlineCount;
          
          if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.set({ onlineCount: presenceData.onlineCount });
          }
          
          updatePresenceUI();
        });

        state.socket.on('message', (payload) => {
          handleIncomingMessage(payload);
          // Emit read acknowledgment back to sender
          if (state.socket && state.socket.connected) {
            state.socket.emit('read-ack', { msgId: payload.id });
          }
        });

        state.socket.on('read-ack', (ackData) => {
          updateMessageTickToRead(ackData.msgId);
        });

        state.socket.on('typing', (payload) => {
          handleTypingStatus(payload);
        });
      }
    } catch(err) {
      console.log('[Spotify Jam Chat] Socket error:', err);
    }
  }

  // 4. Update Partner Connection Lock State UI
  function updatePresenceUI() {
    const badge = document.getElementById('sjc-presence-badge');
    const lockBanner = document.getElementById('sjc-lock-banner');
    const inputField = document.getElementById('sjc-input-field');
    const sendBtn = document.getElementById('sjc-send-btn');

    if (state.onlineCount >= 2) {
      // Unlocked State: Partner is connected!
      if (badge) {
        badge.textContent = `${state.onlineCount} Online`;
        badge.className = 'sjc-presence-badge online';
      }
      if (lockBanner) {
        lockBanner.className = 'sjc-lock-banner unlocked';
        lockBanner.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
          <span>🎉 Connected with Jam Partner! Start chatting</span>
        `;
      }
      if (inputField) {
        inputField.disabled = false;
        inputField.placeholder = "Type a message to Jam partner...";
      }
      if (sendBtn) sendBtn.disabled = false;
    } else {
      // Locked State: Waiting for partner!
      if (badge) {
        badge.textContent = `1 Online`;
        badge.className = 'sjc-presence-badge';
      }
      if (lockBanner) {
        lockBanner.className = 'sjc-lock-banner';
        lockBanner.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
          <span>🔒 Waiting for Jam partner to join...</span>
        `;
      }
      if (inputField) {
        inputField.disabled = true;
        inputField.placeholder = "Messaging locked until partner joins...";
      }
      if (sendBtn) sendBtn.disabled = true;
    }
  }

  // Inject UI Layout
  function injectChatUI() {
    if (document.getElementById('sjc-chat-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'sjc-chat-panel';
    panel.innerHTML = `
      <div class="sjc-header">
        <div class="sjc-header-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1DB954" stroke-width="2.5">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
          <h3>Spotify Jam Chat</h3>
          <span class="sjc-presence-badge" id="sjc-presence-badge">1 Online</span>
        </div>
        <button class="sjc-close-btn" id="sjc-close-btn" title="Close Chat">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <div class="sjc-lock-banner" id="sjc-lock-banner">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
        <span>🔒 Waiting for Jam partner to join...</span>
      </div>

      <div class="sjc-messages-container" id="sjc-messages-container">
        <div class="sjc-system-msg">Jam Chat initialized. Both members must be connected to chat.</div>
      </div>

      <div class="sjc-typing-box" id="sjc-typing-box"></div>

      <div class="sjc-input-area">
        <div class="sjc-input-wrapper">
          <input type="text" id="sjc-input-field" class="sjc-input-field" placeholder="Messaging locked until partner joins..." disabled autocomplete="off">
          <button class="sjc-emoji-btn" id="sjc-emoji-toggle-btn" title="Add Emoji">😊</button>
        </div>
        <button class="sjc-send-btn" id="sjc-send-btn" title="Send Message" disabled>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
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

    document.getElementById('sjc-close-btn').addEventListener('click', toggleChatPanel);
    document.getElementById('sjc-send-btn').addEventListener('click', sendMessageFromInput);

    const inputField = document.getElementById('sjc-input-field');
    inputField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !inputField.disabled) {
        e.preventDefault();
        sendMessageFromInput();
      } else {
        emitTypingStatus();
      }
    });

    const emojiBtn = document.getElementById('sjc-emoji-toggle-btn');
    const emojiPicker = document.getElementById('sjc-emoji-picker');
    emojiBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      emojiPicker.classList.toggle('sjc-show');
    });

    document.querySelectorAll('#sjc-emoji-picker span').forEach(span => {
      span.addEventListener('click', () => {
        if (!inputField.disabled) {
          inputField.value += span.textContent;
          inputField.focus();
        }
        emojiPicker.classList.remove('sjc-show');
      });
    });

    tryInjectToggleBtn();
    setInterval(tryInjectToggleBtn, 2000);
    setInterval(detectJamSession, 3000);
  }

  // Inject Player Toggle Button
  function tryInjectToggleBtn() {
    if (document.getElementById('sjc-player-toggle-btn')) return;

    const queueBtn = document.querySelector('button[aria-label*="Queue"]') || 
                     document.querySelector('button[aria-label*="queue"]') ||
                     document.querySelector('button[data-testid="control-button-queue"]');

    const lyricsBtn = document.querySelector('button[aria-label*="Lyrics"]') ||
                      document.querySelector('button[aria-label*="lyrics"]');

    const connectBtn = document.querySelector('button[aria-label*="Connect"]') ||
                       document.querySelector('button[aria-label*="device"]');

    let playerControlArea = null;
    if (queueBtn && queueBtn.parentElement) playerControlArea = queueBtn.parentElement;
    else if (lyricsBtn && lyricsBtn.parentElement) playerControlArea = lyricsBtn.parentElement;
    else if (connectBtn && connectBtn.parentElement) playerControlArea = connectBtn.parentElement;
    else {
      playerControlArea = 
        document.querySelector('[data-testid="now-playing-bar"] > div:last-child') ||
        document.querySelector('.main-nowPlayingBar-extraControls') ||
        document.querySelector('footer');
    }

    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'sjc-player-toggle-btn';
    toggleBtn.className = 'sjc-player-toggle-btn';
    toggleBtn.title = 'Open Spotify Jam Chat';
    toggleBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      </svg>
      <span class="sjc-unread-badge" id="sjc-unread-badge" style="display: none;">0</span>
    `;
    toggleBtn.addEventListener('click', toggleChatPanel);

    if (playerControlArea) {
      playerControlArea.insertBefore(toggleBtn, playerControlArea.firstChild);
    } else {
      toggleBtn.classList.add('sjc-floating-fallback-btn');
      document.body.appendChild(toggleBtn);
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
      state.unreadCount = 0;
      updateUnreadBadgeUI();
      document.getElementById('sjc-input-field')?.focus();
    } else {
      panel.classList.remove('sjc-visible');
      if (toggleBtn) toggleBtn.classList.remove('active');
    }
  }

  // 5. Send Message with Status Ticks (🕒 -> ✓ -> ✓✓)
  function sendMessageFromInput() {
    const inputField = document.getElementById('sjc-input-field');
    if (!inputField || inputField.disabled) return;
    const text = inputField.value.trim();
    if (!text) return;

    const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    const payload = {
      id: msgId,
      sender: state.nickname,
      text: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      jamId: state.activeJamId
    };

    // Render locally with Sending status tick (🕒)
    renderMessage(payload, true, 'sending');
    inputField.value = '';

    // Broadcast over Socket.IO & handle server ACK (✓)
    if (state.socket && state.socket.connected) {
      state.socket.emit('message', payload, (ack) => {
        if (ack && ack.status === 'sent') {
          updateMessageTickToSent(msgId);
        }
      });
    } else {
      // Fallback ACK
      setTimeout(() => updateMessageTickToSent(msgId), 300);
    }

    if (state.broadcastChannel) {
      state.broadcastChannel.postMessage({ type: 'CHAT_MESSAGE', payload });
    }
  }

  function handleIncomingMessage(payload) {
    if (payload.sender === state.nickname) return;

    renderMessage(payload, false, null);
    playNotificationSound();

    if (!state.isPanelOpen) {
      state.unreadCount++;
      updateUnreadBadgeUI();
    }
  }

  function renderMessage(payload, isOwn, tickState = 'sending') {
    const container = document.getElementById('sjc-messages-container');
    if (!container) return;

    const msgWrapper = document.createElement('div');
    msgWrapper.className = `sjc-msg-wrapper ${isOwn ? 'sjc-own' : 'sjc-other'}`;
    msgWrapper.dataset.msgId = payload.id;

    let tickHtml = '';
    if (isOwn) {
      tickHtml = `<span class="sjc-msg-tick sending" id="tick_${payload.id}">🕒</span>`;
    }

    msgWrapper.innerHTML = `
      ${!isOwn ? `<span class="sjc-msg-sender">${escapeHtml(payload.sender)}</span>` : ''}
      <div class="sjc-msg-bubble">
        ${escapeHtml(payload.text)}
        <div class="sjc-msg-meta">
          <span>${payload.timestamp}</span>
          ${tickHtml}
        </div>
      </div>
    `;

    container.appendChild(msgWrapper);
    container.scrollTop = container.scrollHeight;
  }

  function updateMessageTickToSent(msgId) {
    const tickEl = document.getElementById(`tick_${msgId}`);
    if (tickEl) {
      tickEl.className = 'sjc-msg-tick sent';
      tickEl.textContent = '✓';
    }
  }

  function updateMessageTickToRead(msgId) {
    const tickEl = document.getElementById(`tick_${msgId}`);
    if (tickEl) {
      tickEl.className = 'sjc-msg-tick read';
      tickEl.textContent = '✓✓';
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
  }

  function updateRoomBannerUI() {}

  function emitTypingStatus() {
    if (state.typingTimeout) clearTimeout(state.typingTimeout);
    if (state.socket && state.socket.connected) {
      state.socket.emit('typing', { sender: state.nickname, isTyping: true });
    }
    state.typingTimeout = setTimeout(() => {
      if (state.socket && state.socket.connected) {
        state.socket.emit('typing', { sender: state.nickname, isTyping: false });
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

  function escapeHtml(str) {
    return (str || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

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
