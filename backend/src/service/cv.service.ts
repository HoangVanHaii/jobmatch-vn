import { db } from "../config/database";
import { cvs } from "../db/schema";
import type { CreateCvInput, Cv } from "../interface/cv";

export const cvService = {
  create: async (input: CreateCvInput, candidateId: string): Promise<Cv> => {
    const [cv] = await db
      .insert(cvs)
      .values({
        candidateId,
        fileUrl: input.fileUrl,
        fileType: input.fileType,
        isPrimary: input.isPrimary ?? false,
      })
      .returning();

    return cv;
  },
};
