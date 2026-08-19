export interface UploadInput {
  buffer: Buffer;
  mime: string;
  originalName: string;
  userId: string;
  folder?: string;
}

export interface UploadResult {
  url: string;
  key: string;
  mime: string;
  size: number;
}

export type ViewerRole = "candidate" | "employer" | "admin";
