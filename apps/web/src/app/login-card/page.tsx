// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

import {useState, type CSSProperties, type FormEvent} from 'react';
import {CubeIcon} from '@heroicons/react/24/outline';
import {VStack} from '@astryxdesign/core/Layout';
import {Center} from '@astryxdesign/core/Center';
import {Text, Heading} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Button} from '@astryxdesign/core/Button';
import {Banner} from '@astryxdesign/core/Banner';
import {Card} from '@astryxdesign/core/Card';
import {Link} from '@astryxdesign/core/Link';
import {Icon} from '@astryxdesign/core/Icon';

import { authClient, errorMessage } from '../../api.ts'

const pageStyle: CSSProperties = {
  minHeight: '100%',
  backgroundColor: 'var(--color-background-body)',
}
const contentStyle: CSSProperties = { width: '100%', maxWidth: 400 }

export default function LoginCard({ invitation }: { invitation: boolean }) {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset' | 'password'>(
    () => {
      if (location.pathname === '/reset-password') return 'password'
      const requested = new URLSearchParams(location.search).get('auth')
      return requested === 'signup' || requested === 'reset' ? requested : 'login'
    },
  )
  const [error, setError] = useState('')
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
        if (result.error) throw new Error(result.error.message)
        location.reload()
      }
    } catch (reason) { setError(errorMessage(reason)) } finally { setBusy(false) }
  }
  const labels = { login: 'Sign in', signup: 'Create account', reset: 'Reset password', password: 'Set new password' }
  function changeMode(next: typeof mode) {
    setError('')
    setNotice('')
    setPasswordValue('')
    setMode(next)
  }

  // Astryx CLI 0.7.16, login-card template, connected to Better Auth.
  return <main>
    <Center axis="both" padding={6} minHeight="100dvh" style={pageStyle}>
      <VStack gap={4} hAlign="center" style={contentStyle}>
        <VStack gap={2} hAlign="center">
          <Icon icon={CubeIcon} size="lg" />
          <Text type="body" weight="bold" size="lg">Clausid</Text>
        </VStack>
        <Card padding={8} width="100%">
          <VStack gap={4} hAlign="stretch">
            <VStack gap={1} hAlign="center">
              <Heading level={2} accessibilityLevel={1}>{labels[mode]}</Heading>
              {invitation && <Text color="secondary" size="sm">Use the email address that received the invitation.</Text>}
            </VStack>
            <form className="template-form" onSubmit={submit}>
              <VStack gap={2} hAlign="stretch">
                {mode === 'signup' && <TextInput label="Name" isLabelHidden placeholder="Full name" size="lg" width="100%"
                  htmlName="name" autoComplete="name" isRequired {...{ required: true, maxLength: 120 }}
                  value={name} onChange={setName} />}
                {mode !== 'password' && <TextInput label="Email" isLabelHidden placeholder="name@company.com" size="lg" width="100%"
                  type="email" htmlName="email" autoComplete="email" isRequired {...{ required: true }}
                  value={emailValue} onChange={setEmailValue} />}
                {mode !== 'reset' && <TextInput label="Password" isLabelHidden placeholder="Enter your password" size="lg" width="100%"
                  type="password" htmlName="password" isRequired {...{ required: true, minLength: mode === 'login' ? undefined : 12 }}
                  value={passwordValue} onChange={setPasswordValue} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />}
                {mode === 'login' && <VStack hAlign="end">
                  <Link href="?auth=reset" size="sm" color="secondary" type="supporting" onClick={(event) => {
                    event.preventDefault()
                    changeMode('reset')
                  }}>Forgot password?</Link>
                </VStack>}
              </VStack>
              {notice && <div role="status"><Banner status="success" title={notice} /></div>}
              {error && <div role="alert"><Banner status="error" title={error} /></div>}
              <Button label={labels[mode]} type="submit" variant="primary" size="lg" width="100%" isLoading={busy} />
            </form>
            {mode !== 'password' && <VStack hAlign="center">
              <Text type="supporting" color="secondary">
                {mode === 'login' && 'Don’t have an account? '}
                <Link href={mode === 'login' ? '?auth=signup' : '?auth=login'} type="supporting" onClick={(event) => {
                  event.preventDefault()
                  changeMode(mode === 'login' ? 'signup' : 'login')
                }}>{mode === 'login' ? 'Create an account' : 'Back to sign in'}</Link>
              </Text>
            </VStack>}
          </VStack>
        </Card>
      </VStack>
    </Center>
  </main>
}
