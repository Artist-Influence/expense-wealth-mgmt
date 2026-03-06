import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileText, CheckCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface CsvUploaderProps {
  onFileSelect: (file: File) => void;
  isProcessing: boolean;
}

export function CsvUploader({ onFileSelect, isProcessing }: CsvUploaderProps) {
  const [fileName, setFileName] = useState<string | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      setFileName(file.name);
      onFileSelect(file);
    }
  }, [onFileSelect]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'] },
    multiple: false,
    disabled: isProcessing,
  });

  return (
    <div
      {...getRootProps()}
      className={`glass-panel p-8 text-center cursor-pointer transition-all glow-hover ${
        isDragActive ? 'border-primary/50 bg-primary/5' : ''
      } ${isProcessing ? 'opacity-60 pointer-events-none' : ''}`}
    >
      <input {...getInputProps()} />
      
      {isProcessing ? (
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Processing {fileName}...</p>
        </div>
      ) : fileName ? (
        <div className="flex flex-col items-center gap-3">
          <CheckCircle className="h-8 w-8 text-success" />
          <p className="text-sm text-foreground font-medium">{fileName}</p>
          <p className="text-xs text-muted-foreground">Drop another CSV or click to replace</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
            <Upload className="h-6 w-6 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Drop CSV here or click to upload</p>
            <p className="mt-1 text-xs text-muted-foreground">Supports standard expense CSV format</p>
          </div>
        </div>
      )}
    </div>
  );
}
