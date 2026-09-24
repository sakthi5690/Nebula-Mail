import { Router, Request, Response } from 'express';
import { googleOAuthService } from '../services/oauth.service';

const router = Router();

/**
 * GET /api/auth/google
 * Initiates the Google OAuth 2.0 authorization flow.
 * Redirects the user to Google's consent screen.
 */
router.get('/google', (req: Request, res: Response) => {
  try {
    const userId = (req.query.userId as string) || 'default-user';
    const authUrl = googleOAuthService.generateAuthUrl({ userId });
    return res.redirect(authUrl);
  } catch (err: unknown) {
    const error = err as Error;
    console.error('Error generating Google OAuth URL:', error);
    return res.status(500).json({ error: 'Failed to initiate Google OAuth', details: error.message });
  }
});

/**
 * GET /api/auth/callback/google
 * Google OAuth 2.0 callback endpoint.
 * Receives the authorization code from Google, exchanges it for tokens,
 * encrypts and persists credentials in Supabase, then redirects back to frontend.
 */
router.get('/callback/google', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const error = req.query.error as string;
  const stateRaw = req.query.state as string;

  if (error) {
    console.error('Google OAuth error returned:', error);
    const clientOrigin = process.env.CLIENT_ORIGIN || '';
    const redirectBase = clientOrigin.replace(/\/+$/, '');
    return res.redirect(`${redirectBase}/?auth_error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code in OAuth callback' });
  }

  try {
    let userId = 'default-user';
    if (stateRaw) {
      try {
        const parsed = JSON.parse(Buffer.from(stateRaw, 'base64url').toString('utf8'));
        if (parsed.userId) userId = parsed.userId;
      } catch (e) {
        console.warn('Failed to parse OAuth state:', e);
      }
    }

    const { tokens, email } = await googleOAuthService.exchangeCode(code);

    // Cache token session in-memory on the server
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    googleOAuthService.cacheSession(sessionId, {
      email,
      userId,
      accessToken: tokens.access_token || undefined,
      refreshToken: tokens.refresh_token || undefined,
      expiryDate: tokens.expiry_date,
    });

    // Save account & encrypted tokens securely in Supabase if configured
    try {
      await googleOAuthService.saveAccountConnection({
        userId,
        email,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiryDate: tokens.expiry_date,
      });
    } catch (dbError) {
      console.warn('Note: Could not save connection to Supabase (check credentials):', dbError);
    }

    // Set secure server-side session cookie (HTTP only, never exposing tokens)
    res.cookie('stitch_session', sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });
    res.cookie('stitch_user_email', email, {
      httpOnly: false, // UI can read user email safely (no secrets/tokens)
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    const clientOrigin = process.env.CLIENT_ORIGIN || '';
    const redirectBase = clientOrigin.replace(/\/+$/, '');

    // Redirect to frontend with success parameters (NO tokens in URL or storage)
    return res.redirect(`${redirectBase}/?auth_success=true&email=${encodeURIComponent(email)}`);
  } catch (err: unknown) {
    const exchangeError = err as Error;
    console.error('Error exchanging OAuth code:', exchangeError);
    const clientOrigin = process.env.CLIENT_ORIGIN || '';
    const redirectBase = clientOrigin.replace(/\/+$/, '');
    return res.redirect(`${redirectBase}/?auth_error=${encodeURIComponent(exchangeError.message)}`);
  }
});

/**
 * GET /api/auth/status
 * Returns connection status for the authenticated user without exposing tokens.
 */
router.get('/status', async (req: Request, res: Response) => {
  const sessionId = (req.cookies && req.cookies.stitch_session) || '';
  const emailHeader = (req.headers['x-user-email'] as string) || (req.query.email as string) || '';

  let session = sessionId ? googleOAuthService.getCachedSession(sessionId) : undefined;
  if (!session && emailHeader) {
    session = googleOAuthService.getCachedSession(emailHeader);
  }
  if (!session) {
    session = googleOAuthService.getLatestSession();
  }

  if (session && (session.refreshToken || session.accessToken)) {
    return res.json({
      connected: true,
      email: session.email,
      userId: session.userId,
      message: 'Gmail account connected via OAuth',
    });
  }

  return res.json({
    connected: false,
    message: 'No active authenticated Gmail session',
  });
});

export default router;
