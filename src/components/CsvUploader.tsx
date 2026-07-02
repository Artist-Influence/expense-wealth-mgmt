import { useCallback } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { Upload } from 'lucide-react';
import { toast } from 'sonner';

interface CsvUploaderProps {
  onFilesSelect: (files: File[]) => void;
  disabled: boolean;
}

export function CsvUploader({ onFilesSelect, disabled }: CsvUploaderProps) {
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      onFilesSelect(acceptedFiles);
    }
  }, [onFilesSelect]);

  const onDropRejected = useCallback((rejections: FileRejection[]) => {
    rejections.forEach((r) => {
      const reason = r.errors.some((e) => e.code === 'file-too-large')
        ? 'File too large (max 15 MB)'
        : r.errors[0]?.message || 'File rejected';
      toast.error(`${r.file.name}: ${reason}`);
    });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    accept: { 'text/csv': ['.csv'] },
    maxSize: 15 * 1024 * 1024,
    multiple: true,
    disabled,
  });

  return (
    <div
      {...getRootProps()}
      className={`glass-panel p-8 text-center cursor-pointer transition-all glow-hover ${
        isDragActive ? 'border-primary/50 bg-primary/5' : ''
      } ${disabled ? 'opacity-60 pointer-events-none' : ''}`}
    >
      <input {...getInputProps()} />
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
          <Upload className="h-6 w-6 text-primary" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">
            {isDragActive ? 'Drop CSVs here...' : 'Drop CSVs here or click to upload'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Multiple files supported · Payment method auto-detected from filename
          </p>
        </div>
      </div>
    </div>
  );
}
