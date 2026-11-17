export { filesError, type FilesError, type FilesErrorCode } from "./errors.ts";
export { createFileIndex, type FileIndex, type IndexedRepo } from "./file-index.ts";
export { fuzzyScore, fuzzyScores, preparePaths, queryCodes, scorePrepared, scoreScratch, type PreparedPaths, type ScoreScratch } from "./fuzzy.ts";
export { defaultFilesLimits, type FileInfo, type FileKind, type FilesLimits, type FilesServiceDeps, type FileStat } from "./ports.ts";
export { compareRanked, createPathRanker, type PathRanker, type RankedPath } from "./ranking.ts";
export { createFilesService, type FileEntryInfo, type FilesResult, type FilesService, type FileText, type QuickOpenMatch } from "./service.ts";
