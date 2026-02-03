'use client';

import { signIn } from 'next-auth/react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function LoginContent() {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const searchParams = useSearchParams();

    useEffect(() => {
        const errorParam = searchParams.get('error');
        if (errorParam === 'AccessDenied') {
            setError('Akses ditolak. Email Anda tidak terdaftar dalam daftar yang diizinkan.');
        } else if (errorParam) {
            setError('Terjadi kesalahan saat login. Silakan coba lagi.');
        }
    }, [searchParams]);

    const handleGoogleLogin = async () => {
        setIsLoading(true);
        setError(null);
        try {
            await signIn('google', { callbackUrl: '/' });
        } catch (err) {
            setError('Gagal melakukan login');
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-black text-[#f5f5f7] flex items-center justify-center px-6">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-md"
            >
                <div className="text-center space-y-4 mb-12">
                    <h1 className="text-4xl font-semibold tracking-tight">Sertify</h1>
                    <p className="text-[#86868b]">Precision Broadcasting Platform</p>
                </div>

                <div className="glass-panel p-8 space-y-6 border border-white/10 bg-white/[0.02]">
                    <div className="text-center space-y-2">
                        <h2 className="text-xl font-semibold">Masuk ke Dashboard</h2>
                        <p className="text-sm text-[#86868b]">
                            Gunakan akun Google yang terdaftar untuk melanjutkan
                        </p>
                    </div>

                    {error && (
                        <div className="bg-[#ff453a]/10 border border-[#ff453a]/20 rounded-xl p-4 text-center">
                            <p className="text-sm text-[#ff453a]">{error}</p>
                        </div>
                    )}

                    <button
                        onClick={handleGoogleLogin}
                        disabled={isLoading}
                        className="w-full flex items-center justify-center gap-3 bg-white text-black px-6 py-3.5 rounded-xl font-semibold hover:bg-white/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isLoading ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                            <svg className="w-5 h-5" viewBox="0 0 24 24">
                                <path
                                    fill="currentColor"
                                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                                />
                                <path
                                    fill="currentColor"
                                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                />
                                <path
                                    fill="currentColor"
                                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                                />
                                <path
                                    fill="currentColor"
                                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                                />
                            </svg>
                        )}
                        {isLoading ? 'Memproses...' : 'Masuk dengan Google'}
                    </button>

                    <p className="text-[10px] text-center text-[#86868b]">
                        Hanya email yang terdaftar yang dapat mengakses platform ini.
                    </p>
                </div>

                <p className="text-center text-[#424245] text-xs mt-8">
                    &copy; {new Date().getFullYear()} Sertify. All rights reserved.
                </p>
            </motion.div>
        </div>
    );
}

export default function LoginPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-black flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-[#86868b]" />
            </div>
        }>
            <LoginContent />
        </Suspense>
    );
}
