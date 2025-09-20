// content.js

if (typeof window.spotifySyncGlobal === 'undefined') {
    window.isSpotifySyncContentScriptInjected = true;
    window.spotifySyncGlobal = {
        foundHashes: {},
        latestToken: null // Store the generic token here
    };
    console.log("Spotify Blend Sync: Content Script Initializing...");

    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('interceptor.js');
    (document.head || document.documentElement).appendChild(script);
    script.onload = () => script.remove();

    // Listener for the generic token
    window.addEventListener('SpotifySyncTokenFound', (e) => {
        window.spotifySyncGlobal.latestToken = e.detail.token;
    });

    // Listener for specific hashes
    window.addEventListener('SpotifySyncHashFound', (e) => {
        window.spotifySyncGlobal.foundHashes[e.detail.name] = e.detail.hash;
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getLatestToken") {
        const token = window.spotifySyncGlobal.latestToken;
        if (token) {
            sendResponse({ success: true, token: token });
        } else {
            sendResponse({ success: false, error: "Internal token not captured. Please click around Spotify." });
        }
        return true;
    }

    if (request.action === "getPlaylistHash") {
        const hash = window.spotifySyncGlobal.foundHashes['fetchPlaylist'];
        if (hash) {
            sendResponse({ success: true, hash: hash });
        } else {
            sendResponse({ success: false, error: "Playlist hash not captured. Please click on any playlist." });
        }
        return true;
    }
    
    // The proxy fetch is now handled here. This is simpler and more reliable.
    if (request.action === "proxyFetch") {
        fetch(request.url, request.options)
            .then(response => {
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                return response.json();
            })
            .then(data => sendResponse({ success: true, data: data }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
});