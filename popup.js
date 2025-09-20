const loginSection = document.getElementById('login-section');
const syncSection = document.getElementById('sync-section');
const loginButton = document.getElementById('login-button');
const syncButton = document.getElementById('sync-button');
const userDisplayName = document.getElementById('user-display-name');
const statusMessage = document.getElementById('status-message');
const blendUrlInput = document.getElementById('blend-url');
const friendUsernameInput = document.getElementById('friend-username');
const targetUrlInput = document.getElementById('target-url');

function saveInputs() { chrome.storage.local.set({ savedBlendURL: blendUrlInput.value, savedFriendUsername: friendUsernameInput.value, savedTargetURL: targetUrlInput.value }); }
function loadInputs() { chrome.storage.local.get(['savedBlendURL', 'savedFriendUsername', 'savedTargetURL'], (result) => { if (result.savedBlendURL) blendUrlInput.value = result.savedBlendURL; if (result.savedFriendUsername) friendUsernameInput.value = result.savedFriendUsername; if (result.savedTargetURL) targetUrlInput.value = result.savedTargetURL; }); }

blendUrlInput.addEventListener('input', saveInputs);
friendUsernameInput.addEventListener('input', saveInputs);
targetUrlInput.addEventListener('input', saveInputs);

document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get(['spotify_client_id'], (result) => {
        if (result.spotify_client_id) {
            initializeMainUI();
        } else {
            window.location.href = "settings.html";
        }
    });
});

function initializeMainUI() {
    loadInputs();
    chrome.runtime.sendMessage({ action: "checkAuth" }, (response) => {
        if (chrome.runtime.lastError) {
            statusMessage.textContent = "Error communicating. Please try again.";
            console.error(chrome.runtime.lastError);
            return;
        }
        if (response && response.isLoggedIn) {
            showSyncUI(response.displayName);
        } else {
            showLoginUI();
        }
    });
}

loginButton.addEventListener('click', () => {
    statusMessage.textContent = "Opening Spotify login...";
    chrome.runtime.sendMessage({ action: "login" });
});

syncButton.addEventListener('click', () => {
    const blendURL = blendUrlInput.value.trim();
    const friendUsername = friendUsernameInput.value.trim();
    const targetURL = targetUrlInput.value.trim();
    if (!blendURL || !friendUsername || !targetURL) {
        statusMessage.textContent = "Please fill in all fields.";
        return;
    }
    const getPlaylistId = (url) => {
        try { return new URL(url).pathname.split('/playlist/')[1]; } catch (e) { return null; }
    };
    const blendPlaylistId = getPlaylistId(blendURL);
    const targetPlaylistId = getPlaylistId(targetURL);
    if (!blendPlaylistId || !targetPlaylistId) {
        statusMessage.textContent = "Invalid playlist URL(s).";
        return;
    }
    statusMessage.textContent = "Syncing... this may take a moment.";
    chrome.runtime.sendMessage({
        action: "startSync",
        blendPlaylistId,
        friendUsername,
        targetPlaylistId
    });
});

chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "authSuccess") {
        showSyncUI(message.displayName);
    }
    if (message.action === "syncComplete") {
        if (message.success) {
            statusMessage.textContent = `Success! Added ${message.addedCount} new song(s).`;
        } else {
            if (message.error && message.error.includes("not found")) {
                statusMessage.textContent = "Error: Please browse Spotify to capture necessary data, then try again.";
            } else {
                statusMessage.textContent = `Error: ${message.error}`;
            }
        }
    }
});

function showLoginUI() {
    loginSection.classList.remove('hidden');
    syncSection.classList.add('hidden');
}

function showSyncUI(displayName) {
    loginSection.classList.add('hidden');
    syncSection.classList.remove('hidden');
    userDisplayName.textContent = displayName;
    statusMessage.textContent = "";
}