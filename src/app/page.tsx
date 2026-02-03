import Dashboard from './Dashboard';

export default function Home() {
    return (
        <main className="min-h-screen bg-black overflow-x-hidden">
            {/* Decorative Blur */}
            <div className="fixed top-0 left-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
                <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-primary-500/20 blur-[120px] rounded-full" />
                <div className="absolute top-[60%] -right-[10%] w-[50%] h-[50%] bg-indigo-500/20 blur-[120px] rounded-full" />
            </div>

            <Dashboard />
        </main>
    );
}
