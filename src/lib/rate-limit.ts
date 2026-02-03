// Simple in-memory rate limiter
// In production, consider using Redis for distributed rate limiting

interface RateLimitEntry {
    count: number;
    resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up expired entries periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
        if (now > entry.resetTime) {
            rateLimitStore.delete(key);
        }
    }
}, 60000); // Clean every minute

export interface RateLimitConfig {
    maxRequests: number;
    windowMs: number;
}

export interface RateLimitResult {
    success: boolean;
    remaining: number;
    resetTime: number;
    message?: string;
}

/**
 * Check rate limit for an identifier
 * @param identifier - Unique identifier (e.g., user ID, IP address)
 * @param config - Rate limit configuration
 * @returns Rate limit result
 */
export function checkRateLimit(
    identifier: string,
    config: RateLimitConfig
): RateLimitResult {
    const now = Date.now();
    const entry = rateLimitStore.get(identifier);

    // If no entry or window expired, create new entry
    if (!entry || now > entry.resetTime) {
        rateLimitStore.set(identifier, {
            count: 1,
            resetTime: now + config.windowMs,
        });
        return {
            success: true,
            remaining: config.maxRequests - 1,
            resetTime: now + config.windowMs,
        };
    }

    // Check if limit exceeded
    if (entry.count >= config.maxRequests) {
        return {
            success: false,
            remaining: 0,
            resetTime: entry.resetTime,
            message: `Rate limit exceeded. Please wait ${Math.ceil((entry.resetTime - now) / 1000)} seconds.`,
        };
    }

    // Increment counter
    entry.count++;
    rateLimitStore.set(identifier, entry);

    return {
        success: true,
        remaining: config.maxRequests - entry.count,
        resetTime: entry.resetTime,
    };
}

// Predefined rate limits
export const RATE_LIMITS = {
    broadcast: { maxRequests: 5, windowMs: 60 * 60 * 1000 }, // 5 broadcasts per hour
    analyze: { maxRequests: 20, windowMs: 60 * 1000 }, // 20 analyses per minute
    checkDriveMatches: { maxRequests: 10, windowMs: 60 * 1000 }, // 10 checks per minute
};
