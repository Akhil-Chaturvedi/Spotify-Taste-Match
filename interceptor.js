// interceptor.js

if (typeof window.isSpotifySyncInterceptorInjected === 'undefined') {
    window.isSpotifySyncInterceptorInjected = true;

    setTimeout(() => {
        console.log("Spotify Sync: Interceptor is now active.");
        const originalFetch = window.fetch;

        window.fetch = async (url, options) => {
            if (typeof url === 'string' && url.includes('/pathfinder/v2/query')) {
                try {
                    // 1. Always grab the authorization token from any query.
                    const authToken = options.headers.authorization;
                    if (authToken) {
                        window.dispatchEvent(new CustomEvent('SpotifySyncTokenFound', {
                            detail: { token: authToken }
                        }));
                    }

                    // 2. Grab the specific hash for the operation.
                    const body = JSON.parse(options.body);
                    const operationName = body.operationName;
                    const hash = body.extensions.persistedQuery.sha256Hash;
                    
                    if (operationName && hash) {
                        window.dispatchEvent(new CustomEvent('SpotifySyncHashFound', {
                            detail: { name: operationName, hash: hash }
                        }));
                    }
                } catch (e) {}
            }
            return originalFetch(url, options);
        };
    }, 1000);
}