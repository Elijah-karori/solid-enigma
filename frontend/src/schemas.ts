import { z } from 'zod';

export const LoginSchema = z.object({
  email: z.string().trim().email({ message: 'Enter a valid email address.' }),
  password: z.string().min(1, { message: 'Password is required.' }),
});

export const MagicLinkSchema = z.object({
  email: z.string().trim().email({ message: 'Enter a valid email address.' }),
});

export const OTPVerifySchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, { message: 'Enter the 6-digit code.' }),
});

export const ResetPasswordSchema = z.object({
  new_password: z
    .string()
    .min(8, { message: 'Password must be at least 8 characters long.' })
    .regex(/[A-Z]/, { message: 'Password must contain at least one uppercase letter.' })
    .regex(/[a-z]/, { message: 'Password must contain at least one lowercase letter.' })
    .regex(/[0-9]/, { message: 'Password must contain at least one number.' }),
});

export const ChangePasswordSchema = z.object({
  current_password: z.string().min(1, { message: 'Current password is required.' }),
  new_password: z
    .string()
    .min(8, { message: 'Password must be at least 8 characters long.' })
    .regex(/[A-Z]/, { message: 'Password must contain at least one uppercase letter.' })
    .regex(/[a-z]/, { message: 'Password must contain at least one lowercase letter.' })
    .regex(/[0-9]/, { message: 'Password must contain at least one number.' }),
});

export const CatalogItemSchema = z.object({
  asset_type: z.enum(['BULK', 'NONSER', 'ONT', 'RTR', 'NET', 'FAT']),
  manufacturer: z.string().optional(),
  model: z.string().trim().min(1, { message: 'Model is required.' }),
  access_tech: z.string().optional(),
  unit_cost: z.number().min(0, { message: 'Unit cost cannot be negative.' }).default(0),
  description: z.string().optional(),
  reorder_level: z.number().min(0, { message: 'Reorder level cannot be negative.' }).default(0),
  project_scope: z.string().optional(),
});

export const MovementSchema = z.object({
  direction: z.enum(['Stock In', 'Stock Out']),
  item_type: z.enum(['bulk', 'serialized']),
  item_id: z.string().trim().min(1, { message: 'Item SKU or Asset ID is required.' }),
  quantity: z.number().positive({ message: 'Quantity must be greater than 0.' }),
  user: z.string().optional(),
  cost_type: z.string().optional(),
  task_id: z.string().optional(),
  site: z.string().optional(),
  notes: z.string().optional(),
  project_id: z.string().optional(),
});

export const BatchStockInSchema = z.object({
  sku: z.string().trim().min(1, { message: 'Select a serialized model SKU.' }),
  site: z.string().trim().min(1, { message: 'Site / Location is required.' }),
  notes: z.string().optional(),
  units: z
    .array(
      z.object({
        sn: z.string().optional(),
        mac: z.string().optional(),
        productId: z.string().optional(),
        condition: z.string().optional(),
        remarks: z.string().optional(),
      })
    )
    .min(1, { message: 'Add at least one unit row.' })
    .refine(
      (units) =>
        units.every(
          (u) =>
            (u.sn && u.sn.trim().length > 0) ||
            (u.mac && u.mac.trim().replace(/[:.\-\s]/g, '').length === 12)
        ),
      { message: 'Every row must have a valid S/N or 12-hex MAC address.' }
    ),
});

export const RequisitionSchema = z.object({
  item_sku: z.string().trim().min(1, { message: 'Select an item SKU.' }),
  quantity_requested: z.number().positive({ message: 'Quantity requested must be greater than 0.' }),
  reason_job_ticket: z.string().trim().min(1, { message: 'Reason / Job Ticket is required.' }),
  project_id: z.string().optional(),
});

export const ProcurementSchema = z.object({
  item_sku: z.string().trim().min(1, { message: 'Select an item SKU.' }),
  quantity: z.number().positive({ message: 'Quantity must be greater than 0.' }),
  project_id: z.string().optional(),
  supplier: z.string().optional(),
  po_ref: z.string().optional(),
});

export const CustomerSchema = z.object({
  customer_account: z.string().trim().min(1, { message: 'Account number is required.' }),
  name: z.string().trim().min(1, { message: 'Customer name is required.' }),
  subscription_type: z.enum(['PPPoE', 'Hotspot User']),
  contact_person: z.string().optional(),
  contact_phone: z
    .string()
    .optional()
    .refine((val) => !val || /^[+0-9][0-9\s()-]{6,}$/.test(val), {
      message: 'Enter a valid phone number.',
    }),
  contact_email: z
    .string()
    .optional()
    .refine((val) => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val), {
      message: 'Enter a valid email address.',
    }),
  plot_number: z.string().optional(),
  location: z.string().optional(),
  pppoe_username: z.string().optional(),
  package: z.string().optional(),
  status: z.string().optional(),
  notes: z.string().optional(),
});

export const HotspotSchema = z.object({
  name: z.string().trim().min(1, { message: 'Hotspot name is required.' }),
  plots_covered: z.string().optional(),
  location: z.string().optional(),
  contact_person: z.string().optional(),
  contact_phone: z.string().optional(),
  status: z.string().optional(),
  notes: z.string().optional(),
});

export const DeviceReplacementSchema = z.object({
  kind: z.enum(['customer', 'hotspot']),
  entity_id: z.string().trim().min(1, { message: 'Select customer or hotspot.' }),
  role: z.enum(['ONU', 'AP']),
  old_asset: z.string().trim().min(1, { message: 'Faulty asset ID or S/N is required.' }),
  new_asset: z.string().trim().min(1, { message: 'Replacement asset ID or S/N is required.' }),
  ticket_id: z.string().optional(),
  reason: z.string().trim().min(1, { message: 'Reason for replacement is required.' }),
});

export const DeliveryNoteSchema = z.object({
  ref: z.string().trim().min(1, { message: 'Reference number is required.' }),
  type: z.string().optional(),
  project: z.string().optional(),
  recipient: z.string().trim().min(1, { message: 'Recipient is required.' }),
  value: z.number().min(0).optional(),
});

export const TicketSchema = z.object({
  customer_name: z.string().trim().min(1, { message: 'Customer name or account is required.' }),
  issue_category: z.string().optional(),
  priority: z.string().optional(),
  assigned_technician: z.string().optional(),
  create_task: z.boolean().optional(),
  resolution_notes: z.string().optional(),
  customer_id: z.string().optional(),
  hotspot_id: z.string().optional(),
  device_asset_id: z.string().optional(),
  old_device_sn: z.string().optional(),
  new_device_sn: z.string().optional(),
});

export const TaskSchema = z.object({
  task_title: z.string().trim().min(1, { message: 'Task title is required.' }),
  task_type: z.string().optional(),
  assigned_personnel: z.string().optional(),
  priority: z.string().optional(),
  required_sku: z.string().optional(),
  required_qty: z.number().min(0).optional(),
  customer_site: z.string().optional(),
  project_id: z.string().optional(),
});
