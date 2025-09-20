// background.js

async function ensureContentScriptInjected(tabId) {
    const results = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: () => window.isSpotifySyncContentScriptInjected,
    });
    if (!results || !results[0] || !results[0].result) {
        console.log("Content script not found, injecting programmatically...");
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ["content.js"],
        });
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}

async function getAuthToken(interactive) {
  const { spotify_client_id } = await chrome.storage.local.get("spotify_client_id");
  if (!spotify_client_id) throw new Error("Spotify Client ID not configured.");
  const REDIRECT_URI = `https://${chrome.runtime.id}.chromiumapp.org/`;
  const SCOPES = ["playlist-read-private", "playlist-modify-public", "playlist-modify-private"];
  const AUTH_URL = `https://accounts.spotify.com/authorize?client_id=${spotify_client_id}&response_type=token&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPES.join(' '))}`;
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: AUTH_URL, interactive }, (redirectUrl) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (redirectUrl) {
        try {
          const params = new URLSearchParams(new URL(redirectUrl).hash.substring(1));
          const token = params.get("access_token");
          if (token) {
            chrome.storage.local.set({ spotify_access_token: token });
            resolve(token);
          } else { reject(new Error("Token not found in redirect URL.")); }
        } catch (e) { reject(new Error("Error parsing redirect URL.")); }
      } else { reject(new Error("Authentication flow was cancelled.")); }
    });
  });
}

async function getValidAccessToken() {
    const { spotify_access_token } = await chrome.storage.local.get("spotify_access_token");
    if (!spotify_access_token) throw new Error("Not logged in.");
    const response = await fetch('https://api.spotify.com/v1/me', { headers: { 'Authorization': `Bearer ${spotify_access_token}` } });
    if (response.status === 401) {
        console.log("Access token expired. Re-authenticating...");
        return await getAuthToken(true);
    }
    if (!response.ok) throw new Error("Failed to validate token.");
    return spotify_access_token;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "login") {
    getAuthToken(true).then(async token => {
      const userProfile = await fetch('https://api.spotify.com/v1/me', { headers: { 'Authorization': `Bearer ${token}` } }).then(res => res.json());
      chrome.runtime.sendMessage({ action: "authSuccess", displayName: userProfile.display_name });
    }).catch(error => { console.error("Login failed:", error); });
    return true;
  }
  if (request.action === "checkAuth") {
     getValidAccessToken().then(async token => {
        const userProfile = await fetch('https://api.spotify.com/v1/me', { headers: { 'Authorization': `Bearer ${token}` } }).then(res => res.json());
        sendResponse({ isLoggedIn: true, displayName: userProfile.display_name });
     }).catch(error => { sendResponse({ isLoggedIn: false }); });
    return true;
  }
  if (request.action === "startSync") {
    handleSyncRequest(request);
    return true;
  }
});

async function handleSyncRequest(data) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, url: "https://open.spotify.com/*" });
    if (!tab) throw new Error("No active Spotify tab found.");
    await ensureContentScriptInjected(tab.id);

    const userAccessToken = await getValidAccessToken();

    const tokenResponse = await chrome.tabs.sendMessage(tab.id, { action: "getLatestToken" });
    if (!tokenResponse || !tokenResponse.success) {
        throw new Error(tokenResponse.error);
    }
    const internalAccessToken = tokenResponse.token;
    
    const hashResponse = await chrome.tabs.sendMessage(tab.id, { action: "getPlaylistHash" });
    if (!hashResponse || !hashResponse.success) {
        throw new Error(hashResponse.error);
    }
    const fetchPlaylistHash = hashResponse.hash;
    
    const blendPlaylistData = await proxyFetchBlendData(tab.id, data.blendPlaylistId, internalAccessToken, fetchPlaylistHash);
    
    const songsToSyncUris = filterSongs(blendPlaylistData, data.friendUsername);
    const existingTrackUris = await getExistingTracks(data.targetPlaylistId, userAccessToken);
    const newTracksToAdd = songsToSyncUris.filter(uri => !existingTrackUris.has(uri));
    
    let addedCount = 0;
    if (newTracksToAdd.length > 0) {
      addedCount = await addTracksToPlaylist(newTracksToAdd, data.targetPlaylistId, userAccessToken);
    }
    chrome.runtime.sendMessage({ action: "syncComplete", success: true, addedCount: addedCount });
  } catch (error) {
    console.error("Full error object during sync:", error);
    chrome.runtime.sendMessage({ action: "syncComplete", success: false, error: error.message });
  }
}

async function proxyFetchBlendData(tabId, playlistId, accessToken, sha256Hash) {
    const requestUrl = 'https://api-partner.spotify.com/pathfinder/v2/query';
    const requestOptions = {
        method: 'POST',
        headers: {
            'accept': 'application/json',
            'app-platform': 'WebPlayer',
            'authorization': accessToken, 
            'content-type': 'application/json;charset=UTF-8',
        },
        body: JSON.stringify({
            operationName: 'fetchPlaylist',
            variables: { uri: `spotify:playlist:${playlistId}`, offset: 0, limit: 100, enableWatchFeedEntrypoint: true },
            extensions: { persistedQuery: { version: 1, sha256Hash: sha256Hash } }
        }),
    };
    
    const response = await chrome.tabs.sendMessage(tabId, { 
        action: "proxyFetch", 
        url: requestUrl, 
        options: requestOptions
    });

    if (!response || !response.success) throw new Error(`Proxy fetch failed: ${response.error || 'Unknown error'}`);
    return response.data;
}

function filterSongs(playlistData, friendDisplayName) {
    const songsToSyncUris = new Set();
    const items = playlistData?.data?.playlistV2?.content?.items || [];
    for (const item of items) {
        const metadataAttr = item.attributes.find(attr => attr.key === 'multiUserAttributionMetadata');
        if (!metadataAttr) continue;
        try {
            const metadata = JSON.parse(metadataAttr.value);
            const attributedUsers = metadata.attributed_users || [];
            const isFriendInterested = attributedUsers.some(
                user => user.display_name === friendDisplayName && user.description === "Listened to this song"
            );
            if (isFriendInterested && item.itemV2?.data?.uri) {
                songsToSyncUris.add(item.itemV2.data.uri);
            }
        } catch (e) { console.warn("Could not parse multiUserAttributionMetadata", metadataAttr.value, e); }
    }
    return Array.from(songsToSyncUris);
}

async function getExistingTracks(playlistId, accessToken) {
    const allTracks = new Set();
    let url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?fields=items(track(uri)),next&limit=50`;
    while (url) {
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        if (!response.ok) throw new Error(`Failed to get existing tracks: ${response.statusText}`);
        const data = await response.json();
        data.items.forEach(item => { if (item.track && item.track.uri) allTracks.add(item.track.uri); });
        url = data.next;
    }
    return allTracks;
}

async function addTracksToPlaylist(trackUris, playlistId, accessToken) {
    for (let i = 0; i < trackUris.length; i += 100) {
        const chunk = trackUris.slice(i, i + 100);
        const url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ uris: chunk }),
        });
        if (!response.ok) throw new Error(`Failed to add tracks: ${response.statusText}`);
    }
    return trackUris.length;
}