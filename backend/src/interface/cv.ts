import type { cvs } from "../db/schema/cvs";

export type Cv = typeof cvs.$inferSelect;

export interface CreateCvInput {
  fileUrl?: string;
  fileType?: string;
  isPrimary?: boolean;
}

export type CreateCvResponse = Cv;
