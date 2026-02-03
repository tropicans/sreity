import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

// List of allowed email addresses or domains
const ALLOWED_EMAILS = process.env.ALLOWED_EMAILS?.split(',').map(e => e.trim().toLowerCase()) || [];
const ALLOWED_DOMAINS = process.env.ALLOWED_DOMAINS?.split(',').map(d => d.trim().toLowerCase()) || [];

export const { handlers, signIn, signOut, auth } = NextAuth({
    providers: [
        Google({
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        }),
    ],
    callbacks: {
        async signIn({ user }) {
            const email = user.email?.toLowerCase();
            if (!email) return false;

            // If no restrictions configured, allow all Google accounts
            if (ALLOWED_EMAILS.length === 0 && ALLOWED_DOMAINS.length === 0) {
                return true;
            }

            // Check if email is in allowed list
            if (ALLOWED_EMAILS.includes(email)) {
                return true;
            }

            // Check if email domain is in allowed domains
            const domain = email.split('@')[1];
            if (ALLOWED_DOMAINS.includes(domain)) {
                return true;
            }

            // Reject if not in allowed list
            console.log(`[AUTH] Rejected login attempt from: ${email}`);
            return false;
        },
        async session({ session, token }) {
            if (session.user && token.sub) {
                session.user.id = token.sub;
            }
            return session;
        },
    },
    pages: {
        signIn: '/login',
        error: '/login',
    },
    trustHost: true,
});
