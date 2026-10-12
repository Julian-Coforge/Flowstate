import { z } from "zod";

const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a real date")
  .nullable();

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Add your name").max(80),
  email: z.string().trim().email("Enter a valid email").max(200),
  password: z.string().min(8, "Use at least 8 characters").max(200),
});

export const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});

export const projectCreateSchema = z.object({
  title: z.string().trim().min(1, "Name the project").max(120),
  description: z.string().trim().max(2000).optional().default(""),
});

export const nodeCreateSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().trim().min(1).max(120).optional().default("New step"),
  x: z.number().finite(),
  y: z.number().finite(),
});

export const nodePatchSchema = z
  .object({
    title: z.string().trim().min(1, "A step needs a name").max(120).optional(),
    description: z.string().max(2000).optional(),
    importance: z.enum(["low", "medium", "high"]).optional(),
    notes: z.string().max(20000).optional(),
    status: z.enum(["todo", "doing", "done"]).optional(),
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to update" });

export const edgeCreateSchema = z.object({
  projectId: z.string().min(1),
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
});

export const todoCreateSchema = z.object({
  text: z.string().trim().min(1, "Write the task").max(300),
  projectId: z.string().min(1).nullable().optional(),
  nodeId: z.string().min(1).nullable().optional(),
  dueDate: dateField.optional(),
});

export const todoPatchSchema = z
  .object({
    text: z.string().trim().min(1, "Write the task").max(300).optional(),
    done: z.boolean().optional(),
    dueDate: dateField.optional(),
    projectId: z.string().min(1).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to update" });

export const checklistCreateSchema = z.object({
  nodeId: z.string().min(1),
  text: z.string().trim().min(1, "Write the checklist item").max(300),
});

export const checklistPatchSchema = z
  .object({
    text: z.string().trim().min(1).max(300).optional(),
    done: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to update" });

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): { ok: true; data: T } | { ok: false; error: string } {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again" };
  }
  return { ok: true, data: parsed.data };
}
