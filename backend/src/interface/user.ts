export interface User {
    id: string;
    email: string;
    role: 'candidate' | 'employer' | 'admin';
    status: 'pending' | 'active' | 'suspended' | 'deleted';
    avatarUrl?: string;
    createdAt?: Date;
    updatedAt?: Date;
    deletedAt?: Date;
    metadata?: Record<string, unknown>;
}
export interface Profile {
    id?: string;
    email: string;
    fullName?: string;
    avatarUrl?: string;
    phone?: string;
    createdAt?: Date;
    updatedAt?: Date;
    deletedAt?: Date;
    location?: {
        city?: string;
        district?: string;
        lat?: number;
        lng?: number;
    };
    social?: {
        linkedin?: string;
        github?: string;
        portfolio?: string;
    };
    preferences?: Record<string, unknown>;  
}