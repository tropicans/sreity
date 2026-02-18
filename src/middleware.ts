import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';

export default auth((req) => {
    const isLoggedIn = !!req.auth;
    const isLoginPage = req.nextUrl.pathname === '/login';
    const isAuthApi = req.nextUrl.pathname.startsWith('/api/auth');
    const isCronApi = req.nextUrl.pathname.startsWith('/api/cron/process-pending');

    // Allow auth API routes
    if (isAuthApi || isCronApi) {
        return NextResponse.next();
    }

    // Redirect logged-in users away from login page
    if (isLoginPage && isLoggedIn) {
        return NextResponse.redirect(new URL('/', req.url));
    }

    // Redirect unauthenticated users to login
    if (!isLoginPage && !isLoggedIn) {
        return NextResponse.redirect(new URL('/login', req.url));
    }

    return NextResponse.next();
});

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
