// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useState, type FormEvent} from 'react';
import * as stylex from '@stylexjs/stylex';
import {CubeIcon} from '@heroicons/react/24/outline';
import {VStack} from '@astryxdesign/core/Layout';
import {Center} from '@astryxdesign/core/Center';
import {Text, Heading} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Link} from '@astryxdesign/core/Link';
import {Icon} from '@astryxdesign/core/Icon';
import {authClient, errorMessage} from '../../api.ts';

const styles = stylex.create({
  page: {minHeight: '100dvh', backgroundColor: 'var(--color-background-body)'},
  column: {maxWidth: '25rem'},
});

const labels = {
  login: 'Login', signup: 'Create account', reset: 'Send reset link',
  password: 'Set new password', verify: 'Send verification email',
};
type Mode = keyof typeof labels;

function returnURL() {
  const url = new URL(location.href);
  url.searchParams.delete('auth');
  url.searchParams.delete('error');
  return url;
}

function loginAfterReset() {
  const value = new URLSearchParams(location.search).get('returnTo');
  try {
    if (value?.startsWith('/')) {
      const url = new URL(value, location.origin);
      if (url.origin === location.origin && url.pathname !== '/reset-password' && !url.pathname.startsWith('//')) return url;
    }
  } catch { /* Fall back to the home page for malformed URLs. */ }
  return new URL('/', location.origin);
}

