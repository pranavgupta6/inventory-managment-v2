import { z } from 'zod';

export const BRANDS = ['Itel', 'Tecno', 'Infinix', 'Oraimo', 'Villaon', 'Other'] as const;
export const SAMPLE_HW_TYPES = ['PRO', 'PRO-1', 'PR1', 'PR1-1', 'PR2', 'PIR', 'MPR'] as const;

const optionalText = (max: number): z.ZodType<string, z.ZodTypeDef, string | undefined> =>
  z.string().trim().max(max).optional().default('');

const date = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must use YYYY-MM-DD format')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'Date must be a valid date');

const imei = z.string().trim().regex(/^\d{15}$/, 'IMEI must contain exactly 15 digits');
const optionalImei = z
  .string()
  .trim()
  .refine((value) => value === '' || /^\d{15}$/.test(value), 'IMEI2 must be empty or contain exactly 15 digits')
  .optional()
  .default('');

const optionalQueryEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), z.enum(values).optional());

export const benchmarkIdSchema = z.object({ id: z.string().trim().min(1).max(100) });

export const benchmarkQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  search: z.string().trim().max(200).optional().default(''),
  brand: optionalQueryEnum(BRANDS),
  status: optionalQueryEnum(['Active', 'Inactive'] as const),
  owner: z.string().trim().optional(),
});

const deviceFields = {
  brand: z.enum(BRANDS),
  deviceModel: z.string().trim().min(1, 'Device Model is required').max(200),
  sampleHwType: z.enum(SAMPLE_HW_TYPES),
  imei1: imei,
  imei2: optionalImei,
  serialNumber: optionalText(200),
  vcId: z.string().trim().min(1, 'VC ID is mandatory').max(200),
  color: optionalText(100),
  storageRam: optionalText(100),
  assignedDate: date,
  warehouseLocation: z.string().trim().min(1, 'Warehouse / Location is required').max(200),
  inventoryHolder: z.string().trim().min(1, 'Inventory Holder is required').max(200),
  owner: z.string().trim().max(200).optional(),
  remarks: optionalText(2000),
  status: z.enum(['Active', 'Inactive']).default('Inactive'),
  sampleReceivedDate: optionalText(50),
  dateOfReceipt: optionalText(50),
  employeeId: optionalText(100),
  assignedTo: optionalText(200),
};

export const createBenchmarkSchema = z.object(deviceFields);
export const updateBenchmarkSchema = z
  .object(deviceFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one field must be provided');

export const bulkUploadBenchmarkItemSchema = z.object({
  brand: z.string().trim().min(1, 'Brand is required'),
  deviceModel: z.string().trim().min(1, 'Device Model is required'),
  sampleHwType: z.string().trim().default('PRO'),
  sampleReceivedDate: z.string().trim().optional().default(''),
  vcId: z.string().trim().min(1, 'VC ID is mandatory').max(200),
  imei1: z.string().trim().min(1, 'IMEI1 is required'),
  imei2: z.string().trim().optional().default(''),
  serialNumber: z.string().trim().optional().default(''),
  color: z.string().trim().optional().default(''),
  storageRam: z.string().trim().optional().default(''),
  dateOfReceipt: z.string().trim().optional().default(''),
  warehouseLocation: z.string().trim().optional().default('Benchmark Lab'),
  assignedTo: z.string().trim().optional().default(''),
  inventoryHolder: z.string().trim().optional().default(''),
  owner: z.string().trim().optional().default(''),
  employeeId: z.string().trim().optional().default(''),
  assignedDate: z.string().trim().optional().default(''),
  remarks: z.string().trim().optional().default(''),
  status: z.enum(['Active', 'Inactive']).optional().default('Inactive'),
});

export const bulkUploadBenchmarkSchema = z.object({
  items: z.array(bulkUploadBenchmarkItemSchema).min(1, 'At least one item is required'),
  actorId: z.string().optional().default('admin@inventory.internal'),
  actorRole: z.enum(['Admin', 'TL', 'Employee', 'System']).optional().default('Admin'),
});

// Schema for assigning the benchmark controller (Admin only)
export const assignControllerSchema = z.object({
  controllerId: z.string().trim().min(1, 'Controller employee ID is required'),
});

export type BenchmarkQuery = z.infer<typeof benchmarkQuerySchema>;
export type CreateBenchmarkInput = z.infer<typeof createBenchmarkSchema>;
export type UpdateBenchmarkInput = z.infer<typeof updateBenchmarkSchema>;
export type BulkUploadBenchmarkItem = z.infer<typeof bulkUploadBenchmarkItemSchema>;
export type BulkUploadBenchmarkInput = z.infer<typeof bulkUploadBenchmarkSchema>;
export type AssignControllerInput = z.infer<typeof assignControllerSchema>;
