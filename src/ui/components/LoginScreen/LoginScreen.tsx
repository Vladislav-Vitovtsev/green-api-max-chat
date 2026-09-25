import { Button, Input, Typography } from '@maxhub/max-ui'
import { useState, type FormEvent } from 'react'
import { toApiError, type ApiErrorKind } from '../../../api/errors/errors'
import type { Credentials } from '../../../api/client/types'
import { IconEye, IconEyeOff } from '../../lib/icons'
import styles from './LoginScreen.module.css'
import { errorText, texts } from '../../lib/texts'

type Props = {
  onLogin(c: Credentials, remember: boolean): Promise<void>
  initialError?: ApiErrorKind | null
}

export function LoginScreen({ onLogin, initialError = null }: Props) {
  const [idInstance, setId] = useState('')
  const [apiTokenInstance, setToken] = useState('')
  const [apiUrl, setUrl] = useState('https://api.green-api.com')
  const [remember, setRemember] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiErrorKind | null>(initialError)

  const canSubmit = idInstance.trim() && apiTokenInstance.trim() && apiUrl.trim() && !busy

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      await onLogin({ idInstance: idInstance.trim(), apiTokenInstance: apiTokenInstance.trim(), apiUrl: apiUrl.trim() }, remember)
    } catch (err) {
      setError(toApiError(err).kind)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className={`${styles.page} pattern-bg`}>
      <form className={styles.card} onSubmit={submit} noValidate>
        <Typography.Headline variant="small" className={styles.title}>{texts.login.title}</Typography.Headline>
        <Typography.Body variant="small" className={styles.subtitle}>{texts.login.subtitle}</Typography.Body>

        <fieldset disabled={busy} className={styles.fieldset}>
          <label className={styles.field}>
            <span>{texts.login.idInstance}</span>
            <Input aria-label={texts.login.idInstance} inputMode="numeric" autoComplete="off"
              value={idInstance} onChange={(e) => setId(e.target.value)} />
          </label>

          <label className={styles.field}>
            <span>{texts.login.apiToken}</span>
            <Input aria-label={texts.login.apiToken} type={showToken ? 'text' : 'password'} autoComplete="off"
              value={apiTokenInstance} onChange={(e) => setToken(e.target.value)}
              iconAfter={
                <button type="button" className={styles.eye} onClick={() => setShowToken((v) => !v)}
                  aria-label={showToken ? texts.login.hide : texts.login.show}>
                  {showToken ? <IconEyeOff /> : <IconEye />}
                </button>
              } />
          </label>

          <label className={styles.field}>
            <span>{texts.login.apiUrl}</span>
            <Input aria-label={texts.login.apiUrl} autoComplete="off" value={apiUrl} onChange={(e) => setUrl(e.target.value)} />
            <small className={styles.hint}>{texts.login.apiUrlHint}</small>
          </label>

          <label className={styles.remember}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            {texts.login.remember}
          </label>
        </fieldset>

        {error && <p role="alert" className={styles.error}>{errorText(error)}</p>}

        <Button type="submit" size="large" stretched loading={busy} disabled={!canSubmit}>{texts.login.submit}</Button>
        <a className={styles.link} href="https://console.green-api.com" target="_blank" rel="noreferrer">{texts.login.where}</a>
      </form>
    </main>
  )
}
