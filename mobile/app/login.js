import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Platform
} from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { signInWithGoogle, signInWithApple, statusCodes } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { useState } from 'react';

export default function LoginScreen() {
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [loadingApple, setLoadingApple] = useState(false);
  const [loadingAnon, setLoadingAnon] = useState(false);

  async function handleContinueAnonymously() {
    setLoadingAnon(true);
    try {
      const { error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      // _layout.js onAuthStateChange handles routing
    } catch (e) {
      Alert.alert('Sign in failed', 'Please try again.');
    } finally {
      setLoadingAnon(false);
    }
  }

  async function handleGoogleSignIn() {
    setLoadingGoogle(true);
    try {
      await signInWithGoogle();
      // _layout.js onAuthStateChange handles routing after sign-in
    } catch (e) {
      if (e.code === statusCodes.SIGN_IN_CANCELLED) return; // user dismissed
      Alert.alert('Sign in failed', 'Please try again.');
    } finally {
      setLoadingGoogle(false);
    }
  }

  async function handleAppleSignIn() {
    setLoadingApple(true);
    try {
      await signInWithApple();
      // _layout.js onAuthStateChange handles routing after sign-in
    } catch (e) {
      if (e.code === 'ERR_CANCELED') return; // user dismissed
      Alert.alert('Sign in failed', 'Please try again.');
    } finally {
      setLoadingApple(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Adlo</Text>
      <Text style={styles.subtitle}>Track spending together.</Text>

      <TouchableOpacity
        style={styles.googleBtn}
        onPress={handleGoogleSignIn}
        disabled={loadingGoogle}
      >
        {loadingGoogle
          ? <ActivityIndicator color="#000" />
          : <Text style={styles.googleBtnText}>Sign in with Google</Text>}
      </TouchableOpacity>

      {Platform.OS === 'ios' && (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={12}
          style={styles.appleBtn}
          onPress={handleAppleSignIn}
        />
      )}

      <TouchableOpacity
        style={styles.anonBtn}
        onPress={handleContinueAnonymously}
        disabled={loadingAnon}
      >
        {loadingAnon
          ? <ActivityIndicator color="#888" />
          : <Text style={styles.anonBtnText}>Continue without account</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', padding: 32, justifyContent: 'center' },
  title: { fontSize: 32, color: '#fff', fontWeight: '700', marginBottom: 8 },
  subtitle: { color: '#888', fontSize: 16, marginBottom: 48 },
  googleBtn: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  googleBtnText: { color: '#000', fontWeight: '700', fontSize: 16 },
  appleBtn: { width: '100%', height: 52 },
  anonBtn: { marginTop: 24, alignItems: 'center', padding: 12 },
  anonBtnText: { color: '#555', fontSize: 14 },
});
