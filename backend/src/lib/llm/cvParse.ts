import { z } from 'zod';
import { createGemini } from './client';
import { invokeJson } from './jsonParser';


const educationItemSchema = z.object({
  school: z.string(),
  degree: z.string().optional(),
  major: z.string().optional(),
  startYear: z.number().int().min(1950).max(2100).optional(),
  endYear: z.number().int().min(1950).max(2100).optional(),
  description: z.string().optional(),
});

const experienceItemSchema = z.object({
  company: z.string(),
  position: z.string(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .nullable()
    .optional(),
  description: z.string().optional(),
});

const languageItemSchema = z.object({
  language: z.string(),
  proficiency: z
    .enum(["A1", "A2", "B1", "B2", "C1", "C2", "Native"])
    .optional(),
});

const projectItemSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  link: z.string().optional(),
});

const certificationItemSchema = z.object({
  name: z.string(),
  issuer: z.string().optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
});

export const cvParsedDataSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  portfolio: z.string().optional(),
  github: z.string().optional(),
  linkedin: z.string().optional(),
  facebook: z.string().optional(),
  avatarUrl: z.string().optional(),
  summary: z.string().max(2000).optional(),
  education: z.array(educationItemSchema).optional(),
  experience: z.array(experienceItemSchema).optional(),
  skills: z.array(z.string()).optional(),
  languages: z.array(languageItemSchema).optional(),
  projects: z.array(projectItemSchema).optional(),
  certifications: z.array(certificationItemSchema).optional(),
});

export type CvParsedData = z.infer<typeof cvParsedDataSchema>;
const parsingLlm = createGemini({
    temperature: 0.1,
    maxOutputTokens: 4096
});

export const invokeCvParse = async(
    systemPrompt: string,
    userPrompt: string
): Promise<CvParsedData> => {
    const result = await invokeJson({
        llm: parsingLlm,
        schema: cvParsedDataSchema,
        systemPrompt,
        userPrompt,
        tag: 'cvParse'
    })
    return result as CvParsedData;
}









