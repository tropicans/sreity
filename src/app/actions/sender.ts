'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

export async function getSenderProfiles() {
    return await prisma.senderProfile.findMany({
        orderBy: { updatedAt: 'desc' }
    });
}

export async function saveSenderProfile(data: { name: string; department: string; contact: string }) {
    const profile = await prisma.senderProfile.upsert({
        where: { id: 'default-selection' }, // Simplify for now or use a proper ID logic if needed
        update: {
            name: data.name,
            department: data.department,
            contact: data.contact,
            updatedAt: new Date(),
        },
        create: {
            id: 'default-selection',
            name: data.name,
            department: data.department,
            contact: data.contact,
        },
    });
    revalidatePath('/');
    return profile;
}

export async function createSenderProfile(data: { name: string; department: string; contact: string }) {
    const profile = await prisma.senderProfile.create({
        data: {
            name: data.name,
            department: data.department,
            contact: data.contact,
        },
    });
    revalidatePath('/');
    return profile;
}

export async function deleteSenderProfile(id: string) {
    await prisma.senderProfile.delete({
        where: { id },
    });
    revalidatePath('/');
}
