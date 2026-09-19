document.addEventListener('DOMContentLoaded', () => {
  const nicknameInput = document.getElementById('nickname');
  const serverUrlInput = document.getElementById('serverUrl');
  const soundToggle = document.getElementById('soundToggle');
  const saveBtn = document.getElementById('saveBtn');
  const jamStatus = document.getElementById('jamStatus');

  const manualJamInput = document.getElementById('manualJamInput');
  const joinJamBtn = document.getElementById('joinJamBtn');

  // Load existing settings
  chrome.storage.local.get(['nickname', 'serverUrl', 'soundEnabled', 'activeJamRoom'], (res) => {
    if (res.nickname) nicknameInput.value = res.nickname;
    if (res.serverUrl) serverUrlInput.value = res.serverUrl;
    if (res.soundEnabled !== undefined) soundToggle.checked = res.soundEnabled;

    if (res.activeJamRoom) {
      jamStatus.textContent = `Active Jam Room: ${res.activeJamRoom}`;
      jamStatus.style.color = '#1DB954';
      if (manualJamInput) manualJamInput.value = res.activeJamRoom;
    } else {
      jamStatus.textContent = 'Open open.spotify.com to join/detect Jam chat!';
    }
  });

  // Manual Jam Join
  if (joinJamBtn && manualJamInput) {
    joinJamBtn.addEventListener('click', () => {
      let code = manualJamInput.value.trim();
      if (code) {
        // Extract clean code if user pasted a Spotify Jam link (e.g. open.spotify.com/jam/ABC123XYZ)
        const match = code.match(/\/jam\/([a-zA-Z0-9_-]+)/);
        if (match && match[1]) {
          code = match[1];
        }

        chrome.storage.local.set({ activeJamRoom: code }, () => {
          jamStatus.textContent = `Active Jam Room: ${code}`;
          jamStatus.style.color = '#1DB954';
          
          // Send message to Spotify tab to activate chat for this exact room
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0] && tabs[0].url.includes('spotify.com')) {
              chrome.tabs.sendMessage(tabs[0].id, { type: 'FORCE_JOIN_JAM', jamId: code });
            }
          });
        });
      }
    });
  }

  // Save settings
  saveBtn.addEventListener('click', () => {
    const nickname = nicknameInput.value.trim() || 'Viber';
    const serverUrl = serverUrlInput.value.trim() || 'http://localhost:3000';
    const soundEnabled = soundToggle.checked;

    chrome.storage.local.set({ nickname, serverUrl, soundEnabled }, () => {
      saveBtn.textContent = 'Saved! ✓';
      saveBtn.style.backgroundColor = '#1ed760';
      setTimeout(() => {
        saveBtn.textContent = 'Save Settings';
        saveBtn.style.backgroundColor = '#1DB954';
      }, 1500);
    });
  });
});
