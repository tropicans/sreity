'use client';

import { useState, useEffect } from 'react';
import { Upload, Users, CheckCircle2, Loader2, Send, X, ChevronRight, Download, FileText, Search, AlertCircle, LogOut, Eye, Mail } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDropzone } from 'react-dropzone';
import Papa from 'papaparse';
import Image from 'next/image';
import { analyzeCertificateAction, sendBroadcastAction, generateEmailPreviewAction, sendTestEmailAction } from './actions/broadcast';
import { signOut, useSession } from 'next-auth/react';

type Recipient = { name: string; email: string };

type AiResult = {
    recipientName: string;
    eventName: string;
    eventDate: string;
    caption: string;
};

type SenderProfile = {
    id: string;
    name: string;
    department: string;
    contact: string;
};

type SendResult = {
    email: string;
    status: string;
};

type DriveMatchResult = {
    name: string;
    email: string;
    matched: boolean;
    fileName: string | null;
    fileId: string | null;
    resourceKey: string | null;
};

export default function Dashboard() {
    const [file, setFile] = useState<File | null>(null);
    const [certFiles, setCertFiles] = useState<File[]>([]);
    const [recipients, setRecipients] = useState<Recipient[]>([]);
    const [recipientsText, setRecipientsText] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analyzeProgress, setAnalyzeProgress] = useState(0);
    const [aiResult, setAiResult] = useState<AiResult | null>(null);
    const [editedCaption, setEditedCaption] = useState('');
    const [senderProfiles, setSenderProfiles] = useState<SenderProfile[]>([]);
    const [senderForm, setSenderForm] = useState({ name: '', department: '', contact: '' });
    const [youtubeUrl, setYoutubeUrl] = useState('');
    const [certFolderPath, setCertFolderPath] = useState('');
    const [results, setResults] = useState<SendResult[] | null>(null);
    const [driveMatches, setDriveMatches] = useState<DriveMatchResult[] | null>(null);
    const [isCheckingMatches, setIsCheckingMatches] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    const [isPreviewLoading, setIsPreviewLoading] = useState(false);
    const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
    const [previewTitle, setPreviewTitle] = useState('');
    const [selectedPreviewRecipientEmail, setSelectedPreviewRecipientEmail] = useState('');
    const [isEmailPreviewOpen, setIsEmailPreviewOpen] = useState(false);
    const [isEmailPreviewLoading, setIsEmailPreviewLoading] = useState(false);
    const [isSendingTestEmail, setIsSendingTestEmail] = useState(false);
    const [emailPreviewHtml, setEmailPreviewHtml] = useState('');
    const [emailPreviewSubject, setEmailPreviewSubject] = useState('');
    const { data: session } = useSession();
    const deliveredCount = results?.filter((r) => r.status === 'success').length ?? 0;
    const failedCount = results?.filter((r) => r.status === 'failed').length ?? 0;
    const pendingCount = results?.filter((r) => r.status === 'pending').length ?? 0;
    const successRate = results && results.length > 0
        ? Math.round((deliveredCount / results.length) * 100)
        : 0;

    const onDrop = (acceptedFiles: File[]) => {
        const images = acceptedFiles.filter(f => f.type.startsWith('image/'));
        const pdfs = acceptedFiles.filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));

        if (images.length > 0) {
            setFile(images[0]);
            setAiResult(null);
        }

        if (pdfs.length > 0) {
            setCertFiles(prev => [...prev, ...pdfs]);
        }

        setResults(null);
    };

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            'image/*': ['.png', '.jpg', '.jpeg'],
            'application/pdf': ['.pdf']
        },
        multiple: true,
    });

    useEffect(() => {
        const fetchProfiles = async () => {
            const { getSenderProfiles } = await import('./actions/sender');
            const profiles = await getSenderProfiles();
            setSenderProfiles(profiles);
            if (profiles.length > 0) {
                const def = profiles[0];
                setSenderForm({ name: def.name, department: def.department, contact: def.contact });
            }
        };
        fetchProfiles();
    }, []);

    useEffect(() => {
        const lines = recipientsText.split('\n');
        const parsed = lines
            .map(line => {
                const trimmedLine = line.trim();
                if (!trimmedLine) return null;

                const separatorIndex = trimmedLine.lastIndexOf(',');
                if (separatorIndex < 0) return null;

                const name = trimmedLine.slice(0, separatorIndex).trim();
                const email = trimmedLine.slice(separatorIndex + 1).trim();
                return name && email ? { name, email } : null;
            })
            .filter(Boolean) as Recipient[];
        setRecipients(parsed);
    }, [recipientsText]);

    useEffect(() => {
        if (!recipients.length) {
            setSelectedPreviewRecipientEmail('');
            return;
        }

        if (!selectedPreviewRecipientEmail || !recipients.some(r => r.email === selectedPreviewRecipientEmail)) {
            setSelectedPreviewRecipientEmail(recipients[0].email);
        }
    }, [recipients, selectedPreviewRecipientEmail]);

    useEffect(() => {
        if (!file) {
            setPreviewUrl(null);
            return;
        }

        const url = URL.createObjectURL(file);
        setPreviewUrl(url);

        return () => {
            URL.revokeObjectURL(url);
        };
    }, [file]);

    useEffect(() => {
        return () => {
            if (pdfPreviewUrl) {
                URL.revokeObjectURL(pdfPreviewUrl);
            }
        };
    }, [pdfPreviewUrl]);

    const closePreview = () => {
        setIsPreviewOpen(false);
        setIsPreviewLoading(false);
        setPreviewTitle('');
        if (pdfPreviewUrl) {
            URL.revokeObjectURL(pdfPreviewUrl);
            setPdfPreviewUrl(null);
        }
    };

    const getPreviewRecipient = () => {
        if (!recipients.length) {
            return null;
        }

        return recipients.find(r => r.email === selectedPreviewRecipientEmail) || recipients[0];
    };

    const handleOpenEmailPreview = async () => {
        const previewRecipient = getPreviewRecipient();
        if (!previewRecipient || !aiResult) {
            return;
        }

        setIsEmailPreviewLoading(true);
        try {
            const preview = await generateEmailPreviewAction({
                recipient: previewRecipient,
                caption: editedCaption,
                eventName: aiResult.eventName,
                eventDate: aiResult.eventDate,
                sender: senderForm,
                youtubeUrl: youtubeUrl.trim() || undefined,
            });

            setEmailPreviewSubject(preview.subject);
            setEmailPreviewHtml(preview.html);
            setIsEmailPreviewOpen(true);
        } catch (error) {
            console.error('Email preview failed:', error);
            alert('Gagal membuat preview email. Pastikan data pengirim, event, dan penerima valid.');
        } finally {
            setIsEmailPreviewLoading(false);
        }
    };

    const handleSendTestEmail = async () => {
        const previewRecipient = getPreviewRecipient();
        if (!previewRecipient || !aiResult) {
            return;
        }

        setIsSendingTestEmail(true);
        try {
            let certBuffer: number[] | undefined;
            let certFilename: string | undefined;

            if (certFolderPath.trim()) {
                const { fetchCertificatesFromDrive, downloadDriveFile } = await import('./actions/gdrive');
                const [match] = await fetchCertificatesFromDrive(certFolderPath.trim(), [previewRecipient]);

                if (match?.fileId) {
                    const driveBuffer = await downloadDriveFile(match.fileId, match.resourceKey);
                    if (driveBuffer) {
                        certBuffer = Array.from(driveBuffer);
                        certFilename = match.fileName || `${previewRecipient.name}.pdf`;
                    }
                }
            }

            if (!certBuffer) {
                const matchedCert = matchCert(previewRecipient.name);
                if (matchedCert) {
                    certBuffer = Array.from(new Uint8Array(await matchedCert.arrayBuffer()));
                    certFilename = matchedCert.name;
                }
            }

            if (!certBuffer) {
                throw new Error('Sertifikat PDF untuk penerima preview tidak ditemukan');
            }

            const result = await sendTestEmailAction({
                recipient: previewRecipient,
                certBuffer,
                certFilename,
                caption: editedCaption,
                eventName: aiResult.eventName,
                eventDate: aiResult.eventDate,
                sender: senderForm,
                youtubeUrl: youtubeUrl.trim() || undefined,
            });
            alert(`Test email berhasil dikirim ke ${result.sentTo} dengan lampiran sertifikat.`);
        } catch (error) {
            console.error('Send test email failed:', error);
            alert('Gagal mengirim test email. Pastikan sertifikat PDF untuk penerima preview tersedia.');
        } finally {
            setIsSendingTestEmail(false);
        }
    };

    const openPdfPreview = (bytes: number[], title: string) => {
        if (pdfPreviewUrl) {
            URL.revokeObjectURL(pdfPreviewUrl);
        }

        const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
        const objectUrl = URL.createObjectURL(blob);
        setPdfPreviewUrl(objectUrl);
        setPreviewTitle(title);
        setIsPreviewOpen(true);
    };

    const handlePreviewMatch = async (match: DriveMatchResult) => {
        if (!match.matched) {
            return;
        }

        setIsPreviewLoading(true);
        try {
            if (match.fileId) {
                const { downloadDriveFile } = await import('./actions/gdrive');
                const driveBuffer = await downloadDriveFile(match.fileId, match.resourceKey);

                if (!driveBuffer) {
                    throw new Error('File preview gagal diunduh dari Google Drive');
                }

                openPdfPreview(Array.from(driveBuffer), match.fileName || `${match.name}.pdf`);
            } else {
                const matchedCert = matchCert(match.name);
                if (!matchedCert) {
                    throw new Error('File PDF lokal tidak ditemukan untuk preview');
                }

                const localBuffer = await matchedCert.arrayBuffer();
                openPdfPreview(Array.from(new Uint8Array(localBuffer)), matchedCert.name);
            }
        } catch (error) {
            console.error('Preview failed:', error);
            alert('Gagal membuka preview PDF. Coba cek kembali akses file/folder.');
        } finally {
            setIsPreviewLoading(false);
        }
    };

    const handleAnalyze = async () => {
        if (!file) return;

        setIsAnalyzing(true);
        setAnalyzeProgress(3);

        let progressTimer: ReturnType<typeof setInterval> | null = null;
        progressTimer = setInterval(() => {
            setAnalyzeProgress((prev) => {
                if (prev >= 92) {
                    return prev;
                }

                const jump = prev < 25 ? 7 : prev < 60 ? 4 : 2;
                return Math.min(prev + jump, 92);
            });
        }, 450);

        const formData = new FormData();
        formData.append('certificate', file);

        try {
            const res = await analyzeCertificateAction(formData) as AiResult;
            setAiResult(res);
            setEditedCaption(res.caption);
            setAnalyzeProgress(100);
        } catch (error) {
            console.error('Analysis failed:', error);
            alert('Gagal menganalisis sertifikat.');
        } finally {
            if (progressTimer) {
                clearInterval(progressTimer);
            }
            setIsAnalyzing(false);
            setTimeout(() => setAnalyzeProgress(0), 500);
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
            alert('Silakan upload file CSV.');
            return;
        }

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                const data = results.data as Array<Record<string, string | undefined>>;
                const formattedRecipients = data
                    .filter(r => (r.name || r.Nama) && (r.email || r.Email))
                    .map(r => `${r.name || r.Nama}, ${r.email || r.Email}`)
                    .join('\n');
                setRecipientsText(formattedRecipients);
            },
            error: (error) => {
                console.error('CSV Parsing Error:', error);
                alert('Gagal membaca file CSV.');
            }
        });
    };

    const downloadTemplate = () => {
        const link = document.createElement('a');
        link.href = '/template_recipients.csv';
        link.download = 'template_recipients.csv';
        link.click();
    };

    const matchCert = (recipientName: string) => {
        // Normalize name: lowercase and replace non-alphanumeric with underscore
        const normalized = recipientName.toLowerCase().replace(/[^a-z0-9]/g, '_');
        return certFiles.find(f => {
            const fileName = f.name.toLowerCase().replace(/\.[^/.]+$/, "").replace(/[^a-z0-9]/g, '_');
            return fileName.includes(normalized) || normalized.includes(fileName);
        });
    };

    const handleSend = async () => {
        if (!file || !aiResult || recipients.length === 0) return;

        setIsProcessing(true);
        const baseBuffer = await file.arrayBuffer();
        const defaultCertBuffer = Array.from(new Uint8Array(baseBuffer));

        try {
            // Save/Update current sender profile if not empty
            if (senderForm.name && senderForm.department) {
                const { saveSenderProfile } = await import('./actions/sender');
                await saveSenderProfile(senderForm);
            }

            // Fetch certificates from Google Drive if folder ID is provided
            let recipientData;
            if (certFolderPath.trim()) {
                const { fetchCertificatesFromDrive, downloadDriveFile } = await import('./actions/gdrive');
                const driveMatches = await fetchCertificatesFromDrive(certFolderPath.trim(), recipients);

                const unmatchedRecipients = driveMatches
                    .filter((match) => !match.fileId && !matchCert(match.name))
                    .map((match) => match.name);

                if (unmatchedRecipients.length > 0) {
                    throw new Error(
                        `Sertifikat tidak ditemukan untuk: ${unmatchedRecipients.join(', ')}. ` +
                        'Samakan nama di CSV dengan nama file PDF di Google Drive, atau upload PDF lokal sebagai fallback.',
                    );
                }

                recipientData = await Promise.all(driveMatches.map(async (match) => {
                    let buffer: number[] | undefined;
                    let isCustom = false;
                    if (match.fileId) {
                        const driveBuffer = await downloadDriveFile(match.fileId, match.resourceKey);
                        if (driveBuffer) {
                            buffer = Array.from(driveBuffer);
                            isCustom = true;
                        } else {
                            const matchedLocalCert = matchCert(match.name);
                            if (matchedLocalCert) {
                                buffer = Array.from(new Uint8Array(await matchedLocalCert.arrayBuffer()));
                                isCustom = true;
                            }
                        }
                    } else {
                        const matchedCert = matchCert(match.name);
                        if (matchedCert) {
                            buffer = Array.from(new Uint8Array(await matchedCert.arrayBuffer()));
                            isCustom = true;
                        }
                    }
                    return {
                        name: match.name,
                        email: match.email,
                        certBuffer: buffer,
                        isCustom,
                    };
                }));
            } else {
                // Fallback: use local file matching
                recipientData = await Promise.all(recipients.map(async (r) => {
                    const matchedCert = matchCert(r.name);
                    let buffer: number[] | undefined;
                    if (matchedCert) {
                        buffer = Array.from(new Uint8Array(await matchedCert.arrayBuffer()));
                    }
                    return {
                        ...r,
                        certBuffer: buffer,
                        isCustom: !!matchedCert
                    };
                }));
            }

            const res = await sendBroadcastAction({
                recipients: recipientData,
                defaultCertBuffer,
                caption: editedCaption,
                eventName: aiResult.eventName,
                eventDate: aiResult.eventDate,
                sender: senderForm,
                youtubeUrl: youtubeUrl.trim() || undefined
            });
            setResults(res);
        } catch (error) {
            console.error(error);
            alert('Failed to send broadcast');
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="min-h-screen bg-black text-[#f5f5f7] selection:bg-primary/30">
            {/* Nav */}
            <nav className="fixed top-0 w-full z-50 bg-black/80 backdrop-blur-md border-b border-white/5">
                <div className="max-w-5xl mx-auto px-6 h-12 flex items-center justify-between">
                    <span className="text-xl font-semibold tracking-tight">Sertify</span>
                    <div className="flex items-center gap-6">
                        <div className="flex gap-8 text-[12px] font-medium text-[#a1a1a6]">
                            <span className="cursor-pointer hover:text-white transition-colors">Vision</span>
                            <span className="cursor-pointer hover:text-white transition-colors">Broadcast</span>
                            <span className="cursor-pointer hover:text-white transition-colors">History</span>
                        </div>
                        {session?.user && (
                            <div className="flex items-center gap-3 pl-6 border-l border-white/10">
                                <span className="text-[11px] text-[#86868b] truncate max-w-[150px]">{session.user.email}</span>
                                <button
                                    onClick={() => signOut({ callbackUrl: '/login' })}
                                    className="p-1.5 rounded-lg hover:bg-white/10 text-[#86868b] hover:text-white transition-all"
                                    title="Logout"
                                >
                                    <LogOut className="w-4 h-4" />
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </nav>

            <main className="pt-32 pb-20 px-6 max-w-5xl mx-auto space-y-32">
                {/* Hero */}
                <section className="text-center space-y-6">
                    <motion.h1
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-5xl md:text-7xl font-semibold tracking-tight text-gradient"
                    >
                        Precision Broadcasting.
                    </motion.h1>
                    <motion.p
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 }}
                        className="text-xl md:text-2xl text-[#86868b] max-w-2xl mx-auto font-medium"
                    >
                        Analyze images with AI. Blast personalized emails with elegance.
                    </motion.p>
                </section>

                {/* Workflow */}
                <div className="space-y-40">
                    {/* Section 1: Setup */}
                    <motion.section
                        id="setup"
                        initial={{ opacity: 0 }}
                        whileInView={{ opacity: 1 }}
                        viewport={{ once: true }}
                        className="grid grid-cols-1 md:grid-cols-2 gap-12 items-start"
                    >
                        <div className="space-y-8">
                            <div className="space-y-2">
                                <h2 className="text-3xl font-semibold tracking-tight">Stage 1: The Visuals.</h2>
                                <p className="text-[#86868b] text-lg">Upload the image you want AI to analyze and broadcast.</p>
                            </div>

                            {/* Recipients Control */}
                            <div className="glass-panel p-6 space-y-6 soft-glow border-white/10 bg-white/[0.02]">
                                <div className="flex justify-between items-center">
                                    <h3 className="text-sm font-semibold uppercase tracking-widest text-[#86868b]">Recipients</h3>
                                    <div className="flex gap-4">
                                        <button onClick={downloadTemplate} className="text-[11px] font-semibold text-[#86868b] hover:text-[#2997ff] flex items-center gap-1 transition-colors">
                                            <Download className="w-3.5 h-3.5" /> Template
                                        </button>
                                        <label className="text-[11px] font-semibold bg-[#2997ff] text-white px-5 py-1.5 rounded-full hover:bg-[#2997ff]/90 cursor-pointer flex items-center gap-2 shadow-lg shadow-[#2997ff]/20 transition-all active:scale-95">
                                            <FileText className="w-4 h-4" /> Upload CSV
                                            <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
                                        </label>
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    <textarea
                                        value={recipientsText}
                                        onChange={(e) => setRecipientsText(e.target.value)}
                                        placeholder="Name, Email (Per line)"
                                        className="w-full h-32 bg-white/[0.03] border border-white/10 rounded-xl p-4 focus:ring-1 focus:ring-[#2997ff] focus:border-[#2997ff] text-[#f5f5f7] placeholder-[#424245] font-mono text-sm resize-none outline-none transition-all"
                                    />
                                    <div className="flex justify-between items-center text-[12px] px-1">
                                        <span className="text-[#86868b] flex items-center gap-1.5">
                                            <Users className="w-3.5 h-3.5" /> {recipients.length} recipients detected
                                        </span>
                                        {recipients.length > 0 && <CheckCircle2 className="w-4 h-4 text-[#30d158]" />}
                                    </div>
                                </div>

                                {/* Google Drive Folder ID */}
                                <div className="space-y-3 pt-4 border-t border-white/5">
                                    <label className="text-[10px] font-bold uppercase tracking-widest text-[#86868b]">Google Drive Folder ID</label>
                                    <input
                                        type="text"
                                        value={certFolderPath}
                                        onChange={(e) => setCertFolderPath(e.target.value)}
                                        placeholder="e.g. 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
                                        className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3 focus:ring-1 focus:ring-[#2997ff] focus:border-[#2997ff] text-[#f5f5f7] placeholder-[#424245] font-mono text-sm outline-none transition-all"
                                    />
                                    <p className="text-[10px] text-[#86868b]">Ambil ID dari URL folder: <code className="bg-white/10 px-1.5 py-0.5 rounded">drive.google.com/drive/folders/<span className="text-[#2997ff]">FOLDER_ID</span></code></p>

                                    {/* Check Matches Button */}
                                    {certFolderPath.trim() && recipients.length > 0 && (
                                        <button
                                            onClick={async () => {
                                                setIsCheckingMatches(true);
                                                try {
                                                    const { checkDriveMatches } = await import('./actions/gdrive');
                                                    const matches = await checkDriveMatches(certFolderPath.trim(), recipients);
                                                    setDriveMatches(matches);
                                                } catch (error) {
                                                    console.error('Check matches failed:', error);
                                                    alert('Gagal memeriksa kecocokan. Pastikan Folder ID valid dan folder bersifat publik.');
                                                } finally {
                                                    setIsCheckingMatches(false);
                                                }
                                            }}
                                            disabled={isCheckingMatches}
                                            className="mt-3 w-full flex items-center justify-center gap-2 bg-[#2997ff]/10 text-[#2997ff] px-4 py-2.5 rounded-lg hover:bg-[#2997ff]/20 transition-colors text-sm font-semibold disabled:opacity-50"
                                        >
                                            {isCheckingMatches ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                                            {isCheckingMatches ? 'Memeriksa...' : 'Cek Kecocokan Sertifikat'}
                                        </button>
                                    )}
                                </div>

                                {/* Drive Match Results */}
                                {driveMatches && (
                                    <div className="space-y-3 pt-4 border-t border-white/5">
                                        <div className="flex items-center justify-between">
                                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#86868b]">Hasil Pengecekan</label>
                                            <div className="flex gap-4 text-[10px] font-bold">
                                                <span className="text-[#30d158]">{driveMatches.filter(m => m.matched).length} cocok</span>
                                                <span className="text-[#ff453a]">{driveMatches.filter(m => !m.matched).length} tidak ditemukan</span>
                                            </div>
                                        </div>
                                        <div className="max-h-40 overflow-y-auto space-y-1.5">
                                            {driveMatches.map((match, i) => (
                                                <div
                                                    key={i}
                                                    className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs ${match.matched ? 'bg-[#30d158]/10 border border-[#30d158]/20' : 'bg-[#ff453a]/10 border border-[#ff453a]/20'
                                                        }`}
                                                >
                                                    <div className="flex items-center gap-2 truncate">
                                                        {match.matched ? <CheckCircle2 className="w-3.5 h-3.5 text-[#30d158] flex-shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 text-[#ff453a] flex-shrink-0" />}
                                                        <span className="truncate font-medium">{match.name}</span>
                                                    </div>
                                                    <span className="text-[10px] text-[#86868b] truncate max-w-[150px]">
                                                        {match.matched ? match.fileName : 'File tidak ditemukan'}
                                                    </span>
                                                    {match.matched && (
                                                        <button
                                                            type="button"
                                                            onClick={() => handlePreviewMatch(match)}
                                                            disabled={isPreviewLoading}
                                                            className="ml-3 text-[10px] font-semibold text-[#2997ff] hover:text-[#66b6ff] transition-colors disabled:opacity-50"
                                                        >
                                                            {isPreviewLoading ? 'Loading...' : 'Preview'}
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Upload Control */}
                        <div
                            {...getRootProps()}
                            className={`relative aspect-[4/3] glass-panel flex flex-col items-center justify-center border-2 border-dashed transition-all duration-500
                                ${isDragActive ? 'border-[#2997ff] bg-[#2997ff]/5' : 'border-white/10 hover:border-white/20 bg-white/[0.01]'}`}
                        >
                            <input {...getInputProps()} />
                            {file ? (
                                <div className="absolute inset-0 p-4">
                                    <div className="w-full h-full rounded-xl overflow-hidden relative group">
                                        {previewUrl && (
                                            <Image
                                                src={previewUrl}
                                                alt="Preview"
                                                fill
                                                unoptimized
                                                className="w-full h-full object-cover opacity-60 grayscale group-hover:grayscale-0 transition-all duration-700"
                                            />
                                        )}
                                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm opacity-100 group-hover:opacity-0 transition-opacity">
                                            <FileText className="w-12 h-12 text-white/40 mb-2" />
                                            <span className="text-sm font-medium text-white/80">{file.name}</span>
                                        </div>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setFile(null); setAiResult(null); }}
                                            className="absolute top-4 right-4 p-2 bg-black/60 rounded-full hover:bg-black transition-colors"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center space-y-4 p-8">
                                    <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto">
                                        <Upload className="w-6 h-6 text-[#86868b]" />
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-lg font-medium">Drop image for analysis.</p>
                                        <p className="text-sm text-[#86868b]">We&apos;ll automatically generate a caption for you.</p>
                                    </div>
                                </div>
                            )}

                            {file && !aiResult && (
                                <div className="absolute bottom-8 w-[min(380px,90%)] space-y-3">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleAnalyze(); }}
                                        disabled={isAnalyzing}
                                        className="apple-button w-full shadow-2xl flex items-center justify-center gap-2 group"
                                    >
                                        {isAnalyzing ? (
                                            <>
                                                <Loader2 className="animate-spin w-5 h-5" />
                                                Analyzing... {analyzeProgress}%
                                            </>
                                        ) : (
                                            <>
                                                Analyze with AI
                                                <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                                            </>
                                        )}
                                    </button>

                                    {isAnalyzing && (
                                        <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
                                            <div
                                                className="h-full bg-gradient-to-r from-[#66b6ff] to-[#2997ff] transition-all duration-300"
                                                style={{ width: `${analyzeProgress}%` }}
                                            />
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Bulk Files Status */}
                            {certFiles.length > 0 && (
                                <div className="absolute top-4 left-4 flex gap-2">
                                    <div className="bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
                                        <FileText className="w-3.5 h-3.5 text-[#2997ff]" />
                                        {certFiles.length} PDFs
                                    </div>
                                    {recipients.length > 0 && (
                                        <div className="bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
                                            <CheckCircle2 className={`w-3.5 h-3.5 ${recipients.filter(r => matchCert(r.name)).length === recipients.length ? 'text-[#30d158]' : 'text-[#ff9f0a]'}`} />
                                            {recipients.filter(r => matchCert(r.name)).length}/{recipients.length} Mapped
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Certificate List (Optional Preview) */}
                        {certFiles.length > 0 && (
                            <div className="glass-panel p-4 max-h-48 overflow-y-auto space-y-2 border-white/5 bg-white/[0.01]">
                                <h4 className="text-[10px] font-bold uppercase tracking-widest text-[#86868b] px-2 mb-2">Uploaded Certificates</h4>
                                {certFiles.map((f, i) => (
                                    <div key={i} className="flex items-center justify-between px-3 py-2 bg-white/5 rounded-lg border border-white/5 group">
                                        <div className="flex items-center gap-3 truncate">
                                            <FileText className="w-4 h-4 text-[#86868b]" />
                                            <span className="text-xs truncate">{f.name}</span>
                                        </div>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setCertFiles(prev => prev.filter((_, idx) => idx !== i)); }}
                                            className="opacity-0 group-hover:opacity-100 p-1 hover:text-[#ff453a] transition-all"
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </motion.section>

                    {/* Section 2: Review */}
                    <AnimatePresence>
                        {aiResult && (
                            <motion.section
                                initial={{ opacity: 0, y: 40 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 40 }}
                                className="space-y-12"
                            >
                                <div className="text-center space-y-2">
                                    <h2 className="text-3xl font-semibold tracking-tight">Stage 2: The Personalization.</h2>
                                    <p className="text-[#86868b] text-lg">AI has extracted the essence. Refine the message.</p>
                                </div>

                                <div className="max-w-3xl mx-auto glass-panel p-10 space-y-10 border-white/10 bg-white/[0.02] soft-glow">
                                    <div className="flex justify-between items-center text-sm border-b border-white/5 pb-6">
                                        <div className="space-y-1">
                                            <span className="text-[#86868b] font-medium uppercase tracking-widest text-[10px]">Event Name</span>
                                            <p className="text-lg font-medium">{aiResult.eventName}</p>
                                        </div>
                                        <div className="space-y-2">
                                            <span className="text-[#86868b] font-medium uppercase tracking-widest text-[10px] block text-right">Saved Profile</span>
                                            <select
                                                className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-[#2997ff] transition-colors"
                                                onChange={(e) => {
                                                    const p = senderProfiles.find(p => p.id === e.target.value);
                                                    if (p) setSenderForm({ name: p.name, department: p.department, contact: p.contact });
                                                }}
                                            >
                                                <option value="">-- Select Profile --</option>
                                                {senderProfiles.map(p => (
                                                    <option key={p.id} value={p.id}>{p.name} ({p.department})</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    {/* Sender Profile Selection */}
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#86868b]">Sender Name</label>
                                            <input
                                                type="text"
                                                value={senderForm.name}
                                                onChange={(e) => setSenderForm({ ...senderForm, name: e.target.value })}
                                                placeholder="e.g. John Doe"
                                                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm focus:border-[#2997ff] outline-none transition-colors"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#86868b]">Department/Unit</label>
                                            <input
                                                type="text"
                                                value={senderForm.department}
                                                onChange={(e) => setSenderForm({ ...senderForm, department: e.target.value })}
                                                placeholder="e.g. Pusdiklat"
                                                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm focus:border-[#2997ff] outline-none transition-colors"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#86868b]">Contact</label>
                                            <input
                                                type="text"
                                                value={senderForm.contact}
                                                onChange={(e) => setSenderForm({ ...senderForm, contact: e.target.value })}
                                                placeholder="e.g. 0812..."
                                                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm focus:border-[#2997ff] outline-none transition-colors"
                                            />
                                        </div>
                                    </div>

                                    {/* YouTube URL */}
                                    <div className="space-y-2 pt-4 border-t border-white/5">
                                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#86868b]">YouTube Video URL (Optional)</label>
                                        <input
                                            type="url"
                                            value={youtubeUrl}
                                            onChange={(e) => setYoutubeUrl(e.target.value)}
                                            placeholder="https://www.youtube.com/watch?v=..."
                                            className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm focus:border-[#2997ff] outline-none transition-colors"
                                        />
                                        <p className="text-[10px] text-[#86868b]">Link rekaman siaran ulang akan ditampilkan di email</p>
                                    </div>

                                    <div className="space-y-4">
                                        <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#86868b]">Caption Template</label>
                                        <textarea
                                            value={editedCaption}
                                            onChange={(e) => setEditedCaption(e.target.value)}
                                            className="w-full h-80 bg-transparent border-none focus:ring-0 text-[#f5f5f7] leading-relaxed text-lg font-medium italic placeholder-[#424245] resize-none"
                                        />
                                    </div>

                                    <div className="pt-6 border-t border-white/5 space-y-4">
                                        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-3 items-end">
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#86868b]">Preview Recipient</label>
                                                <select
                                                    value={selectedPreviewRecipientEmail}
                                                    onChange={(e) => setSelectedPreviewRecipientEmail(e.target.value)}
                                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none focus:border-[#2997ff] transition-colors"
                                                >
                                                    {recipients.map((r) => (
                                                        <option key={r.email} value={r.email}>{r.name} ({r.email})</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={handleOpenEmailPreview}
                                                disabled={isEmailPreviewLoading || recipients.length === 0}
                                                className="h-10 px-4 rounded-lg border border-[#2997ff]/30 bg-[#2997ff]/10 text-[#8dc8ff] hover:bg-[#2997ff]/20 transition-colors text-xs font-semibold flex items-center gap-2 disabled:opacity-50"
                                            >
                                                {isEmailPreviewLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                                                Preview Email
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleSendTestEmail}
                                                disabled={isSendingTestEmail || recipients.length === 0}
                                                className="h-10 px-4 rounded-lg border border-white/15 bg-white/5 text-white hover:bg-white/10 transition-colors text-xs font-semibold flex items-center gap-2 disabled:opacity-50"
                                            >
                                                {isSendingTestEmail ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                                                Send Test
                                            </button>
                                        </div>
                                        <p className="text-[10px] text-[#86868b]">
                                            Preview dan test email memakai konten personalisasi recipient terpilih. Test email dikirim ke akun login Anda.
                                        </p>
                                    </div>

                                    <div className="pt-10 flex flex-col items-center gap-6">
                                        <button
                                            onClick={handleSend}
                                            disabled={isProcessing || recipients.length === 0}
                                            className="apple-button px-20 py-4 text-xl flex items-center gap-3 relative overflow-hidden group"
                                        >
                                            <span className="relative z-10 flex items-center gap-3">
                                                {isProcessing ? <Loader2 className="animate-spin w-6 h-6" /> : <Send className="w-5 h-5" />}
                                                {isProcessing ? 'Deploying...' : 'Blast Broadcast'}
                                            </span>
                                            <motion.div
                                                className="absolute inset-0 bg-white/10"
                                                initial={false}
                                                whileHover={{ x: '100%' }}
                                                transition={{ duration: 0.5 }}
                                            />
                                        </button>
                                        <p className="text-[#86868b] text-sm">Targeting {recipients.length} recipients for &quot;{aiResult.eventName}&quot;</p>
                                    </div>
                                </div>
                            </motion.section>
                        )}
                    </AnimatePresence>

                    {/* Section 3: Results */}
                    <AnimatePresence>
                        {results && (
                            <motion.section
                                initial={{ opacity: 0, scale: 0.98 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="space-y-12"
                            >
                                <div className="text-center space-y-2">
                                    <h2 className="text-3xl font-semibold tracking-tight">Mission Accomplished.</h2>
                                    <p className="text-[#86868b] text-lg">Broadcast report for your review.</p>
                                </div>

                                <div className="max-w-4xl mx-auto glass-panel overflow-hidden soft-glow bg-white/[0.01]">
                                    <div className="p-12 grid grid-cols-1 md:grid-cols-3 gap-12 border-b border-white/5">
                                        <div className="space-y-2">
                                            <span className="text-[#86868b] text-[10px] font-bold uppercase tracking-widest text-center block">Delivered</span>
                                            <span className="text-5xl font-semibold block text-center text-[#30d158]">{deliveredCount}</span>
                                        </div>
                                        <div className="space-y-2">
                                            <span className="text-[#86868b] text-[10px] font-bold uppercase tracking-widest text-center block">Bounced</span>
                                            <span className="text-5xl font-semibold block text-center text-[#ff453a]">{failedCount}</span>
                                        </div>
                                        <div className="space-y-2">
                                            <span className="text-[#86868b] text-[10px] font-bold uppercase tracking-widest text-center block">Pending</span>
                                            <span className="text-5xl font-semibold block text-center text-[#ff9f0a]">{pendingCount}</span>
                                        </div>
                                        <div className="space-y-2 md:col-span-3 border-t border-white/5 pt-6">
                                            <span className="text-[#86868b] text-[10px] font-bold uppercase tracking-widest text-center block">Success Rate</span>
                                            <span className="text-4xl font-semibold block text-center">
                                                {successRate}%
                                            </span>
                                        </div>
                                    </div>
                                    {pendingCount > 0 && (
                                        <div className="px-12 py-4 border-b border-white/5 bg-[#ff9f0a]/10 text-[#ffd8a1] text-xs text-center">
                                            {pendingCount} email masuk antrian pending dan akan diproses otomatis saat endpoint cron dijalankan.
                                        </div>
                                    )}

                                    <div className="max-h-96 overflow-y-auto">
                                        <table className="w-full text-left text-sm">
                                            <tbody className="divide-y divide-white/5">
                                                {results.map((r, i: number) => (
                                                    <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                                                        <td className="px-12 py-5 font-medium">{r.email}</td>
                                                        <td className="px-12 py-5 text-right">
                                                            <span className={`text-[10px] font-bold uppercase tracking-widest ${r.status === 'success' ? 'text-[#30d158]' : r.status === 'pending' ? 'text-[#ff9f0a]' : 'text-[#ff453a]'}`}>
                                                                {r.status}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div className="p-8 text-center bg-white/[0.02]">
                                        <button onClick={() => { setResults(null); setAiResult(null); setFile(null); setRecipientsText(''); }} className="text-[#2997ff] font-semibold hover:underline">
                                            Start New Broadcast
                                        </button>
                                    </div>
                                </div>
                            </motion.section>
                        )}
                    </AnimatePresence>
                </div>
            </main>

            <footer className="mt-40 pb-20 text-center space-y-4 border-t border-white/5 pt-20 px-6">
                <p className="text-[#86868b] text-sm">Designed for precision. Built for impact.</p>
                <div className="flex justify-center gap-6 text-[11px] font-medium text-[#424245]">
                    <span>Terms</span>
                    <span>Privacy</span>
                    <span>Contact</span>
                </div>
            </footer>

            {isPreviewOpen && (
                <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="w-full max-w-5xl h-[90vh] bg-[#0f0f11] border border-white/10 rounded-2xl overflow-hidden flex flex-col">
                        <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between">
                            <div className="min-w-0">
                                <p className="text-[10px] uppercase tracking-widest text-[#86868b]">PDF Preview</p>
                                <p className="text-sm text-white truncate">{previewTitle}</p>
                            </div>
                            <button
                                type="button"
                                onClick={closePreview}
                                className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="flex-1 bg-black">
                            {pdfPreviewUrl ? (
                                <iframe
                                    src={pdfPreviewUrl}
                                    title="Certificate Preview"
                                    className="w-full h-full"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-[#86868b] text-sm">
                                    Preview tidak tersedia.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {isEmailPreviewOpen && (
                <div className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="w-full max-w-5xl h-[90vh] bg-[#0f0f11] border border-white/10 rounded-2xl overflow-hidden flex flex-col">
                        <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between">
                            <div className="min-w-0">
                                <p className="text-[10px] uppercase tracking-widest text-[#86868b]">Email Preview</p>
                                <p className="text-sm text-white truncate">{emailPreviewSubject}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsEmailPreviewOpen(false)}
                                className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="flex-1 bg-white">
                            {emailPreviewHtml ? (
                                <iframe
                                    srcDoc={emailPreviewHtml}
                                    title="Email Preview"
                                    className="w-full h-full"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-[#555] text-sm">
                                    Preview tidak tersedia.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
