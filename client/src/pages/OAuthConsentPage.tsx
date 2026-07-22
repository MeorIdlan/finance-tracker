import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth-context';
import { api, ApiError } from '../api';
import Button from '../components/Button';
import AuthCard from '../components/AuthCard';

export default function OAuthConsentPage() {
  const { user, loading } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      const next = `/oauth-consent?${searchParams.toString()}`;
      navigate(`/login?next=${encodeURIComponent(next)}`, { replace: true });
    }
  }, [loading, user, navigate, searchParams]);

  async function approve() {
    setBusy(true);
    setError('');
    try {
      const res = await api<{ redirectUrl: string }>('/oauth/authorize/approve', {
        method: 'POST',
        body: {
          redirectUri: searchParams.get('redirect_uri') ?? undefined,
          state: searchParams.get('state') ?? undefined,
          codeChallenge: searchParams.get('code_challenge') ?? undefined,
          codeChallengeMethod: searchParams.get('code_challenge_method') ?? undefined,
        },
      });
      window.location.href = res.redirectUrl;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not approve access.');
      setBusy(false);
    }
  }

  if (loading || !user) return null;

  return (
    <AuthCard title="Connect an AI agent">
      <p className="mb-4 text-sm text-muted">
        Allow this application to access your finance data using your account?
      </p>
      {error && (
        <p role="alert" className="mb-3 text-sm text-danger">
          {error}
        </p>
      )}
      <Button onClick={approve} disabled={busy} className="w-full">
        Approve
      </Button>
    </AuthCard>
  );
}
