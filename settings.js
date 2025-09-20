// settings.js
const clientIdInput = document.getElementById('client-id');
const saveButton = document.getElementById('save-button');
const statusMessage = document.getElementById('status-message');
const redirectUriDisplay = document.getElementById('redirect-uri-display');

// When the settings page loads, display the unique Redirect URI for the user to copy
document.addEventListener('DOMContentLoaded', () => {
    const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
    redirectUriDisplay.textContent = redirectUri;

    // Also, load the currently saved client_id, if any
    chrome.storage.local.get(['spotify_client_id'], (result) => {
        if (result.spotify_client_id) {
            clientIdInput.value = result.spotify_client_id;
        }
    });
});

// When the user clicks save
saveButton.addEventListener('click', () => {
    const clientId = clientIdInput.value.trim();
    if (clientId) {
        // Save the client ID to Chrome's local storage
        chrome.storage.local.set({ spotify_client_id: clientId }, () => {
            statusMessage.textContent = "Client ID saved!";
            // Now that it's saved, we can redirect the user back to the main popup
            setTimeout(() => {
                window.location.href = "popup.html";
            }, 500);
        });
    } else {
        statusMessage.textContent = "Please enter a Client ID.";
    }
});