/*
  Activity Center — public barrel.
  Import from "@/lib/activity" everywhere.
*/
export * from "./types";
export * from "./config";
export {
  currentUserName,
  logActivity,
  logActivityBatch,
  getLocalActivity,
  onActivityChange,
} from "./log";
