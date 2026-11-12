import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  X,
  ArrowLeftRight,
  Loader2,
  CheckCircle2,
  User,
  Building2,
  Camera,
  AlertCircle,
  Eye,
  Trash2,
  ShieldCheck,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client.js';
import { useAssignmentMutations } from '@/hooks/use-assignments.js';
import { useBenchmarkAssignmentMutations } from '@/hooks/use-benchmark.js';
import { useAuth } from '@/context/auth-context.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card.js';
import { Button } from '@/components/ui/button.js';
import { Badge } from '@/components/ui/badge.js';
import { Spinner } from '@/components/ui/spinner.js';
import type { InventoryItem, AuthUser, PhotoRecord, PhotoLabel } from '@/types/api.js';
import { cn } from '@/lib/utils.js';

interface AssignDeviceModalProps {
  item: InventoryItem;
  onClose: () => void;
  source?: 'inventory' | 'benchmark';
}

// ---------------------------------------------------------------------------
// Photo processing helper (mirrors assignments-page.tsx)
// ---------------------------------------------------------------------------
async function processPhotoFile(file: File, label: PhotoLabel): Promise<PhotoRecord> {
  const maxBytes = 5 * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new Error(
      `File "${file.name}" is ${(file.size / (1024 * 1024)).toFixed(2)} MB. Maximum allowed photo size is 5 MB.`,
    );
  }
  if (!file.type.match(/^image\/(jpeg|jpg|png|webp)$/i)) {
    throw new Error(`File "${file.name}" is not a supported format. Please upload JPG, PNG, or WEBP image.`);
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to decode image data.'));
      img.onload = () => {
        const maxDim = 1600;
        let width = img.width;
        let height = img.height;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas context unavailable.')); return; }
        ctx.drawImage(img, 0, 0, width, height);
        const outputMime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const dataUri = canvas.toDataURL(outputMime, 0.85);
        const sizeBytes = Math.round((dataUri.length * 3) / 4);
        if (sizeBytes > maxBytes) {
          reject(new Error('Optimized photo exceeds 5 MB. Please upload a smaller image.'));
          return;
        }
        resolve({ label, mimeType: outputMime, sizeBytes, dataUri, capturedAt: new Date().toISOString() });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

const PHOTO_SLOTS: Array<{ label: PhotoLabel; name: string; required: boolean; hint: string }> = [
  { label: 'front', name: 'Front of Device', required: true, hint: 'Screen, active display & front bezels' },
  { label: 'back', name: 'Back of Device', required: true, hint: 'Rear cover, camera module & serial/IMEI label' },
  { label: 'extra_1', name: 'Side / Edges (Optional)', required: false, hint: 'SIM tray, volume buttons & ports' },
  { label: 'extra_2', name: 'Accessories / Box (Optional)', required: false, hint: 'Charger, cable, packaging or case' },
];

// ---------------------------------------------------------------------------
// Mini PhotoUpload component
// ---------------------------------------------------------------------------
export function PhotoUploadSection({
  photos,
  onChange,
  error,
  title = 'Device Checkout Condition Photos',
  description = 'Front & Back photos are mandatory for chain-of-custody (max 5 MB each). Photos are stored directly in Lark.',
}: {
  photos: PhotoRecord[];
  onChange: (photos: PhotoRecord[]) => void;
  error?: string | null;
  title?: string;
  description?: string;
}) {
  const [processingLabel, setProcessingLabel] = useState<PhotoLabel | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [previewPhoto, setPreviewPhoto] = useState<PhotoRecord | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const hasFront = photos.some((p) => p.label === 'front');
  const hasBack = photos.some((p) => p.label === 'back');

  const handleFileChange = async (label: PhotoLabel, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLocalError(null);
    setProcessingLabel(label);
    try {
      const processed = await processPhotoFile(file, label);
      onChange([...photos.filter((p) => p.label !== label), processed]);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to process photo.');
    } finally {
      setProcessingLabel(null);
    }
  };

  const handleRemove = (label: PhotoLabel) => onChange(photos.filter((p) => p.label !== label));

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
        <div>
          <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <Camera className="h-4 w-4 text-primary" />
            {title}
          </h4>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {description}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {hasFront && hasBack ? (
            <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              <CheckCircle2 className="h-3 w-3 text-emerald-600" />
              Front &amp; Back Verified
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
              <AlertCircle className="h-3 w-3 text-amber-600" />
              Front &amp; Back Required
            </span>
          )}
        </div>
      </div>

      {(error || localError) && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error || localError}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {PHOTO_SLOTS.map((slot) => {
          const currentPhoto = photos.find((p) => p.label === slot.label);
          const isProcessing = processingLabel === slot.label;
          return (
            <div
              key={slot.label}
              className={cn(
                'relative flex flex-col rounded-lg border p-2 transition-all',
                currentPhoto
                  ? 'border-emerald-200/80 bg-emerald-50/20 dark:border-emerald-900 dark:bg-emerald-950/10'
                  : slot.required
                  ? 'border-amber-200 bg-amber-50/10 dark:border-amber-900/50'
                  : 'border-border/60 bg-background/50',
              )}
            >
              <div className="flex items-center justify-between gap-1 mb-1.5">
                <span className="text-[11px] font-medium text-foreground">
                  {slot.name}
                  {slot.required && <span className="text-destructive font-bold ml-0.5">*</span>}
                </span>
                {currentPhoto ? (
                  <Badge variant="outline" className="text-[9px] bg-emerald-100/60 text-emerald-700 border-emerald-300">
                    ✓
                  </Badge>
                ) : slot.required ? (
                  <Badge variant="outline" className="text-[9px] bg-amber-100/60 text-amber-700 border-amber-300">
                    Required
                  </Badge>
                ) : (
                  <span className="text-[9px] text-muted-foreground">Optional</span>
                )}
              </div>

              <input
                ref={(el) => { fileInputRefs.current[slot.label] = el; }}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => void handleFileChange(slot.label, e)}
              />

              {currentPhoto ? (
                <div className="space-y-1">
                  <div className="relative group rounded overflow-hidden border bg-black/5 aspect-video flex items-center justify-center">
                    <img src={currentPhoto.dataUri} alt={slot.name} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                      <Button type="button" size="sm" variant="secondary" className="h-6 px-1.5 text-[10px] gap-1" onClick={() => setPreviewPhoto(currentPhoto)}>
                        <Eye className="h-3 w-3" /> View
                      </Button>
                      <Button type="button" size="sm" variant="destructive" className="h-6 px-1.5 text-[10px] gap-1" onClick={() => handleRemove(slot.label)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-[9px] text-muted-foreground text-center">{(currentPhoto.sizeBytes / 1024).toFixed(0)} KB</p>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => fileInputRefs.current[slot.label]?.click()}
                  className={cn(
                    'flex flex-col items-center justify-center rounded border-2 border-dashed p-3 text-center cursor-pointer transition-colors aspect-video',
                    slot.required
                      ? 'border-amber-300 hover:border-amber-400 bg-amber-500/5 hover:bg-amber-500/10'
                      : 'border-border hover:border-primary/50 hover:bg-muted/30',
                  )}
                >
                  {isProcessing ? (
                    <div className="flex flex-col items-center gap-1">
                      <Spinner size="sm" />
                      <span className="text-[10px] text-muted-foreground">Processing...</span>
                    </div>
                  ) : (
                    <>
                      <Camera className="h-5 w-5 text-muted-foreground/70 mb-1" />
                      <span className="text-[10px] font-medium text-foreground">
                        {slot.required ? `Upload ${slot.name}` : slot.name}
                      </span>
                      <span className="text-[9px] text-muted-foreground">JPG / PNG / WEBP &lt; 5 MB</span>
                    </>
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Preview lightbox */}
      {previewPhoto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4" onClick={() => setPreviewPhoto(null)}>
          <div className="relative max-h-[90vh] max-w-3xl overflow-hidden rounded-lg bg-background p-3 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b pb-2 px-1">
              <span className="text-sm font-semibold capitalize">{previewPhoto.label.replace('_', ' ')} Photo Preview</span>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7 rounded-full" onClick={() => setPreviewPhoto(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="p-2 flex items-center justify-center max-h-[75vh]">
              <img src={previewPhoto.dataUri} alt="Enlarged view" className="max-h-[70vh] w-auto rounded object-contain" />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground border-t pt-2 px-1">
              <span>Size: {(previewPhoto.sizeBytes / 1024).toFixed(0)} KB</span>
              <span>Captured: {previewPhoto.capturedAt.slice(0, 19).replace('T', ' ')}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main modal component
// ---------------------------------------------------------------------------
export function AssignDeviceModal({
  item,
  onClose,
  source = 'inventory',
}: AssignDeviceModalProps) {
  const { user } = useAuth();
  const isBenchmark = source === 'benchmark';
  const hasSoleOwner = !isBenchmark && Boolean(item.owner && item.owner !== 'IT Stock');
  const [selectedEmpCode, setSelectedEmpCode] = useState<string>('');
  const [customEmployeeName, setCustomEmployeeName] = useState<string>('');
  const [customEmployeeId, setCustomEmployeeId] = useState<string>('');
  const [assignedFrom, setAssignedFrom] = useState<string>(
    isBenchmark
      ? (item.warehouseLocation || 'Benchmark Lab Pool')
      : hasSoleOwner
        ? `Owner's Inventory (${item.owner})`
        : (item.inventoryHolder || item.warehouseLocation || 'IT Stock'),
  );
  const [requestedBy, setRequestedBy] = useState<string>('');
  const [assignedAt, setAssignedAt] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState<string>('');
  const [assignmentPhotos, setAssignmentPhotos] = useState<PhotoRecord[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<boolean>(false);

  // Fetch employees to assign to
  const { data: teamMembers, isLoading: membersLoading } = useQuery<AuthUser[]>({
    queryKey: [isBenchmark ? 'benchmark-assignees' : 'team-members'],
    queryFn: () =>
      apiClient.get<AuthUser[]>(isBenchmark ? '/benchmark/assignees' : '/auth/team-members'),
  });

  const inventoryMutations = useAssignmentMutations();
  const benchmarkMutations = useBenchmarkAssignmentMutations();
  const create = isBenchmark ? benchmarkMutations.create : inventoryMutations.create;

  const handleAssign = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setPhotoError(null);

    let empName = '';
    let empId = '';

    if (selectedEmpCode === '__CUSTOM__') {
      if (!customEmployeeName.trim() || !customEmployeeId.trim()) {
        setError('Please provide employee name and employee code / email.');
        return;
      }
      empName = customEmployeeName.trim();
      empId = customEmployeeId.trim();
    } else {
      const found = (teamMembers ?? []).find((m) => m.empCode === selectedEmpCode);
      if (!found) {
        setError('Please select an employee to assign this device to.');
        return;
      }
      empName = found.name;
      empId = found.empCode;
    }

    // Validate mandatory photos
    const hasFront = assignmentPhotos.some((p) => p.label === 'front');
    const hasBack = assignmentPhotos.some((p) => p.label === 'back');
    if (!hasFront || !hasBack) {
      setPhotoError('Mandatory photos required: Both Front and Back photos of the device must be uploaded before assigning.');
      return;
    }

    const defaultSource = isBenchmark
      ? 'Benchmark Lab Pool'
      : hasSoleOwner
        ? `Owner's Inventory (${item.owner})`
        : 'IT Stock';
    const noteSuffix = isBenchmark
      ? `Benchmark Inventory | Owner: ${item.owner || 'Benchmark Lab'}`
      : `Sole Owner: ${item.owner || 'IT Stock'}`;

    create.mutate(
      {
        itemId: item.imei1 || item.itemId,
        itemName: `${item.brand} ${item.deviceModel}`,
        employeeName: empName,
        employeeId: empId,
        assignedAt,
        assignedFrom: assignedFrom.trim() || defaultSource,
        assignedBy: user ? `${user.name} (${user.empCode})` : 'System Admin',
        assignedByRole: user?.role || 'Admin',
        requestedBy: requestedBy.trim() || undefined,
        notes: notes.trim()
          ? `${notes.trim()} (Task allocation | ${noteSuffix})`
          : `Task allocation from ${isBenchmark ? 'benchmark lab' : 'inventory'} (${item.warehouseLocation || 'Stock'}) | ${noteSuffix}`,
        status: 'Active',
        assignmentPhotos,
      },
      {
        onSuccess: () => {
          setSuccess(true);
          setTimeout(() => { onClose(); }, 1200);
        },
        onError: (err) => {
          setError(
            err instanceof Error ? err.message : 'Failed to assign device. Please try again.',
          );
        },
      },
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      role="dialog"
      aria-modal="true"
    >
      <Card className="max-h-[92vh] w-full max-w-xl overflow-y-auto shadow-2xl">
        <CardHeader className="flex flex-row items-center justify-between pb-3 bg-muted/20 border-b">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5 text-primary" />
              Assign Device to Employee
            </CardTitle>
            <CardDescription>
              Assign hardware to a team member. The device will be removed from available stock and
              logged in the Assignments registry.
            </CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close dialog">
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>

        <CardContent className="pt-4 space-y-4">
          {/* Selected Device Preview Banner */}
          <div className="rounded-lg border bg-primary/5 border-primary/20 p-3.5 space-y-2">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-primary">
                  Selected Hardware
                </span>
                <h4 className="text-base font-bold text-foreground">
                  {item.brand} {item.deviceModel}
                </h4>
              </div>
              <Badge variant="outline" className="font-mono text-xs">
                {item.sampleHwType || 'Sample'}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground pt-1">
              <div>
                <span className="font-medium text-foreground">IMEI1: </span>
                <span className="font-mono">{item.imei1}</span>
              </div>
              <div>
                <span className="font-medium text-foreground">VC ID: </span>
                <span className="font-mono text-primary font-semibold">{item.vcId}</span>
              </div>
              {item.storageRam && (
                <div>
                  <span className="font-medium text-foreground">Storage/RAM: </span>
                  <span>{item.storageRam}</span>
                </div>
              )}
              <div>
                <span className="font-medium text-foreground">Location: </span>
                <span>{item.warehouseLocation}</span>
              </div>
            </div>

            {hasSoleOwner && (
              <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
                <ShieldCheck className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Immutable Sole Owner: {item.owner}</p>
                  <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80">
                    This hardware belongs to {item.owner}. Assigning delegates physical custody for tasks/testing only; ownership remains strictly and permanently locked to this owner.
                  </p>
                </div>
              </div>
            )}
          </div>

          {success ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-5 text-center space-y-2">
              <CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto" />
              <p className="font-semibold text-emerald-800 dark:text-emerald-300">
                Device successfully assigned!
              </p>
              <p className="text-xs text-muted-foreground">
                The device has been removed from available stock and recorded in the Assignments table.
              </p>
            </div>
          ) : (
            <form onSubmit={handleAssign} className="space-y-4">
              {/* Select Employee Dropdown */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Assign To Employee <span className="text-destructive">*</span>
                </label>

                {membersLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading employee directory…
                  </div>
                ) : (
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    value={selectedEmpCode}
                    required
                    onChange={(e) => setSelectedEmpCode(e.target.value)}
                  >
                    <option value="">-- Choose Employee / Team Member --</option>
                    {(teamMembers ?? []).map((m) => (
                      <option key={m.id} value={m.empCode}>
                        {m.name} ({m.empCode}) — {m.team} [{m.role}]
                      </option>
                    ))}
                    <option value="__CUSTOM__">Other (Enter custom employee details)</option>
                  </select>
                )}
              </div>

              {/* Custom Employee Inputs if selected */}
              {selectedEmpCode === '__CUSTOM__' && (
                <div className="grid gap-3 sm:grid-cols-2 rounded-md border p-3 bg-muted/20">
                  <div className="space-y-1">
                    <label className="text-xs font-medium">
                      Employee Full Name <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. John Doe"
                      value={customEmployeeName}
                      onChange={(e) => setCustomEmployeeName(e.target.value)}
                      className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">
                      Employee Code / Email <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. 19101234 or email"
                      value={customEmployeeId}
                      onChange={(e) => setCustomEmployeeId(e.target.value)}
                      className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                </div>
              )}

              {/* Custody Source & Requisition Reference */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    Sourced From (Inventory Stock)
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. IT Stock / WH-1 (Main Hub)"
                    value={assignedFrom}
                    onChange={(e) => setAssignedFrom(e.target.value)}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <p className="text-[11px] text-muted-foreground">Original warehouse / custodian holding unit.</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                    Requested By (Optional Reference)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Rohan Raj Singh (Req #402)"
                    value={requestedBy}
                    onChange={(e) => setRequestedBy(e.target.value)}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <p className="text-[11px] text-muted-foreground">Name or ticket if requested in advance.</p>
                </div>
              </div>

              {/* Assigned Date & Assigner Stamp */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    Assignment Date <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={assignedAt}
                    onChange={(e) => setAssignedAt(e.target.value)}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-muted-foreground">
                    Assigned By (Dispatcher)
                  </label>
                  <div className="h-10 flex items-center px-3 rounded-md border bg-muted/30 text-xs font-semibold text-foreground">
                    {user?.name || 'System Admin'} ({user?.empCode || 'Admin'}, {user?.role || 'Admin'})
                  </div>
                </div>
              </div>

              {/* Notes / Purpose */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Allocation Remarks / Project Purpose
                </label>
                <input
                  type="text"
                  placeholder="e.g. Assigned for camera benchmarking trial (Sprint 4)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              {/* Photo Upload Section */}
              <PhotoUploadSection
                photos={assignmentPhotos}
                onChange={setAssignmentPhotos}
                error={photoError}
              />

              {error && (
                <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="outline" type="button" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" disabled={create.isPending || !selectedEmpCode}>
                  {create.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Assigning…
                    </>
                  ) : (
                    'Confirm & Assign Device'
                  )}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
