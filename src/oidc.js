import {
    discovery,
    randomState,
    randomNonce,
    randomPKCECodeVerifier,
    calculatePKCECodeChallenge,
    buildAuthorizationUrl,
    authorizationCodeGrant,
    fetchUserInfo,
} from 'openid-client';

let config;

export async function initOIDC() {
    const clientSecret = process.env.ZITADEL_CLIENT_SECRET?.trim();
    config = await discovery(
        new URL(process.env.ZITADEL_ISSUER),
        process.env.ZITADEL_CLIENT_ID,
        clientSecret || undefined
    );
}

export function getConfig() {
    return config;
}

export {
    randomState,
    randomNonce,
    randomPKCECodeVerifier,
    calculatePKCECodeChallenge,
    buildAuthorizationUrl,
    authorizationCodeGrant,
    fetchUserInfo,
};

export function requireAuth(req, res, next) {
    if (req.session?.user) return next();
    req.session.returnTo = req.originalUrl;
    res.redirect('/auth/login');
}
