document.addEventListener('DOMContentLoaded', () => {
  const serverUrlInput = document.getElementById('serverUrl');
  const userDisplayName = document.getElementById('userDisplayName');
  const saveBtn = document.getElementById('saveBtn');
  const jamStatus = document.getElementById('jamStatus');
  const presenceStatus = document.getElementById('presenceStatus');

  const defaultRenderUrl = 'https://spotify-jam-chat-2ude.onrender.com';

  // Load existing settings
  chrome.storage.local.get(['serverUrl', 'spotifyUsername', 'activeJamRoom', 'onlineCount'], (res) => {
    serverUrlInput.value = res.serverUrl || defaultRenderUrl;

    if (res.spotifyUsername) {
      userDisplayName.textContent = res.spotifyUsername;
    } else {
      userDisplayName.textContent = 'Spotify User';
    }

    if (res.activeJamRoom) {
      jamStatus.textContent = `Jam Room: ${res.activeJamRoom}`;
      jamStatus.style.color = '#1DB954';
    } else {
      jamStatus.textContent = 'Open open.spotify.com in a Jam to connect!';
    }

    if (res.onlineCount >= 2) {
      presenceStatus.textContent = `🟢 Connected with Jam Partner (${res.onlineCount} Online)`;
      presenceStatus.classList.add('online');
    } else {
      presenceStatus.textContent = `⏳ Waiting for Jam Partner to join...`;
      presenceStatus.classList.remove('online');
    }
  });

  // Save server settings
  saveBtn.addEventListener('click', () => {
    const serverUrl = serverUrlInput.value.trim() || defaultRenderUrl;

    chrome.storage.local.set({ serverUrl }, () => {
      saveBtn.textContent = 'Saved! ✓';
      saveBtn.style.backgroundColor = '#1ed760';
      setTimeout(() => {
        saveBtn.textContent = 'Save Server Settings';
        saveBtn.style.backgroundColor = '#1DB954';
      }, 1500);
    });
  });
});
