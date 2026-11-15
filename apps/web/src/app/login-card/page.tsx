// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useState, type CSSProperties, type FormEvent} from 'react';
import {CubeIcon} from '@heroicons/react/24/outline';
import {VStack} from '@astryxdesign/core/Layout';
import {Center} from '@astryxdesign/core/Center';
import {Text, Heading} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Link} from '@astryxdesign/core/Link';
import {Divider} from '@astryxdesign/core/Divider';
import {Icon} from '@astryxdesign/core/Icon';

import {authClient, errorMessage} from '../../api.ts';

// Brand sign-in marks — no heroicons or template-assets equivalent.
const AppleIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    width={16}
    height={16}
    aria-hidden="true"
    {...props}>
    <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
  </svg>
);

const GoogleIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    width={16}
    height={16}
    aria-hidden="true"
    {...props}>
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
);

// Standalone auth page paints its own body background (no host shell).
const pageStyle: CSSProperties = {
  minHeight: '100dvh',
  backgroundColor: 'var(--color-background-body)',
};
// Cap the column at 400px but let it shrink to fit narrow screens (Stack
// has no maxWidth prop, so it's set here).
const contentStyle: CSSProperties = {
  width: '100%',
  maxWidth: 400,
};

export default function LoginCard({ invitation }: { invitation: boolean }) {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset' | 'password'>(
    () => {
      if (location.pathname === '/reset-password') return 'password'
      const requested = new URLSearchParams(location.search).get('auth')
      return requested === 'signup' || requested === 'reset' ? requested : 'login'
    },
  )
  const [error, setError] = useState('')
  const [loginFailed, setLoginFailed] = useState(false)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [emailValue, setEmailValue] = useState('')
  const [passwordValue, setPasswordValue] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const email = String(fields.get('email') ?? '')
    const password = String(fields.get('password') ?? '')
    setError('')
    setNotice('')
    setLoginFailed(false)
    setBusy(true)
    try {
      if (mode === 'reset') {
        const result = await authClient.requestPasswordReset({ email, redirectTo: location.origin + '/reset-password' })
        if (result.error) throw new Error(result.error.message)
        setNotice('Check your email for a password reset link.')
      } else if (mode === 'password') {
        const token = new URLSearchParams(location.search).get('token') ?? ''
        const result = await authClient.resetPassword({ token, newPassword: password })
        if (result.error) throw new Error(result.error.message)
        location.assign('/')
      } else if (mode === 'signup') {
        const result = await authClient.signUp.email({
          email, password, name: String(fields.get('name')), callbackURL: location.origin + location.pathname,
        })
        if (result.error) throw new Error(result.error.message)
        setNotice('Check your inbox to verify your email, then sign in.')
      } else {
        const result = await authClient.signIn.email({ email, password })
        if (result.error?.code === 'INVALID_EMAIL_OR_PASSWORD') {
          setLoginFailed(true)
          return
        }
        if (result.error) throw new Error(result.error.message)
        location.reload()
      }
    } catch (reason) { setError(errorMessage(reason)) } finally { setBusy(false) }
  }
  const labels = { login: 'Login', signup: 'Create account', reset: 'Reset password', password: 'Set new password' }
  function changeMode(next: typeof mode) {
    setError('')
    setNotice('')
    setPasswordValue('')
    setLoginFailed(false)
    setMode(next)
  }

  function showUnavailable(message: string) {
    setNotice('')
    setError(message)
  }

  return (
    <main>
      <Center axis="both" padding={6} style={pageStyle}>
        <VStack gap={4} hAlign="center" style={contentStyle}>
          {/* Logo */}
          <VStack gap={2} hAlign="center">
            <Icon icon={CubeIcon} size="lg" />
            <Text type="body" weight="bold" size="lg">
              Clausid
            </Text>
          </VStack>

          {/* Card */}
          <Card padding={8} width="100%">
            <VStack gap={4} hAlign="stretch">
              {/* Header */}
              <VStack gap={1} hAlign="center">
                <Heading level={2} accessibilityLevel={1}>{mode === 'login' ? 'Welcome back' : labels[mode]}</Heading>
                {mode === 'login' && <Text type="body" color="secondary" size="sm">
                  Sign in to your account
                </Text>}
                {invitation && <Text type="body" color="secondary" size="sm">
                  Use the email address that received the invitation.
                </Text>}
              </VStack>

              <form onSubmit={submit} style={{display: 'contents'}}>
                <VStack gap={2}>
                  {mode === 'signup' && (
                    <TextInput label="Name" isLabelHidden placeholder="Full name" size="lg"
                      htmlName="name" autoComplete="name" isRequired {...{required: true, maxLength: 120}}
                      value={name} onChange={setName} />
                  )}
                  {mode !== 'password' && (
                    <TextInput
                      label="Email"
                      isLabelHidden
                      type="email"
                      placeholder="name@company.com"
                      value={emailValue}
                      onChange={setEmailValue}
                      size="lg"
                      htmlName="email"
                      autoComplete="email"
                      isRequired
                      {...{required: true}}
                    />
                  )}
                  {mode !== 'reset' && (
                    <VStack gap={1}>
                      <TextInput
                        label="Password"
                        isLabelHidden
                        placeholder="Enter your password"
                        type="password"
                        value={passwordValue}
                        onChange={(value: string) => {
                          setPasswordValue(value);
                          setLoginFailed(false);
                        }}
                        size="lg"
                        htmlName="password"
                        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                        isRequired
                        {...{required: true, minLength: mode === 'login' ? undefined : 12}}
                        status={loginFailed ? {type: 'error', message: 'Incorrect password. Try again.'} : undefined}
                      />
                      {mode === 'login' && (loginFailed || error) && (
                        <VStack hAlign="end">
                          <Link
                            href="?auth=reset"
                            size="sm"
                            color="secondary"
                            type="supporting"
                            onClick={(event) => {
                              event.preventDefault();
                              changeMode('reset');
                            }}>
                            Forgot password?
                          </Link>
                        </VStack>
                      )}
                    </VStack>
                  )}
                </VStack>

                {notice && <div role="status"><Banner status="success" title={notice} /></div>}
                {error && <div role="alert"><Banner status="error" title={error} /></div>}
                <Button label={labels[mode]} type="submit" variant="primary" size="lg" isLoading={busy} />
              </form>

              {mode === 'login' && <>
                {/* Divider */}
                <Divider label="Or continue with" />

                {/* Social buttons */}
                <VStack gap={3} hAlign="stretch">
                  <Button
                    label="Login with Apple"
                    variant="secondary"
                    icon={<AppleIcon />}
                    onClick={() => showUnavailable('Apple sign-in is unavailable. Use your email to log in.')}
                    size="lg"
                  />
                  <Button
                    label="Login with Google"
                    variant="secondary"
                    icon={<GoogleIcon />}
                    onClick={() => showUnavailable('Google sign-in is unavailable. Use your email to log in.')}
                    size="lg"
                  />
                </VStack>

              </>}

              {mode !== 'password' && <VStack hAlign="center">
                <Text type="supporting" color="secondary">
                  {mode === 'login' && <>Don&apos;t have an account?{' '}</>}
                  <Link href={mode === 'login' ? '?auth=signup' : '?auth=login'} type="supporting"
                    onClick={(event) => {
                      event.preventDefault();
                      changeMode(mode === 'login' ? 'signup' : 'login');
                    }}>
                    {mode === 'login' ? 'Sign up' : 'Back to sign in'}
                  </Link>
                </Text>
              </VStack>}
            </VStack>
          </Card>

          {/* Terms */}
          <VStack hAlign="center" width="100%">
            <Text type="supporting" color="secondary" justify="center">
              Read our{' '}
              <Link href="#" type="supporting" onClick={(event) => {
                event.preventDefault();
                showUnavailable('Terms of Service are unavailable.');
              }}>
                Terms of Service
              </Link>{' '}
              and{' '}
              <Link href="#" type="supporting" onClick={(event) => {
                event.preventDefault();
                showUnavailable('Privacy Policy is unavailable.');
              }}>
                Privacy Policy
              </Link>
              .
            </Text>
          </VStack>
        </VStack>
      </Center>
    </main>
  );
}
