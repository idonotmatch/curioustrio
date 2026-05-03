import { NativeModules } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { supabase } from './supabase';

let googleSigninModule = null;
let googleConfigured = false;

function getGoogleSigninModule() {
  if (googleSigninModule) return googleSigninModule;
  if (!NativeModules?.RNGoogleSignin) return null;
  try {
    googleSigninModule = require('@react-native-google-signin/google-signin');
    return googleSigninModule;
  } catch {
    return null;
  }
}

function configureGoogleSignin() {
  if (googleConfigured) return true;
  const mod = getGoogleSigninModule();
  if (!mod?.GoogleSignin) return false;
  mod.GoogleSignin.configure({
    // webClientId: Web OAuth 2.0 Client ID — used by Supabase to verify the token
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    // iosClientId: iOS OAuth 2.0 Client ID — enables native account picker on iOS
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  });
  googleConfigured = true;
  return true;
}

export const statusCodes = {
  SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
  IN_PROGRESS: 'IN_PROGRESS',
  PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
};

// SHA256 via crypto.subtle (available in Hermes / React Native 0.71+)
async function sha256Hex(str) {
  const msgBuffer = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function secureRandomHex(bytes = 32) {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Secure random generation is not available in this build.');
  }
  const buffer = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buffer);
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function signInWithGoogle() {
  const mod = getGoogleSigninModule();
  if (!mod?.GoogleSignin || !configureGoogleSignin()) {
    throw new Error('Google Sign-In is not available in this build yet. Rebuild the app to enable it.');
  }
  const { GoogleSignin } = mod;
  await GoogleSignin.hasPlayServices();
  const userInfo = await GoogleSignin.signIn();
  const idToken = userInfo.data?.idToken;
  if (!idToken) throw new Error('No ID token from Google');

  const { data: { session: existingSession } } = await supabase.auth.getSession();
  const authMethod = existingSession?.user?.is_anonymous === true
    ? supabase.auth.linkIdentity.bind(supabase.auth)
    : supabase.auth.signInWithIdToken.bind(supabase.auth);

  const { data, error } = await authMethod({
    provider: 'google',
    token: idToken,
  });
  if (error) throw error;
  return data.session;
}

export async function signInWithApple() {
  // Supabase requires a nonce for Apple Sign In. The raw nonce is passed to
  // Supabase; Apple receives the SHA256-hashed version and embeds it in the
  // identity token so Supabase can verify the round-trip.
  const rawNonce = secureRandomHex(16);
  const hashedNonce = await sha256Hex(rawNonce);

  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
    nonce: hashedNonce,
  });
  if (!credential?.identityToken) {
    throw new Error('Apple did not return a valid identity token. Please try again.');
  }

  const { data: { session: existingSession } } = await supabase.auth.getSession();
  const authMethod = existingSession?.user?.is_anonymous === true
    ? supabase.auth.linkIdentity.bind(supabase.auth)
    : supabase.auth.signInWithIdToken.bind(supabase.auth);

  const { data, error } = await authMethod({
    provider: 'apple',
    token: credential.identityToken,
    nonce: rawNonce,
  });
  if (error) throw error;
  return data.session;
}

export async function signOut() {
  await supabase.auth.signOut();
  try {
    const mod = getGoogleSigninModule();
    if (!mod?.GoogleSignin || !configureGoogleSignin()) return;
    const { GoogleSignin } = mod;
    await GoogleSignin.revokeAccess();
    await GoogleSignin.signOut();
  } catch {
    // Not signed in via Google — ignore
  }
}
