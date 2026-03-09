export { auth as middleware } from '@/lib/auth';

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - /login
     * - /api/auth (NextAuth routes)
     * - /api/cron (protected by CRON_SECRET)
     * - _next/static, _next/image, favicon.ico
     */
    '/((?!login|api/auth|api/cron|_next/static|_next/image|favicon\\.ico).*)',
  ],
};
