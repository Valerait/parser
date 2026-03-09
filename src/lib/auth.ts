import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

const ALLOWED_EMAILS = [
  'flyphotokz@gmail.com',
  'valerakozh@gmail.com',
];

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  pages: {
    signIn: '/login',
  },
  callbacks: {
    signIn({ user }) {
      if (!user.email || !ALLOWED_EMAILS.includes(user.email)) {
        return false;
      }
      return true;
    },
    authorized({ auth: session }) {
      return !!session?.user;
    },
    session({ session }) {
      return session;
    },
  },
});
