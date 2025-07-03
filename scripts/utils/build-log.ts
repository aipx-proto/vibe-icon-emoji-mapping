// Build logging system
interface BuildLogEntry {
  timestamp: string;
  stage: string;
  level: "info" | "warn" | "error";
  message: string;
  details?: any;
}

interface BuildLog {
  startTime: string;
  endTime?: string;
  commit?: string;
  summary: {
    totalIcons: number;
    processedIcons: number;
    totalErrors: number;
    stageErrors: {
      processing: number;
      compiling: number;
      metadata: number;
    };
  };
  sizeStats?: any;
  entries: BuildLogEntry[];
}

export const buildLog: BuildLog = {
  startTime: new Date().toISOString(),
  summary: {
    totalIcons: 0,
    processedIcons: 0,
    totalErrors: 0,
    stageErrors: {
      processing: 0,
      compiling: 0,
      metadata: 0,
    },
  },
  entries: [],
};

export function logEntry(stage: string, level: "info" | "warn" | "error", message: string, details?: any) {
  buildLog.entries.push({
    timestamp: new Date().toISOString(),
    stage,
    level,
    message,
    details,
  });

  if (level === "error" || level === "warn") {
    buildLog.summary.totalErrors++;
    if (stage === "processing") buildLog.summary.stageErrors.processing++;
    else if (stage === "compiling") buildLog.summary.stageErrors.compiling++;
    else if (stage === "metadata") buildLog.summary.stageErrors.metadata++;
  }
}