export default function LoginCard({invitation}: {invitation: boolean}) {
  const query = new URLSearchParams(location.search);
  const [mode, setMode] = useState<Mode>(() => {
    if (location.pathname === '/reset-password') return 'password';
    const requested = query.get('auth');
    return requested === 'signup' || requested === 'reset' || requested === 'verify' ? requested : 'login';
  });
  const [error, setError] = useState(() => query.has('error') && query.get('auth') === 'verified'
    ? 'This verification link is invalid or expired. Request a new link.' : '');
  const [notice, setNotice] = useState(() => {
    if (query.get('auth') === 'verified' && !query.has('error')) return 'Email verified. Sign in to continue.';
    if (query.get('auth') === 'password-updated') return 'Password reset. Sign in with your new password.';
    return '';
  });
  const [busy, setBusy] = useState(false);
  const [canResend, setCanResend] = useState(query.get('auth') === 'verified' && query.has('error'));
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const token = query.get('token');
  const [expiredReset, setExpiredReset] = useState(false);
  const invalidResetLink = mode === 'password' && (!token || query.has('error') || expiredReset);
  const needsPassword = mode === 'login' || mode === 'signup' || mode === 'password';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || invalidResetLink) return;
    setError('');
    setNotice('');
    if (mode !== 'password' && !email.trim()) {
      setError('Enter your email address.');
      return;
    }
    if (mode === 'signup' && (!name.trim() || name.trim().length > 120)) {
      setError('Enter a name of 1 to 120 characters.');
      return;
    }
    if ((mode === 'signup' || mode === 'password') && (password.length < 12 || password.length > 128)) {
      setError('Use a password of 12 to 128 characters.');
      return;
    }
    if (mode === 'login' && !password) {
      setError('Enter your password.');
      return;
    }
    setBusy(true);
    try {
      const address = email.trim();
      const destination = returnURL();
      const verification = new URL(destination);
      verification.searchParams.set('auth', 'verified');

      if (mode === 'reset') {
        const redirect = new URL('/reset-password', location.origin);
        redirect.searchParams.set('returnTo', destination.pathname + destination.search);
        const result = await authClient.requestPasswordReset({email: address, redirectTo: redirect.href});
        if (result.error) throw new Error(result.error.message || 'Could not request a password reset.');
        setNotice('If an account exists for this email, you’ll receive a password reset link.');
      } else if (mode === 'password') {
        const result = await authClient.resetPassword({token: token!, newPassword: password});
        if (result.error?.code === 'INVALID_TOKEN') {
          setExpiredReset(true);
          setPassword('');
          return;
        }
        if (result.error) throw new Error(result.error.message || 'Could not reset your password.');
        const login = loginAfterReset();
        login.searchParams.set('auth', 'password-updated');
        location.replace(login.href);
      } else if (mode === 'verify') {
        const result = await authClient.sendVerificationEmail({email: address, callbackURL: verification.href});
        if (result.error) throw new Error(result.error.message || 'Could not send verification email.');
        setNotice('If this address is awaiting verification, you’ll receive a new link.');
      } else if (mode === 'signup') {
        const result = await authClient.signUp.email({
          email: address, password, name: name.trim(), callbackURL: verification.href,
        });
        if (result.error) throw new Error(result.error.message || 'Could not create an account.');
        setPassword('');
        setCanResend(true);
        setMode('login');
        setNotice('Check your inbox to verify your email, then sign in.');
      } else {
        const result = await authClient.signIn.email({email: address, password, callbackURL: destination.href});
        if (result.error?.code === 'EMAIL_NOT_VERIFIED') {
          setCanResend(true);
          throw new Error('Verify your email before signing in.');
        }
        if (result.error?.code === 'INVALID_EMAIL_OR_PASSWORD') throw new Error('Incorrect email or password.');
        if (result.error) throw new Error(result.error.message || 'Could not sign in.');
        location.replace(destination.href);
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  function modeLink(next: Mode, label: string) {
    const url = mode === 'password' ? loginAfterReset() : returnURL();
    if (next !== 'login') url.searchParams.set('auth', next);
    return <Link href={url.href} type="supporting" onClick={event => {
      if (mode === 'password') return;
      event.preventDefault();
      if (busy) return;
      setError('');
      setNotice('');
      setPassword('');
      setMode(next);
    }}>{label}</Link>;
  }

  return <main>
    <Center axis="both" padding={6} xstyle={styles.page}>
      <VStack gap={4} hAlign="center" width="100%" xstyle={styles.column}>
        <VStack gap={2} hAlign="center">
          <Icon icon={CubeIcon} size="lg" />
          <Text type="body" weight="bold" size="lg">Clausid</Text>
        </VStack>
        <Card padding={8} width="100%">
          <VStack gap={4} hAlign="stretch">
            <VStack gap={1} hAlign="center">
              <Heading level={2} accessibilityLevel={1}>
                {mode === 'login' ? 'Welcome back' : mode === 'reset' ? 'Reset password' : labels[mode]}
              </Heading>
              {mode === 'login' && <Text color="secondary" size="sm">Sign in to your account</Text>}
              {invitation && <Text color="secondary" size="sm">Use the email address that received the invitation.</Text>}
            </VStack>
            {invalidResetLink ? <>
              <Text role="alert">This password reset link is invalid or expired.</Text>
              {modeLink('reset', 'Request a new reset link')}
            </> : <form onSubmit={submit}>
              <VStack gap={3} width="100%">
                {mode === 'signup' && <TextInput label="Name" autoComplete="name"
                  value={name} onChange={setName} isRequired isReadOnly={busy} />}
                {mode !== 'password' && <TextInput label="Email" type="email" autoComplete="username"
                  value={email} onChange={setEmail} isRequired isReadOnly={busy} />}
                {needsPassword && <TextInput label={mode === 'password' ? 'New password' : 'Password'} type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password} onChange={setPassword} isRequired isReadOnly={busy}
                  description={mode === 'login' ? undefined : 'Use at least 12 characters.'} />}
                {notice && <VStack role="status"><Banner status="success" title={notice} /></VStack>}
                {error && <VStack role="alert"><Banner status="error" title={error} /></VStack>}
                <Button label={labels[mode]} type="submit" variant="primary" size="lg" isLoading={busy} />
              </VStack>
            </form>}
            <VStack gap={2} hAlign="center">
              {mode === 'login' ? <>
                {modeLink('reset', 'Forgot password?')}
                {canResend && modeLink('verify', 'Resend verification email')}
                <Text type="supporting" color="secondary">
                  Don&apos;t have an account? {modeLink('signup', 'Sign up')}
                </Text>
              </> : modeLink('login', 'Back to sign in')}
            </VStack>
          </VStack>
        </Card>
      </VStack>
    </Center>
  </main>;
}
