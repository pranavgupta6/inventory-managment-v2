import { useMemo, useState, useRef } from 'react';
import {
  Plus,
  Search,
  X,
  Upload,
  FileSpreadsheet,
  AlertTriangle,
  Ban,
  ShieldCheck,
  CheckCircle2,
  Trash2,
  FileText,
  FlaskConical,
  UserCog,
  Lock,
  Users,
  ChevronLeft,
  ChevronRight,
  History,
  ArrowLeftRight,
  RotateCcw,
  Download,
  Camera,
  Pencil,
  ShieldOff,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  useBenchmark,
  useBenchmarkMutations,
  useBenchmarkController,
  useBenchmarkAssignments,
  useBenchmarkAssignmentMutations,
  type BenchmarkFilters,
  type BenchmarkAssignmentFilters,
  type BenchmarkInput,
} from '@/hooks/use-benchmark.js';
import { AssignDeviceModal, PhotoUploadSection } from '@/features/inventory/assign-device-modal.js';
import { DeviceTrackingModal } from '@/features/inventory/device-tracking-modal.js';
import type {
  Assignment,
  InventoryItem,
  InventoryStatus,
  BulkUploadItem,
  BulkUploadResult,
  BenchmarkControllerConfig,
  AuthUser,
  PhotoRecord,
} from '@/types/api.js';
import { useUserRole } from '@/context/user-role-context.js';
import { useAuth } from '@/context/auth-context.js';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card.js';
import { Button } from '@/components/ui/button.js';
import { Badge } from '@/components/ui/badge.js';
import { Spinner } from '@/components/ui/spinner.js';
import { EmptyState } from '@/components/ui/empty-state.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const brands = ['Itel', 'Tecno', 'Infinix', 'Oraimo', 'Villaon', 'Other'] as const;
const sampleTypes = ['PRO', 'PRO-1', 'PR1', 'PR1-1', 'PR2', 'PIR', 'MPR'] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function Field({
  label,
  required,
  children,
  wide = false,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`space-y-1 text-sm ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="font-medium">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </span>
      {children}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  type = 'text',
  required = false,
  maxLength,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  maxLength?: number;
  placeholder?: string;
}) {
  return (
    <input
      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
      value={value}
      type={type}
      required={required}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function downloadBlob(content: BlobPart, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Benchmark Device Form (Add / Edit)
// ---------------------------------------------------------------------------
const emptyForm: BenchmarkInput & {
  sampleReceivedDate?: string;
  dateOfReceipt?: string;
  employeeId?: string;
  assignedTo?: string;
} = {
  brand: 'Other',
  deviceModel: '',
  sampleHwType: 'PRO',
  imei1: '',
  imei2: '',
  serialNumber: '',
  vcId: '',
  color: '',
  storageRam: '',
  assignedDate: new Date().toISOString().slice(0, 10),
  warehouseLocation: 'Benchmark Lab',
  inventoryHolder: 'Benchmark Lab',
  owner: '',
  remarks: '',
  status: 'Inactive',
  sampleReceivedDate: new Date().toISOString().slice(0, 10),
  dateOfReceipt: new Date().toISOString().slice(0, 10),
  employeeId: '',
  assignedTo: '',
};

type FormProps = { item?: InventoryItem; onClose: () => void };

function BenchmarkForm({ item, onClose }: FormProps) {
  const { user } = useAuth();
  const uploaderOwner = user?.name ? `${user.name}${user.empCode ? ` (${user.empCode})` : ''}` : 'Benchmark Lab';

  const [form, setForm] = useState(
    item
      ? { ...item, owner: item.owner || uploaderOwner }
      : { ...emptyForm, owner: uploaderOwner, inventoryHolder: 'Benchmark Lab' },
  );
  const { create, update } = useBenchmarkMutations();
  const mutation = item ? update : create;

  const set = (name: string, value: string | InventoryStatus) =>
    setForm((current) => ({ ...current, [name]: value }));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (item) {
      update.mutate({ id: item.itemId, input: form }, { onSuccess: onClose });
    } else {
      create.mutate(form as BenchmarkInput, { onSuccess: onClose });
    }
  };

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <Card className="max-h-[92vh] w-full max-w-3xl overflow-y-auto">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5 text-amber-500" />
              {item ? 'Edit Benchmark Device' : 'Register Benchmark Device'}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Benchmark Inventory · VC ID is mandatory · Managed solely by designated Benchmark Controller / Admin
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close form">
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <Field label="Brand" required>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.brand}
                required
                onChange={(e) => set('brand', e.target.value)}
              >
                {brands.map((brand) => (
                  <option key={brand}>{brand}</option>
                ))}
              </select>
            </Field>

            <Field label="Device Model" required>
              <TextInput
                value={form.deviceModel}
                required
                placeholder="e.g. Camon 30 Ultra 5G"
                onChange={(val) => set('deviceModel', val)}
              />
            </Field>

            <Field label="Sample / HW Type" required>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.sampleHwType}
                required
                onChange={(e) => set('sampleHwType', e.target.value)}
              >
                {sampleTypes.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </Field>

            <Field label="IMEI1 (15 digits)" required>
              <TextInput
                value={form.imei1}
                required
                maxLength={15}
                placeholder="356789012345678"
                onChange={(val) => set('imei1', val)}
              />
            </Field>

            <Field label="IMEI2 (Optional)">
              <TextInput
                value={form.imei2 || ''}
                maxLength={15}
                placeholder="Optional second IMEI"
                onChange={(val) => set('imei2', val)}
              />
            </Field>

            <Field label="VC ID" required>
              <TextInput
                value={form.vcId || ''}
                required
                placeholder="e.g. BM-VC-2026-001"
                onChange={(val) => set('vcId', val)}
              />
            </Field>

            <Field label="Serial Number">
              <TextInput
                value={form.serialNumber || ''}
                placeholder="SN..."
                onChange={(val) => set('serialNumber', val)}
              />
            </Field>

            <Field label="Color">
              <TextInput
                value={form.color || ''}
                placeholder="e.g. Alps White"
                onChange={(val) => set('color', val)}
              />
            </Field>

            <Field label="Storage / RAM Variant">
              <TextInput
                value={form.storageRam || ''}
                placeholder="e.g. 12GB / 256GB"
                onChange={(val) => set('storageRam', val)}
              />
            </Field>

            <Field label="Assigned / Entry Date" required>
              <TextInput
                type="date"
                value={form.assignedDate}
                required
                onChange={(val) => set('assignedDate', val)}
              />
            </Field>

            <Field label="Warehouse / Location" required>
              <TextInput
                value={form.warehouseLocation}
                required
                placeholder="e.g. Benchmark Lab"
                onChange={(val) => set('warehouseLocation', val)}
              />
            </Field>

            <Field label="Inventory Holder" required>
              <TextInput
                value={form.inventoryHolder}
                required
                placeholder="e.g. Benchmark Lab"
                onChange={(val) => set('inventoryHolder', val)}
              />
            </Field>

            {/* Sole owner — always locked to uploader */}
            <Field label="Registered Owner (Immutable)" wide>
              <div className="flex items-center gap-2 p-2.5 rounded-md border bg-amber-50 dark:bg-amber-950/20 text-xs">
                <Lock className="h-4 w-4 text-amber-600 shrink-0" />
                <div>
                  <span className="font-semibold text-foreground">{form.owner || 'Benchmark Lab'}</span>
                  <span className="text-muted-foreground ml-2">
                    (Owner record is immutable. Only the designated Benchmark Controller or Admin may delegate custody.)
                  </span>
                </div>
              </div>
            </Field>

            {!item ? (
              <>
                <Field label="Initial Assign To (Employee Name — Optional)">
                  <TextInput
                    value={(form as { assignedTo?: string }).assignedTo || ''}
                    placeholder="Leave blank to keep Available in Stock"
                    onChange={(val) => set('assignedTo', val)}
                  />
                </Field>

                <Field label="Initial Employee ID (Optional)">
                  <TextInput
                    value={(form as { employeeId?: string }).employeeId || ''}
                    placeholder="e.g. 19101020"
                    onChange={(val) => set('employeeId', val)}
                  />
                </Field>
              </>
            ) : (
              <Field label="Checkout Status" wide>
                <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-xs">
                  <span>
                    Current Status: <strong>{form.status === 'Active' ? 'In Testing (Assigned)' : 'Available in Stock'}</strong>
                  </span>
                  <span className="text-muted-foreground">Use Assign / Return actions to change custody status.</span>
                </div>
              </Field>
            )}

            <Field label="Remarks Section" wide>
              <textarea
                className="min-h-20 w-full rounded-md border border-input bg-background p-3 text-sm"
                value={form.remarks || ''}
                placeholder="Benchmark test notes, protocol, or condition..."
                onChange={(e) => set('remarks', e.target.value)}
              />
            </Field>

            {mutation.isError && (
              <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive sm:col-span-2">
                {mutation.error instanceof Error ? mutation.error.message : 'Could not save device.'}
              </div>
            )}

            <div className="flex justify-end gap-2 sm:col-span-2 pt-2 border-t">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending} className="bg-amber-600 hover:bg-amber-700 text-white">
                {mutation.isPending && <Spinner size="sm" className="mr-1" />}
                Save to Benchmark
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Benchmark Bulk Upload Modal
// ---------------------------------------------------------------------------
function normalizeHeader(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function formatCellString(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return BigInt(val).toString();
    return val.toString();
  }
  if (typeof val === 'string') return val.trim().replace(/^"|"$/g, '');
  return String(val).trim();
}

const FIELD_ALIASES: Record<string, string[]> = {
  brand: ['brand', 'make', 'oem'],
  deviceModel: ['devicemodel', 'model', 'modelname'],
  sampleHwType: ['samplehwtype', 'sampletype', 'hwtype'],
  sampleReceivedDate: ['samplereceiveddate', 'receiveddate'],
  vcId: ['vcid', 'vcno', 'vcnumber'],
  imei1: ['imei1', 'imei', 'imeino1'],
  imei2: ['imei2', 'imeino2'],
  serialNumber: ['serialnumber', 'serial', 'sn'],
  color: ['color', 'colour'],
  storageRam: ['storageram', 'storageramvariant', 'memory', 'variant'],
  dateOfReceipt: ['dateofreceipt', 'receiptdate'],
  warehouseLocation: ['warehouselocation', 'warehouse', 'location'],
  assignedTo: ['assignedto', 'assignee', 'employeename'],
  employeeId: ['employeeid', 'empid'],
  assignedDate: ['assigneddate', 'allocationdate'],
  remarks: ['remarks', 'remarkssection', 'notes', 'comments'],
};

const STANDARD_TEMPLATE_HEADERS = [
  'Brand',
  'Device Model',
  'Sample/HW Type',
  'Sample Received Date',
  'VC ID',
  'IMEI1',
  'IMEI2',
  'Color',
  'Storage/RAM Variant',
  'Date of Receipt',
  'Warehouse/Location',
  'Assigned To (Employee Name)',
  'Employee ID',
  'Assigned Date',
  'Remarks Section',
];

function BulkUploadBenchmarkModal({ onClose, uploaderOwner }: { onClose: () => void; uploaderOwner: string }) {
  const [activeTab, setActiveTab] = useState<'upload' | 'paste'>('upload');
  const [csvText, setCsvText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [uploadedFileSize, setUploadedFileSize] = useState<string | null>(null);
  const [parsedItems, setParsedItems] = useState<BulkUploadItem[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [uploadResult, setUploadResult] = useState<BulkUploadResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { bulkUpload } = useBenchmarkMutations();
  const { user } = useAuth();
  const { role } = useUserRole();

  const downloadExcelTemplate = () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([STANDARD_TEMPLATE_HEADERS]);
    ws['!cols'] = STANDARD_TEMPLATE_HEADERS.map((h) => ({ wch: Math.max(h.length + 4, 16) }));
    XLSX.utils.book_append_sheet(wb, ws, 'Benchmark Import');
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    downloadBlob(
      wbout,
      'benchmark_bulk_upload_template.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  };

  const downloadCsvTemplate = () => {
    const csvHeader = STANDARD_TEMPLATE_HEADERS.map((h) => `"${h}"`).join(',');
    downloadBlob(`${csvHeader}\n`, 'benchmark_bulk_upload_template.csv', 'text/csv;charset=utf-8;');
  };

  const parseWorkbookData = (workbook: XLSX.WorkBook, sourceLabel: string) => {
    setParseErrors([]);
    setUploadResult(null);
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      setParseErrors([`Spreadsheet "${sourceLabel}" contains no worksheets.`]);
      setParsedItems([]);
      return;
    }
    const sheet = workbook.Sheets[firstSheetName];
    if (!sheet) {
      setParsedItems([]);
      return;
    }
    const rawData: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
    if (rawData.length < 2) {
      setParseErrors([`"${sourceLabel}" must contain a header row and at least one device.`]);
      setParsedItems([]);
      return;
    }

    let headerRowIdx = 0;
    while (headerRowIdx < rawData.length && (!rawData[headerRowIdx] || (rawData[headerRowIdx] as unknown[]).length === 0)) {
      headerRowIdx++;
    }
    const rawHeaders = ((rawData[headerRowIdx] as unknown[]) || []).map(formatCellString);
    const normHeaders = rawHeaders.map(normalizeHeader);

    const findColIndex = (aliases: string[]): number =>
      normHeaders.findIndex((h) => aliases.some((alias) => h.includes(alias) || alias.includes(h)));

    const colMap: Record<string, number> = {};
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      colMap[field] = findColIndex(aliases);
    }

    const items: BulkUploadItem[] = [];
    const errors: string[] = [];

    for (let i = headerRowIdx + 1; i < rawData.length; i++) {
      const row = rawData[i] as unknown[];
      if (!row || row.length === 0) continue;
      const get = (field: string): string =>
        formatCellString(colMap[field] !== undefined && colMap[field]! >= 0 ? row[colMap[field]!] : '');

      const vcId = get('vcId');
      const imei1 = get('imei1');
      const deviceModel = get('deviceModel');

      if (!deviceModel && !imei1 && !vcId) continue;

      if (!vcId || vcId.trim() === '') errors.push(`Row ${i - headerRowIdx}: VC ID is mandatory.`);
      if (!imei1 || !/^\d{15}$/.test(imei1)) errors.push(`Row ${i - headerRowIdx}: IMEI1 '${imei1}' must be exactly 15 digits.`);

      const assignedTo = get('assignedTo');
      const employeeId = get('employeeId');

      items.push({
        brand: get('brand') || 'Other',
        deviceModel,
        sampleHwType: get('sampleHwType') || 'PRO',
        sampleReceivedDate: get('sampleReceivedDate'),
        vcId,
        imei1,
        imei2: get('imei2'),
        serialNumber: get('serialNumber'),
        color: get('color'),
        storageRam: get('storageRam'),
        dateOfReceipt: get('dateOfReceipt'),
        warehouseLocation: get('warehouseLocation') || 'Benchmark Lab',
        assignedTo,
        employeeId,
        assignedDate: get('assignedDate') || new Date().toISOString().slice(0, 10),
        remarks: get('remarks'),
        status: assignedTo || employeeId ? 'Active' : 'Inactive',
      });
    }

    setParsedItems(items);
    setParseErrors(errors);
  };

  const parseCsvText = (text: string) => {
    setCsvText(text);
    if (!text.trim()) {
      setParsedItems([]);
      setParseErrors([]);
      setUploadResult(null);
      return;
    }
    const workbook = XLSX.read(text, { type: 'string', cellDates: false });
    parseWorkbookData(workbook, 'Pasted CSV');
  };

  const processFile = (file: File) => {
    const fileName = file.name;
    const size =
      file.size < 1024
        ? `${file.size} B`
        : file.size < 1_048_576
          ? `${(file.size / 1024).toFixed(1)} KB`
          : `${(file.size / 1_048_576).toFixed(1)} MB`;
    setUploadedFileName(fileName);
    setUploadedFileSize(size);
    setUploadResult(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      const data = event.target?.result;
      if (!data) return;
      const workbook = XLSX.read(data, { type: 'array', cellDates: false });
      parseWorkbookData(workbook, fileName);
    };
    reader.readAsArrayBuffer(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const clearUploadedFile = () => {
    setUploadedFileName(null);
    setUploadedFileSize(null);
    setParsedItems([]);
    setParseErrors([]);
    setUploadResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleExecuteUpload = () => {
    if (parsedItems.length === 0) return;
    bulkUpload.mutate(
      { items: parsedItems, actorId: user?.email || user?.empCode || '', actorRole: role },
      { onSuccess: (data) => setUploadResult(data) },
    );
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true">
      <Card className="max-h-[92vh] w-full max-w-4xl overflow-y-auto">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-amber-500" />
              Bulk Benchmark Import (Excel / CSV)
            </CardTitle>
            <CardDescription>
              Batch import benchmark devices. Mandatory VC ID + all duplicate checkpoints (IMEI1, IMEI2, VC ID) are enforced automatically.
            </CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Ownership Banner */}
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
            <Lock className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Automatic Immutable Sole Ownership Policy</p>
              <p className="text-[11px] text-amber-800/90 dark:text-amber-300/90 mt-0.5">
                All devices uploaded will be registered under <strong>{uploaderOwner}</strong>. Rows with Assigned To / Employee ID are automatically checked out in Benchmark Assignments.
              </p>
            </div>
          </div>

          {/* Template Downloads */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3 text-xs">
            <div className="max-w-lg">
              <p className="font-semibold text-foreground">Standard 15 Fields Structure:</p>
              <p className="text-muted-foreground mt-0.5 leading-relaxed">
                Brand, Device Model, Sample/HW Type, Sample Received Date, VC ID (Mandatory), IMEI1 (15 digits), IMEI2, Color, Storage/RAM, Date of Receipt, Warehouse/Location, Assigned To, Employee ID, Assigned Date, Remarks.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={downloadExcelTemplate} className="gap-1.5 text-xs font-medium text-amber-700 border-amber-300 hover:bg-amber-50">
                <FileSpreadsheet className="h-3.5 w-3.5 text-amber-600" />
                Excel Template (.xlsx)
              </Button>
              <Button variant="outline" size="sm" onClick={downloadCsvTemplate} className="gap-1.5 text-xs font-medium">
                <Download className="h-3.5 w-3.5" />
                CSV Template (.csv)
              </Button>
            </div>
          </div>

          {/* Mode Tabs */}
          {!uploadResult && (
            <div className="flex items-center border-b text-xs font-medium">
              {(['upload', 'paste'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`flex items-center gap-2 px-4 py-2 border-b-2 transition-colors ${activeTab === tab ? 'border-amber-500 text-amber-600 font-semibold' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                >
                  {tab === 'upload' ? <FileSpreadsheet className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                  {tab === 'upload' ? 'Upload Spreadsheet (.xlsx, .csv)' : 'Paste Raw CSV'}
                </button>
              ))}
            </div>
          )}

          {/* Upload Zone */}
          {!uploadResult && activeTab === 'upload' && (
            <div className="space-y-3">
              <input type="file" ref={fileInputRef} accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileInputChange} />
              {!uploadedFileName ? (
                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => { e.preventDefault(); setIsDragging(false); const file = e.dataTransfer.files?.[0]; if (file) processFile(file); }}
                  className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-all cursor-pointer ${isDragging ? 'border-amber-500 bg-amber-500/5' : 'border-muted-foreground/25 hover:border-amber-400 hover:bg-muted/30'}`}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="rounded-full bg-amber-500/10 p-2.5 text-amber-600 mb-2">
                    <FileSpreadsheet className="h-6 w-6" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">Drop benchmark Excel/CSV file here</p>
                  <p className="text-xs text-muted-foreground mt-1">Supports .xlsx, .xls, and .csv</p>
                  <Button variant="outline" size="sm" className="mt-4 gap-2 text-xs border-amber-300 text-amber-700" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
                    <Upload className="h-3.5 w-3.5" /> Select File
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3.5">
                  <div className="flex items-center gap-3">
                    <div className="rounded-md bg-amber-500/10 p-2 text-amber-600">
                      <FileSpreadsheet className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground flex items-center gap-2">
                        {uploadedFileName}
                        <Badge variant="outline" className="text-[10px] font-normal">{uploadedFileSize}</Badge>
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{parsedItems.length} device entries parsed</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="text-xs h-7">Change File</Button>
                    <Button variant="ghost" size="sm" onClick={clearUploadedFile} className="text-xs h-7 text-muted-foreground hover:text-destructive" title="Remove file">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Paste CSV */}
          {!uploadResult && activeTab === 'paste' && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Paste comma-separated values including header row:</p>
              <textarea
                className="font-mono text-xs w-full h-36 rounded-md border border-input bg-background p-3"
                placeholder="Brand,Device Model,Sample/HW Type,Sample Received Date,VC ID,IMEI1,..."
                value={csvText}
                onChange={(e) => parseCsvText(e.target.value)}
              />
            </div>
          )}

          {/* Parse Errors */}
          {parseErrors.length > 0 && (
            <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive space-y-1">
              <p className="font-semibold flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" /> Validation Warnings ({parseErrors.length}):</p>
              <ul className="list-disc pl-5 space-y-0.5 max-h-28 overflow-y-auto">
                {parseErrors.slice(0, 8).map((err, idx) => <li key={idx}>{err}</li>)}
                {parseErrors.length > 8 && <li className="italic">...and {parseErrors.length - 8} more</li>}
              </ul>
            </div>
          )}

          {/* Upload Results */}
          {uploadResult && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border bg-muted/20 p-3 text-center">
                  <p className="text-xs uppercase text-muted-foreground">Total Processed</p>
                  <p className="text-2xl font-bold mt-1">{uploadResult.totalProcessed}</p>
                </div>
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-center">
                  <p className="text-xs uppercase text-amber-700 font-semibold">Imported Successfully</p>
                  <p className="text-2xl font-bold mt-1 text-amber-700">{uploadResult.importedCount}</p>
                </div>
                <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-center">
                  <p className="text-xs uppercase text-rose-700 font-semibold">Blocked by Duplicate</p>
                  <p className="text-2xl font-bold mt-1 text-rose-700">{uploadResult.blockedCount}</p>
                </div>
              </div>
              {uploadResult.blockedCount > 0 && (
                <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-4 space-y-2">
                  <h4 className="text-xs font-semibold text-rose-900 dark:text-rose-200 flex items-center gap-1.5"><Ban className="h-4 w-4" /> Blocked Entries:</h4>
                  <div className="divide-y text-xs text-rose-800 dark:text-rose-300 max-h-36 overflow-y-auto">
                    {uploadResult.blocked.map((b, idx) => (
                      <div key={idx} className="py-1.5 flex items-center justify-between gap-2">
                        <span>{b.reason}</span>
                        <Badge variant="destructive" className="text-[10px] shrink-0">BLOCKED</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Staged Items Preview */}
          {!uploadResult && parsedItems.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold">Preview Staged Entries ({parsedItems.length}):</p>
              <div className="max-h-48 overflow-y-auto rounded-md border text-xs">
                <table className="w-full text-left">
                  <thead className="border-b bg-muted/40 uppercase text-muted-foreground sticky top-0 bg-background">
                    <tr>
                      <th className="px-3 py-2 font-medium">#</th>
                      <th className="px-3 py-2 font-medium">Brand</th>
                      <th className="px-3 py-2 font-medium">Model</th>
                      <th className="px-3 py-2 font-medium">IMEI1</th>
                      <th className="px-3 py-2 font-medium">VC ID</th>
                      <th className="px-3 py-2 font-medium">Initial Assignee</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {parsedItems.map((item, idx) => (
                      <tr key={idx} className="hover:bg-muted/20">
                        <td className="px-3 py-1.5 text-muted-foreground font-mono text-[11px]">{idx + 1}</td>
                        <td className="px-3 py-1.5">{item.brand}</td>
                        <td className="px-3 py-1.5 font-medium">{item.deviceModel}</td>
                        <td className="px-3 py-1.5 font-mono text-amber-600 font-semibold">{item.imei1}</td>
                        <td className="px-3 py-1.5 font-mono">{item.vcId || '—'}</td>
                        <td className="px-3 py-1.5">{item.assignedTo ? `${item.assignedTo} (${item.employeeId || 'N/A'})` : 'Available Stock'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button variant="outline" onClick={onClose} size="sm">{uploadResult ? 'Done' : 'Cancel'}</Button>
            {!uploadResult && (
              <Button
                size="sm"
                disabled={parsedItems.length === 0 || bulkUpload.isPending}
                onClick={handleExecuteUpload}
                className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
              >
                {bulkUpload.isPending && <Spinner size="sm" className="mr-1" />}
                Import to Benchmark ({parsedItems.length} Devices)
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assign Controller Modal (Admin Only — Employee or TL)
// ---------------------------------------------------------------------------
function AssignControllerModal({ onClose, currentConfig }: { onClose: () => void; currentConfig: BenchmarkControllerConfig | null }) {
  const [controllerId, setControllerId] = useState(currentConfig?.controllerId || '');
  const [roleFilter, setRoleFilter] = useState<'ALL' | 'Employee' | 'TL'>('ALL');
  const [userSearch, setUserSearch] = useState('');
  const { assignController, clearController } = useBenchmarkMutations();
  const { data: allUsers } = useQuery<AuthUser[]>({
    queryKey: ['all-users-admin'],
    queryFn: () => apiClient.get<AuthUser[]>('/auth/all-users'),
  });

  const filteredUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase();
    return (allUsers ?? []).filter((u) => {
      if (roleFilter !== 'ALL' && u.role !== roleFilter) return false;
      if (!query) return true;
      return (
        u.name.toLowerCase().includes(query) ||
        u.empCode.toLowerCase().includes(query) ||
        u.email.toLowerCase().includes(query)
      );
    });
  }, [allUsers, roleFilter, userSearch]);

  const handleAssign = () => {
    if (!controllerId.trim()) return;
    assignController.mutate({ controllerId }, { onSuccess: onClose });
  };

  const handleClear = () => {
    clearController.mutate(undefined, { onSuccess: onClose });
  };

  const mutationError = assignController.error || clearController.error;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true">
      <Card className="w-full max-w-lg">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <UserCog className="h-5 w-5 text-amber-500" />
              Assign Benchmark Controller
            </CardTitle>
            <CardDescription>Designate one Employee or TL as the sole controller of Benchmark Inventory.</CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {currentConfig && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-amber-700 flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5" /> Current Controller
                </p>
                <p className="mt-1">
                  <strong>{currentConfig.controllerName}</strong> ({currentConfig.controllerId})
                  {currentConfig.controllerRole && (
                    <Badge variant="outline" className="ml-2 text-[10px]">{currentConfig.controllerRole}</Badge>
                  )}
                </p>
                <p className="text-muted-foreground">{currentConfig.controllerEmail}</p>
                <p className="text-muted-foreground">Assigned by: {currentConfig.assignedBy}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs text-destructive border-destructive/30 hover:bg-destructive/10 shrink-0 gap-1"
                disabled={clearController.isPending}
                onClick={handleClear}
              >
                <ShieldOff className="h-3.5 w-3.5" />
                Revoke
              </Button>
            </div>
          )}

          {/* Filter users by Role + Search */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-sm font-medium">Select Controller (Employee or TL)</label>
              <div className="flex items-center gap-1">
                {(['ALL', 'Employee', 'TL'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRoleFilter(r)}
                    className={`rounded-md px-2 py-0.5 text-[11px] font-medium border transition-colors ${
                      roleFilter === r
                        ? 'bg-amber-600 text-white border-amber-600'
                        : 'bg-background text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {r === 'ALL' ? 'All Roles' : r === 'Employee' ? 'Employees' : 'TLs'}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-xs"
                placeholder="Search by name, emp code, or email..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
              />
            </div>

            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={controllerId}
              onChange={(e) => setControllerId(e.target.value)}
            >
              <option value="">— Select Employee / TL ({filteredUsers.length} matches) —</option>
              {filteredUsers.map((u) => (
                <option key={u.empCode} value={u.empCode}>
                  {u.name} ({u.empCode}) — {u.role}{u.team ? ` · ${u.team}` : ''}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Only one person can be the Benchmark Controller at a time. The previous controller loses write access immediately.
            </p>
          </div>

          {mutationError && (
            <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
              {mutationError instanceof Error ? mutationError.message : 'Controller update failed.'}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              disabled={!controllerId || assignController.isPending || clearController.isPending}
              onClick={handleAssign}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {assignController.isPending && <Spinner size="sm" className="mr-1" />}
              Assign as Controller
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Return Benchmark Device Modal (with mandatory Front/Back return photos)
// ---------------------------------------------------------------------------
function ReturnBenchmarkModal({ assignment, onClose }: { assignment: Assignment; onClose: () => void }) {
  const [returnLocation, setReturnLocation] = useState('Benchmark Lab');
  const [returnCondition, setReturnCondition] = useState<'Good' | 'Minor Wear' | 'Damaged'>('Good');
  const [notes, setNotes] = useState('');
  const [returnPhotos, setReturnPhotos] = useState<PhotoRecord[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState(false);

  const { returnDevice } = useBenchmarkAssignmentMutations();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setPhotoError(null);

    const hasFront = returnPhotos.some((p) => p.label === 'front');
    const hasBack = returnPhotos.some((p) => p.label === 'back');
    if (!hasFront || !hasBack) {
      setPhotoError('Mandatory return photos required: Upload both Front and Back photos of the returned device.');
      return;
    }

    returnDevice.mutate(
      {
        id: assignment.id,
        input: {
          returnLocation: returnLocation.trim() || 'Benchmark Lab',
          returnCondition,
          notes: notes.trim() || undefined,
          returnPhotos,
        },
      },
      {
        onSuccess: () => {
          setSuccess(true);
          setTimeout(() => onClose(), 1000);
        },
        onError: (err) => {
          setFormError(err instanceof Error ? err.message : 'Failed to return benchmark device.');
        },
      },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
      <Card className="max-h-[92vh] w-full max-w-xl overflow-y-auto shadow-2xl">
        <CardHeader className="flex flex-row items-center justify-between pb-3 border-b bg-muted/20">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-emerald-600" />
              Return Benchmark Device
            </CardTitle>
            <CardDescription>
              Check hardware back into Benchmark Pool and capture verified return photos.
            </CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close return modal">
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <div className="rounded-lg border bg-amber-500/5 border-amber-500/20 p-3 text-xs space-y-1">
            <p className="font-bold text-sm text-foreground">{assignment.itemName}</p>
            <p className="text-muted-foreground">
              Currently assigned to: <strong className="text-foreground">{assignment.employeeName}</strong> ({assignment.employeeId})
            </p>
            <p className="text-muted-foreground font-mono">Device ID / IMEI: {assignment.itemId} · Since {assignment.assignedAt}</p>
          </div>

          {success ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-5 text-center space-y-2">
              <CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto" />
              <p className="font-semibold text-emerald-800 dark:text-emerald-300">Benchmark Device Returned!</p>
              <p className="text-xs text-muted-foreground">Device status is now Inactive / Available in Benchmark Stock.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Return Location</label>
                  <input
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={returnLocation}
                    onChange={(e) => setReturnLocation(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Physical Condition</label>
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={returnCondition}
                    onChange={(e) => setReturnCondition(e.target.value as 'Good' | 'Minor Wear' | 'Damaged')}
                  >
                    <option value="Good">Good</option>
                    <option value="Minor Wear">Minor Wear</option>
                    <option value="Damaged">Damaged</option>
                  </select>
                </div>
              </div>

              <PhotoUploadSection
                photos={returnPhotos}
                onChange={(next) => {
                  setReturnPhotos(next);
                  setPhotoError(null);
                }}
                error={photoError}
                title="Return Inspection Condition Photos"
                description="Front & Back photos are mandatory upon return for chain-of-custody verification (max 5 MB each)."
              />

              <div className="space-y-1">
                <label className="text-sm font-medium">Return Notes (Optional)</label>
                <textarea
                  className="min-h-16 w-full rounded-md border border-input bg-background p-2.5 text-sm"
                  placeholder="Condition observations, accessories returned, benchmark score notes..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              {formError && (
                <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                  {formError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                <Button
                  type="submit"
                  disabled={returnDevice.isPending}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                >
                  {returnDevice.isPending && <Spinner size="sm" />}
                  Confirm Benchmark Return
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Photo Thumbnail Strip Helper
// ---------------------------------------------------------------------------
function PhotoThumbnails({
  photos,
  labelPrefix,
  onZoom,
}: {
  photos?: PhotoRecord[];
  labelPrefix: string;
  onZoom: (photo: PhotoRecord, title: string) => void;
}) {
  if (!photos || photos.length === 0) {
    return <span className="text-[11px] text-muted-foreground">—</span>;
  }
  return (
    <div className="flex items-center gap-1">
      {photos.slice(0, 4).map((p, idx) => (
        <button
          key={`${p.label}-${idx}`}
          type="button"
          onClick={() => onZoom(p, `${labelPrefix} · ${p.label.replace('_', ' ')}`)}
          className="h-7 w-7 rounded border overflow-hidden hover:ring-2 hover:ring-amber-500 transition-all bg-black/5 shrink-0"
          title={`${labelPrefix}: ${p.label}`}
        >
          <img src={p.dataUri} alt={`${labelPrefix} ${p.label}`} className="h-full w-full object-cover" />
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Benchmark Page
// ---------------------------------------------------------------------------
const tableColumns = [
  'Brand',
  'Device Model',
  'Sample/HW Type',
  'VC ID',
  'IMEI1',
  'IMEI2',
  'Serial Number',
  'Assigned Date',
  'Warehouse',
  'Owner / Uploader',
  'Current Custody',
  'Status',
];

export function BenchmarkPage() {
  const { role } = useUserRole();
  const { user } = useAuth();
  const [activeSubTab, setActiveSubTab] = useState<'devices' | 'assignments'>('devices');

  const [filters, setFilters] = useState<BenchmarkFilters>({
    page: 1,
    pageSize: 10,
    search: '',
    brand: '',
    status: '',
    owner: '',
  });
  const [assignFilters, setAssignFilters] = useState<BenchmarkAssignmentFilters>({
    page: 1,
    pageSize: 10,
    search: '',
    status: '',
  });

  const [formItem, setFormItem] = useState<InventoryItem | null | undefined>(undefined);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [showAssignController, setShowAssignController] = useState(false);
  const [assigningItem, setAssigningItem] = useState<InventoryItem | null>(null);
  const [returningAssignment, setReturningAssignment] = useState<Assignment | null>(null);
  const [trackingDeviceId, setTrackingDeviceId] = useState<string | null>(null);
  const [zoomPhoto, setZoomPhoto] = useState<{ photo: PhotoRecord; title: string } | null>(null);
  const [exporting, setExporting] = useState(false);

  const { data, isLoading, isError } = useBenchmark(filters);
  const { data: controllerData } = useBenchmarkController();
  const { data: activeAssignmentsData } = useBenchmarkAssignments({
    page: 1,
    pageSize: 200,
    search: '',
    status: 'Active',
  });
  const {
    data: assignmentsData,
    isLoading: assignmentsLoading,
    isError: assignmentsError,
  } = useBenchmarkAssignments(assignFilters);

  const { deactivate } = useBenchmarkMutations();
  const { exportCsv } = useBenchmarkAssignmentMutations();

  const uploaderOwner = user?.name ? `${user.name}${user.empCode ? ` (${user.empCode})` : ''}` : 'Benchmark Lab';

  const isAdmin = role === 'Admin';
  const isBenchmarkController = Boolean(
    controllerData &&
      user &&
      ((controllerData.controllerId &&
        (controllerData.controllerId.toLowerCase() === user.empCode?.toLowerCase() ||
          controllerData.controllerId.toLowerCase() === user.id?.toLowerCase())) ||
        (controllerData.controllerEmail &&
          controllerData.controllerEmail.toLowerCase() === user.email?.toLowerCase())),
  );
  const hasWriteAccess = isAdmin || isBenchmarkController;

  // Map IMEI1 / itemId -> Active Assignment so rows show real-time custody & one-click Return
  const activeAssignmentByDevice = useMemo(() => {
    const map = new Map<string, Assignment>();
    for (const a of activeAssignmentsData?.records ?? []) {
      map.set(a.itemId, a);
    }
    return map;
  }, [activeAssignmentsData]);

  const updateFilter = <K extends keyof BenchmarkFilters>(name: K, value: BenchmarkFilters[K]) =>
    setFilters((current) => ({ ...current, [name]: value, ...(name !== 'page' && { page: 1 }) }));

  const updateAssignFilter = <K extends keyof BenchmarkAssignmentFilters>(
    name: K,
    value: BenchmarkAssignmentFilters[K],
  ) =>
    setAssignFilters((current) => ({ ...current, [name]: value, ...(name !== 'page' && { page: 1 }) }));

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const result = await exportCsv();
      downloadBlob(result.csv, result.filename || 'benchmark_assignments.csv', 'text/csv;charset=utf-8;');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FlaskConical className="h-6 w-6 text-amber-500" />
            <h1 className="text-2xl font-bold tracking-tight">Benchmark Inventory</h1>
            <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-300 text-xs">BENCHMARK</Badge>
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            Dedicated benchmark testing hardware pool · Controlled by a single designated Employee or TL assigned by Admin.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Controller Info Chip */}
          {controllerData ? (
            <div className="flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 dark:bg-amber-950/20 px-3 py-1 text-xs text-amber-700 dark:text-amber-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>
                Controller: <strong>{controllerData.controllerName}</strong>
                {controllerData.controllerRole ? ` (${controllerData.controllerRole})` : ''}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 rounded-full border border-muted px-3 py-1 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              <span>No controller assigned</span>
            </div>
          )}

          {/* Admin: Assign Controller */}
          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowAssignController(true)}
              className="gap-1.5 text-xs border-amber-300 text-amber-700 hover:bg-amber-50"
            >
              <UserCog className="h-4 w-4" />
              {controllerData ? 'Change Controller' : 'Assign Controller'}
            </Button>
          )}

          {/* Write Operations */}
          {hasWriteAccess && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowBulkUpload(true)}
                className="gap-1.5 text-xs"
              >
                <Upload className="h-4 w-4" />
                Bulk Upload
              </Button>
              <Button
                size="sm"
                onClick={() => setFormItem(null)}
                className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
              >
                <Plus className="h-4 w-4" />
                Add Device
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Access restriction notice for non-controllers */}
      {!hasWriteAccess && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm flex items-start gap-2.5">
          <Lock className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-800 dark:text-amber-200">
            <span className="font-semibold">View-Only Access:</span> Only the designated Benchmark Controller
            {controllerData ? <> (<strong>{controllerData.controllerName}</strong>)</> : ''} or Admin can add, edit, assign, or return benchmark devices. You can inspect devices and custody trails read-only.
          </div>
        </div>
      )}

      {/* Stats Cards */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg border p-3 bg-muted/20 text-center">
            <p className="text-xs text-muted-foreground uppercase">Total Benchmark Pool</p>
            <p className="text-2xl font-bold mt-1">{data.total}</p>
          </div>
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-center">
            <p className="text-xs text-emerald-700 dark:text-emerald-300 font-semibold uppercase">Available in Stock</p>
            <p className="text-2xl font-bold mt-1 text-emerald-600">{data.inactiveCount}</p>
          </div>
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-center">
            <p className="text-xs text-amber-700 dark:text-amber-300 font-semibold uppercase">In Testing (Assigned)</p>
            <p className="text-2xl font-bold mt-1 text-amber-600">{data.activeCount}</p>
          </div>
          <div className="rounded-lg border p-3 bg-muted/20 text-center">
            <p className="text-xs text-muted-foreground uppercase">Designated Controller</p>
            <p className="text-xs font-semibold mt-2 truncate">
              {controllerData ? `${controllerData.controllerName} (${controllerData.controllerRole || 'Controller'})` : 'Unassigned'}
            </p>
          </div>
        </div>
      )}

      {/* Sub-Tabs */}
      <div className="flex items-center border-b text-sm font-medium">
        <button
          type="button"
          onClick={() => setActiveSubTab('devices')}
          className={`flex items-center gap-2 px-4 py-2.5 border-b-2 transition-colors ${
            activeSubTab === 'devices'
              ? 'border-amber-500 text-amber-600 font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <FlaskConical className="h-4 w-4" />
          Benchmark Devices
          {data && <Badge variant="secondary" className="text-[10px]">{data.total}</Badge>}
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('assignments')}
          className={`flex items-center gap-2 px-4 py-2.5 border-b-2 transition-colors ${
            activeSubTab === 'assignments'
              ? 'border-amber-500 text-amber-600 font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <ArrowLeftRight className="h-4 w-4" />
          Checkouts &amp; Returns
          {assignmentsData && (
            <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700">
              {assignmentsData.activeCount} Active
            </Badge>
          )}
        </button>
      </div>

      {/* =================================================================== */}
      {/* TAB 1: BENCHMARK DEVICES                                            */}
      {/* =================================================================== */}
      {activeSubTab === 'devices' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Status pills */}
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { label: 'All Devices', value: '' },
                  { label: 'Available in Stock', value: 'Inactive' },
                  { label: 'In Testing (Active)', value: 'Active' },
                ] as const
              ).map((pill) => (
                <button
                  key={pill.label}
                  type="button"
                  onClick={() => updateFilter('status', pill.value)}
                  className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                    filters.status === pill.value
                      ? 'bg-amber-600 text-white border-amber-600'
                      : 'bg-background text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>

            {/* Search & dropdown filters */}
            <div className="flex flex-wrap items-center gap-2 flex-1 justify-end">
              <div className="relative min-w-[210px] max-w-xs flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
                  placeholder="Search model, VC ID, IMEI, remarks..."
                  value={filters.search}
                  onChange={(e) => updateFilter('search', e.target.value)}
                />
              </div>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={filters.brand}
                onChange={(e) => updateFilter('brand', e.target.value)}
              >
                <option value="">All Brands</option>
                {brands.map((b) => <option key={b}>{b}</option>)}
              </select>
              {data?.owners && data.owners.length > 0 && (
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm max-w-[200px]"
                  value={filters.owner || ''}
                  onChange={(e) => updateFilter('owner', e.target.value)}
                >
                  <option value="">All Owners</option>
                  {data.owners.map((ownerName) => (
                    <option key={ownerName} value={ownerName}>{ownerName}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Table */}
          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="flex items-center justify-center py-20"><Spinner size="lg" /></div>
              ) : isError ? (
                <div className="p-6 text-sm text-destructive text-center">
                  Failed to load benchmark inventory. Please check Lark connectivity and ensure LARK_TABLE_BENCHMARK is configured.
                </div>
              ) : !data || data.records.length === 0 ? (
                <EmptyState
                  title="No Benchmark Devices"
                  description={hasWriteAccess ? 'Add your first benchmark device or use Bulk Upload.' : 'No benchmark devices match your filter.'}
                  icon={<FlaskConical className="h-8 w-8 text-amber-400" />}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="border-b bg-muted/30 text-xs uppercase text-muted-foreground">
                      <tr>
                        {tableColumns.map((col) => (
                          <th key={col} className="px-3.5 py-3 font-medium whitespace-nowrap">{col}</th>
                        ))}
                        <th className="px-3.5 py-3 font-medium text-right whitespace-nowrap">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {data.records.map((item) => {
                        const activeCheckout =
                          activeAssignmentByDevice.get(item.imei1) || activeAssignmentByDevice.get(item.itemId);
                        return (
                          <tr key={item.itemId} className="hover:bg-muted/20 transition-colors">
                            <td className="px-3.5 py-3 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5">
                                <span
                                  className={`h-2 w-2 rounded-full ${
                                    item.brand === 'Tecno'
                                      ? 'bg-blue-500'
                                      : item.brand === 'Infinix'
                                        ? 'bg-purple-500'
                                        : item.brand === 'Itel'
                                          ? 'bg-green-500'
                                          : 'bg-muted-foreground'
                                  }`}
                                />
                                {item.brand}
                              </span>
                            </td>
                            <td className="px-3.5 py-3 font-medium text-foreground whitespace-nowrap">
                              {item.deviceModel}
                              {item.storageRam && (
                                <span className="block text-[11px] font-normal text-muted-foreground">{item.storageRam}</span>
                              )}
                            </td>
                            <td className="px-3.5 py-3">
                              <Badge variant="outline" className="text-[10px] font-mono">{item.sampleHwType}</Badge>
                            </td>
                            <td className="px-3.5 py-3 font-mono text-xs text-amber-600 font-semibold whitespace-nowrap">
                              {item.vcId || '—'}
                            </td>
                            <td className="px-3.5 py-3 font-mono text-xs whitespace-nowrap">{item.imei1}</td>
                            <td className="px-3.5 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                              {item.imei2 || '—'}
                            </td>
                            <td className="px-3.5 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                              {item.serialNumber || '—'}
                            </td>
                            <td className="px-3.5 py-3 text-xs whitespace-nowrap">{item.assignedDate || '—'}</td>
                            <td className="px-3.5 py-3 text-xs whitespace-nowrap">{item.warehouseLocation}</td>
                            <td className="px-3.5 py-3 text-xs">
                              <div className="flex items-center gap-1">
                                <Lock className="h-3 w-3 text-amber-500 shrink-0" />
                                <span className="truncate max-w-[140px]">{item.owner || 'Benchmark Lab'}</span>
                              </div>
                            </td>
                            <td className="px-3.5 py-3 text-xs">
                              {activeCheckout ? (
                                <div>
                                  <span className="font-medium text-foreground block whitespace-nowrap">
                                    {activeCheckout.employeeName}
                                  </span>
                                  <span className="text-[11px] text-muted-foreground font-mono">
                                    {activeCheckout.employeeId}
                                  </span>
                                </div>
                              ) : item.assignedTo ? (
                                <span className="text-foreground">{item.assignedTo}</span>
                              ) : (
                                <span className="text-muted-foreground">{item.inventoryHolder || 'Benchmark Pool'}</span>
                              )}
                            </td>
                            <td className="px-3.5 py-3 whitespace-nowrap">
                              <Badge
                                className={`text-[10px] ${
                                  item.status === 'Active'
                                    ? 'bg-amber-500/20 text-amber-700 border-amber-300'
                                    : 'bg-emerald-500/15 text-emerald-700 border-emerald-300'
                                }`}
                                variant="outline"
                              >
                                {item.status === 'Active' ? '● In Testing' : '○ Available'}
                              </Badge>
                            </td>
                            <td className="px-3.5 py-3 text-right whitespace-nowrap">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-xs gap-1"
                                  onClick={() => setTrackingDeviceId(item.imei1 || item.itemId)}
                                  title="View chain-of-custody trail"
                                >
                                  <History className="h-3.5 w-3.5" />
                                  Custody
                                </Button>

                                {hasWriteAccess && item.status === 'Inactive' && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2 text-xs gap-1 border-amber-300 text-amber-700 hover:bg-amber-50"
                                    onClick={() => setAssigningItem(item)}
                                  >
                                    <ArrowLeftRight className="h-3 w-3" />
                                    Assign
                                  </Button>
                                )}

                                {hasWriteAccess && item.status === 'Active' && activeCheckout && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2 text-xs gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                                    onClick={() => setReturningAssignment(activeCheckout)}
                                  >
                                    <RotateCcw className="h-3 w-3" />
                                    Return
                                  </Button>
                                )}

                                {hasWriteAccess && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-xs gap-1"
                                    onClick={() => setFormItem(item)}
                                  >
                                    <Pencil className="h-3 w-3" />
                                    Edit
                                  </Button>
                                )}

                                {isAdmin && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                                    disabled={deactivate.isPending || item.status === 'Active'}
                                    title={
                                      item.status === 'Active'
                                        ? 'Return device before deactivating'
                                        : 'Deactivate benchmark device'
                                    }
                                    onClick={() => deactivate.mutate(item.itemId)}
                                  >
                                    Deactivate
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pagination */}
          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Showing {(filters.page - 1) * filters.pageSize + 1}–{Math.min(filters.page * filters.pageSize, data.total)} of{' '}
                {data.total} devices
              </span>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={filters.page <= 1}
                  onClick={() => updateFilter('page', filters.page - 1)}
                  className="h-7 px-2"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="px-3">{filters.page} / {data.totalPages}</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={filters.page >= data.totalPages}
                  onClick={() => updateFilter('page', filters.page + 1)}
                  className="h-7 px-2"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 2: BENCHMARK CHECKOUTS & RETURNS                                */}
      {/* =================================================================== */}
      {activeSubTab === 'assignments' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { label: 'All Checkouts', value: '' },
                  { label: 'Active', value: 'Active' },
                  { label: 'Returned', value: 'Returned' },
                ] as const
              ).map((pill) => (
                <button
                  key={pill.label}
                  type="button"
                  onClick={() => updateAssignFilter('status', pill.value)}
                  className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                    assignFilters.status === pill.value
                      ? 'bg-amber-600 text-white border-amber-600'
                      : 'bg-background text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 flex-1 justify-end">
              <div className="relative min-w-[220px] max-w-xs flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
                  placeholder="Search device, IMEI, employee..."
                  value={assignFilters.search}
                  onChange={(e) => updateAssignFilter('search', e.target.value)}
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleExportCsv()}
                disabled={exporting}
                className="gap-1.5 text-xs"
              >
                {exporting ? <Spinner size="sm" /> : <Download className="h-3.5 w-3.5" />}
                Export CSV
              </Button>
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              {assignmentsLoading ? (
                <div className="flex items-center justify-center py-20"><Spinner size="lg" /></div>
              ) : assignmentsError ? (
                <div className="p-6 text-sm text-destructive text-center">
                  Failed to load benchmark checkouts. Please verify LARK_TABLE_BENCHMARK_ASSIGNMENTS configuration.
                </div>
              ) : !assignmentsData || assignmentsData.records.length === 0 ? (
                <EmptyState
                  title="No Benchmark Assignments"
                  description="Assign an available benchmark device to track custody and condition photos."
                  icon={<ArrowLeftRight className="h-8 w-8 text-amber-400" />}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="border-b bg-muted/30 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 font-medium">Device</th>
                        <th className="px-4 py-3 font-medium">Assigned Employee</th>
                        <th className="px-4 py-3 font-medium">Dates &amp; Condition</th>
                        <th className="px-4 py-3 font-medium">Source / Handler</th>
                        <th className="px-4 py-3 font-medium">Checkout Photos</th>
                        <th className="px-4 py-3 font-medium">Return Photos</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {assignmentsData.records.map((a) => (
                        <tr key={a.id} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-3">
                            <p className="font-medium text-foreground">{a.itemName}</p>
                            <p className="text-[11px] font-mono text-muted-foreground">{a.itemId}</p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-foreground">{a.employeeName}</p>
                            <p className="text-[11px] font-mono text-muted-foreground">{a.employeeId}</p>
                          </td>
                          <td className="px-4 py-3 text-xs space-y-0.5">
                            <p>Out: <span className="font-mono">{a.assignedAt}</span></p>
                            {a.returnedAt && <p className="text-emerald-700">In: <span className="font-mono">{a.returnedAt}</span></p>}
                            {a.returnCondition && (
                              <Badge variant="outline" className="text-[10px]">{a.returnCondition}</Badge>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground space-y-0.5">
                            <p>{a.assignedFrom || 'Benchmark Lab Pool'}</p>
                            {a.assignedBy && <p className="text-[11px]">By: {a.assignedBy}</p>}
                          </td>
                          <td className="px-4 py-3">
                            <PhotoThumbnails
                              photos={a.assignmentPhotos}
                              labelPrefix="Checkout"
                              onZoom={(photo, title) => setZoomPhoto({ photo, title })}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <PhotoThumbnails
                              photos={a.returnPhotos}
                              labelPrefix="Return"
                              onZoom={(photo, title) => setZoomPhoto({ photo, title })}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${
                                a.status === 'Active'
                                  ? 'bg-amber-500/20 text-amber-700 border-amber-300'
                                  : 'bg-emerald-500/15 text-emerald-700 border-emerald-300'
                              }`}
                            >
                              {a.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs gap-1"
                                onClick={() => setTrackingDeviceId(a.itemId)}
                              >
                                <History className="h-3.5 w-3.5" />
                                Custody
                              </Button>
                              {hasWriteAccess && a.status === 'Active' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-xs gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                                  onClick={() => setReturningAssignment(a)}
                                >
                                  <RotateCcw className="h-3 w-3" />
                                  Return
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {assignmentsData && assignmentsData.totalPages > 1 && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Showing {(assignFilters.page - 1) * assignFilters.pageSize + 1}–
                {Math.min(assignFilters.page * assignFilters.pageSize, assignmentsData.total)} of{' '}
                {assignmentsData.total} records
              </span>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={assignFilters.page <= 1}
                  onClick={() => updateAssignFilter('page', assignFilters.page - 1)}
                  className="h-7 px-2"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="px-3">{assignFilters.page} / {assignmentsData.totalPages}</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={assignFilters.page >= assignmentsData.totalPages}
                  onClick={() => updateAssignFilter('page', assignFilters.page + 1)}
                  className="h-7 px-2"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {formItem !== undefined && (
        <BenchmarkForm item={formItem ?? undefined} onClose={() => setFormItem(undefined)} />
      )}
      {showBulkUpload && (
        <BulkUploadBenchmarkModal onClose={() => setShowBulkUpload(false)} uploaderOwner={uploaderOwner} />
      )}
      {showAssignController && (
        <AssignControllerModal
          onClose={() => setShowAssignController(false)}
          currentConfig={controllerData ?? null}
        />
      )}
      {assigningItem && (
        <AssignDeviceModal
          item={assigningItem}
          source="benchmark"
          onClose={() => setAssigningItem(null)}
        />
      )}
      {returningAssignment && (
        <ReturnBenchmarkModal
          assignment={returningAssignment}
          onClose={() => setReturningAssignment(null)}
        />
      )}
      {trackingDeviceId && (
        <DeviceTrackingModal
          deviceIdentifier={trackingDeviceId}
          source="benchmark"
          onClose={() => setTrackingDeviceId(null)}
        />
      )}

      {/* Photo Lightbox */}
      {zoomPhoto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
          onClick={() => setZoomPhoto(null)}
        >
          <div
            className="relative max-h-[90vh] max-w-3xl overflow-hidden rounded-lg bg-background p-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b pb-2 px-1">
              <span className="text-sm font-semibold capitalize flex items-center gap-1.5">
                <Camera className="h-4 w-4 text-amber-500" />
                {zoomPhoto.title}
              </span>
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full" onClick={() => setZoomPhoto(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="p-2 flex items-center justify-center max-h-[75vh]">
              <img
                src={zoomPhoto.photo.dataUri}
                alt={zoomPhoto.title}
                className="max-h-[70vh] w-auto rounded object-contain"
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground border-t pt-2 px-1">
              <span>Size: {(zoomPhoto.photo.sizeBytes / 1024).toFixed(0)} KB</span>
              <span>Captured: {zoomPhoto.photo.capturedAt?.slice(0, 19).replace('T', ' ')}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
